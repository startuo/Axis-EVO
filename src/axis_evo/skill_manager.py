"""Immutable version creation, explicit lifecycle promotion and verified reads."""

from dataclasses import dataclass
import hashlib
import sqlite3

from .events import utc_now
from .skill_card import SkillCard, SkillRef, SkillSource, skill_card_from_json
from .skill_storage import _insert_one, _skill_transaction


_STATES = ("CANDIDATE", "SHADOW", "TRUSTED")


class SkillIntegrityError(ValueError):
    """Persisted Skill facts disagree; no repair is attempted."""


@dataclass(frozen=True)
class SkillStateEvent:
    ref: SkillRef
    transition_seq: int
    state: str
    occurred_at: str


class SkillManager:
    """Holds a caller-owned connection; never initializes schema implicitly."""

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def _rows(self, sql: str, parameters: tuple) -> list[sqlite3.Row]:
        cursor = self.connection.cursor()
        cursor.row_factory = sqlite3.Row
        try:
            return cursor.execute(sql, parameters).fetchall()
        finally:
            cursor.close()

    def _version_row(self, ref: SkillRef) -> sqlite3.Row:
        rows = self._rows("""SELECT v.*, s.created_at AS identity_created_at,
                             (SELECT COUNT(*) FROM skill_versions WHERE skill_id=v.skill_id) AS version_count,
                             (SELECT MAX(skill_version) FROM skill_versions WHERE skill_id=v.skill_id) AS latest_version,
                             (SELECT COUNT(*) FROM skill_versions WHERE skill_id=v.skill_id
                              AND (typeof(skill_version) != 'integer' OR skill_version < 1)) AS invalid_versions
                             FROM skill_versions AS v
                             LEFT JOIN skills AS s ON s.skill_id=v.skill_id
                             WHERE v.skill_id=? AND v.skill_version=?""",
                          (ref.skill_id, ref.skill_version))
        if not rows:
            raise KeyError((ref.skill_id, ref.skill_version))
        return rows[0]

    def _decode_card(self, row: sqlite3.Row) -> SkillCard:
        try:
            if type(row["card_json"]) is not str:
                raise ValueError("card_json must be text")
            card = skill_card_from_json(row["card_json"])
            if row["invalid_versions"] or row["version_count"] != row["latest_version"]:
                raise ValueError("Skill versions are not contiguous from 1")
            data = card.canonical_bytes()
            source = card.source.ref
            if (type(row["skill_version"]) is not int or type(row["schema_version"]) is not int
                    or card.skill_id != row["skill_id"] or card.skill_version != row["skill_version"]
                    or card.schema_version != row["schema_version"] or card.source.kind != row["source_kind"]
                    or row["source_skill_id"] != (source.skill_id if source else None)
                    or row["source_skill_version"] != (source.skill_version if source else None)
                    or (source is not None and type(row["source_skill_version"]) is not int)
                    or row["card_json"].encode("utf-8") != data
                    or hashlib.sha256(data).hexdigest() != row["card_sha256"]):
                raise ValueError("card identity, source, canonical bytes or hash disagree")
            if card.skill_version > 1 and card.source.kind != "DERIVED":
                raise ValueError("later versions require explicit lineage")
            if source is not None and source.skill_id == card.skill_id and source.skill_version >= card.skill_version:
                raise ValueError("same-skill lineage must reference an earlier version")
            for name in ("created_at", "identity_created_at"):
                if type(row[name]) is not str or not row[name].strip():
                    raise ValueError(f"{name} must be nonempty text")
                row[name].encode("utf-8")
            return card
        except (TypeError, ValueError, RecursionError) as error:
            raise SkillIntegrityError(f"Invalid persisted Skill Card: {error}") from error

    def _history(self, ref: SkillRef) -> tuple[SkillStateEvent, ...]:
        rows = self._rows("""SELECT transition_seq, state, occurred_at FROM skill_state_events
                             WHERE skill_id=? AND skill_version=? ORDER BY transition_seq""",
                          (ref.skill_id, ref.skill_version))
        if not 1 <= len(rows) <= len(_STATES):
            raise SkillIntegrityError("Lifecycle history must be a nonempty CANDIDATE/SHADOW/TRUSTED prefix")
        history = []
        for index, row in enumerate(rows, 1):
            if (type(row["transition_seq"]) is not int or row["transition_seq"] != index
                    or row["state"] != _STATES[index - 1] or type(row["occurred_at"]) is not str
                    or not row["occurred_at"].strip()):
                raise SkillIntegrityError("Lifecycle history has an invalid sequence or transition")
            try:
                row["occurred_at"].encode("utf-8")
            except UnicodeError as error:
                raise SkillIntegrityError("Lifecycle timestamp is not valid UTF-8") from error
            history.append(SkillStateEvent(ref, index, row["state"], row["occurred_at"]))
        return tuple(history)

    def get_version(self, skill_id: str, skill_version: int) -> SkillCard:
        ref = SkillRef(skill_id, skill_version)
        card = self._decode_card(self._version_row(ref))
        self._history(ref)
        seen = {ref}
        source = card.source.ref
        while source is not None:
            if source in seen:
                raise SkillIntegrityError("Skill lineage contains a cycle")
            seen.add(source)
            try:
                ancestor = self._decode_card(self._version_row(source))
            except KeyError as error:
                raise SkillIntegrityError("Skill lineage references a missing version") from error
            self._history(source)
            source = ancestor.source.ref
        return card

    def list_versions(self, skill_id: str) -> tuple[SkillCard, ...]:
        SkillRef(skill_id, 1)
        rows = self._rows("SELECT skill_version FROM skill_versions WHERE skill_id=? ORDER BY skill_version", (skill_id,))
        if not rows:
            raise KeyError(skill_id)
        if any(type(row[0]) is not int or row[0] != index for index, row in enumerate(rows, 1)):
            raise SkillIntegrityError("Skill versions are not contiguous from 1")
        return tuple(self.get_version(skill_id, row[0]) for row in rows)

    def get_state_history(self, skill_id: str, skill_version: int) -> tuple[SkillStateEvent, ...]:
        card = self.get_version(skill_id, skill_version)
        return self._history(card.ref)

    def get_current_state(self, skill_id: str, skill_version: int) -> str:
        return self.get_state_history(skill_id, skill_version)[-1].state

    def create_version(self, skill_id: str, *, name: str, description: str, instructions: str,
                       allowed_tools: list[str], source: SkillSource = SkillSource("MANUAL")) -> SkillCard:
        # Snapshot every caller-owned value before waiting for the write lock.
        draft = SkillCard(skill_id, 1, name, description, instructions, allowed_tools, source)
        with _skill_transaction(self.connection):
            exists = bool(self._rows("SELECT 1 FROM skills WHERE skill_id=?", (skill_id,)))
            count, maximum = self._rows(
                "SELECT COUNT(*), COALESCE(MAX(skill_version), 0) FROM skill_versions WHERE skill_id=?", (skill_id,))[0]
            if count != maximum or exists != bool(count):
                raise SkillIntegrityError("Logical identity and contiguous version history disagree")
            if maximum:
                self.get_version(skill_id, maximum)
            version = maximum + 1
            if version > 1 and draft.source.kind != "DERIVED":
                raise ValueError("versions after v1 must be DERIVED")
            if draft.source.ref is not None:
                self.get_version(draft.source.ref.skill_id, draft.source.ref.skill_version)
            card = SkillCard(skill_id, version, draft.name, draft.description, draft.instructions,
                             list(draft.allowed_tools), draft.source)
            data = card.canonical_bytes()
            created_at = utc_now()
            if not exists:
                _insert_one(self.connection, "INSERT INTO skills(skill_id, created_at) VALUES (?, ?)", (skill_id, created_at))
            source_ref = card.source.ref
            _insert_one(self.connection, """INSERT INTO skill_versions (
                skill_id, skill_version, schema_version, card_json, card_sha256, source_kind,
                source_skill_id, source_skill_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (skill_id, version, card.schema_version, data.decode("utf-8"), hashlib.sha256(data).hexdigest(),
                 card.source.kind, source_ref.skill_id if source_ref else None,
                 source_ref.skill_version if source_ref else None, created_at))
            _insert_one(self.connection, """INSERT INTO skill_state_events
                (skill_id, skill_version, transition_seq, state, occurred_at) VALUES (?, ?, 1, 'CANDIDATE', ?)""",
                (skill_id, version, created_at))
        return card

    def promote(self, skill_id: str, skill_version: int, target_state: str) -> SkillStateEvent:
        ref = SkillRef(skill_id, skill_version)
        if type(target_state) is not str or target_state not in _STATES:
            raise ValueError("target_state must be CANDIDATE, SHADOW or TRUSTED")
        with _skill_transaction(self.connection):
            self.get_version(skill_id, skill_version)
            history = self._history(ref)
            if len(history) == len(_STATES) or target_state != _STATES[len(history)]:
                raise ValueError(f"invalid lifecycle transition: {history[-1].state} -> {target_state}")
            event = SkillStateEvent(ref, history[-1].transition_seq + 1, target_state, utc_now())
            _insert_one(self.connection, """INSERT INTO skill_state_events
                (skill_id, skill_version, transition_seq, state, occurred_at) VALUES (?, ?, ?, ?, ?)""",
                (skill_id, skill_version, event.transition_seq, event.state, event.occurred_at))
        return event

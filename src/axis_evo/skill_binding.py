"""Explicit Skill authorization and read-only provenance for deterministic calls.

A durable binding is authorization evidence, not proof of external execution or
semantic interpretation of a Skill's natural-language instructions.
"""

from collections import Counter, defaultdict
from contextlib import contextmanager
from copy import deepcopy
import hashlib
from importlib.resources import files
import json
import re
import sqlite3

from .events import utc_now
from .hashing import canonical_json_bytes
from .models import PlanStep
from .skill_card import SkillRef
from .skill_manager import SkillManager
from .skill_storage import _check_write_context, _insert_one, _schema_objects, _skill_transaction


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _text(value, name):
    if type(value) is not str or not value.strip() or "\x00" in value:
        raise ValueError(f"{name} must be nonempty UTF-8 text without NUL")
    value.encode("utf-8")


def _ref(value):
    if type(value) is not SkillRef:
        raise TypeError("skill_ref must be an exact SkillRef")
    return SkillRef(value.skill_id, value.skill_version)


def _step(value):
    # Delayed reuse avoids a runner -> binding -> runner import cycle.
    from .runner import _validate_json_native
    if type(value) is not PlanStep or type(value.arguments) is not dict:
        raise TypeError("binding requires a PlanStep with JSON object arguments")
    _text(value.step_id, "step_id")
    _text(value.tool_name, "tool_name")
    _validate_json_native(value.arguments)
    snapshot = PlanStep(value.step_id, value.tool_name, deepcopy(value.arguments))
    canonical_json_bytes(snapshot.arguments)
    return snapshot


def _rows(connection, sql, parameters=()):
    cursor = connection.cursor()
    cursor.row_factory = sqlite3.Row
    try:
        return cursor.execute(sql, parameters).fetchall()
    finally:
        cursor.close()


def _binding_objects(connection):
    return tuple(tuple(row) for row in _rows(connection, """SELECT type, name, tbl_name, sql
        FROM main.sqlite_master WHERE tbl_name = 'skill_invocation_bindings'
          AND name NOT LIKE 'sqlite_%' ORDER BY type, name"""))


def _require_main_namespace(connection):
    # Frozen SkillManager queries also use these names. Never authorize against
    # connection-local substitutes that disappear at close or hard exit.
    if _rows(connection, """SELECT 1 FROM temp.sqlite_master WHERE type IN ('table', 'view')
        AND name COLLATE NOCASE IN ('runs', 'events', 'skills', 'skill_versions', 'skill_state_events',
                     'skill_invocation_bindings') LIMIT 1"""):
        raise ValueError("Skill binding rejects TEMP shadowing of persistent facts")


def _expected_schema():
    migration = files("axis_evo").joinpath("migrations")
    second = migration.joinpath("002_phase2_skills.sql").read_text(encoding="utf-8")
    third = migration.joinpath("003_phase2_skill_bindings.sql").read_text(encoding="utf-8")
    reference = sqlite3.connect(":memory:")
    try:
        reference.executescript(second + "\n" + third)
        return third, _schema_objects(reference), _binding_objects(reference)
    finally:
        reference.close()


def _json1(connection):
    try:
        row = connection.execute("SELECT json_valid('{}'), value FROM json_each('[\"probe\"]')").fetchone()
        if row is None or tuple(row) != (1, "probe"):
            raise ValueError("SQLite JSON1 is required for Skill binding authorization")
    except sqlite3.Error as error:
        raise ValueError("SQLite JSON1 is required for Skill binding authorization") from error


def _require_binding_schema(connection):
    _require_main_namespace(connection)
    _, _, expected = _expected_schema()
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"runs", "events", "skills", "skill_versions", "skill_state_events"}.issubset(names):
        raise ValueError("Skill binding requires explicit migrations 001, 002 and 003")
    if _binding_objects(connection) != expected:
        raise ValueError("Skill binding schema is missing or differs from migration 003")
    _json1(connection)


def initialize_skill_binding_schema(connection: sqlite3.Connection) -> None:
    """Explicitly apply migration 003 atomically, preserving the caller's settings."""
    _check_write_context(connection)
    _require_main_namespace(connection)
    _json1(connection)
    third, expected_second, expected_third = _expected_schema()
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"runs", "events"}.issubset(names) or _schema_objects(connection) != expected_second:
        raise ValueError("Skill binding initialization requires migrations 001 and 002")
    try:
        connection.executescript("BEGIN IMMEDIATE;\n" + third)
        if _binding_objects(connection) != expected_third:
            raise sqlite3.IntegrityError("Skill binding schema differs from migration 003")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


@contextmanager
def _read_snapshot(connection):
    if connection.in_transaction:
        raise ValueError("Skill inspection/preflight rejects an active caller transaction")
    connection.execute("BEGIN")
    try:
        yield
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _authorized_card(connection, ref, steps):
    manager = SkillManager(connection)
    card = manager.get_version(ref.skill_id, ref.skill_version)
    if manager.get_current_state(ref.skill_id, ref.skill_version) != "TRUSTED":
        raise ValueError("Normal Skill-bound execution requires TRUSTED state")
    for step in steps:
        if step.tool_name not in card.allowed_tools:
            raise ValueError(f"Tool is outside Skill allowed_tools: {step.tool_name}")
    return card


def preflight_skill_binding(connection: sqlite3.Connection, steps, skill_ref: SkillRef) -> SkillRef:
    """Authorize the entire snapshotted plan before workspace/run creation."""
    ref = _ref(skill_ref)
    snapshots = tuple(_step(step) for step in steps)
    if not snapshots:
        raise ValueError("A Skill-bound plan must contain at least one PlanStep")
    _check_write_context(connection)
    with _read_snapshot(connection):
        _require_binding_schema(connection)
        _authorized_card(connection, ref, snapshots)
    return ref


def record_skill_invocation_binding(connection: sqlite3.Connection, run_id: str, tool_call_id: str,
                                    step: PlanStep, skill_ref: SkillRef) -> dict:
    """Commit one immutable authorization before any events for this invocation."""
    _text(run_id, "run_id")
    _text(tool_call_id, "tool_call_id")
    ref, snapshot = _ref(skill_ref), _step(step)
    with _skill_transaction(connection):
        _require_binding_schema(connection)
        runs = _rows(connection, "SELECT status, ended_at FROM runs WHERE run_id=?", (run_id,))
        if not runs or runs[0]["status"] != "RUNNING" or runs[0]["ended_at"] is not None:
            raise ValueError("Skill binding requires a RUNNING Run")
        if _rows(connection, "SELECT 1 FROM events WHERE run_id=? AND tool_call_id=? LIMIT 1", (run_id, tool_call_id)):
            raise ValueError("Skill binding must precede invocation events")
        card = _authorized_card(connection, ref, (snapshot,))
        binding = {"run_id": run_id, "tool_call_id": tool_call_id, "step_id": snapshot.step_id,
                   "tool_name": snapshot.tool_name,
                   "arguments_sha256": hashlib.sha256(canonical_json_bytes(snapshot.arguments)).hexdigest(),
                   "skill_id": ref.skill_id, "skill_version": ref.skill_version,
                   "card_sha256": hashlib.sha256(card.canonical_bytes()).hexdigest(),
                   "bound_state": "TRUSTED", "bound_at": utc_now()}
        _insert_one(connection, """INSERT INTO main.skill_invocation_bindings
            (run_id, tool_call_id, step_id, tool_name, arguments_sha256, skill_id, skill_version,
             card_sha256, bound_state, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", tuple(binding.values()))
    return binding


def _safe(value):
    if value is None or type(value) in (str, int, bool):
        return value
    return None


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def inspect_skill_trace(connection: sqlite3.Connection, run_id: str) -> dict:
    """Read a coherent committed provenance snapshot; never infer tool causality.

    Presence fields describe persisted evidence only. Stored and verified Skill
    identities are separate. Zero bindings means LEGACY_UNBOUND, including on
    databases initialized only with migration 001.
    """
    _text(run_id, "run_id")
    with _read_snapshot(connection):
        _require_main_namespace(connection)
        runs = _rows(connection, "SELECT task_id FROM runs WHERE run_id=?", (run_id,))
        if not runs:
            raise KeyError(run_id)
        available = bool(_rows(connection, "SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='skill_invocation_bindings'"))
        bindings = [dict(row) for row in _rows(connection, "SELECT * FROM main.skill_invocation_bindings WHERE run_id=? ORDER BY tool_call_id", (run_id,))] if available else []
        events = [dict(row) for row in _rows(connection, "SELECT * FROM events WHERE run_id=? ORDER BY seq", (run_id,))]
        issues, invocations = [], []

        def issue(code, message, call=None, seq=None):
            item = {"code": code, "message": message, "tool_call_id": _safe(call), "seq": _safe(seq)}
            issues.append(item)

        groups = defaultdict(list)
        for index, event in enumerate(events, 1):
            if (type(event["seq"]) is not int or event["seq"] != index
                    or type(event["schema_version"]) is not int or event["schema_version"] != 1
                    or event["task_id"] != runs[0]["task_id"]):
                issue("EVENT_IDENTITY_MISMATCH", "Event envelope or sequence disagrees with its run", event["tool_call_id"], event["seq"])
            groups[event["tool_call_id"]].append(event)
        if bindings:
            bound_calls = {row["tool_call_id"] for row in bindings}
            calls = Counter(row["tool_call_id"] for row in bindings)
            steps = Counter(row["step_id"] for row in bindings)
            for row in bindings:
                if calls[row["tool_call_id"]] != 1 or steps[row["step_id"]] != 1:
                    issue("SKILL_BINDING_INTEGRITY", "Binding invocation/step identity is not unique", row["tool_call_id"])
                if any(event["step_id"] == row["step_id"] and event["tool_call_id"] != row["tool_call_id"]
                       and event["event_type"] in ("STEP_PLANNED", "TOOL_INTENT", "TOOL_RESULT") for event in events):
                    issue("BINDING_EVENT_MISMATCH", "Bound step is recorded under a different tool_call_id", row["tool_call_id"])
            for event in events:
                if event["event_type"] == "TOOL_INTENT" and event["tool_call_id"] not in bound_calls:
                    issue("UNBOUND_TOOL_INVOCATION", "TOOL_INTENT has no recorded Skill binding", event["tool_call_id"], event["seq"])
        for binding in bindings:
            call = binding["tool_call_id"]
            stored = {name: _safe(binding.get(name)) for name in ("skill_id", "skill_version", "card_sha256")}
            item = {"step_id": _safe(binding.get("step_id")), "tool_call_id": _safe(call),
                    "tool_name": _safe(binding.get("tool_name")), "stored_skill": stored,
                    "verified_skill": None, "arguments_sha256": _safe(binding.get("arguments_sha256")),
                    "bound_state": _safe(binding.get("bound_state")), "binding_persisted": True,
                    "step_planned_seq": None, "tool_intent_seq": None, "tool_result_seq": None}
            invocations.append(item)
            try:
                for name in ("run_id", "tool_call_id", "step_id", "tool_name", "bound_at"):
                    _text(binding[name], name)
                if binding["run_id"] != run_id:
                    raise ValueError("Binding run_id disagrees with the inspected run")
                ref = SkillRef(binding["skill_id"], binding["skill_version"])
                if binding["bound_state"] != "TRUSTED":
                    raise ValueError("bound_state must be TRUSTED")
                for name in ("card_sha256", "arguments_sha256"):
                    if type(binding[name]) is not str or _SHA256.fullmatch(binding[name]) is None:
                        raise ValueError(f"invalid {name}")
                card = _authorized_card(connection, ref, (PlanStep(binding["step_id"], binding["tool_name"], {}),))
                registry_hash = _rows(connection, "SELECT card_sha256 FROM skill_versions WHERE skill_id=? AND skill_version=?", (ref.skill_id, ref.skill_version))[0][0]
                if binding["card_sha256"] != registry_hash or registry_hash != hashlib.sha256(card.canonical_bytes()).hexdigest():
                    raise ValueError("Binding, registry and canonical Card hashes disagree")
                item["verified_skill"] = {**ref.to_dict(), "card_sha256": registry_hash}
            except (TypeError, ValueError, KeyError, sqlite3.Error, RecursionError) as error:
                issue("SKILL_BINDING_INTEGRITY", f"Skill binding cannot be verified: {type(error).__name__}", call)
            facts = groups.get(call, [])
            selected = {}
            for kind, key in (("STEP_PLANNED", "step_planned_seq"), ("TOOL_INTENT", "tool_intent_seq"), ("TOOL_RESULT", "tool_result_seq")):
                matches = [event for event in facts if event["event_type"] == kind]
                if len(matches) > 1:
                    issue("BINDING_EVENT_MISMATCH", f"Invocation has multiple {kind} rows", call)
                if len(matches) == 1:
                    selected[kind] = matches[0]
                    item[key] = _safe(matches[0]["seq"])
            for kind, event in selected.items():
                try:
                    payload = json.loads(event["payload_json"], object_pairs_hook=_object)
                    if type(payload) is not dict or event["step_id"] != binding["step_id"] or payload.get("tool_name") != binding["tool_name"]:
                        raise ValueError("Invocation identity disagrees with binding")
                    if kind != "TOOL_RESULT":
                        expected = {"tool_name", "arguments"} if kind == "STEP_PLANNED" else {"tool_name", "arguments", "mutating", "targets"}
                        if payload.keys() != expected:
                            raise ValueError("Invalid invocation payload fields")
                        if kind == "TOOL_INTENT" and (type(payload["mutating"]) is not bool
                                or type(payload["targets"]) is not list or payload["mutating"] != bool(payload["targets"])):
                            raise ValueError("Invalid TOOL_INTENT")
                        arguments = payload["arguments"]
                        snapshot = _step(PlanStep(binding["step_id"], binding["tool_name"], arguments))
                        if hashlib.sha256(canonical_json_bytes(snapshot.arguments)).hexdigest() != binding["arguments_sha256"]:
                            raise ValueError("Invocation arguments disagree with binding")
                    else:
                        if (payload.keys() != {"tool_name", "status", "message", "duration_ms", "result"}
                                or type(payload.get("status")) is not str or not payload["status"].strip()
                                or type(payload.get("message")) is not str or type(payload.get("result")) is not dict
                                or type(payload.get("duration_ms")) not in (int, float)
                                or payload["duration_ms"] < 0):
                            raise ValueError("Invalid TOOL_RESULT")
                        canonical_json_bytes(payload)
                except (TypeError, ValueError, KeyError, RecursionError):
                    issue("BINDING_EVENT_MISMATCH", f"{kind} disagrees with its Skill binding", call, event["seq"])
            planned, intent, result = (selected.get(kind) for kind in ("STEP_PLANNED", "TOOL_INTENT", "TOOL_RESULT"))
            if intent and (planned is None or type(intent["seq"]) is not int or type(planned["seq"]) is not int
                           or intent["seq"] <= planned["seq"]):
                issue("BINDING_EVENT_MISMATCH", "TOOL_INTENT requires an earlier matching STEP_PLANNED", call, intent["seq"])
            if result and (intent is None or type(result["seq"]) is not int or type(intent["seq"]) is not int
                           or result["seq"] <= intent["seq"]):
                issue("BINDING_EVENT_MISMATCH", "TOOL_RESULT requires an earlier matching TOOL_INTENT", call, result["seq"])
        return {"schema_version": 1, "run_id": run_id, "mode": "SKILL_BOUND" if bindings else "LEGACY_UNBOUND",
                "consistent": not issues, "issues": issues, "invocations": invocations}

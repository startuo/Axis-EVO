"""Explicit migration 005 and bounded immutable Episode input identities."""

from dataclasses import dataclass
import hashlib
from importlib.resources import files
from pathlib import Path, PurePosixPath
import re
import sqlite3
from uuid import uuid4

from .agent_feedback import AgentIntegrityError
from .events import utc_now
from .hashing import canonical_json_bytes
from .planning_adapter import _strict_json, _text
from .planning_provenance import _objects, _require_planning_schema, _read_schema_guard
from .runner import _resolve_seed
from .sandbox import Sandbox
from .skill_binding import _authorized_card, _read_snapshot, _ref, _rows
from .skill_card import SkillRef
from .skill_storage import _check_write_context, _insert_one, _skill_transaction
from .skill_planner import _task_data, _static_path
from .task_spec import load_task_spec
from .validators import preflight_acceptance


MAX_ATTEMPTS = 5
MAX_SEED_FILES = 256
MAX_SEED_BYTES = 1024 * 1024
MAX_SEED_MANIFEST_BYTES = 128 * 1024
_TABLES = ("agent_episodes", "agent_attempts", "agent_attempt_facts", "agent_dispatches")
_ALL_TABLES = ("runs", "events", "skills", "skill_versions", "skill_state_events",
    "skill_invocation_bindings", "plan_proposals", "plan_run_links") + _TABLES


@dataclass(frozen=True)
class AgentEpisode:
    episode_id: str
    task_spec_path: str
    task_spec_sha256: str
    seed_path: str
    seed_manifest_json: str
    seed_sha256: str
    skill_id: str
    skill_version: int
    card_sha256: str
    workspace_root: str
    adapter_name: str
    model_id: str
    max_attempts: int
    include_message_excerpts: int
    created_at: str

    @property
    def skill_ref(self):
        return SkillRef(self.skill_id, self.skill_version)


def _namespace(connection):
    marks = ",".join("?" for _ in _ALL_TABLES)
    if _rows(connection, f"SELECT 1 FROM temp.sqlite_master WHERE type IN ('table','view') "
             f"AND name COLLATE NOCASE IN ({marks}) LIMIT 1", _ALL_TABLES):
        raise AgentIntegrityError("Agent rejects TEMP shadowing of persistent facts")


def _schema_resource():
    return files("axis_evo").joinpath("migrations", "005_phase2_agent_episodes.sql").read_text(encoding="utf-8")


def _expected_objects():
    expected, statement = [], ""
    for line in _schema_resource().splitlines(keepends=True):
        statement += line
        if not sqlite3.complete_statement(statement):
            continue
        sql = statement.strip().removesuffix(";")
        match = re.match(r"CREATE (TABLE|TRIGGER) IF NOT EXISTS (\w+)", sql)
        if match is None:
            raise AgentIntegrityError("Unexpected trusted Agent migration")
        kind, name = match.groups()
        table = name if kind == "TABLE" else re.search(r" ON (\w+)\s+BEGIN", sql)[1]
        expected.append((kind.lower(), name, table,
                         sql.replace("CREATE " + kind + " IF NOT EXISTS", "CREATE " + kind, 1)))
        statement = ""
    if statement.strip():
        raise AgentIntegrityError("Incomplete trusted Agent migration")
    return tuple(sorted(expected, key=lambda row: (row[0], row[1])))


def _guard_schema(connection):
    _namespace(connection)
    _read_schema_guard(connection)
    if _objects(connection, _TABLES) != _expected_objects():
        raise AgentIntegrityError("Agent schema is missing, weak or unexpected")


def initialize_agent_episode_schema(connection):
    """Apply 005 atomically; reject caller transactions and weak prior schemas."""
    _check_write_context(connection)
    _namespace(connection)
    _require_planning_schema(connection)
    existing = _objects(connection, _TABLES)
    if existing and existing != _expected_objects():
        raise AgentIntegrityError("Existing Agent schema is weak or unexpected")
    try:
        connection.executescript("BEGIN IMMEDIATE;\n" + _schema_resource())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _absolute_directory(value):
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("Agent directory must be absolute")
    # Reject redirected ancestors as well as a redirected leaf. Resolved roots
    # are the durable identity; no workspace aliases are introduced.
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("Agent directories cannot use symlink or junction aliases")
    root = path.resolve(strict=True)
    if not root.is_dir():
        raise NotADirectoryError(root)
    return root


def seed_manifest(seed):
    """Bounded deterministic manifest including empty directories; never writes."""
    root = _absolute_directory(seed)
    sandbox = Sandbox(root)
    entries, total = [], 0

    def visit(directory):
        nonlocal total
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            if len(entries) >= MAX_SEED_FILES:
                raise ValueError("Seed exceeds entry count limit")
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                raise ValueError("Agent seed does not permit symlinks or junctions")
            sandbox.resolver.resolve(relative)
            if path.is_dir():
                entries.append({"path": relative, "type": "directory"})
                visit(path)
            elif path.is_file():
                with path.open("rb") as stream:
                    data = stream.read(MAX_SEED_BYTES - total + 1)
                total += len(data)
                if total > MAX_SEED_BYTES:
                    raise ValueError("Seed exceeds total byte limit")
                entries.append({"path": relative, "type": "file", "size_bytes": len(data),
                                "sha256": hashlib.sha256(data).hexdigest()})
            else:
                raise ValueError("Seed contains a nonregular file")
    visit(root)
    data = canonical_json_bytes({"schema_version": 1, "entries": entries})
    if len(data) > MAX_SEED_MANIFEST_BYTES:
        raise ValueError("Seed manifest exceeds byte limit")
    return data.decode("utf-8"), hashlib.sha256(data).hexdigest()


def _validate_manifest(text):
    value = _strict_json(text, MAX_SEED_MANIFEST_BYTES)
    if (type(value) is not dict or value.keys() != {"schema_version", "entries"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or type(value["entries"]) is not list or len(value["entries"]) > MAX_SEED_FILES):
        raise ValueError("Invalid seed manifest shape")
    directories, paths, total = set(), [], 0
    for item in value["entries"]:
        if type(item) is not dict or item.get("type") not in ("directory", "file"):
            raise ValueError("Invalid seed manifest entry")
        expected = {"path", "type"} | ({"size_bytes", "sha256"} if item["type"] == "file" else set())
        if item.keys() != expected:
            raise ValueError("Invalid seed manifest fields")
        path = _text(item["path"])
        _static_path(path)
        parts = PurePosixPath(path).parts
        if "\\" in path or not parts or path == "." or PurePosixPath(path).as_posix() != path:
            raise ValueError("Noncanonical seed path")
        if len(parts) > 1 and parts[:-1] not in directories:
            raise ValueError("Seed manifest lacks a parent directory")
        if item["type"] == "directory":
            directories.add(parts)
        else:
            if type(item["size_bytes"]) is not int or item["size_bytes"] < 0 or not re.fullmatch(r"[0-9a-f]{64}", _text(item["sha256"])):
                raise ValueError("Invalid seed file size or digest")
            total += item["size_bytes"]
        paths.append(parts)
    if len(set(paths)) != len(paths) or paths != sorted(paths) or total > MAX_SEED_BYTES:
        raise ValueError("Invalid seed ordering, duplicate path or size bound")
    if canonical_json_bytes(value).decode("utf-8") != text:
        raise ValueError("Noncanonical seed manifest bytes")
    return value


def _load_episode(connection, episode_id):
    _text(episode_id)
    rows = _rows(connection, "SELECT * FROM main.agent_episodes WHERE episode_id=?", (episode_id,))
    if len(rows) != 1:
        raise KeyError(episode_id)
    try:
        value = dict(rows[0])
        episode = AgentEpisode(**value)
        for key, item in value.items():
            if key not in ("max_attempts", "include_message_excerpts", "skill_version"):
                _text(item)
        if type(episode.max_attempts) is not int or not 1 <= episode.max_attempts <= MAX_ATTEMPTS:
            raise ValueError("Invalid budget")
        if type(episode.include_message_excerpts) is not int or episode.include_message_excerpts not in (0, 1):
            raise ValueError("Invalid excerpt permission")
        for key in ("task_spec_sha256", "seed_sha256", "card_sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", value[key]):
                raise ValueError("Invalid pin digest")
        for key in ("task_spec_path", "seed_path", "workspace_root"):
            if not Path(value[key]).is_absolute():
                raise ValueError("Relative persisted input identity")
        manifest = _validate_manifest(episode.seed_manifest_json)
        if canonical_json_bytes(manifest).decode("utf-8") != episode.seed_manifest_json or hashlib.sha256(episode.seed_manifest_json.encode()).hexdigest() != episode.seed_sha256:
            raise ValueError("Seed manifest hash mismatch")
        card = _authorized_card(connection, episode.skill_ref, ())
        if hashlib.sha256(card.canonical_bytes()).hexdigest() != episode.card_sha256:
            raise ValueError("Episode Card hash mismatch")
        return episode
    except (TypeError, ValueError):
        raise AgentIntegrityError("Episode identity failed integrity verification") from None


def _pinned_inputs(connection, episode, task_spec_path):
    path = Path(task_spec_path).resolve(strict=True)
    task = load_task_spec(path)
    preflight_acceptance(task)
    if str(path) != episode.task_spec_path or hashlib.sha256(canonical_json_bytes(_task_data(task))).hexdigest() != episode.task_spec_sha256:
        raise AgentIntegrityError("Episode TaskSpec changed")
    seed = _resolve_seed(path, task.workspace["seed_dir"])
    manifest, digest = seed_manifest(seed)
    if str(seed) != episode.seed_path or digest != episode.seed_sha256 or manifest != episode.seed_manifest_json:
        raise AgentIntegrityError("Episode original seed changed")
    if str(_absolute_directory(episode.workspace_root)) != episode.workspace_root:
        raise AgentIntegrityError("Episode workspace root changed")
    card = _authorized_card(connection, episode.skill_ref, ())
    if hashlib.sha256(card.canonical_bytes()).hexdigest() != episode.card_sha256:
        raise AgentIntegrityError("Episode Skill Card changed")
    return task, card


def create_agent_episode(connection, task_spec_path, skill_ref, workspace_root,
                         adapter_name, model_id, *, max_attempts=3, episode_id=None,
                         include_message_excerpts=False):
    _check_write_context(connection)
    if type(max_attempts) is not int or not 1 <= max_attempts <= MAX_ATTEMPTS:
        raise ValueError("max_attempts must be an exact integer between 1 and 5")
    if type(include_message_excerpts) is not bool:
        raise ValueError("Excerpt permission must be bool")
    ref = _ref(skill_ref)
    path = Path(task_spec_path).resolve(strict=True)
    task = load_task_spec(path)
    preflight_acceptance(task)
    seed = _resolve_seed(path, task.workspace["seed_dir"])
    manifest, seed_hash = seed_manifest(seed)
    root = _absolute_directory(workspace_root)
    if root.is_relative_to(path.parent) or path.parent.is_relative_to(root):
        raise ValueError("Episode workspaces must be separate from task assets")
    with _skill_transaction(connection):
        _guard_schema(connection)
        card = _authorized_card(connection, ref, ())
        row = {"episode_id": _text(episode_id) if episode_id is not None else "episode_" + uuid4().hex,
            "task_spec_path": str(path), "task_spec_sha256": hashlib.sha256(canonical_json_bytes(_task_data(task))).hexdigest(),
            "seed_path": str(seed), "seed_manifest_json": manifest, "seed_sha256": seed_hash,
            **ref.to_dict(), "card_sha256": hashlib.sha256(card.canonical_bytes()).hexdigest(),
            "workspace_root": str(root), "adapter_name": _text(adapter_name), "model_id": _text(model_id),
            "max_attempts": max_attempts, "include_message_excerpts": int(include_message_excerpts), "created_at": utc_now()}
        _insert_one(connection, "INSERT INTO main.agent_episodes (" + ",".join(row) + ") VALUES (" + ",".join("?" for _ in row) + ")", tuple(row.values()))
        episode = _load_episode(connection, row["episode_id"])
        _pinned_inputs(connection, episode, path)
    return episode

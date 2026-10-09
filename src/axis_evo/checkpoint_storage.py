"""Explicit migration 006; immutable, self-contained checkpoint publication."""

from dataclasses import dataclass
from importlib.resources import files
import re
import sqlite3

from .agent_episode_storage import _guard_schema as _agent_schema
from .planning_provenance import _objects, _require_planning_schema
from .skill_binding import _rows
from .skill_storage import _check_write_context


MAX_ENTRIES = 256
MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024
MAX_SNAPSHOT_BYTES = 512 * 1024
_TABLES = ("checkpoint_records", "checkpoint_artifacts")


class CheckpointIntegrityError(ValueError):
    """Evidence cannot be certified; no repair or execution is authorized."""


@dataclass(frozen=True)
class CheckpointRecord:
    checkpoint_id: str
    schema_version: int
    run_id: str
    checkpoint_kind: str
    event_cursor_seq: int
    event_prefix_sha256: str
    task_spec_sha256: str
    skill_id: str | None
    skill_version: int | None
    card_sha256: str | None
    proposal_id: str | None
    plan_sha256: str | None
    workspace_root: str
    workspace_manifest_json: str
    workspace_manifest_sha256: str
    snapshot_json: str
    snapshot_sha256: str
    captured_at: str


def _schema_resource():
    return files("axis_evo").joinpath("migrations", "006_phase3_checkpoints.sql").read_text(encoding="utf-8")


def _ddl_objects(source):
    # Parse trusted DDL without executing migrations in a normal read API.
    result, statement = [], ""
    for line in source.splitlines(keepends=True):
        statement += line
        if not sqlite3.complete_statement(statement):
            continue
        sql = statement.strip().removesuffix(";")
        match = re.match(r"CREATE (TABLE|TRIGGER|INDEX) IF NOT EXISTS (\w+)", sql)
        if match is None:
            raise CheckpointIntegrityError("Unexpected trusted checkpoint migration")
        kind, name = match.groups()
        table = name if kind == "TABLE" else re.search(r" ON (\w+)", sql)[1]
        result.append((kind.lower(), name, table, sql.replace(
            "CREATE " + kind + " IF NOT EXISTS", "CREATE " + kind, 1)))
        statement = ""
    if statement.strip():
        raise CheckpointIntegrityError("Incomplete checkpoint migration")
    return tuple(sorted(result, key=lambda row: (row[0], row[1])))


def _expected_objects():
    return _ddl_objects(_schema_resource())


def _guard_schema(connection):
    _agent_schema(connection)
    expected = []
    migrations = files("axis_evo").joinpath("migrations")
    for name in ("001_phase1.sql", "002_phase2_skills.sql", "003_phase2_skill_bindings.sql"):
        expected.extend(_ddl_objects(migrations.joinpath(name).read_text(encoding="utf-8")))
    if _objects(connection, ("runs", "events", "skills", "skill_versions", "skill_state_events",
                             "skill_invocation_bindings")) != tuple(sorted(expected, key=lambda row: (row[0], row[1]))):
        raise CheckpointIntegrityError("Checkpoint requires exact prior schemas")
    if _rows(connection, "SELECT 1 FROM temp.sqlite_master WHERE type IN ('table','view') "
             "AND name COLLATE NOCASE IN ('checkpoint_records','checkpoint_artifacts') LIMIT 1"):
        raise CheckpointIntegrityError("Checkpoint rejects TEMP shadowing")
    if _objects(connection, _TABLES) != _expected_objects():
        raise CheckpointIntegrityError("Checkpoint schema is missing, weak or unexpected")


def initialize_checkpoint_schema(connection):
    """Install 006 atomically after exact 001–005; never take caller ownership."""
    _check_write_context(connection)
    _require_planning_schema(connection)
    _agent_schema(connection)
    if _rows(connection, "SELECT 1 FROM temp.sqlite_master WHERE type IN ('table','view') "
             "AND name COLLATE NOCASE IN ('checkpoint_records','checkpoint_artifacts') LIMIT 1"):
        raise CheckpointIntegrityError("Checkpoint rejects TEMP shadowing")
    existing = _objects(connection, _TABLES)
    if existing and existing != _expected_objects():
        raise CheckpointIntegrityError("Existing checkpoint schema differs from 006")
    try:
        connection.executescript("BEGIN IMMEDIATE;\n" + _schema_resource())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise

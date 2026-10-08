"""SQLite fact persistence. A successful append returns only after COMMIT."""

from contextlib import contextmanager
from dataclasses import asdict
from importlib.resources import files
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator
from uuid import uuid4

from .events import Event, EventType, utc_now
from .hashing import canonical_json_bytes, canonical_json_sha256
from .models import Run, RunStatus, TaskSpec
from .task_spec import task_spec_from_dict


def connect_database(path: str | Path) -> sqlite3.Connection:
    """Open a file-backed database, apply durability settings and initialize schema."""
    connection = sqlite3.connect(str(path), timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        mode = connection.execute("PRAGMA journal_mode = WAL").fetchone()[0]
        if mode.lower() != "wal":
            raise sqlite3.OperationalError("Axis-Evo requires a file-backed WAL database")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("PRAGMA busy_timeout = 5000")
        schema = files("axis_evo").joinpath("migrations", "001_phase1.sql").read_text(
            encoding="utf-8"
        )
        connection.executescript("BEGIN IMMEDIATE;\n" + schema + "\nCOMMIT;")
    except BaseException:
        connection.rollback()
        connection.close()
        raise
    return connection


@contextmanager
def _write_transaction(connection: sqlite3.Connection) -> Iterator[None]:
    # BEGIN failure must not roll back a transaction already owned by the caller.
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def create_run(
    connection: sqlite3.Connection,
    task_spec: TaskSpec,
    workspace_path: str | Path,
    model_plugin: str,
    *,
    run_id: str | None = None,
    started_at: str | None = None,
) -> Run:
    """Persist the initial RUNNING record; no execution or crash inference."""
    spec_data = asdict(task_spec_from_dict(asdict(task_spec)))
    run = Run(
        run_id=run_id if run_id is not None else f"run_{uuid4().hex}",
        task_id=task_spec.task_id,
        status=RunStatus.RUNNING,
        task_spec_json=canonical_json_bytes(spec_data).decode("utf-8"),
        task_spec_sha256=canonical_json_sha256(spec_data),
        workspace_path=str(workspace_path),
        model_plugin=model_plugin,
        started_at=started_at if started_at is not None else utc_now(),
    )
    with _write_transaction(connection):
        connection.execute(
            """INSERT INTO runs (
                run_id, task_id, status, task_spec_json, task_spec_sha256,
                workspace_path, model_plugin, started_at, ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run.run_id, run.task_id, run.status.value, run.task_spec_json,
                run.task_spec_sha256, run.workspace_path, run.model_plugin,
                run.started_at, run.ended_at,
            ),
        )
    return run


def append_event(
    connection: sqlite3.Connection,
    run_id: str,
    event_type: EventType | str,
    payload: dict[str, Any],
    *,
    step_id: str | None = None,
    tool_call_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
) -> Event:
    """Allocate a per-run seq inside the write transaction and durably append."""
    event_type = EventType(event_type)
    if type(payload) is not dict:
        raise TypeError("event payload must be a JSON object")
    payload_json = canonical_json_bytes(payload).decode("utf-8")
    with _write_transaction(connection):
        run = connection.execute(
            "SELECT task_id FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise sqlite3.IntegrityError(f"run does not exist: {run_id}")
        seq = connection.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id = ?", (run_id,)
        ).fetchone()[0]
        event = Event(
            event_id=event_id if event_id is not None else f"evt_{uuid4().hex}",
            task_id=run["task_id"],
            run_id=run_id,
            seq=seq,
            event_type=event_type,
            step_id=step_id,
            tool_call_id=tool_call_id,
            occurred_at=occurred_at if occurred_at is not None else utc_now(),
            payload=json.loads(payload_json),
        )
        connection.execute(
            """INSERT INTO events (
                event_id, schema_version, run_id, task_id, seq, event_type,
                step_id, tool_call_id, occurred_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.event_id, event.schema_version, event.run_id, event.task_id,
                event.seq, event.event_type.value, event.step_id, event.tool_call_id,
                event.occurred_at, payload_json,
            ),
        )
    return event


def finish_run(
    connection: sqlite3.Connection,
    run_id: str,
    status: RunStatus | str,
    payload: dict[str, Any],
    *,
    step_id: str | None = None,
    tool_call_id: str | None = None,
    ended_at: str | None = None,
) -> Event:
    """Atomically persist a terminal event and the matching run state.

    Completion requires a reference to this run's latest committed validation,
    which must have passed. This helper does not classify or repair crashes.
    """
    status = RunStatus(status)
    terminal_types = {
        RunStatus.COMPLETED: EventType.RUN_COMPLETED,
        RunStatus.FAILED: EventType.RUN_FAILED,
        RunStatus.INTERRUPTED: EventType.RUN_INTERRUPTED,
    }
    if status not in terminal_types:
        raise ValueError("finish_run requires a terminal status")
    if type(payload) is not dict:
        raise TypeError("event payload must be a JSON object")
    payload_json = canonical_json_bytes(payload).decode("utf-8")
    terminal_payload = json.loads(payload_json)
    terminal_time = ended_at if ended_at is not None else utc_now()
    if type(terminal_time) is not str or not terminal_time.strip():
        raise ValueError("ended_at must be a nonempty timestamp string")

    with _write_transaction(connection):
        run = connection.execute(
            "SELECT task_id, status FROM runs WHERE run_id = ?", (run_id,),
        ).fetchone()
        if run is None:
            raise sqlite3.IntegrityError(f"run does not exist: {run_id}")
        if run["status"] != RunStatus.RUNNING:
            raise ValueError("only a RUNNING run can be finished")
        if status == RunStatus.COMPLETED:
            validation = connection.execute(
                """SELECT event_id, event_type FROM events
                   WHERE run_id = ? AND event_type IN ('VALIDATION_PASSED', 'VALIDATION_FAILED')
                   ORDER BY seq DESC LIMIT 1""", (run_id,),
            ).fetchone()
            if (
                validation is None
                or validation["event_type"] != EventType.VALIDATION_PASSED
                or terminal_payload.get("validation_event_id") != validation["event_id"]
            ):
                raise ValueError("COMPLETED requires this run's latest VALIDATION_PASSED event")
        seq = connection.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id = ?", (run_id,),
        ).fetchone()[0]
        event = Event(
            event_id=f"evt_{uuid4().hex}", task_id=run["task_id"], run_id=run_id,
            seq=seq, event_type=terminal_types[status], occurred_at=terminal_time,
            payload=terminal_payload, step_id=step_id, tool_call_id=tool_call_id,
        )
        inserted = connection.execute(
            """INSERT INTO events (
                event_id, schema_version, run_id, task_id, seq, event_type,
                step_id, tool_call_id, occurred_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.event_id, event.schema_version, event.run_id, event.task_id,
                event.seq, event.event_type.value, event.step_id, event.tool_call_id,
                event.occurred_at, payload_json,
            ),
        )
        if inserted.rowcount != 1:
            raise sqlite3.IntegrityError("terminal event insertion was not applied")
        updated = connection.execute(
            "UPDATE runs SET status = ?, ended_at = ? WHERE run_id = ? AND status = 'RUNNING'",
            (status.value, terminal_time, run_id),
        )
        if updated.rowcount != 1:
            raise sqlite3.IntegrityError("terminal run update was not applied")
    return event

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from axis_evo.events import EventType
from axis_evo.models import RunStatus
from axis_evo.storage import append_event, connect_database, create_run, finish_run


def _passed_validation(database, run):
    return append_event(database, run.run_id, EventType.VALIDATION_PASSED, {
        "passed": True, "message": "Acceptance passed", "details": {},
    })


@pytest.mark.parametrize("status,event_type", [
    (RunStatus.COMPLETED, "RUN_COMPLETED"),
    (RunStatus.FAILED, "RUN_FAILED"),
    (RunStatus.INTERRUPTED, "RUN_INTERRUPTED"),
])
def test_finish_run_atomically_commits_matching_event_and_state(database, task_spec, tmp_path, status, event_type):
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    validation = _passed_validation(database, run)
    payload = {"validation_event_id": validation.event_id, "nested": {"value": "snapshot"}}
    statements = []
    database.set_trace_callback(statements.append)

    event = finish_run(database, run.run_id, status, payload, step_id="step_terminal",
                       tool_call_id="call_terminal", ended_at="2026-10-02T12:00:00Z")

    database.set_trace_callback(None)
    assert [statement for statement in statements if statement.startswith("BEGIN")] == ["BEGIN IMMEDIATE"]
    assert [statement for statement in statements if statement == "COMMIT"] == ["COMMIT"]
    assert not database.in_transaction
    payload["nested"]["value"] = "caller mutation"
    reader = connect_database(tmp_path / "facts.sqlite3")
    try:
        row = reader.execute("SELECT status, ended_at FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()
        terminal = reader.execute("SELECT * FROM events WHERE event_id = ?", (event.event_id,)).fetchone()
        assert row["status"] == status
        assert row["ended_at"] == event.occurred_at == "2026-10-02T12:00:00Z"
        assert terminal["event_type"] == event_type
        assert terminal["seq"] == event.seq == validation.seq + 1
        assert terminal["task_id"] == run.task_id
        assert terminal["schema_version"] == 1
        assert terminal["step_id"] == "step_terminal"
        assert terminal["tool_call_id"] == "call_terminal"
        assert json.loads(terminal["payload_json"])["nested"]["value"] == "snapshot"
        assert event.payload["nested"]["value"] == "snapshot"
    finally:
        reader.close()


@pytest.mark.parametrize("phase", ["insert", "update", "ignore_insert", "ignore_update", "commit"])
def test_terminal_transaction_failure_rolls_back_both_facts(database, task_spec, phase):
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    validation = _passed_validation(database, run)
    if phase == "commit":
        database.executescript("""
            CREATE TEMP TRIGGER fail_terminal_commit AFTER UPDATE ON runs
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                INSERT INTO events (event_id, schema_version, run_id, task_id, seq, event_type, occurred_at, payload_json)
                VALUES ('evt_missing_parent', 1, 'run_missing_parent', 'task_missing', 1, 'TOOL_INTENT', 'test', '{}');
            END;
        """)
        database.execute("PRAGMA defer_foreign_keys = ON")
    else:
        table = "events" if phase in {"insert", "ignore_insert"} else "runs"
        operation = "INSERT" if table == "events" else "UPDATE"
        condition = "NEW.event_type = 'RUN_COMPLETED'" if table == "events" else "NEW.status = 'COMPLETED'"
        action = "RAISE(IGNORE)" if phase.startswith("ignore") else "RAISE(ABORT, 'terminal transition rejected')"
        database.executescript(f"""
            CREATE TEMP TRIGGER reject_terminal BEFORE {operation} ON {table}
            WHEN {condition}
            BEGIN SELECT {action}; END;
        """)

    statements = []
    database.set_trace_callback(statements.append)
    with pytest.raises(sqlite3.IntegrityError):
        finish_run(database, run.run_id, "COMPLETED", {"validation_event_id": validation.event_id})
    database.set_trace_callback(None)
    if phase == "commit":
        assert "COMMIT" in statements

    assert not database.in_transaction
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
    assert [row[0] for row in database.execute("SELECT event_type FROM events ORDER BY seq")] == ["VALIDATION_PASSED"]
    assert append_event(database, run.run_id, EventType.TASK_LOADED, {}).seq == 2


@pytest.mark.parametrize("case", ["no_validation", "failed", "wrong_run", "wrong_reference", "stale_pass"])
def test_completion_requires_this_runs_latest_passed_validation(database, task_spec, case):
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    reference = "evt_missing"
    if case == "failed":
        reference = append_event(database, run.run_id, EventType.VALIDATION_FAILED, {"passed": False}).event_id
    elif case == "wrong_run":
        other = create_run(database, task_spec, "other_workspace", "explicit_plan")
        reference = _passed_validation(database, other).event_id
    elif case in {"wrong_reference", "stale_pass"}:
        passed = _passed_validation(database, run)
        if case == "stale_pass":
            reference = passed.event_id
            append_event(database, run.run_id, EventType.VALIDATION_FAILED, {"passed": False})
    before = database.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    with pytest.raises(ValueError, match="latest VALIDATION_PASSED"):
        finish_run(database, run.run_id, "COMPLETED", {"validation_event_id": reference})

    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == before
    assert tuple(database.execute("SELECT status, ended_at FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()) == ("RUNNING", None)
    assert not database.in_transaction


def test_finish_run_rejects_missing_or_already_terminal_run(database, task_spec):
    with pytest.raises(sqlite3.IntegrityError, match="run does not exist"):
        finish_run(database, "run_missing", "FAILED", {})
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    first = finish_run(database, run.run_id, "FAILED", {"reason": "known failure"})
    with pytest.raises(ValueError, match="only a RUNNING"):
        finish_run(database, run.run_id, "INTERRUPTED", {})
    assert [row[0] for row in database.execute("SELECT event_id FROM events")] == [first.event_id]
    assert not database.in_transaction


@pytest.mark.parametrize("status", ["RUNNING", "SUCCESS", "CRASHED", None])
def test_finish_run_rejects_invalid_terminal_status(database, task_spec, status):
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    with pytest.raises(ValueError):
        finish_run(database, run.run_id, status, {})
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


def test_finish_run_preserves_caller_owned_transaction(database, task_spec):
    run = create_run(database, task_spec, "workspace", "explicit_plan")
    database.execute("BEGIN IMMEDIATE")
    try:
        database.execute("UPDATE runs SET model_plugin = 'pending' WHERE run_id = ?", (run.run_id,))
        with pytest.raises(sqlite3.OperationalError, match="within a transaction"):
            finish_run(database, run.run_id, "FAILED", {})
        assert database.in_transaction
        assert database.execute("SELECT model_plugin FROM runs").fetchone()[0] == "pending"
        assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    finally:
        database.rollback()
    assert database.execute("SELECT model_plugin FROM runs").fetchone()[0] == "explicit_plan"


def test_hard_exit_inside_terminal_transaction_leaves_no_partial_transition(tmp_path, task_spec):
    path = tmp_path / "terminal_crash.sqlite3"
    connection = connect_database(path)
    try:
        run = create_run(connection, task_spec, "workspace", "explicit_plan", run_id="run_terminal_crash")
        validation = _passed_validation(connection, run)
    finally:
        connection.close()
    child = r'''
import os
import sys
from axis_evo.storage import connect_database, finish_run

connection = connect_database(sys.argv[1])
connection.create_function("hard_exit", 0, lambda: os._exit(70))
connection.executescript("""
    CREATE TEMP TRIGGER crash_before_terminal_update BEFORE UPDATE ON runs
    WHEN NEW.status = 'COMPLETED'
    BEGIN SELECT hard_exit(); END;
""")
finish_run(connection, "run_terminal_crash", "COMPLETED", {"validation_event_id": sys.argv[2]})
'''
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2] / "src")
    completed = subprocess.run([sys.executable, "-c", child, str(path), validation.event_id],
                               env=env, capture_output=True, text=True, timeout=15)
    assert completed.returncode == 70, completed.stdout + completed.stderr
    connection = connect_database(path)
    try:
        assert tuple(connection.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
        assert [row[0] for row in connection.execute("SELECT event_type FROM events ORDER BY seq")] == ["VALIDATION_PASSED"]
    finally:
        connection.close()

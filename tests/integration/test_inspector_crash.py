import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from axis_evo.inspector import format_inspection_json, format_inspection_text, inspect_database, inspect_run
from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.tools import PatchFileTool


TASK = Path(__file__).resolve().parents[1] / "fixtures" / "tasks" / "demo_runner" / "task.json"
BEFORE = (TASK.parent / "seed" / "config.json").read_bytes()
AFTER = b'{"timeout": 20}\n'
_CHILD = r'''
import os, sys
from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.storage import connect_database
from axis_evo.tools import WriteFileTool

connection = connect_database(sys.argv[1])
class HardExitWrite(WriteFileTool):
    def execute(self, sandbox, arguments):
        assert not connection.in_transaction
        if sys.argv[4] == "before":
            os._exit(70)
        result = super().execute(sandbox, arguments)
        assert result.status == "SUCCESS"
        os._exit(70)

registry = PluginRegistry()
registry.register(HardExitWrite())
run_task(connection, sys.argv[2], sys.argv[3],
    [PlanStep("step_crash", "write_file", {"path":"config.json", "content":'{"timeout": 20}\n'})],
    registry, run_id="run_crash")
'''


def _environment():
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[2] / "src")
    return environment


def _crash(tmp_path, mode):
    database = tmp_path / "crash facts #1.sqlite3"
    workspace = tmp_path / "workspace"
    child = subprocess.run([sys.executable, "-c", _CHILD, str(database), str(TASK), str(workspace), mode],
                           env=_environment(), capture_output=True, text=True, timeout=20)
    assert child.returncode == 70, child.stdout + child.stderr
    assert (workspace / "config.json").read_bytes() == (AFTER if mode == "after" else BEFORE)
    return database, workspace


def _facts(connection):
    return ([tuple(row) for row in connection.execute("SELECT * FROM runs ORDER BY run_id")],
            [tuple(row) for row in connection.execute("SELECT * FROM events ORDER BY run_id,seq")],
            [tuple(row) for row in connection.execute("SELECT * FROM sqlite_master ORDER BY name")])


def _inspect_unchanged(database, workspace):
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, isolation_level=None)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        facts_before = _facts(connection)
        files_before = {p.relative_to(workspace).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
                        for p in workspace.rglob("*") if p.is_file()}
        report = inspect_run(connection, "run_crash")
        assert inspect_run(connection, "run_crash") == report
        assert inspect_database(database, "run_crash") == report
        assert facts_before == _facts(connection)
        assert files_before == {p.relative_to(workspace).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
                                for p in workspace.rglob("*") if p.is_file()}
        assert tuple(connection.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
        events = [dict(row) for row in connection.execute("SELECT * FROM events ORDER BY seq")]
        assert [event["seq"] for event in events] == [1, 2, 3, 4, 5]
        assert [event["event_type"] for event in events] == ["RUN_STARTED", "TASK_LOADED", "STEP_PLANNED", "FILE_OBSERVED", "TOOL_INTENT"]
        pre = json.loads(events[-2]["payload_json"])
        intent = json.loads(events[-1]["payload_json"])
        assert pre["sha256"] == intent["targets"][0]["before_sha256"] == hashlib.sha256(BEFORE).hexdigest()
        assert pre["size_bytes"] == intent["targets"][0]["size_bytes"] == len(BEFORE)
        assert report["trace"]["consistent"]
        assert report["trace"]["last_seq"] == 5
        assert report["trace"]["last_event_type"] == "TOOL_INTENT"
        return report
    finally:
        connection.close()


def _no_execution_attribution(report):
    outputs = format_inspection_json(report) + "\n" + format_inspection_text(report)
    for phrase in ("CONFIRMED_EXECUTED", "CONFIRMED_NOT_EXECUTED", "RETRY", "CONTINUE", "COMPENSATE", "ROLLBACK", "REPLAY", "RESUME", "RECOVER", "TRUST", "UNTRUST", "SAFE_TO_RETRY", "tool executed", "tool caused", "tool succeeded", "partially succeeded"):
        assert phrase not in outputs
    assert "do not attribute changes to a tool" in outputs


def test_real_crash_window_b_inspection_preserves_run_events_and_workspace(tmp_path):
    database, workspace = _crash(tmp_path, "after")
    report = _inspect_unchanged(database, workspace)
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN", "EXTERNAL_STATE_CHANGED"]
    target = report["pending_invocations"][0]["targets"][0]
    assert target["before"]["sha256"] == hashlib.sha256(BEFORE).hexdigest()
    assert target["current"]["sha256"] == hashlib.sha256(AFTER).hexdigest()
    assert target["external_state_changed"] is True
    _no_execution_attribution(report)


def test_real_crash_before_effect_remains_unknown_despite_unchanged_state(tmp_path):
    database, workspace = _crash(tmp_path, "before")
    report = _inspect_unchanged(database, workspace)
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    target = report["pending_invocations"][0]["targets"][0]
    assert target["current"]["sha256"] == hashlib.sha256(BEFORE).hexdigest()
    assert target["external_state_changed"] is False
    _no_execution_attribution(report)


def test_third_party_change_after_crash_cannot_be_attributed_to_tool(tmp_path):
    database, workspace = _crash(tmp_path, "before")
    third_party_bytes = b"changed by the parent process\xff\r\n"
    (workspace / "config.json").write_bytes(third_party_bytes)
    report = _inspect_unchanged(database, workspace)
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN", "EXTERNAL_STATE_CHANGED"]
    target = report["pending_invocations"][0]["targets"][0]
    assert target["current"]["sha256"] == hashlib.sha256(third_party_bytes).hexdigest()
    assert target["external_state_changed"] is True
    _no_execution_attribution(report)


def test_normal_completed_runner_is_inspected_without_new_events(database, tmp_path):
    registry = PluginRegistry()
    registry.register(PatchFileTool())
    run = run_task(database, TASK, tmp_path / "completed_workspace",
                   [PlanStep("step_patch", "patch_file", {"path":"config.json", "old":'"timeout": 10', "new":'"timeout": 20'})],
                   registry, run_id="run_completed")
    assert run.status == "COMPLETED"
    before = _facts(database)
    report = inspect_run(database, run.run_id)
    assert report["run"]["status"] == "COMPLETED"
    assert report["trace"]["consistent"]
    assert report["trace"]["last_event_type"] == "RUN_COMPLETED"
    assert report["observations"] == []
    assert report["pending_invocations"] == []
    assert _facts(database) == before


@pytest.mark.parametrize("format_name", ["json", "text"])
def test_module_cli_uses_real_read_only_inspection(tmp_path, format_name):
    database, workspace = _crash(tmp_path, "after")
    expected = _inspect_unchanged(database, workspace)
    completed = subprocess.run([sys.executable, "-m", "axis_evo.inspector", str(database), "run_crash", "--format", format_name],
                               env=_environment(), capture_output=True, text=True, timeout=15)
    assert completed.returncode == 0, completed.stderr
    if format_name == "json":
        assert json.loads(completed.stdout) == expected
    else:
        assert completed.stdout.rstrip() == format_inspection_text(expected)
    assert _inspect_unchanged(database, workspace) == expected

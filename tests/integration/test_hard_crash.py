import json
import os
from pathlib import Path
import subprocess
import sys

from axis_evo.storage import append_event, connect_database
from axis_evo.events import EventType


def test_tool_intent_survives_hard_crash(tmp_path, task_path):
    project_root = Path(__file__).resolve().parents[2]
    child = project_root / "tests" / "fixtures" / "crash" / "record_intent_and_exit.py"
    database_path = tmp_path / "hard_crash.sqlite3"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(project_root / "src")
    result = subprocess.run(
        [sys.executable, str(child), str(database_path), str(task_path)],
        env=env, capture_output=True, text=True, timeout=15, check=False,
    )
    assert result.returncode == 70, result.stdout + result.stderr

    connection = connect_database(database_path)
    try:
        run = connection.execute("SELECT * FROM runs WHERE run_id = 'run_hard_crash'").fetchone()
        assert run["status"] == "RUNNING"
        assert run["ended_at"] is None
        rows = connection.execute(
            "SELECT * FROM events WHERE run_id = 'run_hard_crash' ORDER BY seq"
        ).fetchall()
        assert len(rows) == 1
        event = rows[0]
        assert event["event_type"] == "TOOL_INTENT"
        assert event["event_id"] == "evt_hard_crash"
        assert event["schema_version"] == 1
        assert event["task_id"] == "demo_config_001"
        assert event["step_id"] == "step_001"
        assert event["tool_call_id"] == "call_001"
        assert event["seq"] == 1
        assert json.loads(event["payload_json"]) == {
            "tool_name": "patch_file", "arguments": {"path": "config.json", "timeout": 20}
        }
        # The reopened parent allocates from the committed maximum, not memory.
        assert append_event(connection, run["run_id"], EventType.TASK_LOADED, {}).seq == 2
    finally:
        connection.close()

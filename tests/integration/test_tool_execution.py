from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from axis_evo.models import PlanStep, ToolResult
from axis_evo.sandbox import Sandbox
from axis_evo.storage import connect_database, create_run
from axis_evo.tools import PatchFileTool, ReadFileTool, RunTestsTool, WriteFileTool, execute_tool_call


@pytest.fixture
def sandbox(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return Sandbox(root)


def _events(database):
    rows = database.execute("SELECT * FROM events ORDER BY seq").fetchall()
    return [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]


def _step(tool, arguments):
    return PlanStep("step_001", tool.name, arguments)


def test_tool_cannot_execute_before_intent_commit(database, task_spec, sandbox, tmp_path):
    run = create_run(database, task_spec, sandbox.root, "test_model")

    class SpyTool:
        name = "spy_write"
        mutating = True
        called = False

        def declared_targets(self, arguments):
            return [arguments["path"]]

        def execute(self, sandbox, arguments):
            assert not database.in_transaction
            second = connect_database(tmp_path / "facts.sqlite3")
            try:
                row = second.execute(
                    "SELECT payload_json FROM events WHERE run_id = ? AND tool_call_id = ? AND event_type = 'TOOL_INTENT'",
                    (run.run_id, "call_spy"),
                ).fetchone()
                assert row is not None
                assert json.loads(row[0])["arguments"] == arguments
                # A second connection can acquire a write lock while execute runs.
                second.execute("BEGIN IMMEDIATE")
                second.rollback()
            finally:
                second.close()
            self.called = True
            sandbox.resolve(arguments["path"]).write_bytes(b"side effect")
            return ToolResult("SUCCESS", "spy returned", 0.0)

    tool = SpyTool()
    result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "a.txt"}), "call_spy")
    assert tool.called
    assert result.status == "SUCCESS"
    assert (sandbox.root / "a.txt").read_bytes() == b"side effect"
    assert not database.in_transaction


def test_failed_intent_insert_never_executes_tool(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    database.executescript("""
        CREATE TEMP TRIGGER reject_intent BEFORE INSERT ON events
        WHEN NEW.event_type = 'TOOL_INTENT'
        BEGIN SELECT RAISE(ABORT, 'intent insert rejected'); END;
    """)

    class SpyTool(WriteFileTool):
        called = False

        def execute(self, sandbox, arguments):
            self.called = True
            return super().execute(sandbox, arguments)

    tool = SpyTool()
    with pytest.raises(sqlite3.IntegrityError, match="intent insert rejected"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "new.txt", "content": "must not write"}), "call_failed")
    assert not tool.called
    assert not (sandbox.root / "new.txt").exists()
    assert not database.in_transaction
    assert [event["event_type"] for event in _events(database)] == ["FILE_OBSERVED"]


def test_pre_tool_observation_is_reused(database, task_spec, sandbox, monkeypatch):
    path = sandbox.root / "a.txt"
    path.write_bytes(b"before")
    run = create_run(database, task_spec, sandbox.root, "test_model")
    observations = []
    reads = []
    original_observe = sandbox.observe_file
    original_read = Path.read_bytes

    def counted_observe(relative_path):
        observation = original_observe(relative_path)
        observations.append(observation)
        return observation

    def counted_read(file):
        if file == path:
            reads.append(file)
        return original_read(file)

    monkeypatch.setattr(sandbox, "observe_file", counted_observe)
    monkeypatch.setattr(Path, "read_bytes", counted_read)
    tool = WriteFileTool()
    execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "a.txt", "content": "after"}), "call_reuse")
    assert len(observations) == 2
    assert len(reads) == 2
    events = _events(database)
    assert events[0]["payload"] == {"reason": "PRE_TOOL", **asdict(observations[0])}
    assert events[1]["payload"]["targets"] == [{
        "path": observations[0].path, "exists": observations[0].exists,
        "before_sha256": observations[0].sha256, "size_bytes": observations[0].size_bytes,
    }]
    assert events[2]["payload"] == {"reason": "POST_TOOL", **asdict(observations[1])}


def test_mutating_call_event_order_and_exact_payload_shapes(database, task_spec, sandbox):
    before = b'{"timeout": 10}\r\n'
    after = b'{"timeout": 20}\r\n'
    (sandbox.root / "config.json").write_bytes(before)
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = PatchFileTool()
    arguments = {"path": "config.json", "old": '"timeout": 10', "new": '"timeout": 20'}
    result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, arguments), "call_patch")
    events = _events(database)
    assert [event["seq"] for event in events] == [1, 2, 3, 4]
    assert [event["event_type"] for event in events] == ["FILE_OBSERVED", "TOOL_INTENT", "FILE_OBSERVED", "TOOL_RESULT"]
    for event in events:
        assert event["schema_version"] == 1
        assert event["step_id"] == "step_001"
        assert event["tool_call_id"] == "call_patch"
    pre, intent, post, reported = [event["payload"] for event in events]
    assert pre == {"reason": "PRE_TOOL", "path": "config.json", "exists": True, "sha256": hashlib.sha256(before).hexdigest(), "size_bytes": len(before)}
    assert intent == {"tool_name": "patch_file", "arguments": arguments, "mutating": True, "targets": [{"path": "config.json", "exists": True, "before_sha256": pre["sha256"], "size_bytes": len(before)}]}
    assert post == {"reason": "POST_TOOL", "path": "config.json", "exists": True, "sha256": hashlib.sha256(after).hexdigest(), "size_bytes": len(after)}
    assert reported == {"tool_name": "patch_file", **asdict(result)}
    assert set(reported) == {"tool_name", "status", "message", "duration_ms", "result"}
    assert reported["result"] == {"matches": 1}
    assert (sandbox.root / "config.json").read_bytes() == after
    row = database.execute("SELECT status, ended_at FROM runs").fetchone()
    assert tuple(row) == ("RUNNING", None)
    assert {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")} == {"runs", "events"}


def test_missing_target_observed_before_write(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()
    execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "new.txt", "content": "created"}), "call_new")
    events = _events(database)
    assert events[0]["payload"] == {"reason": "PRE_TOOL", "path": "new.txt", "exists": False, "sha256": None, "size_bytes": None}
    assert events[1]["payload"]["targets"] == [{"path": "new.txt", "exists": False, "before_sha256": None, "size_bytes": None}]
    assert events[2]["payload"]["sha256"] == hashlib.sha256(b"created").hexdigest()


@pytest.mark.parametrize("change", [False, True])
def test_core_facts_do_not_follow_tool_claims(database, task_spec, sandbox, change):
    path = sandbox.root / "a.txt"
    path.write_bytes(b"before")
    run = create_run(database, task_spec, sandbox.root, "test_model")

    class UnreliableReportTool:
        name = "unreliable_report"
        mutating = True

        def declared_targets(self, arguments):
            return ["a.txt"]

        def execute(self, sandbox, arguments):
            if change:
                sandbox.resolve("a.txt").write_bytes(b"after")
            return ToolResult("FAILED" if change else "SUCCESS", "file unchanged" if change else "file changed", 0.0)

    tool = UnreliableReportTool()
    execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {}), "call_report")
    events = _events(database)
    assert events[2]["payload"]["sha256"] == hashlib.sha256(b"after" if change else b"before").hexdigest()
    assert events[3]["payload"]["status"] == ("FAILED" if change else "SUCCESS")


@pytest.mark.parametrize("tool_name", ["read_file", "run_tests"])
def test_nonmutating_tools_record_intent_and_result_without_fake_observations(database, task_spec, sandbox, tool_name):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    if tool_name == "read_file":
        (sandbox.root / "file.txt").write_bytes(b"data")
        tool, args = ReadFileTool(), {"path": "file.txt"}
    else:
        (sandbox.root / "test_tiny.py").write_text("def test_tiny():\n    assert True\n", encoding="utf-8")
        tool, args = RunTestsTool(), {"args": ["-q"]}
    result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, args), "call_read")
    assert result.status == "SUCCESS", result.result
    events = _events(database)
    assert [event["event_type"] for event in events] == ["TOOL_INTENT", "TOOL_RESULT"]
    assert events[0]["payload"]["targets"] == []
    assert events[0]["payload"]["mutating"] is False
    assert events[1]["payload"] == {"tool_name": tool.name, **asdict(result)}


def test_operational_failure_still_records_real_post_observation(database, task_spec, sandbox):
    (sandbox.root / "config.txt").write_bytes(b"unchanged")
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = PatchFileTool()
    result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "config.txt", "old": "missing", "new": "new"}), "call_no_match")
    assert result.status == "FAILED"
    events = _events(database)
    assert len(events) == 4
    assert events[0]["payload"]["sha256"] == events[2]["payload"]["sha256"]
    assert events[3]["payload"]["status"] == "FAILED"


def test_unexpected_exception_after_write_leaves_intent_without_result(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")

    class BrokenTool(WriteFileTool):
        def execute(self, sandbox, arguments):
            super().execute(sandbox, arguments)
            raise RuntimeError("unexpected exception after external effect")

    tool = BrokenTool()
    with pytest.raises(RuntimeError, match="unexpected exception"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "a.txt", "content": "after"}), "call_broken")
    assert (sandbox.root / "a.txt").read_bytes() == b"after"
    assert [event["event_type"] for event in _events(database)] == ["FILE_OBSERVED", "TOOL_INTENT"]
    assert not database.in_transaction
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)


def test_tool_name_mismatch_never_executes(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    step = PlanStep("step_001", "patch_file", {"path": "a.txt", "content": "data"})
    with pytest.raises(ValueError, match="does not match"):
        execute_tool_call(database, run.run_id, sandbox, WriteFileTool(), step, "call_wrong")
    assert _events(database) == []
    assert not (sandbox.root / "a.txt").exists()


def test_unsafe_target_is_rejected_before_intent_or_execution(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()
    with pytest.raises(ValueError, match="escapes root"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "../outside.txt", "content": "data"}), "call_unsafe")
    assert _events(database) == []
    assert not (sandbox.root.parent / "outside.txt").exists()


def test_active_caller_transaction_is_not_used_for_external_execution(database, task_spec, sandbox):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()
    database.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(ValueError, match="active transaction"):
            execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {"path": "a.txt", "content": "data"}), "call_transaction")
        assert database.in_transaction
        assert not (sandbox.root / "a.txt").exists()
    finally:
        database.rollback()


@pytest.mark.parametrize("mutating,targets", [(True, []), (False, ["a.txt"]), (True, ["a.txt", "a.txt"]), (True, [1])])
def test_invalid_target_declaration_does_not_execute(database, task_spec, sandbox, mutating, targets):
    run = create_run(database, task_spec, sandbox.root, "test_model")

    class BadDeclaration:
        name = "bad_declaration"

        def declared_targets(self, arguments):
            return targets

        def execute(self, sandbox, arguments):
            pytest.fail("invalid declaration must not execute")

    tool = BadDeclaration()
    tool.mutating = mutating
    with pytest.raises(ValueError):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {}), "call_bad_declaration")
    assert _events(database) == []


def test_hard_exit_after_external_effect_preserves_crash_window_b(tmp_path, task_path, sandbox):
    (sandbox.root / "a.txt").write_bytes(b"before")
    path = tmp_path / "crash_b.sqlite3"
    project_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(project_root / "src")
    child = r'''
import os
import sys
from axis_evo.models import PlanStep
from axis_evo.sandbox import Sandbox
from axis_evo.storage import connect_database, create_run
from axis_evo.task_spec import load_task_spec
from axis_evo.tools import WriteFileTool, execute_tool_call

connection = connect_database(sys.argv[1])
sandbox = Sandbox(sys.argv[2])
run = create_run(connection, load_task_spec(sys.argv[3]), sandbox.root, "test_model", run_id="run_crash_b")

class CrashAfterWrite(WriteFileTool):
    def execute(self, sandbox, arguments):
        assert not connection.in_transaction
        result = super().execute(sandbox, arguments)
        assert result.status == "SUCCESS"
        os._exit(70)

tool = CrashAfterWrite()
execute_tool_call(connection, run.run_id, sandbox, tool, PlanStep("step_001", "write_file", {"path": "a.txt", "content": "after"}), "call_crash_b")
'''
    completed = subprocess.run([sys.executable, "-c", child, str(path), str(sandbox.root), str(task_path)], env=env, capture_output=True, text=True, timeout=15)
    assert completed.returncode == 70, completed.stdout + completed.stderr
    assert (sandbox.root / "a.txt").read_bytes() == b"after"
    connection = connect_database(path)
    try:
        events = _events(connection)
        assert [event["seq"] for event in events] == [1, 2]
        assert [event["event_type"] for event in events] == ["FILE_OBSERVED", "TOOL_INTENT"]
        assert events[0]["payload"]["reason"] == "PRE_TOOL"
        assert events[0]["payload"]["sha256"] == hashlib.sha256(b"before").hexdigest()
        assert events[1]["payload"]["targets"][0]["before_sha256"] == events[0]["payload"]["sha256"]
        assert events[1]["tool_call_id"] == "call_crash_b"
        assert tuple(connection.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
    finally:
        connection.close()


def _forbid_tool_call_hooks(monkeypatch, tool):
    def unexpected_hook(*args, **kwargs):
        pytest.fail("context must be rejected before target declaration, observation, or execution")

    monkeypatch.setattr(tool, "declared_targets", unexpected_hook)
    monkeypatch.setattr(tool, "execute", unexpected_hook)
    monkeypatch.setattr(Sandbox, "observe_file", unexpected_hook)


def test_tool_call_rejects_sandbox_not_bound_to_run(database, task_spec, tmp_path, monkeypatch):
    root_a = tmp_path / "workspace_A"
    root_b = tmp_path / "workspace_B"
    root_a.mkdir()
    root_b.mkdir()
    (root_a / "existing.txt").write_bytes(b"original A")
    (root_b / "existing.txt").write_bytes(b"original B")
    sandbox_a = Sandbox(root_a)
    sandbox_b = Sandbox(root_b)
    run = create_run(database, task_spec, sandbox_a.root, "test_model")
    tool = WriteFileTool()
    step = _step(tool, {"path": "existing.txt", "content": "changed"})
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="sandbox root does not match"):
        execute_tool_call(database, run.run_id, sandbox_b, tool, step, "call_wrong_workspace")

    assert _events(database) == []
    assert (root_a / "existing.txt").read_bytes() == b"original A"
    assert (root_b / "existing.txt").read_bytes() == b"original B"
    assert {path.name for path in root_a.iterdir()} == {"existing.txt"}
    assert {path.name for path in root_b.iterdir()} == {"existing.txt"}
    assert database.execute("SELECT workspace_path FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()[0] == str(sandbox_a.root)
    assert not database.in_transaction


@pytest.mark.parametrize("resolved_spelling", [False, True])
def test_tool_call_accepts_sandbox_bound_to_run(database, task_spec, sandbox, resolved_spelling):
    workspace_path = str(sandbox.root)
    if resolved_spelling:
        (sandbox.root / "nested").mkdir()
        workspace_path += os.sep + "nested" + os.sep + ".."
    run = create_run(database, task_spec, workspace_path, "test_model")
    supplied_sandbox = Sandbox(sandbox.root)
    tool = WriteFileTool()

    result = execute_tool_call(database, run.run_id, supplied_sandbox, tool, _step(tool, {
        "path": "created.txt", "content": "bound workspace",
    }), "call_bound_workspace")

    assert result.status == "SUCCESS"
    assert (sandbox.root / "created.txt").read_bytes() == b"bound workspace"
    assert [event["event_type"] for event in _events(database)] == [
        "FILE_OBSERVED", "TOOL_INTENT", "FILE_OBSERVED", "TOOL_RESULT",
    ]
    assert database.execute("SELECT workspace_path FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()[0] == workspace_path
    assert not database.in_transaction


def test_tool_call_rejects_missing_run(database, sandbox, monkeypatch):
    tool = WriteFileTool()
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="run does not exist"):
        execute_tool_call(database, "missing_run", sandbox, tool, _step(tool, {
            "path": "created.txt", "content": "must not execute",
        }), "call_missing_run")

    assert _events(database) == []
    assert list(sandbox.root.iterdir()) == []
    assert not database.in_transaction


@pytest.mark.parametrize("kind", ["empty", "relative", "missing", "file", "nul"])
def test_tool_call_rejects_invalid_recorded_workspace(database, task_spec, sandbox, tmp_path, monkeypatch, kind):
    if kind == "empty":
        workspace_path = ""
    elif kind == "relative":
        # Even a relative path that currently resolves to this root is invalid.
        monkeypatch.chdir(sandbox.root)
        workspace_path = "."
    elif kind == "missing":
        workspace_path = str(tmp_path / "missing_workspace")
    elif kind == "file":
        recorded_file = tmp_path / "not_a_workspace.txt"
        recorded_file.write_bytes(b"unchanged")
        workspace_path = str(recorded_file)
    else:
        workspace_path = str(sandbox.root) + "\x00"
    run = create_run(database, task_spec, workspace_path, "test_model")
    tool = WriteFileTool()
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="recorded workspace_path"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
            "path": "created.txt", "content": "must not execute",
        }), "call_invalid_workspace")

    assert _events(database) == []
    assert list(sandbox.root.iterdir()) == []
    assert database.execute("SELECT workspace_path FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()[0] == workspace_path
    if kind == "file":
        assert recorded_file.read_bytes() == b"unchanged"
    assert not database.in_transaction


@pytest.mark.parametrize("tool_call_id", [None, "", " ", "\t\n", 123, False, []])
def test_tool_call_id_must_be_nonempty(database, task_spec, sandbox, monkeypatch, tool_call_id):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="tool_call_id must be a nonempty string"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
            "path": "created.txt", "content": "must not execute",
        }), tool_call_id)

    assert _events(database) == []
    assert list(sandbox.root.iterdir()) == []
    assert not database.in_transaction


def test_tool_call_id_cannot_be_reused_within_run(database, task_spec, sandbox, monkeypatch):
    run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()
    result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
        "path": "first.txt", "content": "first effect",
    }), "call_same")
    assert result.status == "SUCCESS"
    original_events = _events(database)
    assert len(original_events) == 4
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="already been used within this run"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
            "path": "second.txt", "content": "second effect",
        }), "call_same")

    assert _events(database) == original_events
    assert (sandbox.root / "first.txt").read_bytes() == b"first effect"
    assert not (sandbox.root / "second.txt").exists()
    assert {path.name for path in sandbox.root.iterdir()} == {"first.txt"}
    assert not database.in_transaction


@pytest.mark.parametrize("event_type", ["FILE_OBSERVED", "TOOL_INTENT", "TOOL_RESULT"])
def test_tool_call_id_rejects_any_existing_event(database, task_spec, sandbox, monkeypatch, event_type):
    from axis_evo.storage import append_event

    run = create_run(database, task_spec, sandbox.root, "test_model")
    append_event(database, run.run_id, event_type, {}, tool_call_id="call_existing")
    original_events = _events(database)
    tool = WriteFileTool()
    _forbid_tool_call_hooks(monkeypatch, tool)

    with pytest.raises(ValueError, match="already been used within this run"):
        execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
            "path": "created.txt", "content": "must not execute",
        }), "call_existing")

    assert _events(database) == original_events
    assert list(sandbox.root.iterdir()) == []
    assert not database.in_transaction


def test_tool_call_id_can_be_reused_in_different_run(database, task_spec, sandbox):
    first_run = create_run(database, task_spec, sandbox.root, "test_model")
    second_run = create_run(database, task_spec, sandbox.root, "test_model")
    tool = WriteFileTool()

    for run, path, content in [
        (first_run, "first.txt", "first run"),
        (second_run, "second.txt", "second run"),
    ]:
        result = execute_tool_call(database, run.run_id, sandbox, tool, _step(tool, {
            "path": path, "content": content,
        }), "call_shared")
        assert result.status == "SUCCESS"

    assert (sandbox.root / "first.txt").read_bytes() == b"first run"
    assert (sandbox.root / "second.txt").read_bytes() == b"second run"
    events = _events(database)
    assert len(events) == 8
    assert {event["tool_call_id"] for event in events} == {"call_shared"}
    for run in (first_run, second_run):
        assert [event["seq"] for event in events if event["run_id"] == run.run_id] == [1, 2, 3, 4]
    assert not database.in_transaction

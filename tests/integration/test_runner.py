import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

import pytest

from axis_evo import runner, validators
from axis_evo.events import EventType
from axis_evo.models import PlanStep, ToolResult
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.sandbox import Sandbox
from axis_evo.storage import append_event, connect_database, create_run
from axis_evo.tools import PatchFileTool, ReadFileTool, RunTestsTool, WriteFileTool, execute_tool_call


@pytest.fixture
def task_file(tmp_path):
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "tasks" / "demo_runner"
    destination = tmp_path / "task_assets"
    shutil.copytree(fixture, destination)
    return destination / "task.json"


@pytest.fixture
def registry():
    registry = PluginRegistry()
    for tool in (ReadFileTool(), WriteFileTool(), PatchFileTool(), RunTestsTool()):
        registry.register(tool)
    return registry


@pytest.fixture
def patch_plan():
    return [PlanStep("step_001", "patch_file", {
        "path": "config.json", "old": '"timeout": 10', "new": '"timeout": 20',
    })]


def _events(database):
    return [
        {**dict(row), "payload": json.loads(row["payload_json"])}
        for row in database.execute("SELECT * FROM events ORDER BY seq")
    ]


def _configure(task_file, *, assertions=None, enabled=None, args=None, seed=None):
    data = json.loads(task_file.read_text(encoding="utf-8"))
    if assertions is not None:
        data["acceptance"]["file_assertions"] = assertions
    if enabled is not None:
        data["acceptance"]["pytest"]["enabled"] = enabled
    if args is not None:
        data["acceptance"]["pytest"]["args"] = args
    if seed is not None:
        data["workspace"]["seed_dir"] = seed
    task_file.write_text(json.dumps(data), encoding="utf-8")


def _seed_bytes(task_file):
    seed = task_file.parent / "seed"
    return {path.relative_to(seed).as_posix(): path.read_bytes() for path in seed.rglob("*") if path.is_file()}


def test_runner_completes_normal_task_with_full_trace(database, task_file, registry, patch_plan, tmp_path):
    original_seed = _seed_bytes(task_file)
    workspace = tmp_path / "workspace"

    result = run_task(database, task_file, workspace, patch_plan, registry, run_id="run_normal")

    assert result.run_id == "run_normal"
    assert result.status == "COMPLETED"
    assert result.ended_at is not None
    assert result.workspace_path == str(workspace.resolve())
    assert result.model_plugin == "explicit_plan"
    assert _seed_bytes(task_file) == original_seed
    assert (workspace / "config.json").read_bytes() == original_seed["config.json"].replace(b"10", b"20")
    assert (workspace / "check_task.py").read_bytes() == original_seed["check_task.py"]
    events = _events(database)
    assert [event["seq"] for event in events] == list(range(1, 13))
    assert [event["event_type"] for event in events] == [
        "RUN_STARTED", "TASK_LOADED", "STEP_PLANNED", "FILE_OBSERVED", "TOOL_INTENT",
        "FILE_OBSERVED", "TOOL_RESULT", "STEP_CONFIRMED", "VALIDATION_STARTED",
        "FILE_OBSERVED", "VALIDATION_PASSED", "RUN_COMPLETED",
    ]
    assert all(event["schema_version"] == 1 for event in events)
    assert [event["payload"]["reason"] for event in events if event["event_type"] == "FILE_OBSERVED"] == ["PRE_TOOL", "POST_TOOL", "VALIDATION"]
    started, loaded, planned = events[:3]
    assert started["payload"] == {"workspace_path": result.workspace_path, "model_plugin": "explicit_plan"}
    assert loaded["payload"] == {"task_spec_sha256": result.task_spec_sha256}
    assert planned["payload"] == {"tool_name": "patch_file", "arguments": patch_plan[0].arguments}
    assert events[4]["payload"]["arguments"] == planned["payload"]["arguments"]
    invocation_events = events[2:8]
    assert {event["step_id"] for event in invocation_events} == {"step_001"}
    assert {event["tool_call_id"] for event in invocation_events} == {planned["tool_call_id"]}
    assert planned["tool_call_id"].startswith("call_")
    assert events[7]["payload"] == {"tool_call_id": planned["tool_call_id"], "tool_status": "SUCCESS"}
    validation = events[-2]
    assert validation["payload"]["passed"] is True
    assert validation["payload"]["details"]["pytest"]["executed"] is True
    assert validation["payload"]["details"]["pytest"]["exit_code"] == 0
    assert "1 passed" in validation["payload"]["details"]["pytest"]["stdout"]
    assert events[-1]["payload"] == {"validation_event_id": validation["event_id"]}
    assert events[-1]["occurred_at"] == result.ended_at
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("COMPLETED", result.ended_at)
    assert not database.in_transaction


def test_runner_executes_multiple_steps_sequentially_with_fresh_call_ids(database, task_file, registry, patch_plan, tmp_path):
    plan = [*patch_plan, PlanStep("step_002", "read_file", {"path": "config.json"})]

    result = run_task(database, task_file, tmp_path / "workspace", tuple(plan), registry)

    assert result.status == "COMPLETED"
    events = _events(database)
    planned = [event for event in events if event["event_type"] == "STEP_PLANNED"]
    confirmed = [event for event in events if event["event_type"] == "STEP_CONFIRMED"]
    assert [event["step_id"] for event in planned] == ["step_001", "step_002"]
    assert len({event["tool_call_id"] for event in planned}) == 2
    assert confirmed[0]["seq"] < planned[1]["seq"] < confirmed[1]["seq"]
    second_result = next(event for event in events if event["event_type"] == "TOOL_RESULT" and event["step_id"] == "step_002")
    assert json.loads(second_result["payload"]["result"]["content"])["timeout"] == 20


@pytest.mark.parametrize("tool_status", ["FAILED", "TIMEOUT"])
def test_step_confirmed_records_known_failure_without_acceptance_or_later_steps(database, task_file, registry, tmp_path, monkeypatch, tool_status):
    if tool_status == "FAILED":
        failure_step = PlanStep("step_failure", "patch_file", {"path": "config.json", "old": "not present", "new": "unused"})
    else:
        class TimedOutTool:
            name = "timed_out_tool"
            mutating = False

            def declared_targets(self, arguments):
                return []

            def execute(self, sandbox, arguments):
                assert not database.in_transaction
                return ToolResult("TIMEOUT", "Observed timeout", 1.0)

        registry.register(TimedOutTool())
        failure_step = PlanStep("step_failure", "timed_out_tool", {})
    later = PlanStep("step_later", "write_file", {"path": "later.txt", "content": "must not run"})

    def forbidden_acceptance(*args, **kwargs):
        pytest.fail("reported tool failure must not start final acceptance")

    monkeypatch.setattr(runner, "validate_acceptance", forbidden_acceptance)
    result = run_task(database, task_file, tmp_path / "workspace", [failure_step, later], registry)

    assert result.status == "FAILED"
    events = _events(database)
    reported = next(event for event in events if event["event_type"] == "TOOL_RESULT")
    confirmed = next(event for event in events if event["event_type"] == "STEP_CONFIRMED")
    assert reported["payload"]["status"] == confirmed["payload"]["tool_status"] == tool_status
    assert reported["seq"] < confirmed["seq"] < events[-1]["seq"]
    assert confirmed["tool_call_id"] == reported["tool_call_id"]
    assert events[-1]["event_type"] == "RUN_FAILED"
    assert events[-1]["payload"] == {
        "reason": "TOOL_REPORTED_FAILURE", "step_id": failure_step.step_id,
        "tool_call_id": confirmed["tool_call_id"], "tool_status": tool_status,
    }
    assert not any(event["step_id"] == "step_later" for event in events)
    assert not any(event["event_type"].startswith("VALIDATION_") for event in events)
    assert not (tmp_path / "workspace" / "later.txt").exists()
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("FAILED", events[-1]["occurred_at"])


def test_tool_success_is_not_task_success_and_static_failure_skips_pytest(database, task_file, registry, patch_plan, tmp_path, monkeypatch):
    _configure(task_file, assertions=[{"path": "config.json", "operator": "contains", "expected": '"timeout": 30'}])

    def forbidden_pytest(*args, **kwargs):
        pytest.fail("file assertion failure must prevent final pytest")

    monkeypatch.setattr(validators.subprocess, "run", forbidden_pytest)
    result = run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)

    assert result.status == "FAILED"
    events = _events(database)
    assert next(event for event in events if event["event_type"] == "TOOL_RESULT")["payload"]["status"] == "SUCCESS"
    assert [event["event_type"] for event in events[-4:]] == ["VALIDATION_STARTED", "FILE_OBSERVED", "VALIDATION_FAILED", "RUN_FAILED"]
    assert events[-3]["payload"]["reason"] == "VALIDATION"
    assert events[-2]["payload"]["passed"] is False
    assert events[-2]["payload"]["details"]["pytest"]["executed"] is False
    assert events[-2]["payload"]["details"]["pytest"]["reason"] == "not executed due to file assertion failure"
    assert events[-1]["payload"] == {"reason": "VALIDATION_FAILED", "validation_event_id": events[-2]["event_id"]}
    assert not any(event["event_type"] == "RUN_COMPLETED" for event in events)


def test_agent_run_tests_success_does_not_authorize_completion(database, task_file, registry, patch_plan, tmp_path):
    _configure(task_file, assertions=[{"path": "config.json", "operator": "contains", "expected": '"timeout": 30'}])
    plan = [*patch_plan, PlanStep("step_agent_tests", "run_tests", {"args": ["-q", "check_task.py"]})]

    result = run_task(database, task_file, tmp_path / "workspace", plan, registry)

    assert result.status == "FAILED"
    events = _events(database)
    tool_results = [event for event in events if event["event_type"] == "TOOL_RESULT"]
    assert [event["payload"]["status"] for event in tool_results] == ["SUCCESS", "SUCCESS"]
    assert tool_results[1]["payload"]["tool_name"] == "run_tests"
    assert "1 passed" in tool_results[1]["payload"]["result"]["stdout"]
    assert events[-2]["event_type"] == "VALIDATION_FAILED"
    assert events[-2]["payload"]["details"]["pytest"]["executed"] is False
    assert events[-1]["event_type"] == "RUN_FAILED"
    assert not any(event["event_type"] == "RUN_COMPLETED" for event in events)


def test_final_pytest_failure_ends_run_failed(database, task_file, registry, patch_plan, tmp_path):
    seed_test = task_file.parent / "seed" / "check_task.py"
    seed_test.write_text("def test_failure():\n    assert False\n", encoding="utf-8")

    result = run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)

    assert result.status == "FAILED"
    events = _events(database)
    assert events[-2]["event_type"] == "VALIDATION_FAILED"
    validation = events[-2]["payload"]
    assert validation["details"]["file_assertions"][0]["passed"] is True
    outcome = validation["details"]["pytest"]
    assert outcome["executed"] is True
    assert outcome["exit_code"] == 1
    assert "1 failed" in outcome["stdout"]
    assert isinstance(outcome["stderr"], str)
    assert events[-1]["event_type"] == "RUN_FAILED"
    assert not any(event["event_type"] == "RUN_COMPLETED" for event in events)


def test_runner_rejects_vacuous_success_without_acceptance_criteria(database, task_file, registry, tmp_path):
    _configure(task_file, assertions=[], enabled=False, args=[])

    result = run_task(database, task_file, tmp_path / "workspace", [], registry)

    assert result.status == "FAILED"
    events = _events(database)
    assert [event["event_type"] for event in events] == ["RUN_STARTED", "TASK_LOADED", "VALIDATION_STARTED", "VALIDATION_FAILED", "RUN_FAILED"]
    assert events[-2]["payload"]["message"] == "No acceptance criteria configured"


def test_runner_snapshots_all_plan_arguments_before_execution(database, task_file, registry, tmp_path):
    original_arguments = {"path": "result.txt", "content": "original snapshot"}

    class CallerMutationTool(WriteFileTool):
        name = "caller_mutation_tool"

        def execute(self, sandbox, arguments):
            original_arguments["content"] = "caller changed later arguments"
            original_arguments["path"] = "wrong_path.txt"
            return super().execute(sandbox, arguments)

    registry.register(CallerMutationTool())
    _configure(task_file, assertions=[{"path": "result.txt", "operator": "equals", "expected": "original snapshot"}], enabled=False, args=[])
    plan = [
        PlanStep("step_mutate_caller", "caller_mutation_tool", {"path": "first.txt", "content": "first"}),
        PlanStep("step_snapshot", "write_file", original_arguments),
    ]

    result = run_task(database, task_file, tmp_path / "workspace", plan, registry)

    assert result.status == "COMPLETED"
    assert original_arguments["content"] == "caller changed later arguments"
    assert (tmp_path / "workspace" / "result.txt").read_bytes() == b"original snapshot"
    assert not (tmp_path / "workspace" / "wrong_path.txt").exists()
    events = [event for event in _events(database) if event["step_id"] == "step_snapshot"]
    planned = next(event for event in events if event["event_type"] == "STEP_PLANNED")
    intent = next(event for event in events if event["event_type"] == "TOOL_INTENT")
    assert planned["payload"]["arguments"] == intent["payload"]["arguments"] == {"path": "result.txt", "content": "original snapshot"}


@pytest.mark.parametrize("plan", [
    "", {}, [object()],
    [PlanStep("same", "write_file", {}), PlanStep("same", "read_file", {})],
    [PlanStep(" ", "write_file", {})], [PlanStep(None, "write_file", {})],
    [PlanStep("first", "write_file", {}), PlanStep("later", "missing_tool", {})],
    [PlanStep("step", " ", {})], [PlanStep("step", "write_file", [])],
    [PlanStep("step", "write_file", {"non_json": object()})],
])
def test_plan_preflight_rejects_invalid_plan_before_workspace_or_run(database, task_file, registry, tmp_path, monkeypatch, plan):
    def forbidden_declaration(*args, **kwargs):
        pytest.fail("whole-plan preflight must not declare or execute tool targets")

    for name in ("write_file", "read_file", "patch_file", "run_tests"):
        monkeypatch.setattr(registry.get(name), "declared_targets", forbidden_declaration)
    with pytest.raises((ValueError, TypeError)):
        run_task(database, task_file, tmp_path / "workspace", plan, registry)
    assert not (tmp_path / "workspace").exists()
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


@pytest.mark.parametrize("case", ["unknown_operator", "unsafe_pytest_option"])
def test_acceptance_configuration_preflight_precedes_side_effects(database, task_file, registry, patch_plan, tmp_path, case):
    if case == "unknown_operator":
        _configure(task_file, assertions=[{"path": "config.json", "operator": "regex", "expected": "x"}])
    else:
        _configure(task_file, args=["-p", "arbitrary_plugin"])
    with pytest.raises(ValueError):
        run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)
    assert not (tmp_path / "workspace").exists()
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_acceptance_path_preflight_preserves_copied_workspace_without_execution(database, task_file, registry, patch_plan, tmp_path):
    _configure(task_file, args=["missing_test.py"])
    with pytest.raises(ValueError, match="does not exist"):
        run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)
    assert (tmp_path / "workspace" / "config.json").read_bytes() == (task_file.parent / "seed" / "config.json").read_bytes()
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


@pytest.mark.parametrize("seed", ["../outside", r"..\outside", "/outside", r"C:\outside", r"C:outside", r"\\host\share", "seed\x00bad"])
def test_seed_reference_cannot_escape_task_directory(database, task_file, registry, tmp_path, seed):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "marker.txt").write_bytes(b"outside evidence")
    _configure(task_file, seed=seed)
    with pytest.raises((ValueError, OSError)):
        run_task(database, task_file, tmp_path / "workspace", [], registry)
    assert not (tmp_path / "workspace").exists()
    assert (outside / "marker.txt").read_bytes() == b"outside evidence"
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


@pytest.mark.parametrize("kind", ["missing", "file"])
def test_seed_must_be_existing_directory(database, task_file, registry, tmp_path, kind):
    if kind == "file":
        (task_file.parent / "not_a_seed.txt").write_bytes(b"file")
        _configure(task_file, seed="not_a_seed.txt")
    else:
        _configure(task_file, seed="missing_seed")
    with pytest.raises(OSError):
        run_task(database, task_file, tmp_path / "workspace", [], registry)
    assert not (tmp_path / "workspace").exists()
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_seed_is_resolved_relative_to_task_file_and_run_records_resolved_root(database, task_file, registry, patch_plan, tmp_path, monkeypatch):
    other_cwd = tmp_path / "other_cwd"
    other_cwd.mkdir()
    monkeypatch.chdir(other_cwd)
    result = run_task(database, task_file, "../workspace", patch_plan, registry)
    assert result.status == "COMPLETED"
    assert result.workspace_path == str((tmp_path / "workspace").resolve())


def test_unexpected_execution_exception_preserves_incomplete_evidence(database, task_file, registry, tmp_path):
    class UnexpectedFailureTool(WriteFileTool):
        name = "unexpected_failure_tool"
        calls = 0

        def execute(self, sandbox, arguments):
            self.calls += 1
            assert not database.in_transaction
            super().execute(sandbox, arguments)
            raise RuntimeError("unexpected failure after external effect")

    tool = UnexpectedFailureTool()
    registry.register(tool)
    with pytest.raises(RuntimeError, match="unexpected failure after external effect"):
        run_task(database, task_file, tmp_path / "workspace", [
            PlanStep("step_crash", tool.name, {"path": "changed.txt", "content": "external effect"}),
        ], registry)
    assert tool.calls == 1
    assert (tmp_path / "workspace" / "changed.txt").read_bytes() == b"external effect"
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
    assert [event["event_type"] for event in _events(database)] == ["RUN_STARTED", "TASK_LOADED", "STEP_PLANNED", "FILE_OBSERVED", "TOOL_INTENT"]
    assert not database.in_transaction


def test_runner_hard_exit_preserves_crash_window_b(task_file, tmp_path):
    database_path = tmp_path / "runner_crash.sqlite3"
    workspace = tmp_path / "workspace"
    child = r'''
import os
import sys
from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.storage import connect_database
from axis_evo.tools import WriteFileTool

connection = connect_database(sys.argv[1])
class CrashAfterWrite(WriteFileTool):
    def execute(self, sandbox, arguments):
        assert not connection.in_transaction
        result = super().execute(sandbox, arguments)
        assert result.status == "SUCCESS"
        os._exit(70)

registry = PluginRegistry()
registry.register(CrashAfterWrite())
run_task(connection, sys.argv[2], sys.argv[3], [PlanStep("step_crash", "write_file", {"path": "config.json", "content": '{"timeout": 20}'})], registry, run_id="run_runner_crash")
'''
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2] / "src")
    completed = subprocess.run([sys.executable, "-c", child, str(database_path), str(task_file), str(workspace)],
                               env=env, capture_output=True, text=True, timeout=15)
    assert completed.returncode == 70, completed.stdout + completed.stderr
    assert (workspace / "config.json").read_bytes() == b'{"timeout": 20}'
    connection = connect_database(database_path)
    try:
        assert tuple(connection.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
        events = _events(connection)
        assert [event["seq"] for event in events] == [1, 2, 3, 4, 5]
        assert [event["event_type"] for event in events] == ["RUN_STARTED", "TASK_LOADED", "STEP_PLANNED", "FILE_OBSERVED", "TOOL_INTENT"]
        assert events[-2]["payload"]["sha256"] == hashlib.sha256((task_file.parent / "seed" / "config.json").read_bytes()).hexdigest()
        assert append_event(connection, "run_runner_crash", EventType.TASK_LOADED, {}).seq == 6
    finally:
        connection.close()


def test_runner_terminal_failure_keeps_event_and_row_consistent(database, task_file, registry, patch_plan, tmp_path):
    database.executescript("""
        CREATE TEMP TRIGGER reject_terminal_update BEFORE UPDATE ON runs
        WHEN NEW.status = 'COMPLETED'
        BEGIN SELECT RAISE(ABORT, 'terminal update rejected'); END;
    """)
    with pytest.raises(sqlite3.IntegrityError, match="terminal update rejected"):
        run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)
    assert tuple(database.execute("SELECT status, ended_at FROM runs").fetchone()) == ("RUNNING", None)
    events = _events(database)
    assert events[-1]["event_type"] == "VALIDATION_PASSED"
    assert not any(event["event_type"] in {"RUN_COMPLETED", "RUN_FAILED"} for event in events)
    assert not database.in_transaction


def test_single_matching_step_planned_allows_one_invocation_after_commit(database, task_spec, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    sandbox = Sandbox(root)
    run = create_run(database, task_spec, sandbox.root, "explicit_plan")

    class CheckedWrite(WriteFileTool):
        def execute(self, sandbox, arguments):
            assert not database.in_transaction
            reader = connect_database(tmp_path / "facts.sqlite3")
            try:
                assert [row[0] for row in reader.execute("SELECT event_type FROM events ORDER BY seq")] == ["STEP_PLANNED", "FILE_OBSERVED", "TOOL_INTENT"]
                reader.execute("BEGIN IMMEDIATE")
                reader.rollback()
            finally:
                reader.close()
            return super().execute(sandbox, arguments)

    tool = CheckedWrite()
    step = PlanStep("step_planned", tool.name, {"path": "created.txt", "content": "planned effect"})
    append_event(database, run.run_id, EventType.STEP_PLANNED, {
        "arguments": dict(reversed(list(step.arguments.items()))), "tool_name": step.tool_name,
    }, step_id=step.step_id, tool_call_id="call_planned")

    result = execute_tool_call(database, run.run_id, sandbox, tool, step, "call_planned")

    assert result.status == "SUCCESS"
    assert (root / "created.txt").read_bytes() == b"planned effect"
    before = _events(database)
    with pytest.raises(ValueError, match="already been used"):
        execute_tool_call(database, run.run_id, sandbox, tool, step, "call_planned")
    assert _events(database) == before


@pytest.mark.parametrize("case", ["wrong_step", "wrong_tool", "wrong_arguments", "duplicate", "missing_payload", "bool_vs_int", "FILE_OBSERVED", "TOOL_INTENT", "TOOL_RESULT", "STEP_CONFIRMED"])
def test_incompatible_planned_id_rejected_before_all_execution_hooks(database, task_spec, tmp_path, monkeypatch, case):
    root = tmp_path / "workspace"
    root.mkdir()
    sandbox = Sandbox(root)
    run = create_run(database, task_spec, sandbox.root, "explicit_plan")
    tool = WriteFileTool()
    step = PlanStep("step_planned", tool.name, {"path": "created.txt", "content": "expected"})
    payload = {"tool_name": step.tool_name, "arguments": dict(step.arguments)}
    step_id = step.step_id
    if case == "wrong_step":
        step_id = "other_step"
    elif case == "wrong_tool":
        payload["tool_name"] = "read_file"
    elif case == "wrong_arguments":
        payload["arguments"]["content"] = "different"
    elif case == "missing_payload":
        payload = {}
    elif case == "bool_vs_int":
        payload["arguments"]["content"] = True
        step.arguments["content"] = 1
    append_event(database, run.run_id, EventType.STEP_PLANNED, payload, step_id=step_id, tool_call_id="call_planned")
    if case == "duplicate":
        append_event(database, run.run_id, EventType.STEP_PLANNED, payload, step_id=step_id, tool_call_id="call_planned")
    elif case in {"FILE_OBSERVED", "TOOL_INTENT", "TOOL_RESULT", "STEP_CONFIRMED"}:
        append_event(database, run.run_id, case, {}, step_id=step_id, tool_call_id="call_planned")
    before = _events(database)

    def forbidden_hook(*args, **kwargs):
        pytest.fail("planning context rejection must precede declaration, observation, and execution")

    monkeypatch.setattr(tool, "declared_targets", forbidden_hook)
    monkeypatch.setattr(tool, "execute", forbidden_hook)
    monkeypatch.setattr(sandbox, "observe_file", forbidden_hook)
    with pytest.raises(ValueError, match="already been used"):
        execute_tool_call(database, run.run_id, sandbox, tool, step, "call_planned")
    assert _events(database) == before
    assert list(root.iterdir()) == []
    assert not database.in_transaction


class _NormalizesOnDeepcopy:
    def __deepcopy__(self, memo):
        return {"silently_normalized": True}


@pytest.mark.parametrize("arguments", [
    {1: "value"},
    {True: "value"},
    {"items": ("a", "b")},
    {"items": [{"nested": {1: "value"}}]},
    {"items": [{"nested": ("a", "b")}]},
    {"items": {"a", "b"}},
    {"data": b"bytes"},
    {"value": object()},
    {"value": _NormalizesOnDeepcopy()},
    {"items": [float("nan")]},
    {"items": [float("inf")]},
    {"items": [float("-inf")]},
    {"value": type("DerivedInt", (int,), {})(1)},
    {"value": type("DerivedFloat", (float,), {})(1.0)},
    {"value": type("DerivedStr", (str,), {})("value")},
    {"value": type("DerivedList", (list,), {})(["value"])},
    {"value": type("DerivedDict", (dict,), {})({"key": "value"})},
    {type("DerivedKey", (str,), {})("key"): "value"},
], ids=[
    "integer_key", "boolean_key", "tuple", "nested_integer_key", "nested_tuple",
    "set", "bytes", "custom_object", "normalizing_deepcopy", "nan", "infinity",
    "negative_infinity", "int_subclass", "float_subclass", "str_subclass",
    "list_subclass", "dict_subclass", "key_subclass",
])
def test_non_json_native_arguments_rejected_before_any_execution(database, task_file, registry, tmp_path, monkeypatch, arguments):
    tool = registry.get("write_file")

    def forbidden_hook(*args, **kwargs):
        pytest.fail("invalid argument trees must be rejected before declaration or execution")

    monkeypatch.setattr(tool, "declared_targets", forbidden_hook)
    monkeypatch.setattr(tool, "execute", forbidden_hook)
    plan = [
        PlanStep("step_valid_first", "write_file", {"path": "first.txt", "content": "must not execute"}),
        PlanStep("step_invalid_later", "write_file", arguments),
    ]
    original_seed = _seed_bytes(task_file)
    with pytest.raises(ValueError, match="PlanStep.arguments"):
        run_task(database, task_file, tmp_path / "workspace", plan, registry)
    assert not (tmp_path / "workspace").exists()
    assert _seed_bytes(task_file) == original_seed
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


def test_json_native_nested_arguments_match_persisted_and_tool_visible_facts(database, task_file, registry, tmp_path):
    expected = {"items": [{
        "text": "nested\r\ntext", "integer": 7, "number": 1.25, "enabled": True,
        "missing": None, "children": [False, -3, -0.0, {}, []],
    }]}
    original_arguments = json.loads(json.dumps(expected))
    seen = []

    class JsonNativeTool:
        name = "json_native_tool"
        mutating = False

        def declared_targets(self, arguments):
            return []

        def execute(self, sandbox, arguments):
            original_arguments["items"][0]["text"] = "caller mutation"
            assert arguments == expected
            item = arguments["items"][0]
            assert type(item["integer"]) is int
            assert type(item["enabled"]) is bool
            assert type(item["number"]) is float
            assert type(item["children"]) is list
            seen.append(arguments)
            return ToolResult("SUCCESS", "JSON-native arguments received", 0.0)

    registry.register(JsonNativeTool())
    _configure(task_file, assertions=[{"path": "config.json", "operator": "exists", "expected": ""}], enabled=False, args=[])
    result = run_task(database, task_file, tmp_path / "workspace", [
        PlanStep("step_native", "json_native_tool", original_arguments),
    ], registry)
    assert result.status == "COMPLETED"
    assert seen == [expected]
    assert original_arguments["items"][0]["text"] == "caller mutation"
    events = _events(database)
    planned = next(event for event in events if event["event_type"] == "STEP_PLANNED")
    intent = next(event for event in events if event["event_type"] == "TOOL_INTENT")
    assert planned["payload"]["arguments"] == intent["payload"]["arguments"] == seen[0]


@pytest.mark.parametrize("operator", ["contains", "equals"])
def test_runner_cannot_pass_validation_using_changed_file_bytes(database, task_file, registry, patch_plan, tmp_path, monkeypatch, operator):
    workspace = tmp_path / "workspace"
    target = workspace / "config.json"
    observed_bytes = (task_file.parent / "seed" / "config.json").read_bytes().replace(b"10", b"20")
    changed_bytes = observed_bytes.replace(b"20", b"30")
    expected = '"timeout": 30' if operator == "contains" else changed_bytes.decode("utf-8")
    _configure(task_file, assertions=[{"path": "config.json", "operator": operator, "expected": expected}])
    original_read = Path.read_bytes
    content_reads = []

    def change_after_persisted_observation(path):
        if path == target:
            latest = database.execute("SELECT event_type, payload_json FROM events ORDER BY seq DESC LIMIT 1").fetchone()
            if latest is not None and latest["event_type"] == "FILE_OBSERVED":
                payload = json.loads(latest["payload_json"])
                if payload["reason"] == "VALIDATION":
                    assert not database.in_transaction
                    assert payload["sha256"] == hashlib.sha256(observed_bytes).hexdigest()
                    content_reads.append(path)
                    path.write_bytes(changed_bytes)
        return original_read(path)

    def forbidden_pytest(*args, **kwargs):
        pytest.fail("state instability must short-circuit final pytest")

    monkeypatch.setattr(Path, "read_bytes", change_after_persisted_observation)
    monkeypatch.setattr(validators.subprocess, "run", forbidden_pytest)
    result = run_task(database, task_file, workspace, patch_plan, registry)
    assert result.status == "FAILED"
    assert content_reads == [target]
    events = _events(database)
    validation_observations = [event for event in events if event["event_type"] == "FILE_OBSERVED" and event["payload"]["reason"] == "VALIDATION"]
    assert len(validation_observations) == 1
    assert validation_observations[0]["payload"]["sha256"] == hashlib.sha256(observed_bytes).hexdigest()
    assert validation_observations[0]["payload"]["size_bytes"] == len(observed_bytes)
    detail = events[-2]["payload"]["details"]["file_assertions"][0]
    assert detail["passed"] is False
    assert detail["message"] == "File changed during validation"
    assert events[-2]["event_type"] == "VALIDATION_FAILED"
    assert events[-1]["event_type"] == "RUN_FAILED"
    assert not any(event["event_type"] in {"VALIDATION_PASSED", "RUN_COMPLETED"} for event in events)


@pytest.mark.parametrize("path", [
    "../outside.txt", r"..\outside.txt", "/outside.txt", r"\outside.txt",
    r"C:\outside.txt", "C:/outside.txt", r"C:outside.txt", r"\\server\share\outside.txt",
    "file.txt:stream", "bad\x00path", "NUL", "COM1", "nested/NUL/file.txt", "host_absolute",
])
def test_unsafe_assertion_path_rejected_before_run_and_mutating_plan(database, task_file, registry, patch_plan, tmp_path, path):
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"outside evidence")
    if path == "host_absolute":
        path = str(outside)
    _configure(task_file, assertions=[{"path": path, "operator": "not_exists", "expected": ""}], enabled=False, args=[])

    class CheckedPatch(PatchFileTool):
        name = "checked_patch"
        declared = False
        executed = False

        def declared_targets(self, arguments):
            self.declared = True
            return super().declared_targets(arguments)

        def execute(self, sandbox, arguments):
            self.executed = True
            return super().execute(sandbox, arguments)

    tool = CheckedPatch()
    registry.register(tool)
    original_seed = _seed_bytes(task_file)
    workspace = tmp_path / "workspace"
    with pytest.raises(ValueError):
        run_task(database, task_file, workspace, [PlanStep("step_mutating", tool.name, patch_plan[0].arguments)], registry)
    assert not tool.declared
    assert not tool.executed
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    assert (workspace / "config.json").read_bytes() == original_seed["config.json"]
    assert _seed_bytes(task_file) == original_seed
    assert outside.read_bytes() == b"outside evidence"


def test_external_symlink_assertion_preflight_blocks_mutating_plan(database, task_file, registry, patch_plan, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"outside evidence")
    link = task_file.parent / "seed" / "external_link.txt"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError) as error:
        if isinstance(error, NotImplementedError) or getattr(error, "winerror", None) in {1314, 50}:
            pytest.skip(f"OS cannot create the symlink required by this subcase: {error}")
        raise
    _configure(task_file, assertions=[{"path": "external_link.txt", "operator": "not_exists", "expected": ""}], enabled=False, args=[])
    with pytest.raises(ValueError, match="escapes root"):
        run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)
    assert database.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    assert (tmp_path / "workspace" / "config.json").read_bytes() == (task_file.parent / "seed" / "config.json").read_bytes()
    assert outside.read_bytes() == b"outside evidence"


def test_safe_missing_target_not_exists_acceptance_remains_valid(database, task_file, registry, patch_plan, tmp_path):
    _configure(task_file, assertions=[{"path": "missing.txt", "operator": "not_exists", "expected": ""}], enabled=False, args=[])
    result = run_task(database, task_file, tmp_path / "workspace", patch_plan, registry)
    assert result.status == "COMPLETED"
    assert not (tmp_path / "workspace" / "missing.txt").exists()
    events = _events(database)
    detail = events[-2]["payload"]["details"]["file_assertions"][0]
    assert detail["passed"] is True
    assert detail["exists"] is False
    assert detail["sha256"] is None
    assert detail["size_bytes"] is None

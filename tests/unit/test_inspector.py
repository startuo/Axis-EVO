from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3

import pytest

from axis_evo.events import EventType
from axis_evo.inspector import format_inspection_json, format_inspection_text, inspect_database, inspect_run
from axis_evo.models import PlanStep, RunStatus
from axis_evo.sandbox import Sandbox
from axis_evo.storage import append_event, create_run, finish_run
from axis_evo.tools import ReadFileTool, WriteFileTool, execute_tool_call


@pytest.fixture
def context(database, task_spec, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    sandbox = Sandbox(root)
    run = create_run(database, task_spec, sandbox.root, "explicit_plan", run_id="run_inspect")
    return database, run, sandbox


def _intent(context, paths=("config.json",), call="call_x", step="step_x", pre=True, target_transform=None):
    connection, run, sandbox = context
    targets = []
    for path in paths:
        observation = asdict(sandbox.observe_file(path))
        if pre:
            append_event(connection, run.run_id, EventType.FILE_OBSERVED,
                         {"reason": "PRE_TOOL", **observation}, step_id=step, tool_call_id=call)
        target = {**observation, "before_sha256": observation.pop("sha256")}
        target.pop("sha256")
        if target_transform:
            target_transform(target)
        targets.append(target)
    return append_event(connection, run.run_id, EventType.TOOL_INTENT,
                        {"tool_name": "write_file", "arguments": {}, "mutating": bool(paths), "targets": targets},
                        step_id=step, tool_call_id=call)


def _report(context):
    return inspect_run(context[0], context[1].run_id)


def _target(report, index=0):
    return report["pending_invocations"][0]["targets"][index]


def _codes(report):
    return {item["code"] for item in report["trace"]["issues"]}


def _facts(connection):
    return ([tuple(row) for row in connection.execute("SELECT * FROM runs ORDER BY run_id")],
            [tuple(row) for row in connection.execute("SELECT * FROM events ORDER BY run_id, seq")],
            [tuple(row) for row in connection.execute("SELECT * FROM sqlite_master ORDER BY name")])


@pytest.mark.parametrize("before,after,changed", [
    (None, None, False), (None, b"created", True), (b"existing", None, True),
    (b"same", b"same", False), (b"AAAA", b"BBBB", True), (b"a", b"longer", True),
    (b"a\r\nb\xff", b"a\nb\xff", True),
])
def test_explicit_target_raw_state_comparison(context, before, after, changed):
    path = context[2].root / "config.json"
    if before is not None:
        path.write_bytes(before)
    _intent(context)
    if after is None:
        path.unlink(missing_ok=True)
    else:
        path.write_bytes(after)
    report = _report(context)
    assert report["trace"]["consistent"]
    assert _target(report)["external_state_changed"] is changed
    assert ("EXTERNAL_STATE_CHANGED" in report["observations"]) is changed
    assert report["observations"][:2] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    if before is not None:
        assert _target(report)["before"]["sha256"] == hashlib.sha256(before).hexdigest()


def test_size_difference_independently_causes_state_change(context):
    connection, run, sandbox = context
    data = b"same hash"
    (sandbox.root / "config.json").write_bytes(data)
    observation = {"path": "config.json", "exists": True, "sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data) + 1}
    append_event(connection, run.run_id, "FILE_OBSERVED", {"reason": "PRE_TOOL", **observation}, tool_call_id="call_x")
    append_event(connection, run.run_id, "TOOL_INTENT", {"tool_name": "write_file", "arguments": {}, "mutating": True,
        "targets": [{"path": "config.json", "exists": True, "before_sha256": observation["sha256"], "size_bytes": observation["size_bytes"]}]}, tool_call_id="call_x")
    report = _report(context)
    assert report["trace"]["consistent"]
    assert _target(report)["before"]["sha256"] == _target(report)["current"]["sha256"]
    assert _target(report)["external_state_changed"] is True


def test_nonmutating_unknown_does_not_observe_workspace(context, monkeypatch):
    _intent(context, paths=())
    monkeypatch.setattr(Sandbox, "observe_file", lambda *args: pytest.fail("unexpected file observation"))
    report = _report(context)
    assert report["pending_invocations"][0]["targets"] == []
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]


def test_tool_result_without_confirmation_suppresses_unknown(context, monkeypatch):
    connection, run, sandbox = context
    execute_tool_call(connection, run.run_id, sandbox, WriteFileTool(),
                      PlanStep("step_x", "write_file", {"path": "config.json", "content": "after"}), "call_x")
    monkeypatch.setattr(Sandbox, "observe_file", lambda *args: pytest.fail("resolved target must not be read"))
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["pending_invocations"] == []
    assert report["observations"] == ["UNFINISHED_RUN"]


def test_post_observation_is_not_a_tool_result(context):
    connection, run, sandbox = context
    _intent(context)
    (sandbox.root / "config.json").write_bytes(b"after")
    append_event(connection, run.run_id, "FILE_OBSERVED", {"reason": "POST_TOOL", **asdict(sandbox.observe_file("config.json"))},
                 step_id="step_x", tool_call_id="call_x")
    report = _report(context)
    assert report["pending_invocations"][0]["post_observation_present"] is True
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN", "EXTERNAL_STATE_CHANGED"]


@pytest.mark.parametrize("last", ["STEP_PLANNED", "VALIDATION_STARTED", "VALIDATION_PASSED", "STEP_CONFIRMED"])
def test_later_incomplete_prefixes_are_factual(context, last):
    connection, run, sandbox = context
    if last == "STEP_PLANNED":
        append_event(connection, run.run_id, last, {"tool_name": "write_file", "arguments": {}}, step_id="step_x", tool_call_id="call_x")
    else:
        execute_tool_call(connection, run.run_id, sandbox, ReadFileTool(),
                          PlanStep("step_x", "read_file", {"path": "absent.txt"}), "call_x")
        payload = ({"file_assertion_count": 1, "pytest_enabled": False} if last == "VALIDATION_STARTED" else
                   {"passed": True, "message": "passed", "details": {}} if last == "VALIDATION_PASSED" else
                   {"tool_call_id": "call_x", "tool_status": "FAILED"})
        append_event(connection, run.run_id, last, payload, step_id="step_x", tool_call_id="call_x")
    report = _report(context)
    assert report["trace"]["last_event_type"] == last
    assert report["observations"] == ["UNFINISHED_RUN"]


def test_zero_event_run_is_supported(context):
    report = _report(context)
    assert report["trace"] == {"event_count": 0, "last_seq": None, "last_event_type": None, "consistent": True, "issues": []}
    assert report["observations"] == ["UNFINISHED_RUN"]


@pytest.mark.parametrize("changed_field,changed_value", [("before_sha256", "f" * 64), ("size_bytes", 100), ("exists", False)])
def test_pre_intent_mismatch_disables_positive_comparison(context, changed_field, changed_value):
    (context[2].root / "config.json").write_bytes(b"first")
    _intent(context, target_transform=lambda target: target.update({changed_field: changed_value}))
    (context[2].root / "config.json").write_bytes(b"changed")
    report = _report(context)
    assert "PRE_OBSERVATION_INTENT_MISMATCH" in _codes(report)
    assert not report["trace"]["consistent"]
    assert _target(report)["external_state_changed"] is None
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]


@pytest.mark.parametrize("shape", ["missing", "after", "duplicate"])
def test_missing_late_or_duplicate_pre_cannot_support_change(context, shape):
    connection, run, sandbox = context
    _intent(context, pre=shape == "duplicate")
    append_event(connection, run.run_id, "FILE_OBSERVED", {"reason": "PRE_TOOL", **asdict(sandbox.observe_file("config.json"))},
                 step_id="step_x", tool_call_id="call_x")
    if shape == "duplicate":
        # Put both PRE rows before intent without rewriting production APIs.
        connection.execute("UPDATE events SET event_type='FILE_OBSERVED',payload_json=(SELECT payload_json FROM events WHERE seq=1) WHERE seq=2")
        connection.execute("UPDATE events SET event_type='TOOL_INTENT',payload_json=? WHERE seq=3", (json.dumps({"tool_name":"write_file","arguments":{},"mutating":True,"targets":[{"path":"config.json","exists":False,"before_sha256":None,"size_bytes":None}]}),))
    (sandbox.root / "config.json").write_bytes(b"changed")
    report = _report(context)
    expected = "PRE_OBSERVATION_DUPLICATE" if shape == "duplicate" else "PRE_OBSERVATION_MISSING"
    assert expected in _codes(report)
    assert _target(report)["external_state_changed"] is None


@pytest.mark.parametrize("kind", ["TOOL_INTENT", "TOOL_RESULT"])
def test_duplicate_raw_invocation_facts_are_not_silently_selected(context, kind):
    connection, run, sandbox = context
    intent = _intent(context)
    payload = intent.payload if kind == "TOOL_INTENT" else {"tool_name":"write_file","status":"SUCCESS","message":"ok","duration_ms":0.0,"result":{}}
    append_event(connection, run.run_id, kind, payload, step_id="step_x", tool_call_id="call_x")
    append_event(connection, run.run_id, kind, payload, step_id="step_x", tool_call_id="call_x")
    (sandbox.root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert "DUPLICATE_" + kind in _codes(report)
    assert report["pending_invocations"] == []
    assert report["observations"] == ["UNFINISHED_RUN"]


@pytest.mark.parametrize("raw", ["not JSON", "[]", "null", '"string"', '{"targets":[]}',
    '{"tool_name":"x","arguments":{"n":NaN},"mutating":false,"targets":[]}',
    '{"tool_name":"x","arguments":{"n":1e999},"mutating":false,"targets":[]}',
    '{"tool_name":"x","arguments":{},"mutating":false,"mutating":true,"targets":[]}'])
def test_invalid_intent_payload_retains_unknown_without_inventing_targets(context, raw):
    connection, run, _ = context
    intent = _intent(context, paths=())
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (raw, intent.event_id))
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert report["pending_invocations"][0]["targets"] == []
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    json.loads(format_inspection_json(report))


@pytest.mark.parametrize("raw", ["not JSON", "[]", "{}"])
def test_malformed_result_is_present_and_never_reclassified_as_missing(context, raw):
    connection, run, _ = context
    _intent(context)
    event = append_event(connection, run.run_id, "TOOL_RESULT", {}, step_id="step_x", tool_call_id="call_x")
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (raw, event.event_id))
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert report["observations"] == ["UNFINISHED_RUN"]
    assert report["pending_invocations"] == []


@pytest.mark.parametrize("field,value", [("exists", 1), ("exists", "false"), ("size_bytes", True),
    ("size_bytes", -1), ("before_sha256", "bad"), ("before_sha256", "A" * 64)])
def test_invalid_target_state_types_cannot_support_change(context, field, value):
    (context[2].root / "config.json").write_bytes(b"before")
    _intent(context, target_transform=lambda target: target.update({field:value}))
    (context[2].root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert _target(report)["before"] is None
    assert _target(report)["external_state_changed"] is None


def test_duplicate_target_paths_never_use_the_first_before_fact(context):
    connection, _, sandbox = context
    intent = _intent(context)
    payload = deepcopy(intent.payload)
    payload["targets"] *= 2
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (json.dumps(payload), intent.event_id))
    (sandbox.root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert all(target["external_state_changed"] is None for target in report["pending_invocations"][0]["targets"])
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]


@pytest.mark.parametrize("mutation,code", [("task", "TASK_ID_MISMATCH"), ("schema", "UNSUPPORTED_EVENT_SCHEMA"),
    ("seq", "SEQ_INCONSISTENT"), ("step", "INVOCATION_IDENTITY_MISMATCH"), ("call", "INVOCATION_IDENTITY_MISMATCH"), ("type", "UNSUPPORTED_EVENT_TYPE")])
def test_corrupt_envelope_and_sequence_surface_issues(context, mutation, code):
    connection, _, sandbox = context
    intent = _intent(context)
    if mutation == "schema":
        connection.execute("PRAGMA ignore_check_constraints=ON")
        connection.execute("UPDATE events SET schema_version=2 WHERE event_id=?", (intent.event_id,))
        connection.execute("PRAGMA ignore_check_constraints=OFF")
    else:
        sql = {"task":"task_id='wrong'", "seq":"seq=5", "step":"step_id='wrong'", "call":"tool_call_id=''", "type":"event_type='OTHER'"}[mutation]
        connection.execute("UPDATE events SET " + sql + " WHERE event_id=?", (intent.event_id,))
    (sandbox.root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert code in _codes(report)
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]


def test_seq_orders_invocations_targets_and_last_event_regardless_of_timestamps(context):
    connection, _, _ = context
    _intent(context, paths=("z.txt", "a.txt"), call="call_z", step="step_z")
    _intent(context, paths=("config.json",), call="call_a", step="step_a")
    connection.execute("UPDATE events SET occurred_at=CASE WHEN seq=5 THEN '1900-01-01' ELSE '2100-01-01' END")
    report = _report(context)
    assert report["trace"]["last_seq"] == 5
    assert report["trace"]["last_event_type"] == "TOOL_INTENT"
    assert [item["tool_call_id"] for item in report["pending_invocations"]] == ["call_z", "call_a"]
    assert [item["path"] for item in report["pending_invocations"][0]["targets"]] == ["z.txt", "a.txt"]
    assert report["trace"]["consistent"]


def test_independent_valid_target_can_still_report_change(context):
    connection, _, sandbox = context
    intent = _intent(context, paths=("invalid.txt", "valid.txt"))
    payload = deepcopy(intent.payload)
    payload["targets"][0]["size_bytes"] = 123
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (json.dumps(payload), intent.event_id))
    (sandbox.root / "valid.txt").write_bytes(b"created")
    report = _report(context)
    assert _target(report, 0)["external_state_changed"] is None
    assert _target(report, 1)["external_state_changed"] is True
    assert "EXTERNAL_STATE_CHANGED" in report["observations"]


@pytest.mark.parametrize("case", ["missing", "file", "relative", "nul"])
def test_unavailable_workspace_preserves_database_facts(context, case):
    connection, run, sandbox = context
    _intent(context)
    if case in ("missing", "file"):
        sandbox.root.rename(sandbox.root.with_name("workspace_original"))
        if case == "file":
            sandbox.root.write_bytes(b"not a directory")
    else:
        connection.execute("UPDATE runs SET workspace_path=? WHERE run_id=?", ("relative" if case == "relative" else "\x00", run.run_id))
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    assert _target(report)["current"]["observable"] is False
    assert _target(report)["external_state_changed"] is None
    assert report["current_state_issues"][0]["code"] == "WORKSPACE_UNAVAILABLE"


@pytest.mark.parametrize("case", ["directory", "parent_missing", "permission"])
def test_unobservable_target_is_null_not_false(context, case, monkeypatch):
    connection, _, sandbox = context
    if case == "parent_missing":
        (sandbox.root / "parent").mkdir()
        _intent(context, paths=("parent/file.txt",))
        (sandbox.root / "parent").rmdir()
    else:
        _intent(context)
        if case == "directory":
            (sandbox.root / "config.json").mkdir()
        else:
            def denied(*args):
                raise PermissionError("read denied")
            monkeypatch.setattr(Sandbox, "observe_file", denied)
    report = _report(context)
    assert report["trace"]["consistent"]
    assert _target(report)["current"]["observable"] is False
    assert _target(report)["external_state_changed"] is None
    assert report["current_state_issues"][-1]["code"] == "CURRENT_TARGET_UNOBSERVABLE"


def _symlink(link, target, directory=False):
    try:
        link.symlink_to(target, target_is_directory=directory)
    except OSError as error:
        if getattr(error, "winerror", None) == 1314 or (os.name != "nt" and error.errno in (1, 13)):
            pytest.skip(f"OS symlink privilege unavailable: {error}")
        raise


@pytest.mark.parametrize("case", ["target", "parent", "root"])
def test_external_symlink_is_not_followed_for_comparison(context, tmp_path, monkeypatch, case):
    connection, _, sandbox = context
    outside = tmp_path / "outside"
    outside.mkdir()
    external = outside / "config.json"
    external.write_bytes(b"external bytes")
    if case == "parent":
        (sandbox.root / "parent").mkdir()
        _intent(context, paths=("parent/config.json",))
        (sandbox.root / "parent").rmdir()
        _symlink(sandbox.root / "parent", outside, True)
    elif case == "root":
        _intent(context)
        sandbox.root.rename(sandbox.root.with_name("original_workspace"))
        _symlink(sandbox.root, outside, True)
    else:
        _intent(context)
        _symlink(sandbox.root / "config.json", external)
    original_read = Path.read_bytes
    def guarded(path):
        if path.resolve().is_relative_to(outside):
            pytest.fail("Inspector read external symlink target")
        return original_read(path)
    monkeypatch.setattr(Path, "read_bytes", guarded)
    report = _report(context)
    assert _target(report)["current"]["observable"] is False
    assert _target(report)["external_state_changed"] is None
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]


def test_inspection_is_query_only_and_preserves_all_facts_and_workspace(context, monkeypatch):
    connection, run, sandbox = context
    (sandbox.root / "config.json").write_bytes(b"before")
    _intent(context)
    (sandbox.root / "config.json").write_bytes(b"after")
    before = _facts(connection)
    file_before = (sandbox.root / "config.json").read_bytes(), (sandbox.root / "config.json").stat().st_mtime_ns
    previous_factory = connection.row_factory
    connection.row_factory = None
    connection.execute("PRAGMA query_only=ON")
    queries = []
    connection.set_trace_callback(queries.append)
    def forbidden(*args, **kwargs):
        pytest.fail("Inspector attempted a filesystem write")
    with monkeypatch.context() as guarded:
        for name in ("write_bytes", "write_text", "mkdir", "unlink", "rmdir", "rename", "touch"):
            guarded.setattr(Path, name, forbidden)
        report = _report(context)
    connection.set_trace_callback(None)
    assert len(queries) == 1 and queries[0].lstrip().startswith("SELECT")
    assert connection.row_factory is None
    connection.row_factory = previous_factory
    assert before == _facts(connection)
    assert file_before == ((sandbox.root / "config.json").read_bytes(), (sandbox.root / "config.json").stat().st_mtime_ns)
    assert not connection.in_transaction
    assert report["observations"][-1] == "EXTERNAL_STATE_CHANGED"


def test_active_transaction_is_rejected_without_commit_or_rollback(context):
    connection, run, _ = context
    connection.execute("BEGIN")
    connection.execute("UPDATE runs SET model_plugin='uncommitted' WHERE run_id=?", (run.run_id,))
    with pytest.raises(ValueError, match="active caller transaction"):
        _report(context)
    assert connection.in_transaction
    assert connection.execute("SELECT model_plugin FROM runs").fetchone()[0] == "uncommitted"
    connection.rollback()


@pytest.mark.parametrize("run_id", [None, "", "  ", 123, True, "missing"])
def test_invalid_or_missing_run_is_rejected(context, run_id):
    with pytest.raises(ValueError):
        inspect_run(context[0], run_id)


def test_readonly_connection_sees_committed_wal_facts(context):
    connection, run, _ = context
    _intent(context)
    path = connection.execute("PRAGMA database_list").fetchone()[2]
    readonly = sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True, isolation_level=None)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            readonly.execute("UPDATE runs SET model_plugin='forbidden'")
        assert inspect_run(readonly, run.run_id) == _report(context)
    finally:
        readonly.close()


@pytest.mark.parametrize("status", [RunStatus.FAILED, RunStatus.INTERRUPTED, RunStatus.COMPLETED])
def test_consistent_terminal_runs_inspect_normally(context, status):
    connection, run, _ = context
    payload = {}
    if status is RunStatus.COMPLETED:
        event = append_event(connection, run.run_id, "VALIDATION_PASSED", {"passed":True,"message":"passed","details":{}})
        payload["validation_event_id"] = event.event_id
    finish_run(connection, run.run_id, status, payload)
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["observations"] == []
    assert report["run"]["status"] == status


@pytest.mark.parametrize("case", ["running_ended", "running_terminal", "terminal_no_event", "wrong_terminal", "multiple", "event_after_terminal", "completed_without_validation"])
def test_terminal_state_inconsistency_is_reported_not_repaired(context, case):
    connection, run, _ = context
    if case == "running_ended":
        connection.execute("UPDATE runs SET ended_at='now'")
    elif case == "running_terminal":
        append_event(connection, run.run_id, "RUN_FAILED", {})
    elif case == "terminal_no_event":
        connection.execute("UPDATE runs SET status='FAILED', ended_at='now'")
    elif case == "completed_without_validation":
        event = append_event(connection, run.run_id, "RUN_COMPLETED", {})
        connection.execute("UPDATE runs SET status='COMPLETED', ended_at=?", (event.occurred_at,))
    else:
        finish_run(connection, run.run_id, RunStatus.FAILED, {})
        if case == "wrong_terminal":
            connection.execute("UPDATE events SET event_type='RUN_INTERRUPTED'")
        else:
            append_event(connection, run.run_id, "RUN_FAILED" if case == "multiple" else "TASK_LOADED", {})
    before = _facts(connection)
    report = _report(context)
    assert "RUN_TERMINAL_STATE_MISMATCH" in _codes(report)
    assert before == _facts(connection)


def test_json_text_output_is_native_stable_and_has_no_forbidden_conclusions(context):
    _intent(context)
    (context[2].root / "config.json").write_bytes(b"changed")
    report = _report(context)
    first = format_inspection_json(report)
    assert json.loads(first) == report
    assert report["inspection_schema_version"] == 1
    assert first == format_inspection_json(_report(context))
    text = format_inspection_text(report)
    assert text == format_inspection_text(_report(context))
    for observation in report["observations"]:
        assert observation in text
    for word in ("CONFIRMED_EXECUTED", "CONFIRMED_NOT_EXECUTED", "RETRY", "CONTINUE", "COMPENSATE", "SAFE_TO_RETRY", "confidence_score", "recommended_action", "fault_owner", "recovery_strategy"):
        assert word not in first + text
    assert "do not attribute changes to a tool" in text
    assert "equal states do not establish whether it ran" in text
    assert '"changed"' not in first  # no raw file contents
    unicode_report = deepcopy(report)
    unicode_report["run"]["task_id"] = "中文任务"
    assert "中文任务" in format_inspection_json(unicode_report)
    unicode_report["number"] = float("nan")
    with pytest.raises(ValueError):
        format_inspection_json(unicode_report)


@pytest.mark.parametrize("raw", ['{"reason":', '{"reason":"PRE_TOOL","path":"config.json","path":"other.txt","exists":false,"sha256":null,"size_bytes":null}'])
def test_malformed_extra_pre_cannot_disappear_from_before_evidence(context, raw):
    connection, run, sandbox = context
    append_event(connection, run.run_id, "FILE_OBSERVED", {"reason":"PRE_TOOL", **asdict(sandbox.observe_file("config.json"))}, step_id="step_x", tool_call_id="call_x")
    event = append_event(connection, run.run_id, "FILE_OBSERVED", {}, step_id="step_x", tool_call_id="call_x")
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (raw, event.event_id))
    _intent(context, pre=False)
    (sandbox.root / "config.json").write_bytes(b"changed")
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert _target(report)["before"] is None
    assert _target(report)["external_state_changed"] is None
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]


@pytest.mark.parametrize("field", ["step_id", "seq", "occurred_at", "task_id", "tool_call_id", "event_type"])
def test_blob_envelope_never_leaks_into_json_or_supports_change(context, field):
    connection, _, sandbox = context
    intent = _intent(context)
    connection.execute("UPDATE events SET " + field + "=? WHERE event_id=?", (sqlite3.Binary(b"invalid native fact"), intent.event_id))
    (sandbox.root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "EXTERNAL_STATE_CHANGED" not in report["observations"]
    assert json.loads(format_inspection_json(report)) == report
    format_inspection_text(report)


def test_blob_ended_at_output_null_does_not_create_false_unfinished_observation(context):
    context[0].execute("UPDATE runs SET ended_at=?", (sqlite3.Binary(b"non-null ended_at"),))
    report = _report(context)
    assert report["run"]["ended_at"] is None
    assert "INVALID_RUN_METADATA" in _codes(report)
    assert "UNFINISHED_RUN" not in report["observations"]
    assert json.loads(format_inspection_json(report)) == report


def test_result_tool_name_mismatch_reports_issue_but_result_is_not_missing(context):
    connection, run, _ = context
    _intent(context)
    append_event(connection, run.run_id, "TOOL_RESULT", {"tool_name":"different_tool","status":"SUCCESS","message":"ok","duration_ms":1,"result":{}}, step_id="step_x", tool_call_id="call_x")
    report = _report(context)
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert report["observations"] == ["UNFINISHED_RUN"]
    assert report["pending_invocations"] == []


def test_safe_recorded_workspace_spelling_keeps_step2_compatibility(context):
    connection, run, sandbox = context
    (sandbox.root / "nested").mkdir()
    connection.execute("UPDATE runs SET workspace_path=? WHERE run_id=?", (str(sandbox.root / "nested" / ".."), run.run_id))
    _intent(context)
    (sandbox.root / "config.json").write_bytes(b"after")
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["current_state_issues"] == []
    assert _target(report)["external_state_changed"] is True


@pytest.mark.parametrize("payload", ['{"tool_name":"write_file","arguments":{"bad":"\\ud800"},"mutating":false,"targets":[]}',
    '{"tool_name":"write_file","arguments":{"\\ud800":1},"mutating":false,"targets":[]}'])
def test_unencodable_payload_is_an_issue_not_an_inspection_crash(context, payload):
    connection, _, _ = context
    intent = _intent(context, paths=())
    connection.execute("UPDATE events SET payload_json=? WHERE event_id=?", (payload, intent.event_id))
    report = _report(context)
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    json.loads(format_inspection_json(report))


@pytest.mark.parametrize("mismatch", ["name", "arguments", "duplicate", "after"])
def test_planned_evidence_must_match_unique_preceding_invocation(context, mismatch):
    connection, run, sandbox = context
    payload = {"tool_name": "other_tool" if mismatch == "name" else "write_file",
               "arguments": {"different":True} if mismatch == "arguments" else {}}
    if mismatch != "after":
        append_event(connection, run.run_id, "STEP_PLANNED", payload, step_id="step_x", tool_call_id="call_x")
    if mismatch == "duplicate":
        append_event(connection, run.run_id, "STEP_PLANNED", payload, step_id="step_x", tool_call_id="call_x")
    _intent(context)
    if mismatch == "after":
        append_event(connection, run.run_id, "STEP_PLANNED", payload, step_id="step_x", tool_call_id="call_x")
    (sandbox.root / "config.json").write_bytes(b"changed")
    report = _report(context)
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert _target(report)["external_state_changed"] is None


def test_same_textual_call_id_in_other_run_cannot_suppress_pending(context, task_spec):
    connection, run, sandbox = context
    _intent(context)
    other = create_run(connection, task_spec, sandbox.root, "explicit_plan", run_id="run_other")
    execute_tool_call(connection, other.run_id, sandbox, ReadFileTool(), PlanStep("step_other","read_file",{"path":"absent.txt"}), "call_x")
    assert _report(context)["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]


def test_resolved_invocation_still_audits_pre_intent_integrity(context):
    connection, run, sandbox = context
    execute_tool_call(connection, run.run_id, sandbox, WriteFileTool(), PlanStep("step_x","write_file",{"path":"config.json","content":"after"}), "call_x")
    connection.execute("UPDATE events SET payload_json=? WHERE event_type='FILE_OBSERVED' AND seq=1",
                       (json.dumps({"reason":"PRE_TOOL","path":"config.json","exists":True,"sha256":"a"*64,"size_bytes":10}),))
    report = _report(context)
    assert "PRE_OBSERVATION_INTENT_MISMATCH" in _codes(report)
    assert report["pending_invocations"] == []


@pytest.mark.parametrize("kind,payload", [("STEP_PLANNED",{}), ("STEP_CONFIRMED",{"tool_call_id":"different","tool_status":"SUCCESS"}),
    ("VALIDATION_STARTED",{}), ("VALIDATION_PASSED",{"passed":False,"message":"wrong","details":{}})])
def test_incompatible_non_tool_payload_is_not_a_consistent_trace(context, kind, payload):
    connection, run, _ = context
    append_event(connection, run.run_id, kind, payload, step_id="step_x", tool_call_id="call_x")
    assert "INVALID_EVENT_PAYLOAD" in _codes(_report(context))


def test_database_api_opens_mode_ro_includes_committed_wal_and_never_creates_missing_main(context, tmp_path, monkeypatch):
    connection, run, _ = context
    _intent(context)
    expected = _report(context)
    path = connection.execute("PRAGMA database_list").fetchone()[2]
    assert Path(path + "-wal").is_file()
    before = _facts(connection)
    original_connect = sqlite3.connect
    opened = []
    def traced(database_uri, **kwargs):
        assert database_uri.endswith("?mode=ro") and kwargs["uri"] is True
        assert "immutable" not in database_uri
        opened.append(database_uri)
        readonly = original_connect(database_uri, **kwargs)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            readonly.execute("UPDATE runs SET model_plugin='forbidden'")
        return readonly
    monkeypatch.setattr(sqlite3, "connect", traced)
    assert inspect_database(path, run.run_id) == expected
    assert len(opened) == 1
    assert before == _facts(connection)
    missing = tmp_path / "missing.sqlite3"
    with pytest.raises(FileNotFoundError):
        inspect_database(missing, run.run_id)
    assert not missing.exists()


def test_closed_wal_database_allows_sqlite_sidecars_but_preserves_logical_facts(context):
    connection, run, sandbox = context
    _intent(context)
    path = Path(connection.execute("PRAGMA database_list").fetchone()[2])
    facts_before = _facts(connection)
    workspace_before = sorted(p.relative_to(sandbox.root).as_posix() for p in sandbox.root.rglob("*"))
    expected = _report(context)
    connection.close()
    assert not Path(str(path) + "-wal").exists()
    assert not Path(str(path) + "-shm").exists()
    assert inspect_database(path, run.run_id) == expected
    # Sidecar existence is intentionally outside the logical read-only invariant.
    reader = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, isolation_level=None)
    try:
        assert _facts(reader) == facts_before
    finally:
        reader.close()
    assert sorted(p.relative_to(sandbox.root).as_posix() for p in sandbox.root.rglob("*")) == workspace_before


def _closure_post(context, path="config.json", step="step_x"):
    connection, run, sandbox = context
    return append_event(connection, run.run_id, "FILE_OBSERVED",
                        {"reason": "POST_TOOL", **asdict(sandbox.observe_file(path))},
                        step_id=step, tool_call_id="call_x")


def _closure_result(context, status="SUCCESS"):
    return append_event(context[0], context[1].run_id, "TOOL_RESULT",
                        {"tool_name": "write_file", "status": status, "message": "reported result", "duration_ms": 0.0, "result": {}},
                        step_id="step_x", tool_call_id="call_x")


def _closure_confirmation(context, status="SUCCESS", step="step_x", payload_call="call_x"):
    return append_event(context[0], context[1].run_id, "STEP_CONFIRMED",
                        {"tool_call_id": payload_call, "tool_status": status}, step_id=step, tool_call_id="call_x")


@pytest.mark.parametrize("changed", [False, True])
def test_step_confirmed_without_tool_result_is_inconsistent(context, changed):
    _intent(context)
    if changed:
        (context[2].root / "config.json").write_bytes(b"external change")
    _closure_confirmation(context)
    before = _facts(context[0])
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert report["observations"][:2] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    assert _target(report)["external_state_changed"] is changed
    assert ("EXTERNAL_STATE_CHANGED" in report["observations"]) is changed
    assert before == _facts(context[0])
    output = format_inspection_json(report) + format_inspection_text(report)
    for forbidden in ("CONFIRMED_EXECUTED", "CONFIRMED_NOT_EXECUTED", "RETRY", "RESUME", "COMPENSATE", "SAFE_TO_RETRY"):
        assert forbidden not in output


@pytest.mark.parametrize("result_status,confirmed_status,consistent", [
    ("FAILED", "SUCCESS", False), ("FAILED", "FAILED", True),
    ("SUCCESS", "SUCCESS", True), ("FAILED", "failed", False),
])
def test_step_confirmed_status_must_match_tool_result(context, result_status, confirmed_status, consistent):
    _intent(context)
    _closure_post(context)
    _closure_result(context, result_status)
    _closure_confirmation(context, confirmed_status)
    report = _report(context)
    assert report["trace"]["consistent"] is consistent
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]
    if not consistent:
        assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)


def test_step_confirmed_must_follow_tool_result(context):
    _intent(context)
    _closure_post(context)
    _closure_confirmation(context)
    _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]


def test_duplicate_step_confirmed_is_inconsistent(context):
    _intent(context)
    _closure_post(context)
    _closure_result(context)
    _closure_confirmation(context)
    _closure_confirmation(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert any("multiple STEP_CONFIRMED" in issue["message"] for issue in report["trace"]["issues"])
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]


@pytest.mark.parametrize("paths", [("config.json",), ("a.txt", "b.txt")])
def test_mutating_tool_result_requires_complete_post_observations(context, paths):
    _intent(context, paths=paths)
    if len(paths) > 1:
        _closure_post(context, paths[0])
    _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]
    assert report["pending_invocations"] == []


def test_result_requires_post_before_result(context):
    _intent(context)
    _closure_result(context)
    _closure_post(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]


@pytest.mark.parametrize("result_present", [False, True])
def test_duplicate_post_observation_is_inconsistent(context, result_present):
    _intent(context)
    _closure_post(context)
    _closure_post(context)
    if result_present:
        _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert any("multiple POST_TOOL" in issue["message"] for issue in report["trace"]["issues"])
    assert ("EXECUTION_RESULT_UNKNOWN" in report["observations"]) is not result_present


@pytest.mark.parametrize("result_present", [False, True])
def test_post_observation_path_must_be_declared_target(context, result_present):
    _intent(context)
    _closure_post(context)
    _closure_post(context, "foreign.txt")
    if result_present:
        _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert any(issue.get("path") == "foreign.txt" and "declared target" in issue["message"] for issue in report["trace"]["issues"])
    assert ("EXECUTION_RESULT_UNKNOWN" in report["observations"]) is not result_present


@pytest.mark.parametrize("post_paths", [(), ("a.txt",), ("a.txt", "b.txt")])
def test_partial_post_without_result_remains_valid_incomplete_prefix(context, post_paths):
    _intent(context, paths=("a.txt", "b.txt"))
    for path in post_paths:
        _closure_post(context, path)
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["observations"] == ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN"]
    assert report["pending_invocations"][0]["post_observation_present"] is bool(post_paths)


@pytest.mark.parametrize("mutating", [False, True])
def test_normal_step2_direct_invocation_still_consistent(context, mutating):
    connection, run, sandbox = context
    tool = WriteFileTool() if mutating else ReadFileTool()
    arguments = {"path": "config.json", "content": "written"} if mutating else {"path": "absent.txt"}
    execute_tool_call(connection, run.run_id, sandbox, tool, PlanStep("step_x", tool.name, arguments), "call_x")
    assert not connection.execute("SELECT 1 FROM events WHERE event_type='STEP_CONFIRMED'").fetchall()
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["observations"] == ["UNFINISHED_RUN"]


def test_normal_step3_confirmed_invocation_still_consistent(context):
    connection, run, sandbox = context
    arguments = {"path": "config.json", "content": "written"}
    append_event(connection, run.run_id, "STEP_PLANNED", {"tool_name": "write_file", "arguments": arguments},
                 step_id="step_x", tool_call_id="call_x")
    result = execute_tool_call(connection, run.run_id, sandbox, WriteFileTool(), PlanStep("step_x", "write_file", arguments), "call_x")
    _closure_confirmation(context, result.status)
    before = _facts(connection)
    report = _report(context)
    assert report["trace"]["consistent"]
    assert report["observations"] == ["UNFINISHED_RUN"]
    assert report["pending_invocations"] == []
    assert before == _facts(connection)


def test_post_observation_must_follow_intent(context):
    _closure_post(context)
    _intent(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" in report["observations"]


@pytest.mark.parametrize("result_present", [False, True])
def test_post_observation_step_identity_must_match_intent(context, result_present):
    _intent(context)
    _closure_post(context, step="different_step")
    if result_present:
        _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert ("EXECUTION_RESULT_UNKNOWN" in report["observations"]) is not result_present


@pytest.mark.parametrize("result_present", [False, True])
@pytest.mark.parametrize("raw", ['{"reason":"POST_TOOL",', '{"reason":"POST_TOOL","path":"config.json","exists":"false","sha256":null,"size_bytes":null}'])
def test_malformed_post_observation_is_inconsistent(context, raw, result_present):
    _intent(context)
    event = _closure_post(context)
    context[0].execute("UPDATE events SET payload_json=? WHERE event_id=?", (raw, event.event_id))
    if result_present:
        _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVALID_EVENT_PAYLOAD" in _codes(report)
    assert ("EXECUTION_RESULT_UNKNOWN" in report["observations"]) is not result_present


@pytest.mark.parametrize("result_present", [False, True])
def test_nonmutating_invocation_rejects_post_observation(context, result_present):
    _intent(context, paths=())
    _closure_post(context)
    if result_present:
        _closure_result(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert ("EXECUTION_RESULT_UNKNOWN" in report["observations"]) is not result_present


@pytest.mark.parametrize("bad_result", ["duplicate", "malformed"])
def test_confirmation_requires_exactly_one_valid_result(context, bad_result):
    _intent(context)
    _closure_post(context)
    result = _closure_result(context)
    if bad_result == "duplicate":
        _closure_result(context)
    else:
        context[0].execute("UPDATE events SET payload_json='{}' WHERE event_id=?", (result.event_id,))
    _closure_confirmation(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]


@pytest.mark.parametrize("mismatch", ["step", "payload_call"])
def test_step_confirmed_identity_must_match_invocation(context, mismatch):
    _intent(context)
    _closure_post(context)
    _closure_result(context)
    _closure_confirmation(context, step="other" if mismatch == "step" else "step_x",
                          payload_call="other" if mismatch == "payload_call" else "call_x")
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert "EXECUTION_RESULT_UNKNOWN" not in report["observations"]


def test_step_confirmed_without_intent_is_inconsistent(context):
    _closure_confirmation(context)
    report = _report(context)
    assert not report["trace"]["consistent"]
    assert "INVOCATION_IDENTITY_MISMATCH" in _codes(report)
    assert report["observations"] == ["UNFINISHED_RUN"]

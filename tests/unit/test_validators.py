from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sys

import pytest

from axis_evo import validators
from axis_evo.sandbox import Sandbox
from axis_evo.storage import connect_database, create_run
from axis_evo.validators import preflight_acceptance, validate_acceptance


@pytest.fixture
def sandbox(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return Sandbox(root)


def _spec(task_spec, assertions, *, enabled=False, args=None):
    return replace(task_spec, acceptance={
        "file_assertions": assertions, "pytest": {"enabled": enabled, "args": args or []},
    })


def _validate(database, sandbox, spec):
    run = create_run(database, spec, sandbox.root, "explicit_plan")
    return validate_acceptance(database, run.run_id, sandbox, spec)


@pytest.mark.parametrize("operator,data,expected,passed", [
    ("exists", b"hello", "", True),
    ("exists", None, "", False),
    ("exists", b"\xff", "", True),
    ("not_exists", None, "", True),
    ("not_exists", b"hello", "", False),
    ("contains", "中文\r\n".encode("utf-8"), "中文", True),
    ("contains", b"hello", "absent", False),
    ("contains", None, "", False),
    ("contains", b"\xff", "", False),
    ("equals", b"hello\r\n", "hello\r\n", True),
    ("equals", b"hello\r\n", "hello\n", False),
    ("equals", b"", "", True),
    ("equals", None, "", False),
    ("equals", b"\xff", "", False),
])
def test_file_assertion_semantics_and_observation(database, task_spec, sandbox, operator, data, expected, passed):
    if data is not None:
        (sandbox.root / "file.txt").write_bytes(data)
    spec = _spec(task_spec, [{"path": "file.txt", "operator": operator, "expected": expected}])

    result = _validate(database, sandbox, spec)

    assert result.passed is passed
    detail = result.details["file_assertions"][0]
    assert detail["passed"] is passed
    assert detail["path"] == "file.txt"
    assert detail["operator"] == operator
    assert detail["expected"] == expected
    assert detail["message"]
    assert detail["exists"] is (data is not None)
    assert detail["sha256"] == (hashlib.sha256(data).hexdigest() if data is not None else None)
    assert detail["size_bytes"] == (len(data) if data is not None else None)
    rows = database.execute("SELECT * FROM events ORDER BY seq").fetchall()
    assert [row["event_type"] for row in rows] == ["VALIDATION_STARTED", "FILE_OBSERVED"]
    observed = json.loads(rows[1]["payload_json"])
    assert observed == {"reason": "VALIDATION", **{key: detail[key] for key in ("path", "exists", "sha256", "size_bytes")}}
    assert "content" not in detail
    assert result.details["pytest"]["executed"] is False


@pytest.mark.parametrize("path", ["folder", "missing_parent/file.txt", "../outside.txt", "/outside.txt", r"C:\outside.txt"])
def test_unobservable_assertion_fails_without_file_observation(database, task_spec, sandbox, path):
    (sandbox.root / "folder").mkdir()
    spec = _spec(task_spec, [{"path": path, "operator": "not_exists", "expected": ""}])

    result = _validate(database, sandbox, spec)

    assert not result.passed
    assert result.details["file_assertions"][0]["passed"] is False
    assert [row[0] for row in database.execute("SELECT event_type FROM events ORDER BY seq")] == ["VALIDATION_STARTED"]


def test_all_file_assertions_are_evaluated_in_order_before_pytest(database, task_spec, sandbox, monkeypatch):
    (sandbox.root / "first.txt").write_bytes(b"first")
    (sandbox.root / "second.txt").write_bytes(b"second")
    (sandbox.root / "unrelated.txt").write_bytes(b"not observed")
    spec = _spec(task_spec, [
        {"path": "first.txt", "operator": "equals", "expected": "wrong"},
        {"path": "second.txt", "operator": "equals", "expected": "second"},
    ], enabled=True)

    def forbidden_pytest(*args, **kwargs):
        pytest.fail("static assertion failure must short-circuit pytest")

    monkeypatch.setattr(validators.subprocess, "run", forbidden_pytest)
    result = _validate(database, sandbox, spec)

    assert not result.passed
    assert [detail["passed"] for detail in result.details["file_assertions"]] == [False, True]
    assert result.details["pytest"]["executed"] is False
    assert result.details["pytest"]["reason"] == "not executed due to file assertion failure"
    observed = [json.loads(row[0])["path"] for row in database.execute("SELECT payload_json FROM events WHERE event_type = 'FILE_OBSERVED' ORDER BY seq")]
    assert observed == ["first.txt", "second.txt"]


def test_no_acceptance_criteria_cannot_pass(database, task_spec, sandbox):
    result = _validate(database, sandbox, _spec(task_spec, []))
    assert not result.passed
    assert result.message == "No acceptance criteria configured"
    assert result.details["pytest"] == {"enabled": False, "executed": False, "reason": "disabled"}


def test_unsupported_operator_is_configuration_error(database, task_spec, sandbox):
    spec = _spec(task_spec, [{"path": "file.txt", "operator": "regex", "expected": "x"}])
    with pytest.raises(ValueError, match="unsupported file assertion operator"):
        _validate(database, sandbox, spec)
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


@pytest.mark.parametrize("arg", [
    "", "-c", "-p", "-o", "--override-ini=addopts=x", "--rootdir=outside",
    "--confcutdir=outside", "--basetemp=outside", "--pyargs", "--maxfail=-1",
    "--tb=long", "test.py; echo unsafe", "test.py|echo unsafe", "$(echo unsafe)",
    "`echo unsafe`", "/outside.py", r"C:\outside.py", r"C:outside.py",
    r"\\server\share\test.py", "test.py::", "bad\x00path", "NUL", "file.py:stream",
])
def test_acceptance_pytest_argument_whitelist(task_spec, sandbox, monkeypatch, arg):
    def forbidden_pytest(*args, **kwargs):
        pytest.fail("preflight must never run pytest")

    monkeypatch.setattr(validators.subprocess, "run", forbidden_pytest)
    with pytest.raises(ValueError):
        preflight_acceptance(_spec(task_spec, [], enabled=True, args=[arg]), sandbox)


@pytest.mark.parametrize("arg", ["../outside.py", r"..\outside.py", "missing.py"])
def test_acceptance_pytest_target_must_exist_within_workspace(task_spec, sandbox, arg):
    with pytest.raises(ValueError):
        preflight_acceptance(_spec(task_spec, [], enabled=True, args=[arg]), sandbox)


def test_final_pytest_is_real_controlled_and_started_after_commit(database, task_spec, sandbox, tmp_path, monkeypatch):
    (sandbox.root / "file.txt").write_bytes(b"evidence")
    (sandbox.root / "check_context.py").write_text(
        "import os\nfrom pathlib import Path\n"
        "def test_context():\n"
        "    assert Path.cwd().name == 'workspace'\n"
        "    assert os.environ['PYTHONDONTWRITEBYTECODE'] == '1'\n"
        "    assert os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] == '1'\n"
        "    assert not os.environ.get('PYTEST_ADDOPTS')\n"
        "    assert 'PYTEST_PLUGINS' not in os.environ\n"
        "    assert 'PYTHONPATH' not in os.environ\n", encoding="utf-8",
    )
    (sandbox.root / "pytest.ini").write_text("[pytest]\naddopts = -p nonexistent_plugin\n", encoding="utf-8")
    (sandbox.root.parent / "pytest.ini").write_text("[pytest]\naddopts = -p nonexistent_plugin\n", encoding="utf-8")
    monkeypatch.setenv("PYTEST_ADDOPTS", "-p nonexistent_plugin")
    monkeypatch.setenv("PYTEST_PLUGINS", "nonexistent_plugin")
    monkeypatch.setenv("PYTHONPATH", "untrusted_python_path")
    spec = _spec(task_spec, [{"path": "file.txt", "operator": "exists", "expected": ""}], enabled=True,
                 args=["-q", "-x", "--maxfail=1", "--tb=short", "check_context.py::test_context"])
    original_observe = sandbox.observe_file
    original_run = validators.subprocess.run
    calls = []

    def assert_started_committed():
        assert not database.in_transaction
        reader = connect_database(tmp_path / "facts.sqlite3")
        try:
            assert reader.execute("SELECT COUNT(*) FROM events WHERE event_type = 'VALIDATION_STARTED'").fetchone()[0] == 1
            reader.execute("BEGIN IMMEDIATE")
            reader.rollback()
        finally:
            reader.close()

    def observed_after_start(path):
        assert_started_committed()
        return original_observe(path)

    def executed_after_start(command, **kwargs):
        assert_started_committed()
        assert database.execute("SELECT COUNT(*) FROM events WHERE event_type = 'FILE_OBSERVED'").fetchone()[0] == 1
        calls.append((command, kwargs))
        return original_run(command, **kwargs)

    monkeypatch.setattr(sandbox, "observe_file", observed_after_start)
    monkeypatch.setattr(validators.subprocess, "run", executed_after_start)
    result = _validate(database, sandbox, spec)

    assert result.passed, result.details
    outcome = result.details["pytest"]
    assert outcome["executed"] and outcome["passed"]
    assert outcome["exit_code"] == 0
    assert "1 passed" in outcome["stdout"]
    assert isinstance(outcome["stderr"], str)
    assert outcome["duration_ms"] >= 0
    assert len(calls) == 1
    command, kwargs = calls[0]
    assert command[:3] == [sys.executable, "-m", "pytest"]
    assert command[command.index("-c") + 1] == os.devnull
    assert "no:cacheprovider" in command
    assert "--rootdir=" + str(sandbox.root) in command
    assert "--confcutdir=" + str(sandbox.root) in command
    assert kwargs["shell"] is False
    assert kwargs["cwd"] == sandbox.root
    assert kwargs["timeout"] == 60
    assert not list(sandbox.root.rglob(".pytest_cache"))
    assert not list(sandbox.root.rglob("__pycache__"))
    assert not list(sandbox.root.rglob("*.pyc"))
    assert not database.execute("SELECT 1 FROM events WHERE event_type IN ('TOOL_INTENT', 'TOOL_RESULT')").fetchone()


def test_final_pytest_failure_preserves_real_output(database, task_spec, sandbox):
    (sandbox.root / "check_failure.py").write_text("def test_failure():\n    assert False\n", encoding="utf-8")
    result = _validate(database, sandbox, _spec(task_spec, [], enabled=True, args=["-q", "check_failure.py"]))
    assert not result.passed
    assert result.details["pytest"]["exit_code"] == 1
    assert "1 failed" in result.details["pytest"]["stdout"]
    assert isinstance(result.details["pytest"]["stderr"], str)


def test_final_pytest_timeout_uses_real_subprocess(database, task_spec, sandbox, monkeypatch):
    (sandbox.root / "check_slow.py").write_text("import time\ndef test_slow():\n    time.sleep(5)\n", encoding="utf-8")
    monkeypatch.setattr(validators, "VALIDATION_TIMEOUT_SECONDS", 0.2)
    result = _validate(database, sandbox, _spec(task_spec, [], enabled=True, args=["-q", "check_slow.py"]))
    assert not result.passed
    outcome = result.details["pytest"]
    assert outcome["executed"] is True
    assert outcome["exit_code"] is None
    assert outcome["reason"] == "pytest timed out"
    assert isinstance(outcome["stdout"], str)
    assert isinstance(outcome["stderr"], str)


def test_final_pytest_rechecks_target_after_plan_changes(database, task_spec, sandbox):
    spec = _spec(task_spec, [], enabled=True, args=["check_removed.py"])
    target = sandbox.root / "check_removed.py"
    target.write_bytes(b"def test_pass():\n    pass\n")
    preflight_acceptance(spec, sandbox)
    target.unlink()
    result = _validate(database, sandbox, spec)
    assert not result.passed
    assert result.details["pytest"]["executed"] is False
    assert "does not exist" in result.details["pytest"]["reason"]


def test_validator_rejects_unbound_workspace(database, task_spec, sandbox, tmp_path):
    spec = _spec(task_spec, [])
    run = create_run(database, spec, sandbox.root, "explicit_plan")
    other_root = tmp_path / "other_workspace"
    other_root.mkdir()
    with pytest.raises(ValueError, match="sandbox does not match"):
        validate_acceptance(database, run.run_id, Sandbox(other_root), spec)
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


@pytest.mark.parametrize("operator", ["contains", "equals"])
@pytest.mark.parametrize("observed_bytes,changed_bytes", [
    (b"timeout=10", b"timeout=20"),
    (b"not ready", b"ready"),
])
def test_text_assertion_rejects_changed_bytes_after_persisted_observation(database, task_spec, sandbox, monkeypatch, operator, observed_bytes, changed_bytes):
    target = sandbox.root / "file.txt"
    target.write_bytes(observed_bytes)
    expected = changed_bytes.decode("utf-8")
    spec = _spec(task_spec, [{"path": "file.txt", "operator": operator, "expected": expected}])
    original_read = Path.read_bytes
    target_reads = []

    def change_at_content_read(path):
        if path == target:
            target_reads.append(path)
            if len(target_reads) == 2:
                recorded = database.execute("SELECT payload_json FROM events WHERE event_type = 'FILE_OBSERVED'").fetchone()
                assert recorded is not None
                assert not database.in_transaction
                assert json.loads(recorded[0])["sha256"] == hashlib.sha256(observed_bytes).hexdigest()
                path.write_bytes(changed_bytes)
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", change_at_content_read)
    result = _validate(database, sandbox, spec)
    assert len(target_reads) == 2
    assert result.passed is False
    detail = result.details["file_assertions"][0]
    assert detail["passed"] is False
    assert detail["message"] == "File changed during validation"
    assert detail["sha256"] == hashlib.sha256(observed_bytes).hexdigest()
    assert detail["size_bytes"] == len(observed_bytes)
    observations = database.execute("SELECT payload_json FROM events WHERE event_type = 'FILE_OBSERVED'").fetchall()
    assert len(observations) == 1
    assert json.loads(observations[0][0])["sha256"] == hashlib.sha256(observed_bytes).hexdigest()


def test_text_assertion_requires_size_to_match_even_when_hash_matches(database, task_spec, sandbox, monkeypatch):
    data = b"content"
    (sandbox.root / "file.txt").write_bytes(data)
    original_observe = sandbox.observe_file

    def incorrect_size(path):
        observation = original_observe(path)
        return replace(observation, size_bytes=observation.size_bytes + 1)

    monkeypatch.setattr(sandbox, "observe_file", incorrect_size)
    result = _validate(database, sandbox, _spec(task_spec, [{"path": "file.txt", "operator": "equals", "expected": "content"}]))
    assert not result.passed
    detail = result.details["file_assertions"][0]
    assert detail["sha256"] == hashlib.sha256(data).hexdigest()
    assert detail["size_bytes"] == len(data) + 1
    assert detail["passed"] is False
    assert detail["message"] == "File changed during validation"


def test_safe_missing_parent_is_deferred_to_formal_validation(database, task_spec, sandbox):
    spec = _spec(task_spec, [{"path": "missing_parent/file.txt", "operator": "not_exists", "expected": ""}])
    preflight_acceptance(spec, sandbox)
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    result = _validate(database, sandbox, spec)
    assert not result.passed
    assert result.details["file_assertions"][0]["passed"] is False
    assert "parent directory does not exist" in result.details["file_assertions"][0]["message"]
    assert [row[0] for row in database.execute("SELECT event_type FROM events ORDER BY seq")] == ["VALIDATION_STARTED"]

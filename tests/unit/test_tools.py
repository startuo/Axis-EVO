import os
import sys

import pytest

from axis_evo.plugins import PluginRegistry
from axis_evo.sandbox import Sandbox
from axis_evo import tools
from axis_evo.tools import PatchFileTool, ReadFileTool, RunTestsTool, WriteFileTool


@pytest.fixture
def sandbox(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return Sandbox(root)


def test_tools_declare_possible_writes_and_register_statically():
    registry = PluginRegistry()
    for tool, args, targets, mutating in [
        (ReadFileTool(), {"path": "a.txt"}, [], False),
        (WriteFileTool(), {"path": "a.txt", "content": "data"}, ["a.txt"], True),
        (PatchFileTool(), {"path": "config.json", "old": "old", "new": "new"}, ["config.json"], True),
        (RunTestsTool(), {"args": ["-q"]}, [], False),
    ]:
        assert tool.declared_targets(args) == targets
        assert tool.mutating is mutating
        registry.register(tool)
        assert registry.get(tool.name) is tool


def test_read_file_keeps_utf8_and_newlines(sandbox):
    content = "中文\r\nnext\n"
    (sandbox.root / "file.txt").write_bytes(content.encode("utf-8"))
    result = ReadFileTool().execute(sandbox, {"path": "file.txt"})
    assert result.status == "SUCCESS"
    assert result.result == {"content": content}
    assert result.duration_ms >= 0


@pytest.mark.parametrize("data", [None, b"\xff"])
def test_read_file_expected_failure(sandbox, data):
    if data is not None:
        (sandbox.root / "file.txt").write_bytes(data)
    result = ReadFileTool().execute(sandbox, {"path": "file.txt"})
    assert result.status == "FAILED"


def test_write_creates_exact_utf8_bytes_in_existing_parent(sandbox):
    (sandbox.root / "nested").mkdir()
    content = "中文\r\nnext\n"
    result = WriteFileTool().execute(sandbox, {"path": "nested/new.txt", "content": content})
    assert result.status == "SUCCESS"
    assert result.result == {}
    assert (sandbox.root / "nested/new.txt").read_bytes() == content.encode("utf-8")


def test_write_does_not_create_missing_parent(sandbox):
    result = WriteFileTool().execute(sandbox, {"path": "new/subdir/file.txt", "content": "data"})
    assert result.status == "FAILED"
    assert not (sandbox.root / "new").exists()


@pytest.mark.parametrize("tool,args", [
    (ReadFileTool(), {"path": "../outside.txt"}),
    (WriteFileTool(), {"path": "../outside.txt", "content": "data"}),
    (PatchFileTool(), {"path": "../outside.txt", "old": "old", "new": "new"}),
])
def test_all_file_tools_use_path_resolver(sandbox, tool, args):
    with pytest.raises(ValueError):
        tool.execute(sandbox, args)


def test_patch_exactly_one_match_preserves_unrelated_bytes(sandbox):
    original = '中文\r\n{"timeout": 10}\r\nlast\n'.encode("utf-8")
    path = sandbox.root / "config.json"
    path.write_bytes(original)
    result = PatchFileTool().execute(sandbox, {"path": "config.json", "old": '"timeout": 10', "new": '"timeout": 20'})
    assert result.status == "SUCCESS"
    assert path.read_bytes() == original.replace(b'"timeout": 10', b'"timeout": 20')
    assert result.result == {"matches": 1}


@pytest.mark.parametrize("content,old", [(b"no match\r\n", "old"), (b"old\r\nold", "old"), (b"aaa", "aa")])
def test_patch_zero_or_multiple_matches_fails_without_write(sandbox, content, old):
    path = sandbox.root / "config.txt"
    path.write_bytes(content)
    result = PatchFileTool().execute(sandbox, {"path": "config.txt", "old": old, "new": "new"})
    assert result.status == "FAILED"
    assert path.read_bytes() == content


def test_patch_requires_an_existing_file(sandbox):
    result = PatchFileTool().execute(sandbox, {"path": "missing.txt", "old": "old", "new": "new"})
    assert result.status == "FAILED"
    assert not (sandbox.root / "missing.txt").exists()


@pytest.mark.parametrize("tool,args", [
    (ReadFileTool(), {"path": 1}),
    (WriteFileTool(), {"path": "a", "content": 1}),
    (WriteFileTool(), {"path": "a", "content": "b", "extra": "c"}),
    (PatchFileTool(), {"path": "a", "old": "", "new": "b"}),
    (RunTestsTool(), {"args": "-q"}),
    (RunTestsTool(), {"args": [1]}),
    (RunTestsTool(), {"command": "pytest"}),
])
def test_tool_arguments_do_not_silently_coerce(tool, args):
    with pytest.raises(ValueError):
        tool.declared_targets(args)


def test_run_tests_passes_with_real_child_cwd_and_environment(sandbox, monkeypatch):
    (sandbox.root / "test_controlled.py").write_text(
        "import os\nfrom pathlib import Path\n"
        "def test_context():\n"
        "    assert Path.cwd().name == 'workspace'\n"
        "    assert os.environ['PYTHONDONTWRITEBYTECODE'] == '1'\n"
        "    assert os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] == '1'\n"
        "    assert not os.environ.get('PYTEST_ADDOPTS')\n"
        "    assert not os.environ.get('PYTEST_PLUGINS')\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("PYTEST_ADDOPTS", "-p plugin_that_does_not_exist")
    monkeypatch.setenv("PYTEST_PLUGINS", "plugin_that_does_not_exist")
    # Parent config must not redirect or inject plugins into this invocation.
    (sandbox.root.parent / "pytest.ini").write_text("[pytest]\naddopts = -p plugin_that_does_not_exist\n", encoding="utf-8")
    original_run = tools.subprocess.run
    calls = []

    def recording_run(command, **kwargs):
        calls.append((command, kwargs))
        return original_run(command, **kwargs)

    monkeypatch.setattr(tools.subprocess, "run", recording_run)
    result = RunTestsTool().execute(sandbox, {"args": ["-q", "test_controlled.py::test_context"]})
    assert result.status == "SUCCESS", result.result
    assert result.result["exit_code"] == 0
    assert "1 passed" in result.result["stdout"]
    assert len(calls) == 1
    command, kwargs = calls[0]
    assert command[:3] == [sys.executable, "-m", "pytest"]
    assert kwargs["shell"] is False
    assert kwargs["cwd"] == sandbox.root
    assert kwargs["timeout"] == 60
    assert "no:cacheprovider" in command
    assert command[command.index("-c") + 1] == os.devnull
    assert not list(sandbox.root.rglob(".pytest_cache"))
    assert not list(sandbox.root.rglob("__pycache__"))
    assert not list(sandbox.root.rglob("*.pyc"))


def test_run_tests_nonzero_exit_is_a_failed_result(sandbox):
    (sandbox.root / "test_failure.py").write_text("def test_failure():\n    assert False\n", encoding="utf-8")
    result = RunTestsTool().execute(sandbox, {"args": ["-q", "-x", "--maxfail=1", "--tb=no", "test_failure.py"]})
    assert result.status == "FAILED"
    assert result.result["exit_code"] == 1
    assert "1 failed" in result.result["stdout"]


def test_run_tests_timeout_uses_real_subprocess(sandbox, monkeypatch):
    (sandbox.root / "test_slow.py").write_text("import time\ndef test_slow():\n    time.sleep(5)\n", encoding="utf-8")
    monkeypatch.setattr(tools, "TEST_TIMEOUT_SECONDS", 0.2)
    result = RunTestsTool().execute(sandbox, {"args": ["-q"]})
    assert result.status == "TIMEOUT"
    assert result.result["exit_code"] is None
    assert isinstance(result.result["stdout"], str)
    assert isinstance(result.result["stderr"], str)


@pytest.mark.parametrize("arg", [
    "-c", "-p", "--basetemp=outside", "--rootdir=outside", "--confcutdir=outside",
    "--override-ini=addopts=x", "-o", "--pyargs", "--maxfail=-1", "--tb=long",
    "pytest -q; echo unsafe", "tests/test_x.py|echo unsafe", "$(echo unsafe)",
    "`echo unsafe`", "../outside.py", r"..\outside.py", "/outside.py", r"C:\outside.py",
])
def test_run_tests_rejects_unsupported_or_unsafe_arguments(sandbox, monkeypatch, arg):
    def forbidden_run(*args, **kwargs):
        pytest.fail("invalid arguments must not start a subprocess")

    monkeypatch.setattr(tools.subprocess, "run", forbidden_run)
    with pytest.raises(ValueError):
        RunTestsTool().execute(sandbox, {"args": [arg]})


def test_run_tests_rejects_nonexistent_target(sandbox):
    with pytest.raises(ValueError, match="does not exist"):
        RunTestsTool().execute(sandbox, {"args": ["missing.py"]})


def test_file_tools_do_not_hide_programming_errors(sandbox, monkeypatch):
    def broken_resolve(path):
        raise RuntimeError("programming error")

    monkeypatch.setattr(sandbox, "resolve", broken_resolve)
    with pytest.raises(RuntimeError, match="programming error"):
        WriteFileTool().execute(sandbox, {"path": "file.txt", "content": "data"})

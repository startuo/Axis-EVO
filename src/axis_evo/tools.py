"""Controlled tools and trusted execution of one explicitly supplied tool call."""

from copy import deepcopy
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from time import perf_counter
from typing import Any, Protocol

from .events import EventType
from .hashing import canonical_json_bytes
from .models import PlanStep, ToolResult
from .sandbox import Sandbox
from .storage import append_event


TEST_TIMEOUT_SECONDS = 60


class ToolPlugin(Protocol):
    name: str
    mutating: bool

    def declared_targets(self, arguments: dict[str, Any]) -> list[str]:
        """All task-relevant paths that this invocation may modify.

        This declaration happens before execution. It does not mean the paths
        the tool eventually did modify; only Core POST_TOOL observation supplies
        the actual filesystem facts.
        """
        ...

    def execute(self, sandbox: Sandbox, arguments: dict[str, Any]) -> ToolResult:
        ...


def _arguments(arguments: dict[str, Any], required: set[str]) -> None:
    if type(arguments) is not dict or arguments.keys() != required:
        raise ValueError(f"tool arguments must have exactly these keys: {sorted(required)}")
    for key in required:
        if type(arguments[key]) is not str:
            raise ValueError(f"{key} must be a string")
    if not arguments["path"].strip():
        raise ValueError("path must be nonempty")


def _result(start: float, status: str, message: str, result: dict[str, Any] | None = None) -> ToolResult:
    return ToolResult(status, message, (perf_counter() - start) * 1000, result or {})


class ReadFileTool:
    name = "read_file"
    mutating = False

    def declared_targets(self, arguments: dict[str, Any]) -> list[str]:
        _arguments(arguments, {"path"})
        return []

    def execute(self, sandbox: Sandbox, arguments: dict[str, Any]) -> ToolResult:
        _arguments(arguments, {"path"})
        start = perf_counter()
        try:
            content = sandbox.resolve(arguments["path"]).read_bytes().decode("utf-8")
        except (OSError, UnicodeError) as error:
            return _result(start, "FAILED", str(error))
        return _result(start, "SUCCESS", "File read", {"content": content})


class WriteFileTool:
    name = "write_file"
    mutating = True

    def declared_targets(self, arguments: dict[str, Any]) -> list[str]:
        _arguments(arguments, {"path", "content"})
        return [arguments["path"]]

    def execute(self, sandbox: Sandbox, arguments: dict[str, Any]) -> ToolResult:
        _arguments(arguments, {"path", "content"})
        start = perf_counter()
        try:
            sandbox.resolve(arguments["path"]).write_bytes(arguments["content"].encode("utf-8"))
        except (OSError, UnicodeError) as error:
            return _result(start, "FAILED", str(error))
        return _result(start, "SUCCESS", "File written")


class PatchFileTool:
    name = "patch_file"
    mutating = True

    def declared_targets(self, arguments: dict[str, Any]) -> list[str]:
        self._validate(arguments)
        return [arguments["path"]]

    @staticmethod
    def _validate(arguments: dict[str, Any]) -> None:
        _arguments(arguments, {"path", "old", "new"})
        if not arguments["old"]:
            raise ValueError("old must be nonempty")

    def execute(self, sandbox: Sandbox, arguments: dict[str, Any]) -> ToolResult:
        self._validate(arguments)
        start = perf_counter()
        try:
            target = sandbox.resolve(arguments["path"])
            content = target.read_bytes().decode("utf-8")
            matches = len(re.findall("(?=" + re.escape(arguments["old"]) + ")", content))
            if matches != 1:
                return _result(start, "FAILED", "old text must occur exactly once", {"matches": matches})
            target.write_bytes(content.replace(arguments["old"], arguments["new"], 1).encode("utf-8"))
        except (OSError, UnicodeError) as error:
            return _result(start, "FAILED", str(error))
        return _result(start, "SUCCESS", "File patched", {"matches": 1})


class RunTestsTool:
    name = "run_tests"
    # Tests can have incidental effects; this is an intention about business files.
    mutating = False

    @staticmethod
    def _args(arguments: dict[str, Any]) -> list[str]:
        if type(arguments) is not dict or not arguments.keys() <= {"args"}:
            raise ValueError("run_tests accepts only args")
        args = arguments.get("args", [])
        if type(args) is not list or any(type(arg) is not str or not arg for arg in args):
            raise ValueError("args must be an array of nonempty strings")
        return args

    def declared_targets(self, arguments: dict[str, Any]) -> list[str]:
        self._args(arguments)
        return []

    def execute(self, sandbox: Sandbox, arguments: dict[str, Any]) -> ToolResult:
        args = []
        for arg in self._args(arguments):
            if arg in {"-q", "-x", "--tb=short", "--tb=line", "--tb=no"} or re.fullmatch(r"--maxfail=[0-9]+", arg):
                args.append(arg)
                continue
            if arg.startswith("-") or any(char in arg for char in ";|&`$\r\n\x00"):
                raise ValueError(f"unsupported pytest argument: {arg}")
            path, *nodes = arg.split("::")
            if any(not node for node in nodes):
                raise ValueError("pytest node ids must have nonempty components")
            target = sandbox.resolve(path)
            if not target.exists():
                raise ValueError(f"pytest target does not exist: {path}")
            args.append(target.relative_to(sandbox.root).as_posix() + "".join("::" + node for node in nodes))

        env = os.environ.copy()
        env.update(
            PYTHONDONTWRITEBYTECODE="1",
            PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
            PYTEST_ADDOPTS="",
            PYTHONIOENCODING="utf-8",
        )
        env.pop("PYTEST_PLUGINS", None)
        env.pop("PYTHONPATH", None)
        command = [
            sys.executable, "-m", "pytest", "-p", "no:cacheprovider",
            # Fixed empty configuration: do not inherit workspace/ancestor addopts.
            # Caller-supplied -c remains forbidden by the whitelist above.
            "-c", os.devnull,
            # Core fixes these boundaries; callers cannot supply overrides.
            "--rootdir=" + str(sandbox.root), "--confcutdir=" + str(sandbox.root),
            *args,
        ]
        start = perf_counter()
        try:
            completed = subprocess.run(
                command, cwd=sandbox.root, env=env, shell=False,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=TEST_TIMEOUT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired as error:
            def text(value: str | bytes | None) -> str:
                return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""

            return _result(start, "TIMEOUT", "pytest timed out", {
                "exit_code": None, "stdout": text(error.stdout), "stderr": text(error.stderr),
            })
        return _result(start, "SUCCESS" if completed.returncode == 0 else "FAILED", "pytest finished", {
            "exit_code": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr,
        })


def execute_tool_call(
    connection: sqlite3.Connection,
    run_id: str,
    sandbox: Sandbox,
    tool: ToolPlugin,
    step: PlanStep,
    tool_call_id: str,
) -> ToolResult:
    """Record and execute exactly one selected call, never inside a DB transaction.

    An exception or hard exit after intent may leave no result. No recovery or
    run lifecycle inference is performed here.
    """
    if connection.in_transaction:
        raise ValueError("tool execution requires a connection without an active transaction")
    run = connection.execute(
        "SELECT workspace_path FROM runs WHERE run_id = ?", (run_id,),
    ).fetchone()
    if run is None:
        raise ValueError("run does not exist")
    workspace_path = run[0]
    if type(workspace_path) is not str or not workspace_path.strip() or "\x00" in workspace_path:
        raise ValueError("recorded workspace_path is invalid or missing")
    recorded_root = Path(workspace_path)
    if not recorded_root.is_absolute():
        raise ValueError("recorded workspace_path must be absolute")
    try:
        recorded_root = recorded_root.resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError("recorded workspace_path is invalid or missing") from error
    if not recorded_root.is_dir():
        raise ValueError("recorded workspace_path must identify a workspace directory")
    if recorded_root != sandbox.root:
        raise ValueError("sandbox root does not match run workspace_path")
    if type(tool_call_id) is not str or not tool_call_id.strip():
        raise ValueError("tool_call_id must be a nonempty string")
    existing_events = connection.execute(
        "SELECT event_type, step_id, payload_json FROM events WHERE run_id = ? AND tool_call_id = ?",
        (run_id, tool_call_id),
    ).fetchall()
    if existing_events:
        planned = existing_events[0]
        if (
            len(existing_events) != 1
            or planned[0] != EventType.STEP_PLANNED
            or planned[1] != step.step_id
            or canonical_json_bytes(json.loads(planned[2])) != canonical_json_bytes({
                "tool_name": step.tool_name, "arguments": step.arguments,
            })
        ):
            raise ValueError("tool_call_id has already been used within this run")
    if tool.name != step.tool_name:
        raise ValueError("tool name does not match PlanStep.tool_name")
    arguments = deepcopy(step.arguments)
    targets = tool.declared_targets(deepcopy(arguments))
    if type(targets) is not list or any(type(path) is not str for path in targets):
        raise ValueError("declared_targets must return a list of path strings")
    if len(set(targets)) != len(targets):
        raise ValueError("declared targets must not contain duplicates")
    if type(tool.mutating) is not bool or tool.mutating != bool(targets):
        raise ValueError("mutating tools require targets; non-mutating tools must declare none")

    observations = [sandbox.observe_file(path) for path in targets]
    event_fields = {"step_id": step.step_id, "tool_call_id": tool_call_id}
    for observation in observations:
        append_event(connection, run_id, EventType.FILE_OBSERVED, {
            "reason": "PRE_TOOL", **asdict(observation),
        }, **event_fields)
    append_event(connection, run_id, EventType.TOOL_INTENT, {
        "tool_name": tool.name,
        "arguments": arguments,
        "mutating": tool.mutating,
        "targets": [{
            "path": observation.path, "exists": observation.exists,
            "before_sha256": observation.sha256, "size_bytes": observation.size_bytes,
        } for observation in observations],
    }, **event_fields)

    # append_event returned after COMMIT. There is no enclosing SQLite transaction.
    result = tool.execute(sandbox, arguments)

    for path in targets:
        append_event(connection, run_id, EventType.FILE_OBSERVED, {
            "reason": "POST_TOOL", **asdict(sandbox.observe_file(path)),
        }, **event_fields)
    append_event(connection, run_id, EventType.TOOL_RESULT, {
        "tool_name": tool.name, **asdict(result),
    }, **event_fields)
    return result

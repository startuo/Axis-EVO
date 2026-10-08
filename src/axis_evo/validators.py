"""Deterministic Core acceptance, independent of agent-callable tools."""

from dataclasses import asdict
import hashlib
import os
from pathlib import Path, PureWindowsPath
import re
import sqlite3
import subprocess
import sys
from time import perf_counter
from typing import Any

from .events import EventType
from .models import TaskSpec, ValidationResult
from .sandbox import Sandbox
from .storage import append_event


VALIDATION_TIMEOUT_SECONDS = 60
FILE_OPERATORS = {"exists", "not_exists", "contains", "equals"}


def _pytest_arguments(arguments: list[str], sandbox: Sandbox | None = None) -> list[str]:
    args = []
    for arg in arguments:
        if type(arg) is not str or not arg:
            raise ValueError("acceptance pytest args must be nonempty strings")
        if arg in {"-q", "-x", "--tb=short", "--tb=line", "--tb=no"} or re.fullmatch(r"--maxfail=[0-9]+", arg):
            args.append(arg)
            continue
        if arg.startswith("-") or any(char in arg for char in ";|&`$\r\n\x00"):
            raise ValueError(f"unsupported acceptance pytest argument: {arg}")
        path, *nodes = arg.split("::")
        windows_path = PureWindowsPath(path)
        if (
            not path or windows_path.drive or windows_path.root or ":" in path
            or any(PureWindowsPath(part).is_reserved() for part in windows_path.parts)
            or any(not node for node in nodes)
        ):
            raise ValueError(f"invalid acceptance pytest target: {arg}")
        if sandbox is not None:
            target = sandbox.resolve(path)
            if not target.exists():
                raise ValueError(f"acceptance pytest target does not exist: {path}")
            path = target.relative_to(sandbox.root).as_posix()
        args.append(path + "".join("::" + node for node in nodes))
    return args


def preflight_acceptance(task_spec: TaskSpec, sandbox: Sandbox | None = None) -> None:
    """Check supported configuration without observing assertion files or running pytest."""
    for assertion in task_spec.acceptance["file_assertions"]:
        if assertion["operator"] not in FILE_OPERATORS:
            raise ValueError(f"unsupported file assertion operator: {assertion['operator']}")
        if sandbox is not None:
            try:
                sandbox.resolve(assertion["path"])
            except FileNotFoundError:
                # A safe path with a missing parent may fail formal validation later.
                pass
    pytest_spec = task_spec.acceptance["pytest"]
    _pytest_arguments(pytest_spec["args"], sandbox if pytest_spec["enabled"] else None)


def _run_pytest(sandbox: Sandbox, arguments: list[str]) -> dict[str, Any]:
    start = perf_counter()
    try:
        args = _pytest_arguments(arguments, sandbox)
    except (OSError, ValueError) as error:
        return {"enabled": True, "executed": False, "passed": False, "reason": str(error)}
    env = os.environ.copy()
    env.update(
        PYTHONDONTWRITEBYTECODE="1", PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
        PYTEST_ADDOPTS="", PYTHONIOENCODING="utf-8",
    )
    env.pop("PYTEST_PLUGINS", None)
    env.pop("PYTHONPATH", None)
    command = [
        sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-c", os.devnull,
        "--rootdir=" + str(sandbox.root), "--confcutdir=" + str(sandbox.root), *args,
    ]
    try:
        completed = subprocess.run(
            command, cwd=sandbox.root, env=env, shell=False,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=VALIDATION_TIMEOUT_SECONDS, check=False,
        )
        outcome = {
            "passed": completed.returncode == 0, "exit_code": completed.returncode,
            "stdout": completed.stdout, "stderr": completed.stderr,
        }
    except subprocess.TimeoutExpired as error:
        def text(value: str | bytes | None) -> str:
            return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""

        outcome = {
            "passed": False, "exit_code": None, "reason": "pytest timed out",
            "stdout": text(error.stdout), "stderr": text(error.stderr),
        }
    except OSError as error:
        outcome = {"passed": False, "exit_code": None, "stdout": "", "stderr": str(error)}
    return {
        "enabled": True, "executed": True,
        "duration_ms": (perf_counter() - start) * 1000, **outcome,
    }


def validate_acceptance(
    connection: sqlite3.Connection,
    run_id: str,
    sandbox: Sandbox,
    task_spec: TaskSpec,
) -> ValidationResult:
    """Commit VALIDATION_STARTED, observe assertions in order, then optionally run pytest."""
    preflight_acceptance(task_spec)
    run = connection.execute(
        "SELECT workspace_path, status FROM runs WHERE run_id = ?", (run_id,),
    ).fetchone()
    if run is None or run["status"] != "RUNNING":
        raise ValueError("acceptance requires an existing RUNNING run")
    recorded_root = Path(run["workspace_path"])
    if not recorded_root.is_absolute() or recorded_root.resolve(strict=True) != sandbox.root:
        raise ValueError("acceptance sandbox does not match run workspace_path")
    assertions = task_spec.acceptance["file_assertions"]
    pytest_spec = task_spec.acceptance["pytest"]
    append_event(connection, run_id, EventType.VALIDATION_STARTED, {
        "file_assertion_count": len(assertions), "pytest_enabled": pytest_spec["enabled"],
    })
    details: dict[str, Any] = {
        "file_assertions": [],
        "pytest": {"enabled": pytest_spec["enabled"], "executed": False, "reason": "disabled"},
    }
    for assertion in assertions:
        detail = {**assertion, "passed": False, "message": ""}
        try:
            observation = sandbox.observe_file(assertion["path"])
            append_event(connection, run_id, EventType.FILE_OBSERVED, {
                "reason": "VALIDATION", **asdict(observation),
            })
            detail.update(
                exists=observation.exists, sha256=observation.sha256,
                size_bytes=observation.size_bytes,
            )
            operator = assertion["operator"]
            if operator == "not_exists":
                detail["passed"] = not observation.exists
            elif operator == "exists":
                detail["passed"] = observation.exists
            elif observation.exists:
                data = sandbox.resolve(assertion["path"]).read_bytes()
                if hashlib.sha256(data).hexdigest() != observation.sha256 or len(data) != observation.size_bytes:
                    raise ValueError("File changed during validation")
                content = data.decode("utf-8")
                detail["passed"] = (
                    assertion["expected"] in content if operator == "contains"
                    else assertion["expected"] == content
                )
            detail["message"] = "Assertion passed" if detail["passed"] else "Assertion failed"
        except (OSError, UnicodeError, ValueError) as error:
            detail["message"] = str(error)
        details["file_assertions"].append(detail)

    if any(not detail["passed"] for detail in details["file_assertions"]):
        details["pytest"]["reason"] = "not executed due to file assertion failure"
        return ValidationResult(False, "File assertions failed", details)
    if not assertions and not pytest_spec["enabled"]:
        return ValidationResult(False, "No acceptance criteria configured", details)
    if pytest_spec["enabled"]:
        details["pytest"] = _run_pytest(sandbox, pytest_spec["args"])
        if not details["pytest"]["passed"]:
            return ValidationResult(False, "Acceptance pytest failed", details)
    return ValidationResult(True, "Acceptance passed", details)

"""Read-only inspection of persisted evidence and current explicit file targets.

Changed state does not prove tool causality; unchanged state does not prove
non-execution. Missing TOOL_RESULT means the persisted result is unknown.
No recovery action is inferred, and no execution facts or task files are written.
SQLite may maintain its own WAL/SHM coordination sidecars; the run, events,
schema and task workspace remain unchanged. Inspection includes committed WAL.
"""

from collections import Counter, defaultdict
from dataclasses import asdict
import json
from math import isfinite
import os
from pathlib import Path
import re
import sqlite3
from typing import Any

from .events import EventType
from .hashing import canonical_json_bytes
from .sandbox import Sandbox


INSPECTION_SCHEMA_VERSION = 1
_TERMINALS = {"COMPLETED": "RUN_COMPLETED", "FAILED": "RUN_FAILED", "INTERRUPTED": "RUN_INTERRUPTED"}
_EVENT_TYPES = {item.value for item in EventType}
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _issue(code: str, message: str, event: dict | None = None, path: str | None = None) -> dict:
    result = {"code": code, "message": message}
    if event is not None:
        result["seq"] = _safe_atom(event["seq"])
        if _nonempty(event["tool_call_id"]):
            result["tool_call_id"] = event["tool_call_id"]
    if path is not None:
        result["path"] = path
    return result


def _nonempty(value: Any) -> bool:
    return type(value) is str and bool(value.strip())


def _safe_atom(value: Any) -> str | int | float | bool | None:
    if type(value) is str:
        try:
            value.encode("utf-8")
        except UnicodeError:
            return None
        return value
    if value is None or type(value) in (bool, int) or (type(value) is float and isfinite(value)):
        return value
    return None


def _json_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _finite_json(value: Any) -> None:
    if type(value) is dict:
        for key, item in value.items():
            key.encode("utf-8")
            _finite_json(item)
    elif type(value) is list:
        for item in value:
            _finite_json(item)
    elif type(value) is float and not isfinite(value):
        raise ValueError("nonfinite JSON number")
    elif type(value) is str:
        value.encode("utf-8")


def _state(value: dict, hash_key: str) -> dict | None:
    if type(value.get("exists")) is not bool or hash_key not in value or "size_bytes" not in value:
        return None
    sha, size = value[hash_key], value["size_bytes"]
    if value["exists"]:
        if type(sha) is not str or _SHA256.fullmatch(sha) is None or type(size) is not int or size < 0:
            return None
    elif sha is not None or size is not None:
        return None
    return {"exists": value["exists"], "sha256": sha, "size_bytes": size}


def _payload(event: dict, issues: list[dict]) -> dict | None:
    try:
        payload = json.loads(event["payload_json"], object_pairs_hook=_json_object)
        _finite_json(payload)
        if type(payload) is not dict:
            raise ValueError("payload must be a JSON object")
        kind = event["event_type"]
        if kind == "TOOL_INTENT":
            if (not _nonempty(payload.get("tool_name")) or type(payload.get("arguments")) is not dict
                    or type(payload.get("mutating")) is not bool or type(payload.get("targets")) is not list
                    or payload["mutating"] != bool(payload["targets"])):
                raise ValueError("invalid TOOL_INTENT shape")
        elif kind == "FILE_OBSERVED":
            if (payload.get("reason") not in ("PRE_TOOL", "POST_TOOL", "VALIDATION")
                    or not _nonempty(payload.get("path")) or _state(payload, "sha256") is None):
                raise ValueError("invalid FILE_OBSERVED shape")
        elif kind == "TOOL_RESULT":
            duration = payload.get("duration_ms")
            if (not _nonempty(payload.get("tool_name")) or not _nonempty(payload.get("status"))
                    or type(payload.get("message")) is not str or type(payload.get("result")) is not dict
                    or type(duration) not in (int, float) or duration < 0):
                raise ValueError("invalid TOOL_RESULT shape")
        elif kind == "STEP_PLANNED":
            if not _nonempty(payload.get("tool_name")) or type(payload.get("arguments")) is not dict:
                raise ValueError("invalid STEP_PLANNED shape")
        elif kind == "STEP_CONFIRMED":
            if payload.get("tool_call_id") != event["tool_call_id"] or not _nonempty(payload.get("tool_status")):
                raise ValueError("invalid STEP_CONFIRMED shape")
        elif kind == "RUN_STARTED":
            if not _nonempty(payload.get("workspace_path")) or not _nonempty(payload.get("model_plugin")):
                raise ValueError("invalid RUN_STARTED shape")
        elif kind == "TASK_LOADED":
            sha = payload.get("task_spec_sha256")
            if type(sha) is not str or _SHA256.fullmatch(sha) is None:
                raise ValueError("invalid TASK_LOADED shape")
        elif kind == "VALIDATION_STARTED":
            count = payload.get("file_assertion_count")
            if type(count) is not int or count < 0 or type(payload.get("pytest_enabled")) is not bool:
                raise ValueError("invalid VALIDATION_STARTED shape")
        elif kind in ("VALIDATION_PASSED", "VALIDATION_FAILED"):
            if (type(payload.get("passed")) is not bool or payload["passed"] != (kind == "VALIDATION_PASSED")
                    or type(payload.get("message")) is not str or type(payload.get("details")) is not dict):
                raise ValueError("invalid validation outcome shape")
        elif kind == "RUN_COMPLETED" and not _nonempty(payload.get("validation_event_id")):
            raise ValueError("invalid completion reference")
        return payload
    except (ValueError, TypeError, RecursionError):
        issues.append(_issue("INVALID_EVENT_PAYLOAD", "Event payload cannot be used as valid evidence", event))
        return None


def _workspace(workspace_path: str) -> tuple[Sandbox | None, str | None]:
    try:
        if not _nonempty(workspace_path) or "\x00" in workspace_path or not Path(workspace_path).is_absolute():
            raise ValueError("recorded workspace must be an absolute path")
        recorded = Path(os.path.abspath(workspace_path))
        sandbox = Sandbox(workspace_path)
        if sandbox.root != recorded:
            raise ValueError("recorded workspace root has been redirected")
        return sandbox, None
    except (OSError, ValueError, RuntimeError) as error:
        return None, f"{type(error).__name__}: {error}"


def _terminal_checks(run: dict, events: list[dict], issues: list[dict]) -> None:
    terminals = [event for event in events if event["event_type"] in _TERMINALS.values()]
    expected = _TERMINALS.get(run["status"])
    valid = (not terminals and run["ended_at"] is None) if run["status"] == "RUNNING" else (
        expected is not None and run["ended_at"] is not None and len(terminals) == 1
        and terminals[0]["event_type"] == expected
        and terminals[0]["occurred_at"] == run["ended_at"] and terminals[0] is events[-1]
    )
    if not valid:
        issues.append(_issue("RUN_TERMINAL_STATE_MISMATCH", "Run row and terminal event evidence disagree"))
    if run["status"] == "COMPLETED" and len(terminals) == 1:
        terminal = terminals[0]
        outcomes = [event for event in events if event["event_type"] in ("VALIDATION_PASSED", "VALIDATION_FAILED")
                    and event["order"] < terminal["order"]]
        payload = terminal["payload"]
        if (not outcomes or outcomes[-1]["event_type"] != "VALIDATION_PASSED" or not outcomes[-1]["valid"] or payload is None
                or payload.get("validation_event_id") != outcomes[-1]["event_id"]):
            issues.append(_issue("RUN_TERMINAL_STATE_MISMATCH", "Completion lacks its referenced latest validation pass", terminal))


def _invocation_closure_checks(intent: dict, facts: list[dict], results: list[dict],
                               declared_paths: Counter, issues: list[dict]) -> None:
    posts = defaultdict(list)
    for event in facts:
        observation = event["payload"]
        if (event["event_type"] != "FILE_OBSERVED" or observation is None
                or observation["reason"] != "POST_TOOL"):
            continue
        path = observation["path"]
        posts[path].append(event)
        if (not event["valid"] or event["step_id"] != intent["step_id"]
                or event["order"] <= intent["order"] or path not in declared_paths):
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "POST_TOOL must follow its intent and identify a declared target with matching step_id", event, path))
    for path, observations in posts.items():
        if len(observations) > 1:
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "Target has multiple POST_TOOL observations", observations[1], path))
    payload = intent["payload"]
    if len(results) == 1 and results[0]["valid"] and payload is not None and payload["mutating"]:
        result = results[0]
        for path in declared_paths:
            observations = posts[path]
            if (len(observations) != 1 or not observations[0]["valid"]
                    or observations[0]["step_id"] != intent["step_id"]
                    or not intent["order"] < observations[0]["order"] < result["order"]):
                issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "TOOL_RESULT requires exactly one valid POST_TOOL per declared target between intent and result", result, path))
    confirmed = [event for event in facts if event["event_type"] == "STEP_CONFIRMED"]
    if len(confirmed) > 1:
        issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "Invocation has multiple STEP_CONFIRMED rows", confirmed[1]))
    for confirmation in confirmed:
        if len(results) != 1:
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "STEP_CONFIRMED requires exactly one TOOL_RESULT", confirmation))
            continue
        result = results[0]
        confirmation_payload = confirmation["payload"]
        result_payload = result["payload"]
        if (not result["valid"] or not confirmation["valid"] or result["order"] >= confirmation["order"]
                or confirmation["step_id"] != intent["step_id"] or result["step_id"] != intent["step_id"]
                or confirmation_payload is None or result_payload is None
                or confirmation_payload["tool_call_id"] != confirmation["tool_call_id"]
                or confirmation_payload["tool_status"] != result_payload["status"]):
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "STEP_CONFIRMED must follow a valid matching TOOL_RESULT and preserve its status", confirmation))


def inspect_run(connection: sqlite3.Connection, run_id: str) -> dict[str, Any]:
    """Inspect one committed run using a single SELECT snapshot and no writes.

    The caller's transaction, row factory and connection settings are untouched.
    Only unresolved intent targets are observed, through the existing Sandbox.
    """
    if not _nonempty(run_id):
        raise ValueError("run_id must be a nonempty string")
    if connection.in_transaction:
        raise ValueError("inspection requires no active caller transaction")
    cursor = connection.cursor()
    cursor.row_factory = sqlite3.Row
    try:
        rows = cursor.execute("""SELECT r.run_id AS r_run_id, r.task_id AS r_task_id,
            r.status AS r_status, r.workspace_path AS r_workspace_path,
            r.started_at AS r_started_at, r.ended_at AS r_ended_at,
            e.event_id, e.task_id, e.seq, e.event_type, e.step_id, e.tool_call_id,
            e.schema_version, e.occurred_at, e.payload_json
            FROM runs AS r LEFT JOIN events AS e ON e.run_id = r.run_id
            WHERE r.run_id = ? ORDER BY e.seq""", (run_id,)).fetchall()
    finally:
        cursor.close()
    if not rows:
        raise ValueError(f"run does not exist: {run_id}")
    run = {name: rows[0][f"r_{name}"] for name in (
        "run_id", "task_id", "status", "workspace_path", "started_at", "ended_at")}
    events = [{key: row[key] for key in row.keys() if not key.startswith("r_")}
              for row in rows if row["event_id"] is not None]
    issues = []
    for name, value in run.items():
        if (value is None and name != "ended_at") or (value is not None and (type(value) is not str or _safe_atom(value) is None)):
            issues.append(_issue("INVALID_RUN_METADATA", f"Run {name} is not valid textual metadata"))
    groups = defaultdict(list)
    pre = defaultdict(list)
    sequence_valid = True
    for expected, event in enumerate(events, 1):
        event["order"] = expected
        event["valid"] = True
        for name in ("event_id", "task_id", "event_type", "occurred_at", "step_id", "tool_call_id"):
            value = event[name]
            if (value is None and name not in ("step_id", "tool_call_id")) or (value is not None and (type(value) is not str or _safe_atom(value) is None)):
                event["valid"] = False
                issues.append(_issue("INVALID_EVENT_ENVELOPE", f"Event {name} is not valid textual metadata", event))
        if type(event["seq"]) is not int or event["seq"] != expected:
            sequence_valid = False
            issues.append(_issue("SEQ_INCONSISTENT", "Event seq must form the contiguous execution order starting at 1", event))
        if event["task_id"] != run["task_id"]:
            event["valid"] = False
            issues.append(_issue("TASK_ID_MISMATCH", "Event task_id differs from run task_id", event))
        if type(event["schema_version"]) is not int or event["schema_version"] != 1:
            event["valid"] = False
            issues.append(_issue("UNSUPPORTED_EVENT_SCHEMA", "Event schema_version is unsupported", event))
        if event["event_type"] not in _EVENT_TYPES:
            event["valid"] = False
            issues.append(_issue("UNSUPPORTED_EVENT_TYPE", "Event type is unsupported", event))
        event["payload"] = _payload(event, issues)
        if event["payload"] is None:
            event["valid"] = False
        call_id = event["tool_call_id"]
        if _nonempty(call_id):
            groups[call_id].append(event)
        elif event["event_type"] in ("TOOL_INTENT", "TOOL_RESULT", "STEP_PLANNED", "STEP_CONFIRMED"):
            event["valid"] = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "Invocation event lacks a nonempty tool_call_id", event))
        elif (event["event_type"] == "FILE_OBSERVED" and event["payload"] is not None
              and event["payload"]["reason"] in ("PRE_TOOL", "POST_TOOL")):
            event["valid"] = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "Tool observation lacks a nonempty tool_call_id", event))
        # Index raw observations too: malformed duplicates must not disappear.
        try:
            raw = json.loads(event["payload_json"])
        except (ValueError, TypeError, RecursionError):
            raw = None
        event["raw_observation_reason"] = raw.get("reason") if type(raw) is dict else None
        if (event["event_type"] == "FILE_OBSERVED" and type(raw) is dict
                and raw.get("reason") == "PRE_TOOL" and type(raw.get("path")) is str):
            pre[(call_id, raw["path"])].append(event)
    _terminal_checks(run, events, issues)
    pending = []
    for call_id, facts in groups.items():
        intents = [event for event in facts if event["event_type"] == "TOOL_INTENT"]
        results = [event for event in facts if event["event_type"] == "TOOL_RESULT"]
        if len(intents) > 1:
            issues.append(_issue("DUPLICATE_TOOL_INTENT", "Invocation has multiple TOOL_INTENT rows", intents[1]))
        if len(results) > 1:
            issues.append(_issue("DUPLICATE_TOOL_RESULT", "Invocation has multiple TOOL_RESULT rows", results[1]))
        if len(intents) != 1:
            if results and not intents:
                issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "TOOL_RESULT has no recorded TOOL_INTENT", results[0]))
            if not intents:
                for event in facts:
                    if event["event_type"] == "STEP_CONFIRMED":
                        issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "STEP_CONFIRMED has no recorded TOOL_INTENT", event))
                    elif event["event_type"] == "FILE_OBSERVED" and event["raw_observation_reason"] == "POST_TOOL":
                        issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "POST_TOOL has no recorded TOOL_INTENT", event))
            continue
        intent = intents[0]
        payload = intent["payload"]
        coherent = sequence_valid and all(event["valid"] for event in facts)
        if any(event["step_id"] != intent["step_id"] for event in facts):
            coherent = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "Invocation step_id values disagree", intent))
        if payload is not None and any(event["payload"] is not None and event["payload"]["tool_name"] != payload["tool_name"] for event in results):
            coherent = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "TOOL_RESULT and TOOL_INTENT tool names disagree", intent))
        if any(event["order"] < intent["order"] for event in results):
            coherent = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "TOOL_RESULT precedes TOOL_INTENT", intent))
        planned = [event for event in facts if event["event_type"] == "STEP_PLANNED"]
        if planned and (len(planned) != 1 or planned[0]["order"] >= intent["order"] or payload is None
                        or planned[0]["payload"] is None or canonical_json_bytes(planned[0]["payload"]) !=
                        canonical_json_bytes({"tool_name": payload["tool_name"], "arguments": payload["arguments"]})):
            coherent = False
            issues.append(_issue("INVOCATION_IDENTITY_MISMATCH", "STEP_PLANNED and TOOL_INTENT evidence disagree", intent))
        targets = []
        raw_targets = payload["targets"] if payload is not None else []
        path_counts = Counter(target["path"] for target in raw_targets
                              if type(target) is dict and type(target.get("path")) is str)
        for target in raw_targets:
            if type(target) is not dict or not _nonempty(target.get("path")):
                issues.append(_issue("INVALID_EVENT_PAYLOAD", "Intent target must identify a nonempty path", intent))
                continue
            path = target["path"]
            before = _state(target, "before_sha256")
            valid_before = coherent and before is not None
            if before is None or path_counts[path] != 1:
                valid_before = False
                issues.append(_issue("INVALID_EVENT_PAYLOAD", "Intent target state is invalid or path is duplicated", intent, path))
            matches = [event for event in pre[(call_id, path)] if event["order"] < intent["order"]]
            if not matches:
                valid_before = False
                issues.append(_issue("PRE_OBSERVATION_MISSING", "No preceding PRE_TOOL observation matches target", intent, path))
            elif len(matches) != 1:
                valid_before = False
                issues.append(_issue("PRE_OBSERVATION_DUPLICATE", "Multiple preceding PRE_TOOL observations match target", intent, path))
            else:
                observed = matches[0]
                observation = observed["payload"]
                if (not observed["valid"] or observed["step_id"] != intent["step_id"] or observation is None
                        or before is None or _state(observation, "sha256") != before):
                    valid_before = False
                    issues.append(_issue("PRE_OBSERVATION_INTENT_MISMATCH", "PRE_TOOL and intent target evidence disagree", intent, path))
            if not results:
                targets.append({"path": path, "before": before if valid_before else None})
        _invocation_closure_checks(intent, facts, results, path_counts, issues)
        if not results:
            pending.append({"step_id": _safe_atom(intent["step_id"]), "tool_call_id": call_id,
                            "tool_name": payload["tool_name"] if payload is not None else None,
                            "intent_seq": _safe_atom(intent["seq"]), "execution_result_unknown": True,
                            "post_observation_present": any(event["event_type"] == "FILE_OBSERVED"
                                and event["payload"] is not None and event["payload"].get("reason") == "POST_TOOL"
                                for event in facts), "targets": targets})
    intent_order = {event["tool_call_id"]: event["order"] for event in events if event["event_type"] == "TOOL_INTENT"}
    pending.sort(key=lambda item: intent_order[item["tool_call_id"]])
    current_issues = []
    sandbox, workspace_reason = _workspace(run["workspace_path"]) if any(item["targets"] for item in pending) else (None, None)
    if workspace_reason is not None:
        current_issues.append(_issue("WORKSPACE_UNAVAILABLE", workspace_reason))
    for invocation in pending:
        for target in invocation["targets"]:
            try:
                if sandbox is None:
                    raise ValueError(workspace_reason or "workspace unavailable")
                observation = asdict(sandbox.observe_file(target["path"]))
                observation.pop("path")
                target["current"] = {"observable": True, **observation}
                target["external_state_changed"] = (observation != target["before"]) if target["before"] is not None else None
            except (OSError, ValueError, RuntimeError) as error:
                reason = f"{type(error).__name__}: {error}"
                target["current"] = {"observable": False, "reason": reason}
                target["external_state_changed"] = None
                current_issues.append({"code": "CURRENT_TARGET_UNOBSERVABLE", "message": reason,
                                       "seq": invocation["intent_seq"], "tool_call_id": invocation["tool_call_id"], "path": target["path"]})
    observations = []
    if run["status"] == "RUNNING" and run["ended_at"] is None:
        observations.append("UNFINISHED_RUN")
    if pending:
        observations.append("EXECUTION_RESULT_UNKNOWN")
    if any(target["external_state_changed"] is True for item in pending for target in item["targets"]):
        observations.append("EXTERNAL_STATE_CHANGED")
    return {"inspection_schema_version": INSPECTION_SCHEMA_VERSION, "run": {key: _safe_atom(value) for key, value in run.items()},
            "trace": {"event_count": len(events), "last_seq": _safe_atom(events[-1]["seq"]) if events else None,
                      "last_event_type": _safe_atom(events[-1]["event_type"]) if events else None,
                      "consistent": not issues, "issues": issues},
            "observations": observations, "pending_invocations": pending, "current_state_issues": current_issues}


def inspect_database(database_path: str | Path, run_id: str) -> dict[str, Any]:
    """Read an existing database with mode=ro, including committed WAL facts.

    SQLite's internal WAL/SHM coordination is permitted. No migrations, journal
    mode changes or application writes occur. The connection is always closed.
    """
    if not _nonempty(run_id):
        raise ValueError("run_id must be a nonempty string")
    uri = Path(database_path).resolve(strict=True).as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, isolation_level=None)
    connection.row_factory = sqlite3.Row
    try:
        return inspect_run(connection, run_id)
    finally:
        connection.close()


def format_inspection_json(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def format_inspection_text(report: dict[str, Any]) -> str:
    lines = [f"Run: {report['run']['run_id']}", f"Persisted status: {report['run']['status']}",
             f"Last event: #{report['trace']['last_seq']} {report['trace']['last_event_type']}"]
    lines.extend(f"Observation: {item}" for item in report["observations"])
    for invocation in report["pending_invocations"]:
        lines.append(f"Pending invocation: {invocation['tool_call_id']} step_id={invocation['step_id']} tool={invocation['tool_name']}")
        for target in invocation["targets"]:
            lines.append(f"Target: {target['path']}")
            lines.append("  before: " + format_inspection_json(target["before"]))
            lines.append("  current: " + format_inspection_json(target["current"]))
            lines.append("  external_state_changed: " + json.dumps(target["external_state_changed"]))
    for issue in report["trace"]["issues"] + report["current_state_issues"]:
        lines.append(f"Issue: {issue['code']} {issue['message']}")
    lines.append("Current state differences do not attribute changes to a tool; equal states do not establish whether it ran.")
    lines.append("Missing TOOL_RESULT means the persisted execution result is unknown.")
    return "\n".join(lines)


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Read-only Axis-Evo inspection")
    parser.add_argument("database")
    parser.add_argument("run_id")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    arguments = parser.parse_args()
    try:
        report = inspect_database(arguments.database, arguments.run_id)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.error(str(error))
    print(format_inspection_json(report) if arguments.format == "json" else format_inspection_text(report))


if __name__ == "__main__":
    _main()

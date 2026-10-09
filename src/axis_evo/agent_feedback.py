"""Bounded, evidence-derived feedback. Text is data, never execution authority."""

from copy import deepcopy
import hashlib
import re

from .hashing import canonical_json_bytes
from .inspector import inspect_run
from .planning_adapter import _strict_json, _text, MAX_RESPONSE_BYTES
from .planning_provenance import inspect_planning_provenance
from .skill_binding import _read_snapshot, _rows, inspect_skill_trace


MAX_FEEDBACK_BYTES = 16 * 1024
MAX_MESSAGE_EXCERPT_BYTES = 2048
MAX_FEEDBACK_RESULTS = 10
_HASH = re.compile(r"[0-9a-f]{64}\Z")


class AgentIntegrityError(ValueError):
    """Committed evidence disagrees; no repair or replacement is attempted."""


class AgentUnknownOutcome(ValueError):
    """An execution or planning prefix has no trustworthy normal outcome."""


def _sha(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _evidence(connection, run_id):
    """Raw committed facts, also usable for final recheck inside an owned write."""
    result = {}
    for table, order in (("runs", "run_id"), ("events", "seq"),
                         ("skill_invocation_bindings", "tool_call_id"), ("plan_run_links", "run_id")):
        result[table] = [dict(row) for row in _rows(connection,
            f"SELECT * FROM main.{table} WHERE run_id=? ORDER BY {order}", (run_id,))]
    result["plan_proposals"] = [dict(row) for row in _rows(connection,
        "SELECT p.* FROM main.plan_proposals p JOIN main.plan_run_links l USING(proposal_id) WHERE l.run_id=?", (run_id,))]
    result["skill_versions"] = [dict(row) for row in _rows(connection,
        "SELECT v.* FROM main.skill_versions v WHERE EXISTS (SELECT 1 FROM main.plan_proposals p "
        "JOIN main.plan_run_links l USING(proposal_id) WHERE l.run_id=? AND p.skill_id=v.skill_id "
        "AND p.skill_version=v.skill_version) ORDER BY v.skill_id,v.skill_version", (run_id,))]
    result["skill_state_events"] = [dict(row) for row in _rows(connection,
        "SELECT s.* FROM main.skill_state_events s WHERE EXISTS (SELECT 1 FROM main.plan_proposals p "
        "JOIN main.plan_run_links l USING(proposal_id) WHERE l.run_id=? AND p.skill_id=s.skill_id "
        "AND p.skill_version=s.skill_version) ORDER BY s.transition_seq", (run_id,))]
    return result


def _message(text, include):
    data = _text(text, nonempty=False).encode("utf-8")
    excerpt = data[:MAX_MESSAGE_EXCERPT_BYTES].decode("utf-8", errors="ignore") if include else None
    return {"message_sha256": hashlib.sha256(data).hexdigest(), "message_size_bytes": len(data),
            "message_excerpt": excerpt,
            "message_excerpt_is_truncated": include and len(data) > MAX_MESSAGE_EXCERPT_BYTES}


def _check_message(value):
    if not _HASH.fullmatch(_text(value["message_sha256"])):
        raise ValueError("Invalid message hash")
    size, excerpt, truncated = (value[k] for k in
        ("message_size_bytes", "message_excerpt", "message_excerpt_is_truncated"))
    if type(size) is not int or size < 0 or type(truncated) is not bool:
        raise ValueError("Invalid message metadata")
    if excerpt is None:
        if truncated:
            raise ValueError("Absent excerpt cannot be truncated")
    else:
        raw = _text(excerpt, nonempty=False).encode("utf-8")
        if len(raw) > MAX_MESSAGE_EXCERPT_BYTES or len(raw) > size or truncated != (size > MAX_MESSAGE_EXCERPT_BYTES):
            raise ValueError("Invalid bounded message excerpt")
        if not truncated and (len(raw) != size or hashlib.sha256(raw).hexdigest() != value["message_sha256"]):
            raise ValueError("Complete message excerpt hash mismatch")


def validate_feedback_context(value):
    """Strict structural validation only; this does not authenticate feedback."""
    # Roundtrip rejects non-JSON types rather than silently normalizing them.
    from .runner import _validate_json_native
    _validate_json_native(value)
    value = _strict_json(canonical_json_bytes(value).decode("utf-8"), MAX_FEEDBACK_BYTES)
    fields = {"schema_version", "episode_id", "attempt_no", "previous_run_id", "prior_evidence"}
    if type(value) is not dict or value.keys() != fields or type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ValueError("Invalid Agent feedback context")
    _text(value["episode_id"])
    n = value["attempt_no"]
    if type(n) is not int or not 1 <= n <= 5:
        raise ValueError("Invalid feedback attempt number")
    prior = value["prior_evidence"]
    if n == 1:
        if value["previous_run_id"] is not None or prior is not None:
            raise ValueError("Initial attempt has no previous execution evidence")
        return deepcopy(value)
    _text(value["previous_run_id"])
    required = {"schema_version", "previous_run_id", "previous_proposal_id", "previous_plan_sha256",
        "run_status", "evidence_complete", "failure_kind", "evidence_sha256", "terminal_event_id",
        "terminal_seq", "tool_results", "validation"}
    if type(prior) is not dict or prior.keys() != required:
        raise ValueError("Invalid factual feedback fields")
    if (type(prior["schema_version"]) is not int or prior["schema_version"] != 1
            or prior["previous_run_id"] != value["previous_run_id"] or prior["evidence_complete"] is not True
            or prior["run_status"] != "FAILED"
            or prior["failure_kind"] not in ("TOOL_REPORTED_FAILURE", "VALIDATION_FAILED")):
        raise ValueError("Feedback requires complete normal FAILED evidence")
    for key in ("previous_proposal_id", "terminal_event_id"):
        _text(prior[key])
    for key in ("previous_plan_sha256", "evidence_sha256"):
        if not _HASH.fullmatch(_text(prior[key])):
            raise ValueError("Invalid feedback digest")
    if type(prior["terminal_seq"]) is not int or prior["terminal_seq"] < 1:
        raise ValueError("Invalid terminal sequence")
    results = prior["tool_results"]
    if type(results) is not list or not 1 <= len(results) <= MAX_FEEDBACK_RESULTS:
        raise ValueError("Invalid feedback result count")
    message_keys = {"message_sha256", "message_size_bytes", "message_excerpt", "message_excerpt_is_truncated"}
    last, calls, steps = 0, set(), set()
    for item in results:
        if type(item) is not dict or item.keys() != message_keys | {"step_id", "tool_call_id", "tool_name", "status", "event_id", "seq"}:
            raise ValueError("Invalid feedback ToolResult")
        for key in ("step_id", "tool_call_id", "tool_name", "event_id"):
            _text(item[key])
        if (item["status"] not in ("SUCCESS", "FAILED", "TIMEOUT") or type(item["seq"]) is not int
                or not last < item["seq"] < prior["terminal_seq"] or item["tool_call_id"] in calls or item["step_id"] in steps):
            raise ValueError("Invalid feedback invocation ordering or status")
        last = item["seq"]
        calls.add(item["tool_call_id"])
        steps.add(item["step_id"])
        _check_message(item)
    validation = prior["validation"]
    if prior["failure_kind"] == "TOOL_REPORTED_FAILURE":
        if validation is not None or results[-1]["status"] not in ("FAILED", "TIMEOUT") or any(i["status"] != "SUCCESS" for i in results[:-1]):
            raise ValueError("Tool failure feedback disagrees with results")
    else:
        if (type(validation) is not dict or validation.keys() != message_keys | {"event_id", "seq", "passed"}
                or validation["passed"] is not False or type(validation["seq"]) is not int
                or not last < validation["seq"] < prior["terminal_seq"] or any(i["status"] != "SUCCESS" for i in results)):
            raise ValueError("Validation failure feedback disagrees with results")
        _text(validation["event_id"])
        _check_message(validation)
    return deepcopy(value)


def extract_verified_feedback(connection, run_id, *, include_message_excerpts=False):
    """Verify separate frozen inspectors, bracketed by equal committed facts.

    This is not a global atomic filesystem snapshot. Writers consuming this
    bundle must compare evidence_sha256 again in their owned transaction.
    """
    if type(include_message_excerpts) is not bool:
        raise ValueError("Excerpt permission must be bool")
    with _read_snapshot(connection):
        raw = _evidence(connection, run_id)
    try:
        execution = inspect_run(connection, run_id)
        skill = inspect_skill_trace(connection, run_id)
        planning = inspect_planning_provenance(connection, run_id)
    except (ValueError, KeyError) as error:
        raise AgentIntegrityError("Previous Run provenance failed integrity verification") from None
    if not execution["trace"]["consistent"] or not skill["consistent"] or not planning["consistent"]:
        raise AgentIntegrityError("Previous Run trace or provenance is inconsistent")
    if execution["observations"] or execution["current_state_issues"]:
        raise AgentUnknownOutcome("Previous Run has unresolved execution evidence")
    if len(raw["runs"]) != 1 or len(raw["plan_run_links"]) != 1 or planning["mode"] != "SKILL_PLANNED":
        raise AgentIntegrityError("Feedback requires exact Skill-bound planning provenance")
    run = raw["runs"][0]
    if run["status"] not in ("FAILED", "COMPLETED") or run["ended_at"] is None:
        raise AgentUnknownOutcome("Previous Run is not normally terminal")
    events = raw["events"]
    if not events or events[-1]["event_type"] != ("RUN_FAILED" if run["status"] == "FAILED" else "RUN_COMPLETED"):
        raise AgentIntegrityError("Previous Run lacks a matching normal terminal event")
    terminal = events[-1]
    payload = _strict_json(terminal["payload_json"], MAX_RESPONSE_BYTES)
    results, planned, validations = [], [], []
    for event in events:
        if event["event_type"] == "STEP_PLANNED":
            planned.append(event)
        if event["event_type"] in ("VALIDATION_PASSED", "VALIDATION_FAILED"):
            validations.append(event)
        if event["event_type"] != "TOOL_RESULT":
            continue
        value = _strict_json(event["payload_json"], MAX_RESPONSE_BYTES)
        confirmed = [e for e in events if e["tool_call_id"] == event["tool_call_id"] and e["event_type"] == "STEP_CONFIRMED"]
        if (value["status"] not in ("SUCCESS", "FAILED", "TIMEOUT") or len(confirmed) != 1
                or not event["seq"] < confirmed[0]["seq"] < terminal["seq"]):
            raise AgentIntegrityError("Feedback requires exactly one confirmed known ToolResult per invocation")
        results.append({"step_id": event["step_id"], "tool_call_id": event["tool_call_id"],
            "tool_name": value["tool_name"], "status": value["status"], "event_id": event["event_id"],
            "seq": event["seq"], **_message(value["message"], include_message_excerpts)})
    if not 1 <= len(results) == len(planned) <= MAX_FEEDBACK_RESULTS or len(raw["skill_invocation_bindings"]) != len(results):
        raise AgentIntegrityError("Previous Runner invocations are not evidence-complete")
    validation, failure = None, payload.get("reason")
    if failure == "TOOL_REPORTED_FAILURE":
        last = results[-1]
        expected = {"reason": failure, "step_id": last["step_id"], "tool_call_id": last["tool_call_id"], "tool_status": last["status"]}
        if (run["status"] != "FAILED" or payload != expected or validations or last["status"] == "SUCCESS"
                or terminal["step_id"] != last["step_id"] or terminal["tool_call_id"] != last["tool_call_id"]
                or any(r["status"] != "SUCCESS" for r in results[:-1])):
            raise AgentIntegrityError("Terminal Tool failure disagrees with confirmed results")
    else:
        if len(validations) != 1 or any(r["status"] != "SUCCESS" for r in results) or any(s["tool_result_seq"] is None for s in planning["steps"]):
            raise AgentIntegrityError("Acceptance requires the complete successful Plan prefix")
        event = validations[0]
        value = _strict_json(event["payload_json"], MAX_RESPONSE_BYTES)
        passed = run["status"] == "COMPLETED"
        expected = {"validation_event_id": event["event_id"]}
        if not passed:
            expected["reason"] = "VALIDATION_FAILED"
        if (payload != expected or value["passed"] is not passed
                or event["event_type"] != ("VALIDATION_PASSED" if passed else "VALIDATION_FAILED")
                or not results[-1]["seq"] < event["seq"] < terminal["seq"]):
            raise AgentIntegrityError("Terminal Acceptance reference disagrees with recorded validation")
        validation = {"event_id": event["event_id"], "seq": event["seq"], "passed": passed,
                      **_message(value["message"], include_message_excerpts)}
        failure = None if passed else "VALIDATION_FAILED"
    with _read_snapshot(connection):
        if _evidence(connection, run_id) != raw:
            raise AgentIntegrityError("Previous Run evidence changed during feedback inspection")
    proposal = planning["proposal"]
    feedback = {"schema_version": 1, "previous_run_id": run_id,
        "previous_proposal_id": proposal["proposal_id"], "previous_plan_sha256": proposal["plan_sha256"],
        "run_status": run["status"], "evidence_complete": True, "failure_kind": failure,
        "evidence_sha256": _sha(raw), "terminal_event_id": terminal["event_id"], "terminal_seq": terminal["seq"],
        "tool_results": results, "validation": validation}
    if len(canonical_json_bytes(feedback)) > MAX_FEEDBACK_BYTES:
        raise AgentIntegrityError("Verified feedback exceeds byte limit")
    return feedback

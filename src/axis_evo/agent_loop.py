"""Bounded independent planning attempts, each requiring caller digest approval."""

from pathlib import Path
import sqlite3
from uuid import uuid4

from .agent_feedback import (AgentIntegrityError, AgentUnknownOutcome, _evidence, _sha,
    extract_verified_feedback, validate_feedback_context)
from .agent_episode_storage import (AgentEpisode, create_agent_episode, _guard_schema,
    _load_episode, _pinned_inputs, _absolute_directory, seed_manifest)
from .events import utc_now
from .hashing import canonical_json_bytes
from .planning_adapter import PlanningResponse, _strict_json, _text, MAX_REQUEST_BYTES
from .planning_provenance import _load, _record_proposal
from .skill_binding import _read_snapshot, _rows
from .skill_planner import _build_request, _trusted_catalog, _validated_plan, execute_approved_skill_plan
from .skill_storage import _check_write_context, _insert_one, _skill_transaction


def _history(connection, episode_id):
    result = {}
    for table, order in (("agent_episodes", "episode_id"), ("agent_attempts", "attempt_no"),
                         ("agent_attempt_facts", "attempt_no"), ("agent_dispatches", "attempt_no")):
        result[table] = [dict(row) for row in _rows(connection,
            f"SELECT * FROM main.{table} WHERE episode_id=? ORDER BY {order}", (episode_id,))]
    result["proposals"] = [dict(row) for row in _rows(connection,
        "SELECT p.* FROM main.plan_proposals p JOIN main.agent_attempt_facts f USING(proposal_id) "
        "WHERE f.episode_id=? ORDER BY f.attempt_no", (episode_id,))]
    result["execution"] = {d["reserved_run_id"]: _evidence(connection, d["reserved_run_id"])
        for d in result["agent_dispatches"]}
    return result


def _workspace(episode, number):
    root = _absolute_directory(episode.workspace_root)
    # Episode IDs are stored identity data, never path segments supplied by a model.
    # Hashing permits arbitrary valid IDs without traversal or platform aliases.
    parent = root / ("episode_" + _sha(episode.episode_id)[:32])
    if parent.exists() or parent.is_symlink():
        if _absolute_directory(parent) != parent or not parent.is_relative_to(root):
            raise AgentIntegrityError("Episode workspace parent is redirected")
    path = parent / f"attempt_{number:03d}"
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        raise AgentIntegrityError("Attempt workspace is redirected")
    return path


def _inspect(connection, episode_id):
    with _read_snapshot(connection):
        _guard_schema(connection)
        episode = _load_episode(connection, episode_id)
        history = _history(connection, episode_id)
        attempts, facts, dispatches = (history[t] for t in
            ("agent_attempts", "agent_attempt_facts", "agent_dispatches"))
        report = {"schema_version": 1, "episode_id": episode_id, "state": "EPISODE_CREATED",
            "attempt_count": len(attempts), "max_attempts": episode.max_attempts,
            "attempts": [], "integrity_issues": [], "evidence_verified": True}
        if len(attempts) > episode.max_attempts or [a["attempt_no"] for a in attempts] != list(range(1, len(attempts) + 1)):
            raise AgentIntegrityError("Attempt allocation sequence or budget is corrupt")
        if any(r["attempt_no"] > len(attempts) for r in facts + dispatches):
            raise AgentIntegrityError("Orphan attempt outcome or dispatch")
        for row in attempts + facts + dispatches:
            if type(row["attempt_no"]) is not int:
                raise AgentIntegrityError("Attempt number must be an exact integer")
            for key, value in row.items():
                if key != "attempt_no" and value is not None:
                    _text(value)
        seen_plans = set()
        for n, attempt in enumerate(attempts, 1):
            context = validate_feedback_context(_strict_json(attempt["feedback_json"], 16384))
            if (canonical_json_bytes(context).decode() != attempt["feedback_json"]
                    or _sha(context) != attempt["feedback_sha256"] or context["episode_id"] != episode_id
                    or context["attempt_no"] != n or context["previous_run_id"] != attempt["previous_run_id"]):
                raise AgentIntegrityError("Attempt feedback identity or digest mismatch")
            previous = dispatches[n-2] if n > 1 and len(dispatches) >= n-1 else None
            if n > 1 and (previous is None or previous["attempt_no"] != n-1 or previous["reserved_run_id"] != attempt["previous_run_id"]):
                raise AgentIntegrityError("Attempt previous Run is not the previous dispatch")
            selected = [f for f in facts if f["attempt_no"] == n]
            reserved = [d for d in dispatches if d["attempt_no"] == n]
            if len(selected) > 1 or len(reserved) > 1:
                raise AgentIntegrityError("Duplicate attempt outcome or dispatch")
            fact, dispatch = selected[0] if selected else None, reserved[0] if reserved else None
            item = {"attempt_no": n, "proposal_id": fact["proposal_id"] if fact else None,
                "kind": fact["kind"] if fact else None, "feedback_sha256": attempt["feedback_sha256"],
                "previous_run_id": attempt["previous_run_id"], "dispatch": None, "run_status": None}
            report["attempts"].append(item)
            if fact is None:
                if n != len(attempts) or dispatch:
                    raise AgentIntegrityError("Unrecorded planning outcome has later facts")
                report["state"] = "HALTED_UNKNOWN"
                continue
            if fact["kind"] == "PLANNING_FAILED":
                if fact["proposal_id"] is not None or not fact["error_category"] or dispatch or n != len(attempts):
                    raise AgentIntegrityError("Invalid planning failure prefix")
                report["state"] = "PLANNING_FAILED"
                continue
            if fact["kind"] not in ("PROPOSAL_RECORDED", "STALLED") or fact["error_category"] is not None:
                raise AgentIntegrityError("Invalid attempt outcome")
            proposal = _load(connection, fact["proposal_id"])
            request = _strict_json(proposal.request_json, MAX_REQUEST_BYTES)
            if (request.get("request_schema_version") != 2 or request.get("agent_feedback") != context
                    or proposal.skill_ref != episode.skill_ref or proposal.card_sha256 != episode.card_sha256
                    or proposal.task_spec_sha256 != episode.task_spec_sha256
                    or proposal.adapter_name != episode.adapter_name or proposal.model_id != episode.model_id):
                raise AgentIntegrityError("Attempt proposal differs from pinned Episode/context")
            repeated = proposal.plan_sha256 in seen_plans
            if (fact["kind"] == "STALLED") != repeated:
                raise AgentIntegrityError("Repeated Plan evidence disagrees with attempt outcome")
            seen_plans.add(proposal.plan_sha256)
            if fact["kind"] == "STALLED":
                if dispatch or n != len(attempts):
                    raise AgentIntegrityError("Stalled attempt cannot dispatch or continue")
                report["state"] = "STALLED"
                continue
            if dispatch is None:
                if n != len(attempts):
                    raise AgentIntegrityError("Unapproved attempt has later allocation")
                report["state"] = "AWAITING_APPROVAL"
                continue
            if (dispatch["proposal_id"] != proposal.proposal_id or dispatch["approved_plan_sha256"] != proposal.plan_sha256
                    or str(_workspace(episode, n)) != dispatch["workspace_path"]):
                raise AgentIntegrityError("Dispatch approval or workspace identity mismatch")
            item["dispatch"] = {**dispatch, "run_id": dispatch["reserved_run_id"]}
            raw = history["execution"][dispatch["reserved_run_id"]]
            if not raw["runs"]:
                if raw["events"] or raw["plan_run_links"] or n != len(attempts):
                    raise AgentIntegrityError("Dispatch without Run has contradictory facts")
                report["state"] = "HALTED_UNKNOWN"
                continue
            run = raw["runs"][0]
            item["run_status"] = run["status"]
            if (len(raw["runs"]) != 1 or run["workspace_path"] != dispatch["workspace_path"]
                    or run["task_spec_sha256"] != episode.task_spec_sha256 or run["model_plugin"] != episode.adapter_name):
                raise AgentIntegrityError("Reserved Run identity differs from Episode")
            if raw["plan_run_links"]:
                link = raw["plan_run_links"][0]
                if len(raw["plan_run_links"]) != 1 or link["proposal_id"] != proposal.proposal_id or link["approved_plan_sha256"] != proposal.plan_sha256:
                    raise AgentIntegrityError("Run planning link differs from dispatch")
            elif raw["events"] or run["status"] != "RUNNING" or run["ended_at"] is not None:
                raise AgentIntegrityError("Run has execution evidence before proposal linkage")
    # Frozen inspectors own their snapshots. They cannot be called in the read
    # transaction above. A before/after comparison and final writer recheck
    # protect against using stale facts, without claiming a global snapshot.
    feedback_by_run = {}
    for item in report["attempts"]:
        if item["run_status"] is None:
            continue
        run_id = item["dispatch"]["reserved_run_id"]
        try:
            feedback = extract_verified_feedback(connection, run_id,
                include_message_excerpts=bool(episode.include_message_excerpts))
        except AgentUnknownOutcome:
            if item["attempt_no"] != len(attempts):
                raise AgentIntegrityError("An unresolved attempt has a successor") from None
            report["state"] = "HALTED_UNKNOWN"
            continue
        feedback_by_run[run_id] = feedback
        if item["attempt_no"] == len(attempts):
            report["state"] = ("SUCCEEDED" if feedback["run_status"] == "COMPLETED" else
                "BUDGET_EXHAUSTED" if len(attempts) == episode.max_attempts else "FAILED_FEEDBACK_AVAILABLE")
        if feedback["run_status"] == "COMPLETED" and item["attempt_no"] != len(attempts):
            raise AgentIntegrityError("Completed Episode has later attempts")
    for attempt in attempts:
        if attempt["previous_run_id"] is not None:
            prior = feedback_by_run.get(attempt["previous_run_id"])
            if prior is None or prior["run_status"] != "FAILED" or _strict_json(attempt["feedback_json"], 16384)["prior_evidence"] != prior:
                raise AgentIntegrityError("Persisted feedback differs from verified previous Run")
    with _read_snapshot(connection):
        _guard_schema(connection)
        _load_episode(connection, episode_id)
        if _history(connection, episode_id) != history:
            raise AgentIntegrityError("Episode evidence changed during inspection")
    return episode, report, history, feedback_by_run


def inspect_agent_episode(connection, episode_id):
    """Read-only evidence report. No migrations, model requests or repairs."""
    _text(episode_id)
    if connection.in_transaction:
        raise ValueError("Episode inspection rejects an active caller transaction")
    try:
        return _inspect(connection, episode_id)[1]
    except (AgentIntegrityError, ValueError, sqlite3.Error, OSError) as error:
        report = {"schema_version": 1, "episode_id": episode_id, "state": "HALTED_INTEGRITY",
            "attempt_count": None, "max_attempts": None, "attempts": [],
            "evidence_verified": False,
            "integrity_issues": [{"code": "EPISODE_INTEGRITY", "message": "Episode evidence cannot be verified", "category": type(error).__name__}]}
        # Counts and stored identities remain useful audit observations even
        # when their semantic relationship cannot be verified. Label them as
        # unverified and never use this fallback report for dispatch authority.
        try:
            with _read_snapshot(connection):
                _guard_schema(connection)
                history = _history(connection, episode_id)
                report["attempt_count"] = len(history["agent_attempts"])
                if len(history["agent_episodes"]) == 1:
                    report["max_attempts"] = history["agent_episodes"][0]["max_attempts"]
                for a in history["agent_attempts"]:
                    fact = next((f for f in history["agent_attempt_facts"] if f["attempt_no"] == a["attempt_no"]), None)
                    d = next((d for d in history["agent_dispatches"] if d["attempt_no"] == a["attempt_no"]), None)
                    runs = history["execution"][d["reserved_run_id"]]["runs"] if d else []
                    report["attempts"].append({"attempt_no": a["attempt_no"],
                        "proposal_id": fact["proposal_id"] if fact else None, "kind": fact["kind"] if fact else None,
                        "feedback_sha256": a["feedback_sha256"], "previous_run_id": a["previous_run_id"],
                        "dispatch": {**d, "run_id": d["reserved_run_id"]} if d else None,
                        "run_status": runs[0]["status"] if len(runs) == 1 else None})
        except (ValueError, KeyError, sqlite3.Error):
            pass
        return _json_safe(report)


def _json_safe(value):
    """Malformed stored scalars stay explicitly unverified, never coerced."""
    if type(value) is dict:
        return {key: _json_safe(item) for key, item in value.items()}
    if type(value) is list:
        return [_json_safe(item) for item in value]
    if type(value) is str:
        try:
            return _text(value, nonempty=False)
        except ValueError:
            return None
    if type(value) in (int, bool, type(None)):
        return value
    return None


def _recheck(connection, episode, history, task_spec_path):
    _guard_schema(connection)
    current = _load_episode(connection, episode.episode_id)
    if current != episode or _history(connection, episode.episode_id) != history:
        raise AgentIntegrityError("Episode facts changed before owned write")
    return _pinned_inputs(connection, episode, task_spec_path)


def _record_outcome(connection, episode, history, task_path, number, kind, proposal_id=None, category=None):
    with _skill_transaction(connection):
        _recheck(connection, episode, history, task_path)
        _insert_one(connection, "INSERT INTO main.agent_attempt_facts VALUES (?,?,?,?,?,?)",
            (episode.episode_id, number, kind, proposal_id, category, utc_now()))


def propose_next_attempt(connection, episode_id, task_spec_path, tool_registry, model_adapter):
    """Durably allocate a bounded model call; never approves or executes tools."""
    _check_write_context(connection)
    episode, report, history, feedbacks = _inspect(connection, episode_id)
    if report["state"] not in ("EPISODE_CREATED", "FAILED_FEEDBACK_AVAILABLE"):
        raise ValueError("Episode cannot propose in state " + report["state"])
    if model_adapter.adapter_name != episode.adapter_name or model_adapter.model_id != episode.model_id:
        raise AgentIntegrityError("Adapter identity differs from pinned Episode")
    number = len(history["agent_attempts"]) + 1
    previous = history["agent_dispatches"][-1]["reserved_run_id"] if number > 1 else None
    context = validate_feedback_context({"schema_version": 1, "episode_id": episode_id,
        "attempt_no": number, "previous_run_id": previous, "prior_evidence": feedbacks.get(previous)})
    feedback_json = canonical_json_bytes(context).decode()
    with _skill_transaction(connection):
        task, card = _recheck(connection, episode, history, task_spec_path)
        catalog = _trusted_catalog(card, tool_registry)
        request = _build_request(task, card, catalog, episode.adapter_name, episode.model_id, agent_feedback=context)
        _insert_one(connection, "INSERT INTO main.agent_attempts VALUES (?,?,?,?,?,?)",
            (episode_id, number, previous, feedback_json, _sha(context), utc_now()))
    with _read_snapshot(connection):
        allocated = _history(connection, episode_id)
    # This call has no open database transaction and receives only immutable text.
    try:
        response = model_adapter.plan(request)
        if (type(response) is not PlanningResponse or response.adapter_name != episode.adapter_name
                or response.model_id != episode.model_id):
            raise ValueError("Adapter response identity differs from Episode")
        plan_json, _ = _validated_plan(response.response_text, catalog, tool_registry)
        with _read_snapshot(connection):
            _recheck(connection, episode, allocated, task_spec_path)
        proposal = _record_proposal(connection, episode.skill_ref, episode.adapter_name,
            episode.model_id, request, response.response_text, plan_json)
    except Exception as error:
        # Fixed categories only: exceptions may carry provider/task secrets.
        category = "TRANSPORT" if type(error).__name__ == "PlanningTransportError" else "PLANNING_REJECTED"
        _record_outcome(connection, episode, allocated, task_spec_path, number, "PLANNING_FAILED", category=category)
        raise
    repeated = any(p["plan_sha256"] == proposal.plan_sha256 for p in allocated["proposals"])
    _record_outcome(connection, episode, allocated, task_spec_path, number,
        "STALLED" if repeated else "PROPOSAL_RECORDED", proposal.proposal_id)
    return proposal


class _ApprovedDispatchRegistry:
    """Ephemeral one-call capability, minted only after a new dispatch COMMIT.

    SQLite is the budget/reservation authority. This non-durable permit keeps a
    reserved-but-crashed dispatch from being replayed via the legacy API. It is
    a trusted local Python boundary, not authentication against hostile Python.
    """
    def __init__(self, delegate, episode, attempt, dispatch):
        self.delegate = delegate
        self.episode = episode
        self.attempt = attempt
        self.dispatch = dispatch
        self.stage = "reserved"

    def get(self, name):
        return self.delegate.get(name)


def _guard_agent_execution(connection, proposal, registry, phase, *, run=None):
    if type(registry) is not _ApprovedDispatchRegistry:
        raise AgentIntegrityError("Agent v2 proposal requires a fresh explicit Episode dispatch")
    _guard_schema(connection)
    episode = _load_episode(connection, registry.episode.episode_id)
    if episode != registry.episode:
        raise AgentIntegrityError("Dispatch Episode changed")
    attempt, dispatch = registry.attempt, registry.dispatch
    actual = _rows(connection, "SELECT * FROM main.agent_dispatches WHERE episode_id=? AND attempt_no=?",
        (episode.episode_id, attempt["attempt_no"]))
    allocations = _rows(connection, "SELECT * FROM main.agent_attempts WHERE episode_id=? AND attempt_no=?",
        (episode.episode_id, attempt["attempt_no"]))
    facts = _rows(connection, "SELECT * FROM main.agent_attempt_facts WHERE episode_id=? AND attempt_no=?",
        (episode.episode_id, attempt["attempt_no"]))
    if (len(actual) != 1 or dict(actual[0]) != dispatch or len(allocations) != 1 or dict(allocations[0]) != attempt
            or len(facts) != 1 or facts[0]["kind"] != "PROPOSAL_RECORDED" or facts[0]["proposal_id"] != proposal.proposal_id
            or dispatch["proposal_id"] != proposal.proposal_id or dispatch["approved_plan_sha256"] != proposal.plan_sha256):
        raise AgentIntegrityError("Dispatch does not authorize this exact proposal")
    context = validate_feedback_context(_strict_json(attempt["feedback_json"], 16384))
    if _strict_json(proposal.request_json, MAX_REQUEST_BYTES)["agent_feedback"] != context or _sha(context) != attempt["feedback_sha256"]:
        raise AgentIntegrityError("Dispatch feedback identity changed")
    if context["previous_run_id"] is not None and _sha(_evidence(connection, context["previous_run_id"])) != context["prior_evidence"]["evidence_sha256"]:
        raise AgentIntegrityError("Previous execution evidence changed before dispatch")
    _pinned_inputs(connection, episode, episode.task_spec_path)
    if phase == "preflight":
        if registry.stage != "reserved" or _rows(connection, "SELECT 1 FROM main.runs WHERE run_id=?", (dispatch["reserved_run_id"],)):
            raise AgentIntegrityError("Dispatch permit already used")
        if _workspace(episode, attempt["attempt_no"]).exists():
            raise AgentIntegrityError("Fresh attempt workspace already exists")
        registry.stage = "preflighted"
    elif phase == "link":
        if (registry.stage != "preflighted" or run is None or run["run_id"] != dispatch["reserved_run_id"]
                or run["workspace_path"] != dispatch["workspace_path"]):
            raise AgentIntegrityError("Run differs from one-use dispatch reservation")
        manifest, digest = seed_manifest(Path(run["workspace_path"]))
        if manifest != episode.seed_manifest_json or digest != episode.seed_sha256:
            raise AgentIntegrityError("Fresh copied workspace differs from pinned seed")
        registry.stage = "linked"
    else:
        raise AgentIntegrityError("Unknown dispatch guard phase")


def execute_approved_attempt(connection, episode_id, proposal_id, approved_plan_sha256,
                             task_spec_path, tool_registry):
    """Reserve once after exact approval, then call the unchanged Skill Runner."""
    _check_write_context(connection)
    episode, report, history, _ = _inspect(connection, episode_id)
    if report["state"] != "AWAITING_APPROVAL":
        raise ValueError("Episode cannot dispatch in state " + report["state"])
    number = len(history["agent_attempts"])
    fact = history["agent_attempt_facts"][-1]
    if fact["proposal_id"] != proposal_id:
        raise AgentIntegrityError("Approval is for a different attempt proposal")
    with _skill_transaction(connection):
        _recheck(connection, episode, history, task_spec_path)
        proposal = _load(connection, proposal_id)
        if type(approved_plan_sha256) is not str or approved_plan_sha256 != proposal.plan_sha256:
            raise AgentIntegrityError("Explicit approval must exactly match the persisted Plan digest")
        catalog = _trusted_catalog(_pinned_inputs(connection, episode, task_spec_path)[1], tool_registry)
        if catalog != _strict_json(proposal.request_json, MAX_REQUEST_BYTES)["tool_catalog"]:
            raise AgentIntegrityError("Execution tool catalog differs from proposal")
        _validated_plan(proposal.plan_json, catalog, tool_registry)
        workspace = _workspace(episode, number)
        if workspace.exists():
            raise AgentIntegrityError("Fresh attempt workspace already exists")
        dispatch = {"episode_id": episode_id, "attempt_no": number, "proposal_id": proposal_id,
            "approved_plan_sha256": approved_plan_sha256, "reserved_run_id": "run_" + uuid4().hex,
            "workspace_path": str(workspace), "reserved_at": utc_now()}
        _insert_one(connection, "INSERT INTO main.agent_dispatches (" + ",".join(dispatch)
            + ") VALUES (" + ",".join("?" for _ in dispatch) + ")", tuple(dispatch.values()))
    # A crash or exception from here leaves a durable reservation. A later call
    # refuses it; no token is reconstructed from existing database rows.
    workspace.parent.mkdir(exist_ok=True)
    _absolute_directory(workspace.parent)
    permit = _ApprovedDispatchRegistry(tool_registry, episode, history["agent_attempts"][-1], dispatch)
    return execute_approved_skill_plan(connection, proposal_id, approved_plan_sha256,
        task_spec_path, workspace, permit, run_id=dispatch["reserved_run_id"])

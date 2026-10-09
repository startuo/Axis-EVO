"""Immutable local planning evidence; no execution or recovery inference."""

from dataclasses import dataclass
import hashlib
from importlib.resources import files
import re
import sqlite3
from uuid import uuid4

from .events import utc_now
from .hashing import canonical_json_bytes
from .models import PlanStep
from .planning_adapter import MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, _strict_json, _text
from .skill_binding import _authorized_card, _read_snapshot, _ref, _rows
from .skill_card import SkillRef
from .skill_storage import _check_write_context, _insert_one, _skill_transaction
from .skill_planner import (
    MAX_PLAN_BYTES, _BUILTINS, _build_request, _digest, _task_data, _tool_schema, _validated_plan,
)
from .task_spec import task_spec_from_dict


_TABLES = ("runs", "events", "skills", "skill_versions", "skill_state_events",
           "skill_invocation_bindings", "plan_proposals", "plan_run_links")
_HASH = re.compile(r"[0-9a-f]{64}\Z")


class PlanningIntegrityError(ValueError):
    """Stored planning evidence cannot be verified; it is never repaired."""


@dataclass(frozen=True)
class PlanProposal:
    proposal_id: str
    schema_version: int
    skill_ref: SkillRef
    card_sha256: str
    task_spec_sha256: str
    adapter_name: str
    model_id: str
    request_json: str
    request_sha256: str
    response_text: str
    response_sha256: str
    plan_json: str
    plan_sha256: str
    created_at: str

    @property
    def plan(self):
        """Fresh execution objects: mutable arguments never alias stored evidence."""
        value = _strict_json(self.plan_json, MAX_PLAN_BYTES)
        return tuple(PlanStep(item["step_id"], item["tool_name"], item["arguments"])
                     for item in value["steps"])


def _namespace(connection):
    placeholders = ",".join("?" for _ in _TABLES)
    if _rows(connection, f"""SELECT 1 FROM temp.sqlite_master
            WHERE type IN ('table','view') AND name COLLATE NOCASE IN ({placeholders}) LIMIT 1""", _TABLES):
        raise ValueError("Planning rejects TEMP shadowing of persistent facts")


def _objects(connection, names):
    placeholders = ",".join("?" for _ in names)
    return tuple(tuple(row) for row in _rows(connection, f"""SELECT type,name,tbl_name,sql
        FROM main.sqlite_master WHERE tbl_name COLLATE NOCASE IN ({placeholders})
        AND name NOT LIKE 'sqlite_%' ORDER BY type,name""", tuple(names)))


def _expected():
    migrations = files("axis_evo").joinpath("migrations")
    reference = sqlite3.connect(":memory:")
    try:
        for name in ("001_phase1.sql", "002_phase2_skills.sql", "003_phase2_skill_bindings.sql"):
            reference.executescript(migrations.joinpath(name).read_text(encoding="utf-8"))
        previous = _objects(reference, _TABLES[:6])
        fourth = migrations.joinpath("004_phase2_skill_planning.sql").read_text(encoding="utf-8")
        reference.executescript(fourth)
        return fourth, previous, _objects(reference, _TABLES)
    finally:
        reference.close()


def _require_planning_schema(connection):
    _namespace(connection)
    if _objects(connection, _TABLES) != _expected()[2]:
        raise PlanningIntegrityError("Planning requires exact migrations 001, 002, 003 and 004")


def _read_schema_guard(connection):
    """Compare stored 004 DDL with the trusted resource, without executing DDL.

    SQLite stores CREATE statements with IF NOT EXISTS and the final semicolon
    removed. complete_statement splits this fixed migration including triggers.
    This read path never opens a reference database or applies a migration.
    """
    _namespace(connection)
    source = files("axis_evo").joinpath("migrations", "004_phase2_skill_planning.sql").read_text(encoding="utf-8")
    expected, statement = [], ""
    for line in source.splitlines(keepends=True):
        statement += line
        if not sqlite3.complete_statement(statement):
            continue
        sql = statement.strip().removesuffix(";")
        match = re.match(r"CREATE (TABLE|TRIGGER) IF NOT EXISTS (\w+)", sql)
        if match is None:
            raise PlanningIntegrityError("Unexpected trusted planning migration resource")
        kind, name = match.groups()
        table = name if kind == "TABLE" else re.search(r" ON (\w+)\s+BEGIN", sql)[1]
        normalized = sql.replace("CREATE " + kind + " IF NOT EXISTS", "CREATE " + kind, 1)
        expected.append((kind.lower(), name, table, normalized))
        statement = ""
    if statement.strip() or _objects(connection, _TABLES[6:]) != tuple(sorted(expected, key=lambda row: (row[0], row[1]))):
        raise PlanningIntegrityError("Stored planning schema is missing, weak or unexpected")


def initialize_skill_planning_schema(connection):
    """Explicit atomic migration 004. Never called by a read API or import."""
    _check_write_context(connection)
    _namespace(connection)
    fourth, previous, expected = _expected()
    if _objects(connection, _TABLES[:6]) != previous:
        raise PlanningIntegrityError("Planning initialization requires exact migrations 001, 002 and 003")
    existing = _objects(connection, _TABLES[6:])
    if existing and _objects(connection, _TABLES) != expected:
        raise PlanningIntegrityError("Existing planning schema is weak or unexpected")
    try:
        connection.executescript("BEGIN IMMEDIATE;\n" + fourth)
        if _objects(connection, _TABLES) != expected:
            raise PlanningIntegrityError("Planning schema differs from migration 004")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _verify(connection, row):
    try:
        expected = {"proposal_id", "schema_version", "skill_id", "skill_version", "card_sha256",
                    "task_spec_sha256", "adapter_name", "model_id", "request_json", "request_sha256",
                    "response_text", "response_sha256", "plan_json", "plan_sha256", "created_at"}
        if set(row) != expected or type(row["schema_version"]) is not int or row["schema_version"] != 1:
            raise ValueError("Invalid proposal shape")
        for name in expected - {"schema_version", "skill_version"}:
            _text(row[name], nonempty=name != "response_text")
        for name in ("card_sha256", "task_spec_sha256", "request_sha256", "response_sha256", "plan_sha256"):
            if not _HASH.fullmatch(row[name]):
                raise ValueError("Invalid digest")
        ref = SkillRef(row["skill_id"], row["skill_version"])
        card = _authorized_card(connection, ref, ())
        if hashlib.sha256(card.canonical_bytes()).hexdigest() != row["card_sha256"]:
            raise ValueError("Card hash mismatch")
        request = _strict_json(row["request_json"], MAX_REQUEST_BYTES)
        task = task_spec_from_dict(request["task_spec"])
        if _digest(canonical_json_bytes(_task_data(task)).decode("utf-8")) != row["task_spec_sha256"]:
            raise ValueError("TaskSpec hash mismatch")
        catalog = request["tool_catalog"]
        if type(catalog) is not dict or not catalog or not set(catalog) <= set(_BUILTINS) & set(card.allowed_tools):
            raise ValueError("Invalid tool catalog")
        trusted = {name: _tool_schema(name) for name in catalog}
        if canonical_json_bytes(catalog) != canonical_json_bytes(trusted):
            raise ValueError("Tool schema mismatch")
        feedback = None
        if "request_schema_version" in request:
            if type(request["request_schema_version"]) is not int or request["request_schema_version"] != 2:
                raise ValueError("Unsupported planning request version")
            from .agent_feedback import validate_feedback_context
            feedback = validate_feedback_context(request["agent_feedback"])
        if _build_request(task, card, trusted, row["adapter_name"], row["model_id"], agent_feedback=feedback) != row["request_json"]:
            raise ValueError("Request identity or canonical bytes mismatch")
        for prefix, name in (("request", "request_json"), ("response", "response_text"), ("plan", "plan_json")):
            if _digest(row[name]) != row[prefix + "_sha256"]:
                raise ValueError("Evidence hash mismatch")
        plan_json, _ = _validated_plan(row["response_text"], trusted)
        if plan_json != row["plan_json"]:
            raise ValueError("Response and accepted Plan differ")
        return PlanProposal(row["proposal_id"], 1, ref, row["card_sha256"], row["task_spec_sha256"],
                            row["adapter_name"], row["model_id"], row["request_json"], row["request_sha256"],
                            row["response_text"], row["response_sha256"], row["plan_json"], row["plan_sha256"], row["created_at"])
    except (TypeError, ValueError, KeyError, sqlite3.Error, RecursionError):
        raise PlanningIntegrityError("Stored Plan Proposal failed integrity verification") from None


def _load(connection, proposal_id):
    _text(proposal_id)
    rows = _rows(connection, "SELECT * FROM main.plan_proposals WHERE proposal_id=?", (proposal_id,))
    if not rows:
        raise KeyError(proposal_id)
    if len(rows) != 1:
        raise PlanningIntegrityError("Plan Proposal identity is not unique")
    return _verify(connection, dict(rows[0]))


def get_plan_proposal(connection, proposal_id):
    with _read_snapshot(connection):
        _read_schema_guard(connection)
        return _load(connection, proposal_id)


def _record_proposal(connection, ref, adapter_name, model_id, request_json, response_text, plan_json):
    request = _strict_json(request_json, MAX_REQUEST_BYTES)
    row = {"proposal_id": "proposal_" + uuid4().hex, "schema_version": 1,
           **ref.to_dict(), "card_sha256": request["card_sha256"],
           "task_spec_sha256": hashlib.sha256(canonical_json_bytes(request["task_spec"])).hexdigest(),
           "adapter_name": adapter_name, "model_id": model_id, "request_json": request_json,
           "request_sha256": _digest(request_json), "response_text": response_text,
           "response_sha256": _digest(response_text), "plan_json": plan_json,
           "plan_sha256": _digest(plan_json), "created_at": utc_now()}
    with _skill_transaction(connection):
        _require_planning_schema(connection)
        proposal = _verify(connection, row)
        _insert_one(connection, "INSERT INTO main.plan_proposals (" + ",".join(row)
                    + ") VALUES (" + ",".join("?" for _ in row) + ")", tuple(row.values()))
    return proposal


def _execution_identity(proposal, approval, task_spec, steps, skill_ref, registry):
    if type(approval) is not str or not _HASH.fullmatch(approval) or approval != proposal.plan_sha256:
        raise PlanningIntegrityError("Explicit approval must exactly match the persisted Plan digest")
    if _ref(skill_ref) != proposal.skill_ref:
        raise PlanningIntegrityError("Execution SkillRef differs from proposal")
    if hashlib.sha256(canonical_json_bytes(_task_data(task_spec))).hexdigest() != proposal.task_spec_sha256:
        raise PlanningIntegrityError("Execution TaskSpec differs from proposal")
    candidate = canonical_json_bytes({"schema_version": 1, "steps": [
        {"step_id": s.step_id, "tool_name": s.tool_name, "arguments": s.arguments} for s in steps]}).decode("utf-8")
    catalog = _strict_json(proposal.request_json, MAX_REQUEST_BYTES)["tool_catalog"]
    canonical, _ = _validated_plan(candidate, catalog, registry)
    if canonical != proposal.plan_json:
        raise PlanningIntegrityError("Execution Plan differs from proposal")


def preflight_plan_proposal(connection, proposal_id, approval, task_spec, steps, skill_ref, registry):
    _check_write_context(connection)
    with _read_snapshot(connection):
        _require_planning_schema(connection)
        proposal = _load(connection, proposal_id)
        _execution_identity(proposal, approval, task_spec, steps, skill_ref, registry)
        if "request_schema_version" in _strict_json(proposal.request_json, MAX_REQUEST_BYTES):
            from .agent_loop import _guard_agent_execution
            _guard_agent_execution(connection, proposal, registry, "preflight")
        if _rows(connection, "SELECT 1 FROM main.plan_run_links WHERE proposal_id=?", (proposal_id,)):
            raise PlanningIntegrityError("Plan Proposal already consumed by a Run")


def record_plan_run_link(connection, run_id, proposal_id, approval, steps, skill_ref, registry):
    """Commit attribution after create_run and before any Run execution events."""
    with _skill_transaction(connection):
        _require_planning_schema(connection)
        proposal = _load(connection, proposal_id)
        runs = _rows(connection, "SELECT * FROM main.runs WHERE run_id=?", (run_id,))
        if len(runs) != 1 or runs[0]["status"] != "RUNNING" or runs[0]["ended_at"] is not None:
            raise PlanningIntegrityError("Planning association requires a RUNNING Run")
        run = runs[0]
        task = task_spec_from_dict(_strict_json(run["task_spec_json"], MAX_REQUEST_BYTES))
        _execution_identity(proposal, approval, task, steps, skill_ref, registry)
        if "request_schema_version" in _strict_json(proposal.request_json, MAX_REQUEST_BYTES):
            from .agent_loop import _guard_agent_execution
            _guard_agent_execution(connection, proposal, registry, "link", run=run)
        if run["task_spec_sha256"] != proposal.task_spec_sha256 or run["task_id"] != task.task_id:
            raise PlanningIntegrityError("Run TaskSpec identity differs from proposal")
        if _rows(connection, "SELECT 1 FROM main.events WHERE run_id=? LIMIT 1", (run_id,)):
            raise PlanningIntegrityError("Planning association must precede all Run events")
        row = {"run_id": run_id, "proposal_id": proposal_id, "approved_plan_sha256": approval, "linked_at": utc_now()}
        _insert_one(connection, """INSERT INTO main.plan_run_links
            (run_id,proposal_id,approved_plan_sha256,linked_at) VALUES (?,?,?,?)""", tuple(row.values()))
    return row


def inspect_planning_provenance(connection, run_id):
    """One committed read snapshot. Presence is evidence, never tool causality."""
    _text(run_id)
    with _read_snapshot(connection):
        _namespace(connection)
        runs = _rows(connection, "SELECT * FROM main.runs WHERE run_id=?", (run_id,))
        if len(runs) != 1:
            raise KeyError(run_id)
        result = {"schema_version": 1, "run_id": run_id, "mode": "LEGACY_UNPLANNED",
                  "consistent": True, "integrity_issues": [], "proposal": None, "steps": []}
        available = _rows(connection, "SELECT 1 FROM main.sqlite_master WHERE type='table' AND name COLLATE NOCASE='plan_run_links'")
        if not available:
            if _objects(connection, _TABLES[6:]):
                raise PlanningIntegrityError("Incomplete planning schema")
            return result
        _read_schema_guard(connection)
        links = _rows(connection, "SELECT * FROM main.plan_run_links WHERE run_id=?", (run_id,))
        if not links:
            return result
        if len(links) != 1:
            raise PlanningIntegrityError("Run has multiple planning associations")
        link = dict(links[0])
        if set(link) != {"run_id", "proposal_id", "approved_plan_sha256", "linked_at"}:
            raise PlanningIntegrityError("Invalid Run association shape")
        try:
            for value in link.values():
                _text(value)
            if not _HASH.fullmatch(link["approved_plan_sha256"]):
                raise ValueError("Invalid approved digest")
        except (ValueError, TypeError):
            raise PlanningIntegrityError("Malformed Run association identity or digest") from None
        proposal = _load(connection, link["proposal_id"])
        result["mode"] = "SKILL_PLANNED"

        def issue(message):
            result["integrity_issues"].append({"code": "PLAN_EXECUTION_MISMATCH", "message": message})

        if (link["run_id"] != run_id or link["approved_plan_sha256"] != proposal.plan_sha256
                or len(_rows(connection, "SELECT run_id FROM main.plan_run_links WHERE proposal_id=?", (proposal.proposal_id,))) != 1):
            issue("Run association or approved digest disagrees with proposal")
        _text(link["linked_at"])
        run = runs[0]
        task = task_spec_from_dict(_strict_json(run["task_spec_json"], MAX_REQUEST_BYTES))
        if (run["task_spec_sha256"] != proposal.task_spec_sha256 or task.task_id != run["task_id"]
                or hashlib.sha256(canonical_json_bytes(_task_data(task))).hexdigest() != proposal.task_spec_sha256):
            issue("Run TaskSpec does not match proposal")
        result["proposal"] = {
            "proposal_id": proposal.proposal_id, "stored_skill_ref": proposal.skill_ref.to_dict(),
            "verified_skill_ref": proposal.skill_ref.to_dict(), "card_sha256": proposal.card_sha256,
            "task_spec_sha256": proposal.task_spec_sha256, "adapter_name": proposal.adapter_name,
            "model_id": proposal.model_id, "request_sha256": proposal.request_sha256,
            "response_sha256": proposal.response_sha256, "plan_sha256": proposal.plan_sha256,
            "approved_plan_sha256": link["approved_plan_sha256"], "linked_run_id": link["run_id"],
            "proposal_recorded": True, "plan_approved": link["approved_plan_sha256"] == proposal.plan_sha256,
            "run_linked": True}
        planned = proposal.plan
        bindings = _rows(connection, "SELECT * FROM main.skill_invocation_bindings WHERE run_id=?", (run_id,))
        events = _rows(connection, "SELECT * FROM main.events WHERE run_id=? ORDER BY seq", (run_id,))
        by_step = {s.step_id: i for i, s in enumerate(planned)}
        by_call, bound_steps = {}, set()
        for step in planned:
            result["steps"].append({"step_id": step.step_id, "tool_name": step.tool_name,
                "arguments_sha256": hashlib.sha256(canonical_json_bytes(step.arguments)).hexdigest(),
                "binding_persisted": False, "tool_call_id": None, "step_planned_seq": None,
                "tool_intent_seq": None, "tool_result_seq": None})
        for binding in bindings:
            index = by_step.get(binding["step_id"])
            call = binding["tool_call_id"]
            if index is None or call in by_call or binding["step_id"] in bound_steps:
                issue("Skill binding step/invocation is absent from Plan or duplicated")
                continue
            _text(call)
            item = result["steps"][index]
            if (binding["skill_id"] != proposal.skill_ref.skill_id
                    or type(binding["skill_version"]) is not int or binding["skill_version"] != proposal.skill_ref.skill_version
                    or binding["card_sha256"] != proposal.card_sha256 or binding["bound_state"] != "TRUSTED"
                    or binding["arguments_sha256"] != item["arguments_sha256"] or binding["tool_name"] != item["tool_name"]):
                issue("Invocation binding differs from exact approved Skill/Plan")
            item.update(binding_persisted=True, tool_call_id=call)
            by_call[call] = index
            bound_steps.add(binding["step_id"])
        planned_count = 0
        for position, event in enumerate(events, 1):
            if type(event["seq"]) is not int:
                raise PlanningIntegrityError("Event seq must be an integer")
            if (event["seq"] != position
                    or type(event["schema_version"]) is not int or event["schema_version"] != 1
                    or event["task_id"] != run["task_id"]):
                issue("Event envelope or sequence differs from Run")
            kind = event["event_type"]
            if kind not in ("STEP_PLANNED", "TOOL_INTENT", "TOOL_RESULT"):
                continue
            index = by_call.get(event["tool_call_id"])
            if index is None:
                issue("Invocation event lacks an approved Plan Skill binding")
                continue
            item, step = result["steps"][index], planned[index]
            if event["step_id"] != step.step_id:
                issue("Invocation event step identity differs from approved Plan")
            payload = _strict_json(event["payload_json"], MAX_RESPONSE_BYTES)
            if type(payload) is not dict:
                raise PlanningIntegrityError("Invocation payload must be a JSON object")
            key = {"STEP_PLANNED": "step_planned_seq", "TOOL_INTENT": "tool_intent_seq", "TOOL_RESULT": "tool_result_seq"}[kind]
            if item[key] is not None:
                issue("Invocation contains duplicate " + kind)
            else:
                item[key] = event["seq"]
            if kind == "STEP_PLANNED":
                if index != planned_count or payload.keys() != {"tool_name", "arguments"}:
                    issue("STEP_PLANNED is not an ordered approved Plan prefix")
                planned_count += 1
            if kind in ("STEP_PLANNED", "TOOL_INTENT"):
                if (payload.get("tool_name") != step.tool_name
                        or canonical_json_bytes(payload.get("arguments")) != canonical_json_bytes(step.arguments)):
                    issue("Persisted invocation arguments differ from approved Plan")
            if kind == "TOOL_RESULT" and payload.get("tool_name") != step.tool_name:
                issue("TOOL_RESULT tool differs from approved Plan")
        for index, item in enumerate(result["steps"]):
            before = None
            for key in ("step_planned_seq", "tool_intent_seq", "tool_result_seq"):
                seq = item[key]
                if seq is not None and key != "step_planned_seq" and (before is None or seq <= before):
                    issue("Invocation evidence order disagrees with Runner")
                before = seq
            if item["binding_persisted"] and index > planned_count:
                issue("Invocation binding lies beyond the legal execution prefix")
        result["consistent"] = not result["integrity_issues"]
        return result

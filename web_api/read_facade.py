"""Bounded projections of real Core facts, with no execution authority.

Each request copies committed SQLite pages into an ephemeral memory database.
Core read APIs own their normal snapshots on that fixed copy. Live filesystem
inspection is deliberately unavailable: a browser read must not follow paths
embedded in a database or acquire an unbounded current file through Core.
"""

from contextlib import contextmanager
import hashlib
import math
from pathlib import Path, PureWindowsPath
import re
import sqlite3
import time

from axis_evo.checkpoint_manager import list_checkpoints, verify_checkpoint
from axis_evo.hashing import canonical_json_bytes
from axis_evo.inspector import inspect_run
from axis_evo.planning_provenance import get_plan_proposal, inspect_planning_provenance
from axis_evo.skill_card import SkillRef
from axis_evo.skill_evolution import inspect_skill_evolution
from axis_evo.skill_evolution_activation import resolve_preferred_skill
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_trust import inspect_skill_trust

from .schemas import (
    ApiError, WorkbenchConfig, MAX_DATABASE_BYTES, MAX_DATABASE_ROWS,
    MAX_EVENTS_PER_RUN, MAX_LIST_ITEMS, MAX_EVENT_ITEMS, QUERY_TIMEOUT_SECONDS,
    SNAPSHOT_TIMEOUT_SECONDS, identifier, no_redirected_parents, public_text,
    public_identity, strict_json,
)


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_TABLE = re.compile(r"[A-Za-z][A-Za-z0-9_]*\Z")
_RUN_COLUMNS = {"run_id", "task_id", "status", "task_spec_json", "task_spec_sha256",
                "workspace_path", "model_plugin", "started_at", "ended_at"}
_EVENT_COLUMNS = {"event_pk", "event_id", "schema_version", "run_id", "task_id", "seq",
                  "event_type", "step_id", "tool_call_id", "occurred_at", "payload_json"}
_TOOLS = {"read_file", "write_file", "patch_file", "run_tests"}
_RESULTS = {"SUCCESS", "FAILED", "TIMEOUT"}
_STATUSES = {"RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"}
_EVENT_TYPES = {"RUN_STARTED", "TASK_LOADED", "STEP_PLANNED", "TOOL_INTENT", "TOOL_RESULT",
                "FILE_OBSERVED", "VALIDATION_STARTED", "VALIDATION_PASSED", "VALIDATION_FAILED",
                "STEP_CONFIRMED", "RUN_COMPLETED", "RUN_FAILED", "RUN_INTERRUPTED"}
_BLOCKED_NAMES = {".env", ".git", ".ssh", ".aws", "credentials", "id_rsa", "id_ed25519"}


def _hash(value):
    return value if type(value) is str and _HASH.fullmatch(value) else None


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def _ref(value):
    if type(value) is not dict:
        return None
    try:
        ref = SkillRef(value["skill_id"], value["skill_version"])
        return {"skill_id": public_identity(ref.skill_id), "skill_version": ref.skill_version}
    except (ValueError, TypeError, KeyError):
        return None


def _path(value):
    """A safe display label only; this function never opens a path."""
    if type(value) is not str or len(value) > 512:
        return None
    windows = PureWindowsPath(value)
    pieces = value.replace("\\", "/").split("/")
    if (windows.drive or windows.root or ":" in value or "\x00" in value
            or any(p in ("", ".", "..") or p.casefold() in _BLOCKED_NAMES
                   or p.casefold().startswith(".env.") for p in pieces)):
        return None
    return public_text(value, 512)


def _issue_codes(values):
    result = []
    for issue in (values if type(values) is list else [])[:100]:
        code = issue.get("code") if type(issue) is dict else "CORE_INTEGRITY"
        if type(code) is not str or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code):
            code = "CORE_INTEGRITY"
        result.append({"code": code, "message": "Core reported an integrity issue."})
    return result


def _unsupported(code="LIVE_FILESYSTEM_INSPECTION_DISABLED"):
    return {"status": "UNSUPPORTED", "observations": [], "traceConsistent": None,
            "issues": [{"code": code, "message": "This evidence is unavailable through the read-only Web boundary."}],
            "pendingInvocations": []}


def _table_exists(connection, table):
    return connection.execute(
        "SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


def _columns(connection, table):
    if not _TABLE.fullmatch(table):
        raise ApiError("UNSUPPORTED_SCHEMA", "The source schema is unsupported.", 422)
    return {r[1] for r in connection.execute(f'PRAGMA main.table_info("{table}")')}


def _payload(raw):
    try:
        value = strict_json(raw, 2 * 1024 * 1024)
        return value if type(value) is dict else {}
    except (ValueError, TypeError, RecursionError, UnicodeError):
        return {}


def _argument_sha(arguments):
    if type(arguments) is not dict:
        return None
    try:
        return hashlib.sha256(canonical_json_bytes(arguments)).hexdigest()
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None


def _step(step_id, tool_name, arguments):
    return {"id": public_text(step_id, 256), "toolName": tool_name if type(tool_name) is str and tool_name in _TOOLS else "UNSUPPORTED",
            "path": _path(arguments.get("path")) if type(arguments) is dict else None,
            "argumentsSha256": _argument_sha(arguments), "argumentsRedacted": True}


def _event(row):
    payload, kind = _payload(row["payload_json"]), row["event_type"]
    summary = {}
    if kind in ("STEP_PLANNED", "TOOL_INTENT"):
        summary = _step(row["step_id"], payload.get("tool_name"), payload.get("arguments"))
        if type(payload.get("mutating")) is bool:
            summary["mutating"] = payload["mutating"]
    elif kind == "TOOL_RESULT":
        summary = {"toolName": payload.get("tool_name") if type(payload.get("tool_name")) is str and payload.get("tool_name") in _TOOLS else "UNSUPPORTED",
                   "status": payload.get("status") if type(payload.get("status")) is str and payload.get("status") in _RESULTS else "UNSUPPORTED",
                   "durationMs": _number(payload.get("duration_ms")), "resultRedacted": True}
    elif kind == "FILE_OBSERVED":
        summary = {"reason": payload.get("reason") if type(payload.get("reason")) is str and payload.get("reason") in ("PRE_TOOL", "POST_TOOL", "VALIDATION") else None,
                   "path": _path(payload.get("path")), "exists": payload.get("exists") if type(payload.get("exists")) is bool else None,
                   "sha256": _hash(payload.get("sha256")), "sizeBytes": _number(payload.get("size_bytes"))}
    elif kind in ("VALIDATION_PASSED", "VALIDATION_FAILED"):
        summary = {"passed": payload.get("passed") if type(payload.get("passed")) is bool else None,
                   "detailsRedacted": True}
    elif kind == "STEP_CONFIRMED":
        summary = {"toolStatus": payload.get("tool_status") if type(payload.get("tool_status")) is str and payload.get("tool_status") in _RESULTS else "UNSUPPORTED"}
    elif kind in ("RUN_COMPLETED", "RUN_FAILED"):
        summary = {"validationEventId": public_text(payload.get("validation_event_id"), 256)}
    return {"id": public_text(row["event_id"], 256), "seq": row["seq"],
            "type": kind if kind in _EVENT_TYPES else "UNSUPPORTED_EVENT",
            "timestamp": public_text(row["occurred_at"], 80), "stepId": public_text(row["step_id"], 256),
            "toolCallId": public_text(row["tool_call_id"], 256), "summary": summary, "payloadRedacted": True}


def _no_live_inspection_needed(connection, run_id=None):
    """Conservative admission only, never a replacement trace classifier.

    Core's Inspector observes unresolved intent targets through Sandbox. Even
    malformed target-bearing intents are excluded here, before calling Core.
    """
    sql = "SELECT run_id, tool_call_id, payload_json FROM main.events WHERE event_type='TOOL_INTENT'"
    params = ()
    if run_id is not None:
        sql += " AND run_id=?"
        params = (run_id,)
    for row in connection.execute(sql, params):
        result = connection.execute(
            "SELECT 1 FROM main.events WHERE run_id=? AND tool_call_id=? AND event_type='TOOL_RESULT' LIMIT 1",
            (row["run_id"], row["tool_call_id"]),
        ).fetchone()
        if result is not None:
            continue
        payload = _payload(row["payload_json"])
        if "targets" not in payload or type(payload["targets"]) is not list or payload["targets"]:
            return False
    return True


def _require_bound_workspaces(connection, project):
    """SQL snapshot paths cannot grant access outside explicit configuration."""
    for table, column in (("runs", "workspace_path"), ("checkpoint_records", "workspace_root"),
                          ("agent_episodes", "workspace_root"), ("agent_dispatches", "workspace_path")):
        if not _table_exists(connection, table):
            continue
        if column not in _columns(connection, table):
            raise ApiError("UNSUPPORTED_SCHEMA", "The source schema is unsupported.", 422)
        for row in connection.execute(f'SELECT DISTINCT "{column}" FROM main."{table}"'):
            raw = row[0]
            try:
                if type(raw) is not str or not Path(raw).is_absolute():
                    raise ValueError("relative source path")
                path = Path(raw)
                if ".." in path.parts or not any(path == root or path.is_relative_to(root) for root in project.workspace_roots):
                    raise ValueError("unconfigured lexical workspace")
                no_redirected_parents(path)
                path = path.resolve(strict=False)
                if not any(path == root or path.is_relative_to(root) for root in project.workspace_roots):
                    raise ValueError("unconfigured workspace")
            except (OSError, ValueError, RuntimeError):
                raise ApiError("SOURCE_BOUNDARY", "The source contains a workspace outside the configured boundary.", 422) from None


def _budget_and_schema(connection):
    if (not _table_exists(connection, "runs") or not _table_exists(connection, "events")
            or _columns(connection, "runs") != _RUN_COLUMNS or _columns(connection, "events") != _EVENT_COLUMNS):
        raise ApiError("UNSUPPORTED_SCHEMA", "The source schema is unsupported.", 422)
    row_count = 0
    tables = list(connection.execute("SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
    if len(tables) > 64 or connection.execute("SELECT 1 FROM main.sqlite_master WHERE type='view' LIMIT 1").fetchone():
        raise ApiError("UNSUPPORTED_SCHEMA", "The source schema is unsupported.", 422)
    for row in tables:
        name = row[0]
        if not _TABLE.fullmatch(name) or "VIRTUAL TABLE" in (row[1] or "").upper():
            raise ApiError("UNSUPPORTED_SCHEMA", "The source schema is unsupported.", 422)
        count = connection.execute(f'SELECT COUNT(*) FROM main."{name}"').fetchone()[0]
        row_count += count
        if row_count > MAX_DATABASE_ROWS:
            raise ApiError("SOURCE_LIMIT", "The source exceeds the Web inspection budget.", 413)
        for column in connection.execute(f'PRAGMA main.table_info("{name}")'):
            if column[2].upper() in ("TEXT", "BLOB"):
                quoted = '"' + column[1].replace('"', '""') + '"'
                oversized = connection.execute(
                    f'SELECT 1 FROM main."{name}" WHERE length(CAST({quoted} AS BLOB)) > 2097152 LIMIT 1'
                ).fetchone()
                if oversized:
                    raise ApiError("SOURCE_LIMIT", "The source exceeds the Web inspection budget.", 413)
    largest = connection.execute("SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM main.events GROUP BY run_id)").fetchone()[0]
    if largest is not None and largest > MAX_EVENTS_PER_RUN:
        raise ApiError("SOURCE_LIMIT", "The source exceeds the Web inspection budget.", 413)


def _read_authorizer(action, arg1, arg2, database, trigger):
    denied = {
        sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH, sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_CREATE_TEMP_TABLE, sqlite3.SQLITE_CREATE_TEMP_INDEX, sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
        sqlite3.SQLITE_CREATE_TEMP_VIEW, sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_DROP_TRIGGER, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_DROP_TEMP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_INDEX, sqlite3.SQLITE_DROP_TEMP_TRIGGER, sqlite3.SQLITE_DROP_TEMP_VIEW,
    }
    readonly_pragmas = {"table_info", "index_list", "index_info", "foreign_key_list"}
    if action in denied or (action == sqlite3.SQLITE_PRAGMA and arg2 is not None and arg1.lower() not in readonly_pragmas):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


@contextmanager
def committed_snapshot(project):
    source = destination = None
    try:
        no_redirected_parents(project.database)
        if not project.database.is_file():
            raise ApiError("DATABASE_UNAVAILABLE", "The configured database is unavailable.", 503)
        if project.database.stat().st_size > MAX_DATABASE_BYTES:
            raise ApiError("SOURCE_LIMIT", "The source exceeds the Web inspection budget.", 413)
        source = sqlite3.connect(project.database.as_uri() + "?mode=ro", uri=True,
                                 isolation_level=None, timeout=0.2)
        source.execute("PRAGMA query_only=ON")
        source.execute("PRAGMA trusted_schema=OFF")
        source.execute("PRAGMA busy_timeout=200")
        page_size = source.execute("PRAGMA page_size").fetchone()[0]
        deadline = time.monotonic() + SNAPSHOT_TIMEOUT_SECONDS

        def progress(status, remaining, total):
            if total * page_size > MAX_DATABASE_BYTES:
                raise ApiError("SOURCE_LIMIT", "The source exceeds the Web inspection budget.", 413)
            if time.monotonic() > deadline:
                raise ApiError("SOURCE_BUSY", "A bounded committed snapshot is unavailable.", 503)

        destination = sqlite3.connect(":memory:", isolation_level=None)
        source.backup(destination, pages=32, progress=progress, sleep=0.01)
        source.close()
        source = None
        destination.row_factory = sqlite3.Row
        destination.execute("PRAGMA foreign_keys=ON")
        destination.execute("PRAGMA query_only=ON")
        destination.execute("PRAGMA trusted_schema=OFF")
        destination.set_authorizer(_read_authorizer)
        query_deadline = time.monotonic() + QUERY_TIMEOUT_SECONDS
        destination.set_progress_handler(lambda: int(time.monotonic() > query_deadline), 1000)
        _budget_and_schema(destination)
        _require_bound_workspaces(destination, project)
        yield destination
    except ApiError:
        raise
    except (OSError, sqlite3.Error, ValueError, RuntimeError):
        raise ApiError("DATABASE_UNAVAILABLE", "The configured source could not be inspected safely.", 503) from None
    finally:
        if source is not None:
            source.close()
        if destination is not None:
            destination.close()


class ReadFacade:
    def __init__(self, config=None):
        self.config = config if config is not None else WorkbenchConfig()

    def health(self):
        return {"status": "available", "read_only": True, "projects": len(self.config.projects),
                "executionAvailable": False, "providerConnection": "UNAVAILABLE"}

    def projects(self):
        return [{"id": public_identity(p.id), "name": public_text(p.name, 128), "capabilities": {
                    "readOnly": True, "execution": False, "liveFiles": False,
                    "currentWorkspaceInspection": False}} for p in self.config.projects]

    def runs(self, project_id, *, limit=MAX_LIST_ITEMS):
        project = self.config.project(project_id)
        with committed_snapshot(project) as connection:
            rows = connection.execute("""SELECT r.*, (SELECT COUNT(*) FROM main.events e WHERE e.run_id=r.run_id) AS event_count
                FROM main.runs r ORDER BY started_at DESC,run_id LIMIT ?""", (limit,)).fetchall()
            return [self._run_metadata(row) for row in rows]

    @staticmethod
    def _run_metadata(row):
        task = _payload(row["task_spec_json"])
        return {"id": public_text(row["run_id"], 256), "taskId": public_text(row["task_id"], 256),
                "title": public_text(task.get("title"), 256) or public_text(row["task_id"], 256),
                "status": row["status"] if row["status"] in _STATUSES else "UNSUPPORTED",
                "startedAt": public_text(row["started_at"], 80), "endedAt": public_text(row["ended_at"], 80),
                "eventCount": row["event_count"] if "event_count" in row.keys() else None}

    def events(self, project_id, run_id, *, after=0, limit=MAX_EVENT_ITEMS):
        identifier(run_id)
        with committed_snapshot(self.config.project(project_id)) as connection:
            if connection.execute("SELECT 1 FROM main.runs WHERE run_id=?", (run_id,)).fetchone() is None:
                raise ApiError("RUN_NOT_FOUND", "The Run does not exist.", 404)
            rows = connection.execute("SELECT * FROM main.events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?",
                                      (run_id, after, limit)).fetchall()
            count = connection.execute("SELECT COUNT(*) FROM main.events WHERE run_id=?", (run_id,)).fetchone()[0]
            return {"items": [_event(row) for row in rows], "total": count,
                    "nextAfter": rows[-1]["seq"] if rows else None, "payloadsRedacted": True}

    def run(self, project_id, run_id):
        identifier(run_id)
        with committed_snapshot(self.config.project(project_id)) as connection:
            row = connection.execute("SELECT * FROM main.runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                raise ApiError("RUN_NOT_FOUND", "The Run does not exist.", 404)
            rows = connection.execute("SELECT * FROM main.events WHERE run_id=? ORDER BY seq", (run_id,)).fetchall()
            events = [_event(r) for r in rows[:MAX_EVENT_ITEMS]]
            result = self._run_metadata(row)
            result.update(goal=public_text(_payload(row["task_spec_json"]).get("goal"), 2048),
                          taskSpecSha256=_hash(row["task_spec_sha256"]), eventCount=len(rows),
                          events=events, eventsTruncated=len(rows) > MAX_EVENT_ITEMS,
                          inspection=_unsupported(), plan=self._plan(connection, run_id, rows),
                          files=[{**e["summary"], "seq": e["seq"], "contentAvailable": False,
                                  "source": "PERSISTED_FILE_OBSERVATION"} for e in events if e["type"] == "FILE_OBSERVED"],
                          checkpoints=self._checkpoints(connection, run_id),
                          recovery=self._recovery(connection, run_id),
                          model={"adapterName": public_text(row["model_plugin"], 128), "modelId": None},
                          limitations=["Read-only evidence is not a conversation transcript.",
                                       "Live workspace bytes and execution are unavailable.",
                                       "Arguments, tool output and provider request/response text are withheld."])
            if _no_live_inspection_needed(connection, run_id):
                try:
                    report = inspect_run(connection, run_id)
                    result["inspection"] = {"status": "SUPPORTED", "observations": report["observations"],
                        "traceConsistent": report["trace"]["consistent"], "issues": _issue_codes(report["trace"]["issues"]),
                        "pendingInvocations": [{"stepId": public_text(i["step_id"], 256),
                            "toolCallId": public_text(i["tool_call_id"], 256),
                            "toolName": i["tool_name"] if i["tool_name"] in _TOOLS else "UNSUPPORTED",
                            "intentSeq": i["intent_seq"], "executionResultUnknown": i["execution_result_unknown"],
                            "postObservationPresent": i["post_observation_present"]} for i in report["pending_invocations"]]}
                except (ValueError, TypeError, KeyError, sqlite3.Error, RecursionError):
                    result["inspection"] = _unsupported("CORE_INSPECTION_UNAVAILABLE")
            proposal = result["plan"].get("model")
            if proposal:
                result["model"] = proposal
            return result

    @staticmethod
    def _plan(connection, run_id, rows):
        steps = []
        for row in rows:
            if row["event_type"] == "STEP_PLANNED":
                payload = _payload(row["payload_json"])
                steps.append(_step(row["step_id"], payload.get("tool_name"), payload.get("arguments")))
        result = {"source": "STEP_PLANNED", "proposalId": None, "planSha256": None,
                  "approvedPlanSha256": None, "approvalStatus": "NOT_RECORDED", "skillRef": None,
                  "steps": steps, "integrityIssues": [], "model": None}
        try:
            report = inspect_planning_provenance(connection, run_id)
            if report["proposal"] is None:
                return result
            metadata = report["proposal"]
            proposal = get_plan_proposal(connection, metadata["proposal_id"])
            result.update(source="IMMUTABLE_PROPOSAL", proposalId=public_identity(proposal.proposal_id),
                planSha256=proposal.plan_sha256, approvedPlanSha256=metadata["approved_plan_sha256"],
                approvalStatus="APPROVED" if report["consistent"] and metadata["plan_approved"] else "INTEGRITY_BLOCKED",
                skillRef=_ref(proposal.skill_ref.to_dict()),
                steps=[_step(s.step_id, s.tool_name, s.arguments) for s in proposal.plan],
                integrityIssues=_issue_codes(report["integrity_issues"]),
                model={"adapterName": public_text(proposal.adapter_name, 128), "modelId": public_text(proposal.model_id, 128)})
        except (ValueError, TypeError, KeyError, sqlite3.Error, RecursionError):
            result.update(approvalStatus="UNVERIFIED", integrityIssues=[{
                "code": "PLANNING_INSPECTION_UNAVAILABLE", "message": "Planning evidence could not be verified."}])
        return result

    @staticmethod
    def _checkpoints(connection, run_id):
        if not _table_exists(connection, "checkpoint_records"):
            return []
        try:
            records = list_checkpoints(connection, run_id)
            result = []
            for record in records[:MAX_LIST_ITEMS]:
                verification = verify_checkpoint(connection, record.checkpoint_id, compare_workspace=False)
                result.append({"id": public_text(record.checkpoint_id, 256), "kind": record.checkpoint_kind,
                    "status": "INTEGRITY_FAILURE" if verification["integrity_issues"] else "VALID",
                    "eventCursorSeq": record.event_cursor_seq, "capturedAt": public_text(record.captured_at, 80),
                    "snapshotSha256": record.snapshot_sha256, "manifestSha256": record.workspace_manifest_sha256,
                    "currentWorkspaceDifference": "NOT_COMPARED",
                    "checks": {name: {"status": check["status"], "issues": _issue_codes(check["issues"])}
                               for name, check in verification["checks"].items()},
                    "integrityIssues": _issue_codes(verification["integrity_issues"])})
            return result
        except (ValueError, TypeError, KeyError, OSError, sqlite3.Error, RecursionError):
            return [{"id": None, "status": "UNSUPPORTED", "checks": {},
                     "code": "CHECKPOINT_INSPECTION_UNAVAILABLE"}]

    @staticmethod
    def _recovery(connection, run_id):
        """Recorded relationships only; never run live reconciliation helpers."""
        if not _table_exists(connection, "recovery_cases"):
            return []
        records = connection.execute("SELECT * FROM main.recovery_cases WHERE source_run_id=? ORDER BY case_id LIMIT ?",
                                     (run_id, MAX_LIST_ITEMS)).fetchall()
        result = []
        for record in records:
            item = {"id": public_text(record["case_id"], 256), "sourceRunId": public_text(record["source_run_id"], 256),
                    "checkpointId": public_text(record["checkpoint_id"], 256), "inspectionStatus": "RECORDED_METADATA_ONLY",
                    "status": "RECORDED_METADATA_ONLY",
                    "sourceOutcome": "NOT_REINTERPRETED", "approvalSha256": None,
                    "proposalId": None, "childRunId": None, "childStatus": None,
                    "outcomeRecorded": False, "integrityVerified": False}
            if _table_exists(connection, "recovery_dispatches"):
                dispatches = connection.execute("SELECT * FROM main.recovery_dispatches WHERE case_id=?", (record["case_id"],)).fetchall()
                if len(dispatches) == 1:
                    d = dispatches[0]
                    item.update(proposalId=public_text(d["proposal_id"], 256), childRunId=public_text(d["reserved_child_run_id"], 256))
                    fact = _payload(d["fact_json"])
                    item["approvalSha256"] = _hash(fact.get("approved_recovery_sha256"))
                    child = connection.execute("SELECT status FROM main.runs WHERE run_id=?", (d["reserved_child_run_id"],)).fetchone()
                    item["childStatus"] = child[0] if child and child[0] in _STATUSES else None
            if _table_exists(connection, "recovery_outcomes"):
                item["outcomeRecorded"] = connection.execute("SELECT 1 FROM main.recovery_outcomes WHERE case_id=?", (record["case_id"],)).fetchone() is not None
            result.append(item)
        return result

    def skills(self, project_id):
        with committed_snapshot(self.config.project(project_id)) as connection:
            if not _table_exists(connection, "skills"):
                return []
            ids = [r[0] for r in connection.execute("SELECT skill_id FROM main.skills ORDER BY skill_id LIMIT ?", (MAX_LIST_ITEMS,))]
            result = []
            for skill_id in ids:
                try:
                    manager = SkillManager(connection)
                    cards = manager.list_versions(skill_id)
                    for card in cards:
                        if len(result) >= MAX_LIST_ITEMS:
                            return result
                        result.append(self._skill_metadata(connection, card, manager))
                except (ValueError, TypeError, KeyError, sqlite3.Error, RecursionError):
                    result.append({"id": public_text(skill_id, 128), "version": None, "state": "INTEGRITY_FAILURE",
                                   "integrityIssues": [{"code": "SKILL_INTEGRITY", "message": "Skill evidence could not be verified."}]})
            return result

    @staticmethod
    def _skill_metadata(connection, card, manager):
        preferred = False
        preferred_status = "NOT_CONFIGURED"
        if _table_exists(connection, "skill_activation_events"):
            try:
                selected = resolve_preferred_skill(connection, card.skill_id)
                preferred = selected == card.ref
                preferred_status = "SELECTED" if preferred else "NOT_SELECTED"
            except (ValueError, TypeError, KeyError, sqlite3.Error):
                preferred_status = "UNVERIFIED"
        source = {"kind": card.source.kind}
        if card.source.ref is not None:
            source.update(_ref(card.source.ref.to_dict()))
        return {"id": public_identity(card.skill_id), "version": card.skill_version, "name": public_text(card.name, 256),
                "description": public_text(card.description, 1024),
                "state": manager.get_current_state(card.skill_id, card.skill_version),
                "allowedTools": [public_text(t, 128) for t in card.allowed_tools], "source": source,
                "cardSha256": hashlib.sha256(card.canonical_bytes()).hexdigest(), "preferred": preferred,
                "preferredStatus": preferred_status,
                "integrityIssues": []}

    def skill(self, project_id, skill_id, version):
        identifier(skill_id)
        if type(version) is not int or version < 1:
            raise ApiError("INVALID_ID", "An exact positive Skill version is required.")
        with committed_snapshot(self.config.project(project_id)) as connection:
            try:
                manager = SkillManager(connection)
                card = manager.get_version(skill_id, version)
                result = self._skill_metadata(connection, card, manager)
                result.update(instructions=public_text(card.instructions, 16 * 1024),
                              instructionsTruncated=len(card.instructions) > 16 * 1024,
                              history=[{"state": e.state, "seq": e.transition_seq, "occurredAt": public_text(e.occurred_at, 80)}
                                       for e in manager.get_state_history(skill_id, version)],
                              trust={"status": "UNSUPPORTED", "recommendation": None, "integrityIssues": []})
            except KeyError:
                raise ApiError("SKILL_NOT_FOUND", "The exact Skill version does not exist.", 404) from None
            except (ValueError, TypeError, sqlite3.Error, RecursionError):
                raise ApiError("SKILL_INTEGRITY", "The Skill evidence could not be verified.", 422) from None
            if (_table_exists(connection, "skill_trust_assessments") and _no_live_inspection_needed(connection)
                    and (not _table_exists(connection, "recovery_cases") or not connection.execute("SELECT 1 FROM main.recovery_cases LIMIT 1").fetchone())):
                report = inspect_skill_trust(connection, card.ref)
                result["trust"] = {"status": "SUPPORTED", "assessmentId": public_text(report.get("assessment_id"), 256),
                    "assessmentSha256": _hash(report.get("assessment_sha256")), "recommendation": public_text(report.get("recommendation"), 80),
                    "freshness": public_text(report.get("freshness"), 80), "historicalDenominators": report.get("historical_denominators"),
                    "comparisonMetrics": report.get("comparison_metrics"), "integrityIssues": _issue_codes(report.get("integrity_issues"))}
            return result

    def evolution_cases(self, project_id):
        with committed_snapshot(self.config.project(project_id)) as connection:
            if not _table_exists(connection, "evolution_cases"):
                return []
            result = []
            for row in connection.execute("SELECT case_id, fact_json FROM main.evolution_cases ORDER BY case_id LIMIT ?", (MAX_LIST_ITEMS,)):
                data = _payload(row["fact_json"])
                result.append({"id": public_text(row["case_id"], 256), "sourceSkillRef": _ref(data),
                               "integrityVerified": False})
            return result

    def evolution(self, project_id, case_id):
        identifier(case_id)
        with committed_snapshot(self.config.project(project_id)) as connection:
            row = connection.execute("SELECT * FROM main.evolution_cases WHERE case_id=?", (case_id,)).fetchone() if _table_exists(connection, "evolution_cases") else None
            if row is None:
                raise ApiError("EVOLUTION_NOT_FOUND", "The evolution case does not exist.", 404)
            stored_ref = _ref({"skill_id": row["skill_id"], "skill_version": row["skill_version"]})
            if (not _no_live_inspection_needed(connection)
                    or (_table_exists(connection, "recovery_cases") and connection.execute("SELECT 1 FROM main.recovery_cases LIMIT 1").fetchone())):
                return {"id": public_identity(case_id), "status": "UNSUPPORTED", "sourceSkillRef": stored_ref,
                        "integrityVerified": False, "integrityIssues": [],
                        "reason": "High-order inspection would cross the live filesystem boundary.", "revisions": []}
            report = inspect_skill_evolution(connection, case_id)
            has_issues = bool(report.get("integrity_issues"))
            result = {"id": public_identity(case_id), "status": "INTEGRITY_FAILURE" if has_issues else "SUPPORTED", "governanceMode": report.get("governance_mode"),
                      "sourceSkillRef": _ref(report.get("source_skill_ref")) or stored_ref,
                      "integrityVerified": not has_issues, "sourceCardSha256": _hash(report.get("source_card_sha256")),
                      "sourceAssessmentId": public_text(report.get("source_assessment_id"), 256),
                      "sourceAssessmentSha256": _hash(report.get("source_assessment_sha256")),
                      "historicalFreshness": public_text(report.get("historical_freshness"), 80),
                      "attribution": report.get("attribution"), "preferredSkillRef": _ref(report.get("preferred_skill_ref")),
                      "activationHistory": [], "revisions": [], "integrityIssues": _issue_codes(report.get("integrity_issues"))}
            for activation in report.get("activation_history", [])[:MAX_LIST_ITEMS]:
                result["activationHistory"].append({"id": public_text(activation.get("activation_id"), 256),
                    "seq": activation.get("activation_seq"), "skillRef": _ref(activation.get("skill_ref")),
                    "eventSha256": _hash(activation.get("event_sha256"))})
            for revision in report.get("revisions", [])[:MAX_LIST_ITEMS]:
                item = {"id": public_text(revision.get("revision_id"), 256), "revisionSha256": _hash(revision.get("revision_sha256")),
                        "approvalSha256": _hash(revision.get("approval_sha256")), "candidateSkillRef": _ref(revision.get("candidate_skill_ref")),
                        "candidateCardSha256": _hash(revision.get("candidate_card_sha256")),
                        "state": revision.get("current_lifecycle_state"), "capabilityStatus": revision.get("capability_status"),
                        "history": [], "promotionProposals": []}
                for history in revision.get("candidate_lifecycle", [])[:3]:
                    item["history"].append({"state": history.get("state"), "seq": history.get("transition_seq"),
                                            "occurredAt": public_text(history.get("occurred_at"), 80)})
                for promotion in revision.get("promotion_proposals", [])[:MAX_LIST_ITEMS]:
                    gate = promotion.get("gate_decision") or {}
                    item["promotionProposals"].append({"id": public_text(promotion.get("proposal_id"), 256),
                        "proposalSha256": _hash(promotion.get("proposal_sha256")),
                        "approvalSha256": _hash(promotion.get("approval_sha256")),
                        "receiptSha256": _hash(promotion.get("receipt_sha256")),
                        "gate": {"eligible": gate.get("eligible") if type(gate.get("eligible")) is bool else None,
                                 "status": public_text(gate.get("status"), 80), "manifestSha256": _hash(gate.get("manifest_sha256"))}})
                result["revisions"].append(item)
            return result

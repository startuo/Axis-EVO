"""Opt-in orchestration around the existing planner and Runner, never a tool loop."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict
from functools import lru_cache
import hashlib
import re
import sqlite3
import threading
from uuid import uuid4

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from axis_evo.inspector import inspect_run
from axis_evo.planning_adapter import PlanningTransportError
from axis_evo.planning_provenance import get_plan_proposal
from axis_evo.plugins import PluginRegistry
from axis_evo.skill_card import SkillRef
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_planner import generate_skill_plan, execute_approved_skill_plan
from axis_evo.tools import ReadFileTool, WriteFileTool, PatchFileTool

from .read_facade import ReadFacade, committed_snapshot
from .runtime_policy import (FILE_TOOLS, MAX_PROMPT_CHARS, MAX_FILE_BYTES, load_template, snapshot_task,
                             preflight_plan, seed_manifest, verify_snapshot)
from .schemas import ApiError, MAX_DATABASE_BYTES, no_redirected_parents, strict_json
from . import runtime_jobs
from .runtime_process import CoordinatorLock, ProcessSupervisor

_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_THREAD = re.compile(r"thread_[0-9a-f]{32}\Z")
_SCHEMA = """
CREATE TABLE IF NOT EXISTS runtime_threads (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, prompt TEXT NOT NULL,
 profile_json TEXT NOT NULL, skill_json TEXT NOT NULL, manifest_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
 proposal_id TEXT UNIQUE, approved_digest TEXT, reserved_run_id TEXT NOT NULL UNIQUE,
 error_code TEXT);
CREATE TRIGGER IF NOT EXISTS runtime_threads_identity BEFORE UPDATE ON runtime_threads
 WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.prompt IS NOT OLD.prompt OR NEW.profile_json IS NOT OLD.profile_json
 OR NEW.skill_json IS NOT OLD.skill_json OR NEW.manifest_json IS NOT OLD.manifest_json
 OR NEW.created_at IS NOT OLD.created_at OR NEW.reserved_run_id IS NOT OLD.reserved_run_id
 OR (OLD.proposal_id IS NOT NULL AND NEW.proposal_id IS NOT OLD.proposal_id)
 OR (OLD.approved_digest IS NOT NULL AND NEW.approved_digest IS NOT OLD.approved_digest)
 BEGIN SELECT RAISE(ABORT, 'runtime thread identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS runtime_threads_no_delete BEFORE DELETE ON runtime_threads
 BEGIN SELECT RAISE(ABORT, 'runtime history is retained'); END;
CREATE TRIGGER IF NOT EXISTS runtime_threads_no_replace BEFORE INSERT ON runtime_threads
 WHEN EXISTS(SELECT 1 FROM runtime_threads WHERE id=NEW.id OR reserved_run_id=NEW.reserved_run_id)
 BEGIN SELECT RAISE(ABORT, 'runtime history cannot be replaced'); END;
"""


def _schema_objects(c):
    return tuple(tuple(row) for row in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
        "WHERE tbl_name='runtime_threads' AND name NOT LIKE 'sqlite_%' ORDER BY type,name"))


@lru_cache(maxsize=1)
def _expected_schema():
    c = sqlite3.connect(":memory:")
    try:
        c.executescript(_SCHEMA)
        return _schema_objects(c)
    finally:
        c.close()


def registry():
    value = PluginRegistry()
    for tool in (ReadFileTool(), WriteFileTool(), PatchFileTool()):
        value.register(tool)
    return value


class RuntimeService:
    def __init__(self, config, workbench_config, providers, *, adapter_factory=None,
                 worker_mode=False, worker_launcher=None):
        self.config, self.workbench, self.providers = config, workbench_config, providers
        self.facade = ReadFacade(workbench_config)
        self._adapter_factory = adapter_factory or providers.adapter
        # Explicit adapter injection is a legacy in-process testing API only.
        # The HTTP constructor/config cannot select it. Normal runtime uses Popen.
        self._isolated, self._worker_mode = adapter_factory is None, worker_mode
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="axis-test-runtime") if adapter_factory else None
        self._coordinator_lock = None
        self._supervisor = None
        self._slots = threading.BoundedSemaphore(8)
        self._futures = {}
        self._closed = False
        directory = self.config.data_dir / "threads"
        no_redirected_parents(directory)
        directory.mkdir(exist_ok=True)
        with self._web() as c:
            existing = _schema_objects(c)
            if existing and existing != _expected_schema():
                raise ApiError("RUNTIME_STORE_INTEGRITY", "Runtime history schema is unexpected.", 422)
            c.executescript("BEGIN IMMEDIATE;" + _SCHEMA)
            if _schema_objects(c) != _expected_schema():
                raise ApiError("RUNTIME_STORE_INTEGRITY", "Runtime history schema is unexpected.", 422)
            c.commit()
            runtime_jobs.initialize(c)
        if self._isolated and not worker_mode:
            self._coordinator_lock = CoordinatorLock(config.data_dir)
        if not worker_mode:
            with self._web() as c, runtime_jobs.transaction(c):
                for row in c.execute("SELECT job_id FROM main.runtime_jobs WHERE state IN ('QUEUED','PLANNING','DISPATCH_RESERVED','EXECUTING')").fetchall():
                    runtime_jobs.observation(c, row[0], None, 'SUPERVISION_LOST', {'reason': 'COORDINATOR_RESTART'})
                    runtime_jobs.transition(c, row[0], 'OUTCOME_UNKNOWN')
            # A lost worker is not evidence of tool failure or permission to retry.
                c.execute("UPDATE runtime_threads SET status='UNKNOWN', error_code='WORKER_INTERRUPTED', updated_at=? "
                          "WHERE status IN ('QUEUED','PLANNING','DISPATCH_RESERVED','EXECUTING')", (utc_now(),))
        if self._isolated and not worker_mode:
            self._supervisor = ProcessSupervisor(self, worker_launcher)
            with self._web() as c:
                interrupted = c.execute("SELECT job_id FROM main.runtime_jobs WHERE state='OUTCOME_UNKNOWN'").fetchall()
            for row in interrupted:
                self._reconcile(row[0])

    @contextmanager
    def _web(self):
        c = self.providers.connect()
        try:
            yield c
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def _project(self, project_id):
        project = self.workbench.project(project_id)
        runtime = next((p for p in self.config.projects if p.id == project_id), None)
        if runtime is None:
            raise ApiError("RUNTIME_PROJECT_DISABLED", "Runtime is not enabled for this project.", 403)
        if not any(self.config.data_dir.is_relative_to(root) for root in project.workspace_roots):
            raise ApiError("RUNTIME_ROOT_UNBOUND", "Runtime data must be inside a configured workspace root.", 422)
        return project, runtime

    @contextmanager
    def _core(self, project):
        no_redirected_parents(project.database)
        if not project.database.is_file() or project.database.stat().st_size > MAX_DATABASE_BYTES:
            raise ApiError("CORE_DATABASE_UNAVAILABLE", "A bounded initialized Core database is required.", 422)
        c = sqlite3.connect(project.database.as_uri() + "?mode=rw", uri=True, timeout=5, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA synchronous=FULL")
        try:
            if c.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
                raise ApiError("CORE_WAL_REQUIRED", "The configured Core database must use WAL.", 422)
            yield c
        finally:
            c.close()

    def capabilities(self, authenticated=False):
        return {"enabled": True, "authenticated": authenticated,
            "projects": [{"id": p.id, "name": self.workbench.project(p.id).name,
                          "skills": [s.to_dict() for s in self._enabled_skills(p)],
                          "taskTemplates": [{'id': 'default', 'name': '默认验收'}] +
                              [{'id': name, 'name': name} for name, _ in p.task_templates]} for p in self.config.projects],
            "supportsConversations": True, "maximumPromptCodepoints": MAX_PROMPT_CHARS,
            "promptLengthUnit": "UNICODE_CODEPOINTS", "maximumConversationTurns": 16,
            "allowedTools": list(FILE_TOOLS), "blockedTools": ["run_tests"],
            "executionMode": "process-isolated" if self._isolated else "in-process-test-injection",
            "limitations": ["File-only runtime; pytest Acceptance is disabled.",
                "Seeds are bounded UTF-8 files; symlinks, junctions, hard links and protected files are rejected.",
                "Acceptance is fixed by the backend TaskSpec template; model output cannot change it.",
                "No shell, child tool process, automatic retry, re-planning or recovery.",
                "Separate credential-scoped planning and execution processes; no OS security sandbox.",
                "Process deadlines are supervised; host scheduling is not a real-time guarantee."]}

    def _enabled_skills(self, runtime_project):
        if not runtime_project.allow_evolved_skills:
            return runtime_project.skill_refs
        from .evolved_admission import enabled_skill_refs
        project, _ = self._project(runtime_project.id)
        try:
            with self._core(project) as c:
                return enabled_skill_refs(c, runtime_project)
        except (ValueError, TypeError, KeyError, sqlite3.Error):
            raise ApiError('EVOLVED_SKILL_INTEGRITY', 'Preferred Skill eligibility could not be verified.', 422) from None

    def _row_unscoped(self, thread_id):
        with self._web() as c:
            row = c.execute('SELECT * FROM main.runtime_threads WHERE id=?', (thread_id,)).fetchone()
        if row is None:
            raise ValueError('runtime thread does not exist')
        return dict(row)

    def _row(self, project_id, thread_id):
        self._project(project_id)
        if type(thread_id) is not str or not _THREAD.fullmatch(thread_id):
            raise ApiError("THREAD_NOT_FOUND", "The runtime thread does not exist.", 404)
        with self._web() as c:
            row = c.execute("SELECT * FROM runtime_threads WHERE id=? AND project_id=?", (thread_id, project_id)).fetchone()
        if row is None:
            raise ApiError("THREAD_NOT_FOUND", "The runtime thread does not exist.", 404)
        return dict(row)

    def _directory(self, thread_id):
        if not _THREAD.fullmatch(thread_id):
            raise ApiError("THREAD_NOT_FOUND", "The runtime thread does not exist.", 404)
        directory = self.config.data_dir / "threads" / thread_id
        no_redirected_parents(directory)
        return directory

    def _proposal(self, row, c):
        proposal = None
        if row["proposal_id"]:
            proposal = get_plan_proposal(c, row["proposal_id"])
        # Crash after Core proposal COMMIT and before Web association: find only
        # this configured attempt identity. Never call the provider again.
        if proposal is None and row["status"] == "UNKNOWN":
            adapter = self._adapter_factory(strict_json(row["profile_json"]), row["id"])
            ids = c.execute("SELECT proposal_id FROM plan_proposals WHERE adapter_name=?", (adapter.adapter_name,)).fetchall()
            if len(ids) == 1:
                proposal = get_plan_proposal(c, ids[0][0])
            elif len(ids) > 1:
                raise ApiError("THREAD_PROVENANCE_MISMATCH", "The planning attempt has ambiguous proposals.", 422)
        if proposal is not None:
            profile = strict_json(row["profile_json"])
            adapter = self._adapter_factory(profile, row["id"])
            manifest = strict_json(row["manifest_json"])
            if (proposal.skill_ref.to_dict() != strict_json(row["skill_json"])
                    or proposal.task_spec_sha256 != manifest["taskSha256"]
                    or proposal.adapter_name != adapter.adapter_name or proposal.model_id != adapter.model_id
                    or row["approved_digest"] is not None and row["approved_digest"] != proposal.plan_sha256):
                raise ApiError("THREAD_PROVENANCE_MISMATCH", "The thread does not match its immutable proposal.", 422)
        return proposal

    def list_threads(self, project_id):
        project, _ = self._project(project_id)
        with self._web() as c:
            rows = c.execute("SELECT * FROM runtime_threads WHERE project_id=? ORDER BY created_at DESC,id LIMIT 100",
                             (project_id,)).fetchall()
        with self._core(project) as c:
            run_ids = {r[0] for r in c.execute("SELECT run_id FROM runs WHERE run_id IN (" +
                ",".join("?" for _ in rows) + ")", tuple(r["reserved_run_id"] for r in rows))} if rows else set()
        result = []
        for row in rows:
            item = self._summary(dict(row))
            if row["reserved_run_id"] in run_ids:
                item["runId"] = row["reserved_run_id"]
            result.append(item)
        return result

    @staticmethod
    def _summary(row):
        return {"id": row["id"], "projectId": row["project_id"], "title": row["prompt"].strip().splitlines()[0][:80],
                "createdAt": row["created_at"], "updatedAt": row["updated_at"], "status": row["status"],
                "proposalId": row["proposal_id"], "runId": None}

    def get_thread(self, project_id, thread_id):
        row = self._row(project_id, thread_id)
        project, _ = self._project(project_id)
        result = self._summary(row)
        result.update(prompt=row["prompt"], errorCode=row["error_code"],
            profileSnapshot=strict_json(row["profile_json"]), skillRef=strict_json(row["skill_json"]),
            proposal=None, run=None)
        with self._web() as c:
            result['supervision'] = runtime_jobs.snapshot(c, thread_id)
        if result['supervision'] is not None:
            self._verify_job(row)
        with self._core(project) as c:
            proposal = self._proposal(row, c)
            if proposal:
                result["proposalId"] = proposal.proposal_id
                result["proposal"] = {"proposalId": proposal.proposal_id, "cardSha256": proposal.card_sha256,
                    "taskSpecSha256": proposal.task_spec_sha256, "planSha256": proposal.plan_sha256,
                    "steps": strict_json(proposal.plan_json)["steps"], "approvedPlanSha256": row["approved_digest"]}
            run_exists = c.execute("SELECT 1 FROM runs WHERE run_id=?", (row["reserved_run_id"],)).fetchone()
        if run_exists:
            result["runId"] = row["reserved_run_id"]
            run = self.facade.run(project_id, result["runId"])
            for event in run["events"]:
                if type(event["summary"]) is dict:
                    event["summary"] = " · ".join(f"{k}: {v}" for k, v in event["summary"].items() if v is not None)
            run["inspection"]["issues"] = [i["code"] for i in run["inspection"]["issues"]]
            if run["inspection"]["status"] == "UNSUPPORTED":
                try:
                    workspace = self._directory(thread_id) / "workspace"
                    seed_manifest(workspace, self.providers.check_text)
                    with committed_snapshot(project) as c:
                        actual = c.execute("SELECT workspace_path FROM runs WHERE run_id=?", (result["runId"],)).fetchone()
                        if actual[0] != str(workspace.resolve(strict=True)):
                            raise ValueError("unbound runtime workspace")
                        report = inspect_run(c, result["runId"])
                    run["inspection"] = {"status": "SUPPORTED", "observations": report["observations"],
                        "traceConsistent": report["trace"]["consistent"],
                        "issues": [i["code"] for i in report["trace"]["issues"] + report["current_state_issues"]],
                        "pendingInvocations": report["pending_invocations"]}
                except (ApiError, OSError, ValueError, sqlite3.Error, KeyError):
                    pass  # bounded observation unavailable; do not fabricate a classification
            result["run"] = run
        supervision = result['supervision']
        if supervision is not None:
            inspection = result['run']['inspection'] if result['run'] else {}
            terminal_facts = [event for event in result['run']['events'] if event['type'] in ('RUN_COMPLETED','RUN_FAILED')] if result['run'] else []
            terminal_observed = bool(result['run'] and result['run']['status'] in ('COMPLETED','FAILED') and
                len(terminal_facts) == 1 and terminal_facts[0]['type'] == 'RUN_' + result['run']['status'] and
                terminal_facts[0]['timestamp'] == result['run']['endedAt'])
            supervision.update(coordinatorAvailable=not self._closed,
                coreRunExists=bool(result['run']), coreTerminalObserved=terminal_observed,
                pendingIntentCount=len(inspection.get('pendingInvocations', [])),
                outcomeUnresolved=row['status'] == 'UNKNOWN',
                recoveryAvailable=bool(result['run'] and result['run'].get('recovery')),
                workerRunning=bool(self._supervisor and self._supervisor.running(thread_id, supervision['workerIdentity'])))
        return result

    def _status(self, thread_id, status, error=None, proposal_id=None):
        with self._web() as c:
            c.execute("BEGIN IMMEDIATE")
            cursor = c.execute("UPDATE runtime_threads SET status=?, error_code=?, proposal_id=COALESCE(?,proposal_id), "
                "updated_at=? WHERE id=?", (status, error, proposal_id, utc_now(), thread_id))
            if cursor.rowcount != 1:
                raise sqlite3.IntegrityError("runtime state was not applied")
            runtime_jobs.transition(c, thread_id, 'OUTCOME_UNKNOWN' if status == 'UNKNOWN' else status)
            c.commit()
        from .runtime_conversations import record_state
        record_state(self, thread_id)

    def _submit(self, thread_id, operation):
        def work():
            try:
                operation()
            finally:
                self._slots.release()
        self._futures[thread_id] = self._pool.submit(work)

    def create_thread(self, project_id, body, *, _turn=None):
        project, runtime = self._project(project_id)
        if type(body) is not dict or body.keys() != {"prompt", "profileId", "profileRevision", "skillRef"}:
            raise ApiError("INVALID_THREAD", "Only prompt, provider revision and exact SkillRef are accepted.")
        prompt = body["prompt"]
        if type(prompt) is not str or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise ApiError("INVALID_PROMPT", "A prompt of 1 to 8192 characters is required.")
        self.providers.check_text(prompt)
        if type(body["profileRevision"]) is not int or body["profileRevision"] < 1:
            raise ApiError("INVALID_PROVIDER", "An exact provider revision is required.")
        ref_data = body["skillRef"]
        if type(ref_data) is not dict or ref_data.keys() != {"skill_id", "skill_version"}:
            raise ApiError("INVALID_SKILL", "An exact configured SkillRef is required.")
        try:
            ref = SkillRef(**ref_data)
        except (ValueError, TypeError):
            raise ApiError("INVALID_SKILL", "An exact configured SkillRef is required.") from None
        if ref not in self._enabled_skills(runtime):
            raise ApiError("SKILL_NOT_ENABLED", "This Skill version is not enabled for the project.", 403)
        profile = self.providers.get(body["profileId"], body["profileRevision"])
        # Never copy seed data or queue provider I/O for an ineligible Skill.
        with self._core(project) as c:
            manager = SkillManager(c)
            card = manager.get_version(ref.skill_id, ref.skill_version)
            if manager.get_current_state(ref.skill_id, ref.skill_version) != "TRUSTED":
                raise ApiError("SKILL_NOT_TRUSTED", "The exact Skill must remain TRUSTED.", 422)
            self.providers.check_text(card.canonical_bytes().decode("utf-8"))
        template_path = runtime.task_spec_path if _turn is None else runtime.template(_turn.template_id)
        template, _, seed_facts = load_template(template_path, self.providers.check_text)
        if _turn is not None:
            if canonical_json_bytes(asdict(template)).decode() != _turn.template_json:
                raise ApiError('TASK_TEMPLATE_CHANGED', 'The selected acceptance template changed.', 409)
            seed_facts = _turn.seed.manifest()
        if self._closed or not self._slots.acquire(blocking=False):
            raise ApiError("RUNTIME_BUSY", "The bounded runtime queue is full.", 429)
        thread_id, run_id = "thread_" + uuid4().hex, "run_" + uuid4().hex
        try:
            task_value = asdict(template)
            task_value.update(task_id=thread_id, title=prompt.strip().splitlines()[0][:80], goal=prompt)
            task_value['workspace'] = {'seed_dir': 'seed'}
            encoded = canonical_json_bytes(task_value) if _turn is None else _turn.task_bytes(thread_id, prompt)
            if len(encoded) > MAX_FILE_BYTES:
                raise ApiError('TASK_LIMIT', 'The task exceeds its byte budget.', 422)
            self.providers.check_text(encoded.decode('utf-8'))
            manifest = {'seed': seed_facts, 'taskSha256': hashlib.sha256(encoded).hexdigest()}
            now = utc_now()
            with self._web() as c:
                c.execute("BEGIN IMMEDIATE")
                if c.execute("SELECT count(*) FROM runtime_threads").fetchone()[0] >= 200:
                    raise ApiError("THREAD_LIMIT", "The local runtime history limit has been reached.", 429)
                cursor = c.execute("INSERT INTO runtime_threads VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)",
                    (thread_id, project_id, prompt, canonical_json_bytes(profile).decode(),
                     canonical_json_bytes(ref.to_dict()).decode(), canonical_json_bytes(manifest).decode(),
                     now, now, "QUEUED", run_id))
                if cursor.rowcount != 1:
                    raise sqlite3.IntegrityError("thread insertion was not applied")
                job_identity = {
                    'projectId': project_id, 'skillRef': ref.to_dict(),
                    'cardSha256': hashlib.sha256(card.canonical_bytes()).hexdigest(),
                    'providerProfileId': profile['id'], 'providerRevision': profile['revision'],
                    'providerConfigSha256': profile['configSha256'], 'modelId': profile['modelId'],
                    'taskSpecSha256': manifest['taskSha256'],
                    'seedManifestSha256': hashlib.sha256(canonical_json_bytes(manifest['seed'])).hexdigest(),
                    'reservedRunId': run_id}
                if _turn is not None:
                    job_identity.update(conversationId=_turn.conversation_id, turnId=_turn.turn_id,
                                        contextSha256=_turn.context_sha)
                runtime_jobs.admission(c, thread_id, job_identity)
                if _turn is not None:
                    from .runtime_conversations import record_admission
                    record_admission(self, c, _turn, thread_id, run_id, prompt)
                c.commit()
        except BaseException:
            self._slots.release()
            raise
        # Capacity and immutable identity COMMIT precede private file creation.
        # Failed copies remain bounded, attributable FAILED jobs, not orphans.
        try:
            if _turn is None:
                copied = snapshot_task(runtime.task_spec_path, self._directory(thread_id), prompt, thread_id,
                                       self.providers.check_text)
            else:
                from .conversation_context import snapshot_prepared
                copied = snapshot_prepared(self._directory(thread_id), encoded, _turn.seed)
            if copied != manifest:
                raise ApiError('SEED_CHANGED', 'The admitted snapshot changed.', 422)
            if self._supervisor:
                self._futures[thread_id] = self._supervisor.submit(thread_id, 'planning')
            else:
                self._submit(thread_id, lambda: self._plan(self._row_unscoped(thread_id)))
        except BaseException:
            try:
                self._status(thread_id, 'FAILED', 'SNAPSHOT_OR_ADMISSION_REJECTED')
            finally:
                self._slots.release()
            raise
        return self.get_thread(project_id, thread_id)

    def _verify_job(self, row):
        profile, manifest, ref = (strict_json(row[key]) for key in ('profile_json', 'manifest_json', 'skill_json'))
        with self._web() as c:
            job = runtime_jobs.snapshot(c, row['id'])
        # Legacy pre-Step-3 pending proposals have no job and cannot be consumed.
        if job is None:
            raise ApiError('JOB_IDENTITY_MISMATCH', 'This historical thread has no execution job.', 409)
        project, _ = self._project(row['project_id'])
        with self._core(project) as c:
            manager = SkillManager(c)
            try:
                card = manager.get_version(ref['skill_id'], ref['skill_version'])
                if manager.get_current_state(ref['skill_id'], ref['skill_version']) != 'TRUSTED':
                    raise ValueError('exact Skill is not TRUSTED')
            except (KeyError, TypeError, ValueError):
                raise ApiError('JOB_IDENTITY_MISMATCH', 'Pinned Skill cannot be verified.', 422) from None
        expected = {'projectId': row['project_id'], 'skillRef': ref,
            'cardSha256': hashlib.sha256(card.canonical_bytes()).hexdigest(),
            'providerProfileId': profile['id'], 'providerRevision': profile['revision'],
            'providerConfigSha256': profile['configSha256'], 'modelId': profile['modelId'],
            'taskSpecSha256': manifest['taskSha256'],
            'seedManifestSha256': hashlib.sha256(canonical_json_bytes(manifest['seed'])).hexdigest(),
            'reservedRunId': row['reserved_run_id']}
        from .runtime_conversations import verify_binding
        expected.update(verify_binding(self, row, job['identity']))
        current = self.providers.get(profile['id'], profile['revision'])
        if job['identity'] != expected or current['configSha256'] != profile['configSha256']:
            raise ApiError('JOB_IDENTITY_MISMATCH', 'Pinned job identity cannot be verified.', 422)
        return job

    def _plan(self, row):
        thread_id = row['id']
        try:
            self._verify_job(row)
            self._status(thread_id, 'PLANNING')
            manifest, profile = strict_json(row['manifest_json']), strict_json(row['profile_json'])
            verify_snapshot(self._directory(thread_id), manifest, self.providers.check_text)
            project, _ = self._project(row['project_id'])
            adapter = self._adapter_factory(profile, thread_id)
            with self._core(project) as c:
                proposal = generate_skill_plan(c, self._directory(thread_id) / 'task.json',
                    SkillRef(**strict_json(row['skill_json'])), registry(), adapter)
            preflight_plan(self._directory(thread_id), proposal, manifest, self.providers.check_text)
            self._status(thread_id, 'AWAITING_APPROVAL', proposal_id=proposal.proposal_id)
        except PlanningTransportError as error:
            self._status(thread_id, 'FAILED', 'PROVIDER_' + error.category.upper())
        except Exception:
            self._status(thread_id, 'FAILED', 'PLANNING_REJECTED')

    def approve(self, project_id, thread_id, body):
        row = self._row(project_id, thread_id)
        project, _ = self._project(project_id)
        if (type(body) is not dict or body.keys() != {"proposalId", "approvedPlanSha256"}
                or type(body["approvedPlanSha256"]) is not str or not _DIGEST.fullmatch(body["approvedPlanSha256"])
                or row["status"] != "AWAITING_APPROVAL" or body["proposalId"] != row["proposal_id"]):
            raise ApiError("APPROVAL_REJECTED", "Approve the exact pending proposal digest.", 409)
        self._verify_job(row)
        with self._core(project) as c:
            proposal = self._proposal(row, c)
            if body["approvedPlanSha256"] != proposal.plan_sha256:
                raise ApiError("APPROVAL_REJECTED", "The approval digest does not match the immutable plan.", 409)
            preflight_plan(self._directory(thread_id), proposal, strict_json(row["manifest_json"]), self.providers.check_text)
        # Re-load immutable provider revision; editing an active profile cannot
        # silently replace the transport identity pinned by this thread.
        profile = strict_json(row["profile_json"])
        current = self.providers.get(profile["id"], profile["revision"])
        if current["configSha256"] != profile["configSha256"]:
            raise ApiError("PROVIDER_INTEGRITY", "The pinned provider revision is invalid.", 422)
        if self._closed or not self._slots.acquire(blocking=False):
            raise ApiError("RUNTIME_BUSY", "The bounded runtime queue is full.", 429)
        try:
            with self._web() as c:
                c.execute("BEGIN IMMEDIATE")
                cursor = c.execute("UPDATE runtime_threads SET status='DISPATCH_RESERVED', approved_digest=?, updated_at=? "
                    "WHERE id=? AND status='AWAITING_APPROVAL' AND approved_digest IS NULL",
                    (proposal.plan_sha256, utc_now(), thread_id))
                if cursor.rowcount != 1:
                    raise ApiError("APPROVAL_REJECTED", "This proposal already has an execution reservation.", 409)
                dispatch, worker = runtime_jobs.reserve(c, row, proposal)
                c.commit()
        except BaseException:
            self._slots.release()
            raise
        try:
            from .runtime_conversations import record_state
            record_state(self, thread_id)
            if self._supervisor:
                self._futures[thread_id] = self._supervisor.submit(thread_id, 'execution', dispatch, worker)
            else:
                self._submit(thread_id, lambda: self._execute(self._row_unscoped(thread_id)))
        except BaseException:
            try:
                self._status(thread_id, 'UNKNOWN', 'DISPATCH_RESERVED_NOT_STARTED')
            finally:
                self._slots.release()
            raise
        return self.get_thread(project_id, thread_id)

    def _execute(self, row):
        thread_id = row['id']
        project, _ = self._project(row['project_id'])
        try:
            self._verify_job(row)
            self._status(thread_id, 'EXECUTING')
            with self._core(project) as c:
                proposal = self._proposal(row, c)
                with self._web() as web:
                    dispatch = web.execute('SELECT * FROM main.runtime_dispatches WHERE job_id=?', (thread_id,)).fetchone()
                if not dispatch or (dispatch['proposal_id'], dispatch['approved_plan_sha256'], dispatch['reserved_run_id']) != (proposal.proposal_id, proposal.plan_sha256, row['reserved_run_id']):
                    raise ValueError('dispatch evidence mismatch')
                preflight_plan(self._directory(thread_id), proposal, strict_json(row['manifest_json']), self.providers.check_text)
                execute_approved_skill_plan(c, proposal.proposal_id, row['approved_digest'],
                    self._directory(thread_id) / 'task.json', self._directory(thread_id) / 'workspace',
                    registry(), run_id=row['reserved_run_id'])
            self._status(thread_id, 'FINISHED')
        except Exception:
            with self._core(project) as c:
                exists = c.execute('SELECT 1 FROM runs WHERE run_id=?', (row['reserved_run_id'],)).fetchone()
            self._status(thread_id, 'UNKNOWN' if exists else 'FAILED', 'EXECUTION_INTERRUPTED' if exists else 'EXECUTION_REJECTED')

    def _reconcile(self, thread_id, phase=None):
        row = self._row_unscoped(thread_id)
        project, _ = self._project(row['project_id'])
        with self._core(project) as c:
            run = c.execute('SELECT status,ended_at FROM runs WHERE run_id=?', (row['reserved_run_id'],)).fetchone()
            terminal = c.execute("SELECT event_type,occurred_at FROM events WHERE run_id=? AND event_type IN ('RUN_COMPLETED','RUN_FAILED') ORDER BY seq", (row['reserved_run_id'],)).fetchall()
        if run and run['status'] in ('COMPLETED','FAILED') and len(terminal) == 1 and tuple(terminal[0]) == ('RUN_' + run['status'], run['ended_at']):
            self._status(thread_id, 'FINISHED')
        elif row['status'] in (('QUEUED','PLANNING') if phase == 'planning' else ('DISPATCH_RESERVED','EXECUTING') if phase == 'execution' else ('QUEUED','PLANNING','DISPATCH_RESERVED','EXECUTING')):
            self._status(thread_id, 'UNKNOWN', 'WORKER_INTERRUPTED')

    def wait(self, project_id, thread_id, timeout=10):
        """Deterministic local test/CLI helper; HTTP uses bounded polling."""
        future = self._futures.get(thread_id)
        if future:
            future.result(timeout=timeout)
        return self.get_thread(project_id, thread_id)

    def close(self, *, wait=True):
        self._closed = True
        if self._pool:
            self._pool.shutdown(wait=wait, cancel_futures=True)
        if self._supervisor:
            self._supervisor.close(wait)
        if self._coordinator_lock:
            self._coordinator_lock.close()

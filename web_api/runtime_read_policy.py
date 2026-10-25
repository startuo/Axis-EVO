"""Administrator-pinned context/read scope, consumed by the existing exact dispatch CAS.

No provider text creates authority. No startup or read operation retries a job.
Revocation takes effect at grant and execution preflight, not during a Tool call.
"""
from functools import lru_cache
import hashlib
from pathlib import Path
import sqlite3

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from axis_evo.sandbox import Sandbox
from . import runtime_jobs
from .runtime_config import ReadPolicy
from .schemas import ApiError, strict_json

TABLES = ('runtime_read_policies', 'runtime_read_authority', 'runtime_read_admissions', 'runtime_read_approvals')


def _error():
    raise ApiError('READ_POLICY_REJECTED', 'The explicit read scope or its current authority cannot be verified.', 409)


def _canonical(value):
    return canonical_json_bytes(value).decode('utf-8')


def _digest(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _sql():
    sql = (Path(__file__).parent/'migrations/017_runtime_read_policy.sql').read_text(encoding='utf-8')
    keys = ('policy_sha256=NEW.policy_sha256', 'authority_id=NEW.authority_id',
            'job_id=NEW.job_id', 'dispatch_id=NEW.dispatch_id OR job_id=NEW.job_id OR proposal_id=NEW.proposal_id')
    for table, key in zip(TABLES, keys):
        for action in ('UPDATE', 'DELETE'):
            sql += f"\nCREATE TRIGGER {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable read policy fact'); END;"
        sql += f"\nCREATE TRIGGER {table}_no_replace BEFORE INSERT ON {table} WHEN EXISTS(SELECT 1 FROM {table} WHERE {key}) BEGIN SELECT RAISE(ABORT,'read policy identity cannot be replaced'); END;"
    return sql


def _objects(c):
    return tuple(tuple(row) for row in c.execute("SELECT type,name,tbl_name,sql FROM main.sqlite_master "
        "WHERE tbl_name IN (?,?,?,?) AND name NOT LIKE 'sqlite_%' ORDER BY type,name", TABLES))


@lru_cache(maxsize=1)
def _expected():
    c = sqlite3.connect(':memory:')
    try:
        c.executescript(_sql())
        return _objects(c)
    finally:
        c.close()


def guard(c):
    runtime_jobs._unshadowed(c)
    if (c.execute('SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN (?,?,?,?)', TABLES).fetchone()
            or _objects(c) != _expected()):
        _error()


def available(c):
    return bool(_objects(c))


def initialize(c):
    if c.in_transaction:
        raise ValueError('read policy initializer rejects caller transactions')
    if c.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        raise sqlite3.IntegrityError('read policy requires foreign keys')
    runtime_jobs._unshadowed(c)
    if runtime_jobs._objects(c) != runtime_jobs._expected():
        _error()
    if available(c):
        guard(c)
        return
    try:
        c.executescript('BEGIN IMMEDIATE;\n'+_sql())
        guard(c)
        c.commit()
    except BaseException:
        c.rollback()
        raise


def _policy(project_id, policy):
    return {'schema_version': 1, 'project_id': project_id, **policy.to_dict(),
        'model_context': 'Only scoped seed files; no prior message bodies or validation details.',
        'approval_scope': 'Entire exact read_file Plan; not write authority or a human approval.'}


def synchronize(c, projects):
    """Trusted coordinator configuration action; never HTTP- or worker-exposed."""
    guard(c)
    configured = {p.id: p.read_policy for p in projects}
    with runtime_jobs.transaction(c):
        for row in c.execute('SELECT DISTINCT project_id FROM main.runtime_read_authority').fetchall():
            configured.setdefault(row[0], None)
        for project_id, policy in configured.items():
            raw = _canonical(_policy(project_id, policy)) if policy is not None else None
            sha = _digest(raw) if raw is not None else None
            current = c.execute('SELECT policy_sha256 FROM main.runtime_read_authority WHERE project_id=? ORDER BY authority_id DESC LIMIT 1', (project_id,)).fetchone()
            if (current[0] if current else None) == sha:
                continue
            if raw is not None:
                found = c.execute('SELECT policy_json FROM main.runtime_read_policies WHERE policy_sha256=?', (sha,)).fetchone()
                if found is None:
                    runtime_jobs.one(c, 'INSERT INTO main.runtime_read_policies VALUES(?,?,?,?)', (sha, project_id, raw, utc_now()))
                elif found[0] != raw:
                    _error()
            runtime_jobs.one(c, 'INSERT INTO main.runtime_read_authority(project_id,policy_sha256,created_at) VALUES(?,?,?)', (project_id, sha, utc_now()))


def current(c, project_id, *, template_id=None):
    guard(c)
    row = c.execute('SELECT * FROM main.runtime_read_authority WHERE project_id=? ORDER BY authority_id DESC LIMIT 1', (project_id,)).fetchone()
    if row is None or row['policy_sha256'] is None:
        return None
    fact = c.execute('SELECT * FROM main.runtime_read_policies WHERE policy_sha256=?', (row['policy_sha256'],)).fetchone()
    if fact is None or _digest(fact['policy_json']) != row['policy_sha256']:
        _error()
    value = strict_json(fact['policy_json'])
    parsed = ReadPolicy.from_dict({k: value[k] for k in ('task_template_id', 'allowed_paths')})
    if value != _policy(project_id, parsed) or fact['project_id'] != project_id or _canonical(value) != fact['policy_json']:
        _error()
    if template_id is not None and parsed.task_template_id != template_id:
        return None
    return {'authorityId': row['authority_id'], 'policySha256': row['policy_sha256'], 'policy': value}


def selected(service, project_id, template_id):
    with service._web() as c:
        result = current(c, project_id, template_id=template_id) if available(c) else None
    configured = service.config.project(project_id).read_policy
    if configured and configured.task_template_id == template_id and result is None:
        _error()
    return result


def record_admission(c, job_id, selection):
    guard(c)
    if not c.in_transaction:
        raise ValueError('read admission requires owned task transaction')
    now = current(c, selection['policy']['project_id'])
    if now != selection:
        _error()
    runtime_jobs.one(c, 'INSERT INTO main.runtime_read_admissions VALUES(?,?,?,?)',
        (job_id, selection['authorityId'], selection['policySha256'], utc_now()))


def bound(c, job_id, *, require_current=False):
    if not available(c):
        return None
    guard(c)
    row = c.execute('SELECT * FROM main.runtime_read_admissions WHERE job_id=?', (job_id,)).fetchone()
    if row is None:
        return None
    authority = c.execute('SELECT * FROM main.runtime_read_authority WHERE authority_id=?', (row['authority_id'],)).fetchone()
    fact = c.execute('SELECT * FROM main.runtime_read_policies WHERE policy_sha256=?', (row['policy_sha256'],)).fetchone()
    if (authority is None or fact is None or authority['policy_sha256'] != row['policy_sha256']
            or authority['project_id'] != fact['project_id'] or _digest(fact['policy_json']) != row['policy_sha256']):
        _error()
    value = strict_json(fact['policy_json'])
    parsed = ReadPolicy.from_dict({k: value[k] for k in ('task_template_id', 'allowed_paths')})
    if _canonical(_policy(fact['project_id'], parsed)) != fact['policy_json']:
        _error()
    selection = {'authorityId': row['authority_id'], 'policySha256': row['policy_sha256'], 'policy': value}
    if require_current and current(c, fact['project_id']) != selection:
        _error()
    return selection


def validate_plan(directory, proposal, selection):
    """Whole-plan check. Resolver and existing Web gate retain filesystem authority."""
    allowed = selection['policy']['allowed_paths']
    sandbox = Sandbox(Path(directory)/'seed')
    for step in proposal.plan:
        if step.tool_name != 'read_file' or step.arguments.keys() != {'path'} or step.arguments['path'] not in allowed:
            _error()
        sandbox.resolve(step.arguments['path'])


def normal_planning_worker(c, job_id, *, exit_observation_id=None):
    claims = c.execute("SELECT worker_identity FROM main.runtime_worker_claims WHERE job_id=? AND phase='planning'", (job_id,)).fetchall()
    if len(claims) != 1:
        _error()
    worker = claims[0][0]
    facts = c.execute('SELECT * FROM main.runtime_worker_observations WHERE job_id=? AND (? IS NULL OR observation_id<=?) ORDER BY observation_id',
        (job_id, exit_observation_id, exit_observation_id)).fetchall()
    if len(facts) != 2 or any(row['worker_identity'] != worker for row in facts):
        _error()
    start, end = facts
    first, last = strict_json(start['detail_json']), strict_json(end['detail_json'])
    if (start['kind'] != 'START_OBSERVED' or end['kind'] != 'EXIT_OBSERVED'
            or first.get('phase') != 'planning' or last != {'phase': 'planning', 'exitCode': 0}
            or type(last['exitCode']) is not int):
        _error()
    if exit_observation_id is not None and end['observation_id'] != exit_observation_id:
        _error()
    return worker, end['observation_id']


def record_approval(c, row, proposal, dispatch):
    selection = bound(c, row['id'], require_current=True)
    if selection is None:
        _error()
    worker, exit_id = normal_planning_worker(c, row['id'])
    runtime_jobs.one(c, 'INSERT INTO main.runtime_read_approvals VALUES(?,?,?,?,?,?,?,?,?)',
        (dispatch, row['id'], selection['authorityId'], selection['policySha256'],
         proposal.proposal_id, proposal.plan_sha256, worker, exit_id, utc_now()))


def describe(c, job_id):
    selection = bound(c, job_id)
    if selection is None:
        return None
    receipt = c.execute('SELECT * FROM main.runtime_read_approvals WHERE job_id=?', (job_id,)).fetchone()
    result = {'policySha256': selection['policySha256'], 'authorityId': selection['authorityId'],
        'allowedPaths': selection['policy']['allowed_paths'], 'approvalSource': 'POLICY' if receipt else None}
    if receipt:
        worker, _ = normal_planning_worker(c, job_id, exit_observation_id=receipt['planning_exit_observation_id'])
        dispatch = c.execute('SELECT * FROM main.runtime_dispatches WHERE dispatch_id=?', (receipt['dispatch_id'],)).fetchone()
        if (dispatch is None or dispatch['job_id'] != job_id or receipt['policy_sha256'] != selection['policySha256']
                or receipt['authority_id'] != selection['authorityId']
                or dispatch['proposal_id'] != receipt['proposal_id'] or dispatch['approved_plan_sha256'] != receipt['approved_plan_sha256']
                or worker != receipt['planning_worker']):
            _error()
        result.update(dispatchId=receipt['dispatch_id'], approvedPlanSha256=receipt['approved_plan_sha256'],
            planningWorker=receipt['planning_worker'], planningExitObservationId=receipt['planning_exit_observation_id'])
    return result

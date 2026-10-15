"""Owned Web-only transactions for non-replayable worker admission."""
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
import sqlite3
from uuid import uuid4

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from .schemas import ApiError, strict_json

TABLES = ('runtime_jobs', 'runtime_dispatches', 'runtime_worker_claims', 'runtime_worker_observations')


def _sql():
    sql = (Path(__file__).parent / 'migrations/011_runtime_jobs.sql').read_text(encoding='utf-8')
    for table in TABLES:
        sql += f"\nCREATE TRIGGER {table}_no_delete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT,'runtime facts retained'); END;"
        if table != 'runtime_jobs':
            sql += f"\nCREATE TRIGGER {table}_no_update BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT,'runtime facts immutable'); END;"
        # REPLACE cannot remove a conflicting identity even with recursive_triggers OFF.
        conflict = {'runtime_jobs': 'job_id=NEW.job_id', 'runtime_dispatches':
            'dispatch_id=NEW.dispatch_id OR job_id=NEW.job_id OR proposal_id=NEW.proposal_id OR reserved_run_id=NEW.reserved_run_id OR worker_identity=NEW.worker_identity',
            'runtime_worker_claims': '(job_id=NEW.job_id AND phase=NEW.phase) OR worker_identity=NEW.worker_identity OR dispatch_id=NEW.dispatch_id',
            'runtime_worker_observations': 'observation_id=NEW.observation_id'}[table]
        sql += f"\nCREATE TRIGGER {table}_no_replace BEFORE INSERT ON {table} WHEN EXISTS(SELECT 1 FROM {table} WHERE {conflict}) BEGIN SELECT RAISE(ABORT,'runtime facts cannot be replaced'); END;"
    return sql


def _objects(c):
    return tuple(tuple(row) for row in c.execute("SELECT type,name,tbl_name,sql FROM main.sqlite_master WHERE tbl_name IN (?,?,?,?) AND name NOT LIKE 'sqlite_%' ORDER BY type,name", TABLES))


@lru_cache(maxsize=1)
def _expected():
    c = sqlite3.connect(':memory:')
    try:
        c.executescript(_sql())
        return _objects(c)
    finally:
        c.close()


def _unshadowed(c):
    if c.execute("SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN (?,?,?,?,?)", (*TABLES, 'runtime_threads')).fetchone():
        raise sqlite3.IntegrityError('TEMP runtime fact shadowing rejected')


def initialize(c):
    if c.in_transaction:
        raise ValueError('runtime job initializer rejects active caller transactions')
    _unshadowed(c)
    if c.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        raise sqlite3.IntegrityError('runtime jobs require foreign_keys=ON')
    existing = _objects(c)
    if existing:
        if existing != _expected():
            raise sqlite3.IntegrityError('unexpected runtime job schema')
        return
    try:
        c.executescript('BEGIN IMMEDIATE;\n' + _sql())
        if _objects(c) != _expected():
            raise sqlite3.IntegrityError('unexpected runtime job schema')
        c.commit()
    except BaseException:
        c.rollback()
        raise


@contextmanager
def transaction(c):
    if c.in_transaction:
        raise ValueError('runtime jobs reject active caller transactions')
    _unshadowed(c)
    c.execute('BEGIN IMMEDIATE')
    try:
        yield
        c.commit()
    except BaseException:
        c.rollback()
        raise


def one(c, sql, args):
    _unshadowed(c)
    if c.execute(sql, args).rowcount != 1:
        raise sqlite3.IntegrityError('runtime fact write was ignored')


def admission(c, row, identity):
    # Called in the same admission transaction as runtime_threads INSERT.
    _unshadowed(c)
    if not c.in_transaction:
        raise ValueError('admission requires an owned transaction')
    if c.execute("SELECT count(*) FROM main.runtime_jobs WHERE state NOT IN ('FINISHED','FAILED','OUTCOME_UNKNOWN','AWAITING_APPROVAL')").fetchone()[0] >= 8:
        raise ApiError('RUNTIME_BUSY', 'The durable runtime queue is full.', 429)
    one(c, 'INSERT INTO main.runtime_jobs VALUES(?,?,?,?,?)', (row, canonical_json_bytes(identity).decode(), 'QUEUED', utc_now(), utc_now()))


def transition(c, job_id, state):
    one(c, 'UPDATE main.runtime_jobs SET state=?,updated_at=? WHERE job_id=?', (state, utc_now(), job_id))


def reserve(c, row, proposal):
    # Caller already owns BEGIN IMMEDIATE; approval CAS and reservation are one commit.
    dispatch, worker = 'dispatch_' + uuid4().hex, 'worker_' + uuid4().hex
    one(c, 'INSERT INTO main.runtime_dispatches VALUES(?,?,?,?,?,?,?)',
        (dispatch, row['id'], proposal.proposal_id, proposal.plan_sha256, row['reserved_run_id'], worker, utc_now()))
    transition(c, row['id'], 'DISPATCH_RESERVED')
    return dispatch, worker


def claim(c, job_id, phase, worker, dispatch=None):
    if phase not in ('planning', 'execution') or (phase == 'planning') != (dispatch is None):
        raise ValueError('invalid worker phase/dispatch')
    with transaction(c):
        row = c.execute('SELECT state FROM main.runtime_jobs WHERE job_id=?', (job_id,)).fetchone()
        expected = 'QUEUED' if phase == 'planning' else 'DISPATCH_RESERVED'
        if row is None or row[0] != expected:
            raise sqlite3.IntegrityError('job is not claimable')
        if phase == 'execution':
            pinned = c.execute('SELECT job_id,worker_identity FROM main.runtime_dispatches WHERE dispatch_id=?', (dispatch,)).fetchone()
            if pinned is None or tuple(pinned) != (job_id, worker):
                raise sqlite3.IntegrityError('dispatch identity mismatch')
        one(c, 'INSERT INTO main.runtime_worker_claims VALUES(?,?,?,?,?)', (job_id, phase, worker, dispatch, utc_now()))
        transition(c, job_id, 'PLANNING' if phase == 'planning' else 'EXECUTING')


def observation(c, job_id, worker, kind, detail):
    one(c, 'INSERT INTO main.runtime_worker_observations(job_id,worker_identity,kind,detail_json,observed_at) VALUES(?,?,?,?,?)',
        (job_id, worker, kind, canonical_json_bytes(detail).decode(), utc_now()))


def snapshot(c, job_id):
    _unshadowed(c)
    job = c.execute('SELECT * FROM main.runtime_jobs WHERE job_id=?', (job_id,)).fetchone()
    if job is None:
        return None
    dispatch = c.execute('SELECT * FROM main.runtime_dispatches WHERE job_id=?', (job_id,)).fetchone()
    observations = [dict(row) for row in c.execute('SELECT * FROM main.runtime_worker_observations WHERE job_id=? ORDER BY observation_id', (job_id,))]
    worker = dispatch['worker_identity'] if dispatch else next((o['worker_identity'] for o in reversed(observations) if o['worker_identity']), None)
    current = [o for o in observations if o['worker_identity'] == worker]
    return {'jobId': job_id, 'jobState': job['state'], 'identity': strict_json(job['identity_json']),
        'dispatchId': dispatch['dispatch_id'] if dispatch else None,
        'workerIdentity': worker,
        'workerAssigned': bool(worker), 'workerExitObserved': any(o['kind'] == 'EXIT_OBSERVED' for o in current),
        'exitCode': next((strict_json(o['detail_json']).get('exitCode') for o in reversed(current) if o['kind'] == 'EXIT_OBSERVED'), None),
        'supervisionLost': any(o['kind'] == 'SUPERVISION_LOST' and o['worker_identity'] in (None, worker) for o in observations),
        'observations': [{'kind': o['kind'], 'detail': strict_json(o['detail_json']), 'observedAt': o['observed_at']} for o in observations]}

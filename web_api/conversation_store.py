"""Explicit Web-only immutable conversation schema and guarded fact operations."""
from contextlib import contextmanager
from functools import lru_cache
import hashlib
from pathlib import Path
import re
import sqlite3

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from .schemas import ApiError, strict_json

TABLES = ('runtime_conversations','runtime_turns','runtime_messages','runtime_contexts','runtime_turn_observations')
MAX_TURNS = 16
MAX_HISTORY_TURNS = 4
MAX_CONTEXT_BYTES = 48 * 1024
MAX_MESSAGE_BYTES = 32 * 1024


def digest(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def identity(value, prefix):
    if type(value) is not str or not re.fullmatch(prefix+'_[0-9a-f]{32}',value):
        raise ApiError('CONVERSATION_NOT_FOUND','The conversation identity is unavailable.',404)
    return value


def _sql():
    sql=(Path(__file__).parent/'migrations/012_runtime_conversations.sql').read_text(encoding='utf-8')
    conflicts={
        'runtime_conversations':'conversation_id=NEW.conversation_id',
        'runtime_turns':'turn_id=NEW.turn_id OR thread_id=NEW.thread_id OR user_message_id=NEW.user_message_id OR reserved_run_id=NEW.reserved_run_id OR (conversation_id=NEW.conversation_id AND turn_number=NEW.turn_number)',
        'runtime_messages':'message_id=NEW.message_id',
        'runtime_contexts':'turn_id=NEW.turn_id',
        'runtime_turn_observations':'observation_id=NEW.observation_id OR (turn_id=NEW.turn_id AND kind=NEW.kind AND payload_sha256=NEW.payload_sha256)'}
    for table in TABLES:
        for action in ('UPDATE','DELETE'):
            sql+=f"\nCREATE TRIGGER {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable conversation fact'); END;"
        sql+=f"\nCREATE TRIGGER {table}_no_replace BEFORE INSERT ON {table} WHEN EXISTS(SELECT 1 FROM {table} WHERE {conflicts[table]}) BEGIN SELECT RAISE(ABORT,'conversation identity cannot be replaced'); END;"
    return sql


def _objects(c):
    return tuple(tuple(row) for row in c.execute("SELECT type,name,tbl_name,sql FROM main.sqlite_master WHERE tbl_name IN (?,?,?,?,?) AND name NOT LIKE 'sqlite_%' ORDER BY type,name",TABLES))


@lru_cache(maxsize=1)
def _expected():
    c=sqlite3.connect(':memory:')
    try:c.executescript(_sql());return _objects(c)
    finally:c.close()


def unshadowed(c):
    names=(*TABLES,'runtime_threads','runtime_jobs','runtime_dispatches')
    if c.execute('SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN ('+','.join('?' for _ in names)+')',names).fetchone():
        raise sqlite3.IntegrityError('TEMP conversation fact shadowing rejected')


def guard(c):
    unshadowed(c)
    if _objects(c)!=_expected():
        raise ApiError('CONVERSATION_INTEGRITY','Conversation storage cannot be verified.',409)


def initialize(c):
    if c.in_transaction:raise ValueError('conversation initializer rejects caller transactions')
    unshadowed(c)
    if c.execute('PRAGMA foreign_keys').fetchone()[0]!=1:
        raise sqlite3.IntegrityError('conversation facts require foreign keys')
    if c.execute("SELECT count(*) FROM main.sqlite_master WHERE type='table' AND name IN ('runtime_threads','runtime_jobs','runtime_dispatches')").fetchone()[0]!=3:
        raise sqlite3.IntegrityError('conversation schema requires existing Web runtime 011')
    if _objects(c):guard(c);return
    try:
        c.executescript('BEGIN IMMEDIATE;\n'+_sql())
        guard(c)
        c.commit()
    except BaseException:c.rollback();raise


@contextmanager
def snapshot(c):
    if c.in_transaction:raise ValueError('conversation read owns its snapshot')
    guard(c)
    c.execute('BEGIN')
    try:yield
    finally:c.rollback()


def one(c,sql,args):
    unshadowed(c)
    if c.execute(sql,args).rowcount!=1:raise sqlite3.IntegrityError('conversation fact write was ignored')


def context(c,turn_id):
    guard(c)
    row=c.execute('SELECT * FROM main.runtime_contexts WHERE turn_id=?',(turn_id,)).fetchone()
    if row is None:raise ApiError('CONVERSATION_INTEGRITY','Turn context is missing.',409)
    raw=row['context_json']
    if len(raw.encode('utf-8'))>MAX_CONTEXT_BYTES:
        raise ApiError('CONVERSATION_INTEGRITY','Turn context exceeds its budget.',409)
    value=strict_json(raw,MAX_CONTEXT_BYTES)
    if canonical_json_bytes(value).decode()!=raw or digest(value)!=row['context_sha256']:
        raise ApiError('CONVERSATION_INTEGRITY','Turn context digest disagrees.',409)
    return value,row['context_sha256'],raw


def observe(c,turn_id,kind,payload):
    guard(c)
    raw=canonical_json_bytes(payload).decode()
    sha=digest(payload)
    previous=c.execute('SELECT payload_json FROM main.runtime_turn_observations WHERE turn_id=? AND kind=? AND payload_sha256=?',(turn_id,kind,sha)).fetchone()
    if previous is not None:
        if previous[0]!=raw:raise sqlite3.IntegrityError('observation digest collision')
        return
    if len(raw.encode('utf-8'))>4096 or c.execute('SELECT count(*) FROM main.runtime_turn_observations WHERE turn_id=?',(turn_id,)).fetchone()[0]>=64:
        raise sqlite3.IntegrityError('conversation observation budget exceeded')
    one(c,'INSERT INTO main.runtime_turn_observations(turn_id,kind,payload_json,payload_sha256,observed_at) VALUES(?,?,?,?,?)',
        (turn_id,kind,raw,sha,utc_now()))

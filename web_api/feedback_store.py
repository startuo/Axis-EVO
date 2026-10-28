"""Append-only, bounded Web feedback facts in the existing Runtime database."""
from functools import lru_cache
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from .evolution_store import transaction
from .revision_protocol import digest
from .schemas import strict_json

_SQL = Path(__file__).with_name('migrations') / '018_web_task_feedback.sql'
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')
MAX_BYTES = 16384


def _objects(c):
    return tuple(tuple(r) for r in c.execute("SELECT type,name,tbl_name,sql FROM main.sqlite_master "
        "WHERE tbl_name='web_feedback_facts' AND name NOT LIKE 'sqlite_%' ORDER BY type,name"))


@lru_cache(maxsize=1)
def _expected():
    c = sqlite3.connect(':memory:')
    try:
        c.executescript(_SQL.read_text(encoding='utf-8'))
        return _objects(c)
    finally:
        c.close()


def guard(c):
    if (c.execute("SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN "
            "('web_feedback_facts','runtime_threads')").fetchone() or _objects(c) != _expected()):
        raise ValueError('Explicit feedback schema setup is required; incompatible schemas are rejected')


def initialize(c):
    if c.in_transaction or c.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        raise ValueError('Feedback setup requires an owned FK-enforced transaction')
    if _objects(c):
        guard(c)
        return
    with transaction(c):
        statement = ''
        for line in _SQL.read_text(encoding='utf-8').splitlines(True):
            statement += line
            if sqlite3.complete_statement(statement):
                c.execute(statement)
                statement = ''
        guard(c)


def _row(row):
    v = {'id': row['id'], 'projectId': row['project_id'], 'threadId': row['thread_id'],
        'kind': row['kind'], 'parentId': row['parent_id'], 'slot': row['slot'],
        'body': strict_json(row['body_json'], MAX_BYTES), 'createdAt': row['created_at']}
    if canonical_json_bytes(v['body']).decode() != row['body_json'] or digest(v) != row['fact_sha256']:
        raise ValueError('Feedback fact identity mismatch')
    return {**v, 'sha256': row['fact_sha256']}


def load(c, project, identity, kind=None):
    guard(c)
    row = c.execute('SELECT * FROM main.web_feedback_facts WHERE project_id=? AND id=?', (project, identity)).fetchone()
    if row is None or kind is not None and row['kind'] != kind:
        raise ValueError('Feedback fact is missing or foreign')
    return _row(row)


def insert(c, project, thread, kind, body, *, identity=None, parent=None, slot=None):
    guard(c)
    if not c.in_transaction:
        raise ValueError('Feedback insert requires an owned transaction')
    identity = identity or 'feedback_' + uuid4().hex
    slot = slot or identity
    for v in (project, thread, identity, kind, parent or 'root', slot):
        if type(v) is not str or not _ID.fullmatch(v):
            raise ValueError('Invalid bounded identity')
    if (c.execute('SELECT count(*) FROM main.web_feedback_facts').fetchone()[0] >= 8192
            or c.execute('SELECT count(*) FROM main.web_feedback_facts WHERE thread_id=?', (thread,)).fetchone()[0] >= 128):
        raise ValueError('Feedback history capacity reached')
    encoded = canonical_json_bytes(body)
    strict_json(encoded, MAX_BYTES)
    v = {'id': identity, 'projectId': project, 'threadId': thread, 'kind': kind, 'parentId': parent,
        'slot': slot, 'body': body, 'createdAt': utc_now()}
    sha = digest(v)
    cursor = c.execute('INSERT INTO main.web_feedback_facts VALUES(?,?,?,?,?,?,?,?,?)',
        (identity, project, thread, kind, parent, slot, encoded.decode(), sha, v['createdAt']))
    if cursor.rowcount != 1 or load(c, project, identity) != {**v, 'sha256': sha}:
        raise ValueError('Feedback write was not fully applied')
    return {**v, 'sha256': sha}


def records(c, project, thread, kind='FEEDBACK'):
    guard(c)
    return [_row(r) for r in c.execute('SELECT * FROM main.web_feedback_facts '
        'WHERE project_id=? AND thread_id=? AND kind=? ORDER BY rowid LIMIT 129', (project, thread, kind))]

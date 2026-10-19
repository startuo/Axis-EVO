"""Small append-only Web fact store; never pretends two databases are atomic."""
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes

from .revision_protocol import digest
from .schemas import strict_json

_SQL = Path(__file__).with_name('migrations') / '013_web_skill_evolution.sql'
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')
MAX_FACT_BYTES = 192 * 1024
MAX_FACTS = 8192


def _objects(c):
    return tuple(tuple(row) for row in c.execute("SELECT type,name,tbl_name,sql FROM main.sqlite_master "
        "WHERE tbl_name='web_evolution_facts' AND name NOT LIKE 'sqlite_%' ORDER BY type,name"))


@lru_cache(maxsize=1)
def _expected():
    c = sqlite3.connect(':memory:')
    try:
        c.executescript(_SQL.read_text(encoding='utf-8'))
        return _objects(c)
    finally:
        c.close()


def guard(c):
    if (c.execute("SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE='web_evolution_facts'").fetchone()
            or _objects(c) != _expected()):
        raise ValueError('Web evolution schema is missing, shadowed or unexpected')


@contextmanager
def transaction(c):
    if c.in_transaction:
        raise ValueError('Evolution requires an owned SQLite transaction')
    c.execute('BEGIN IMMEDIATE')
    try:
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise


def initialize(c):
    if c.in_transaction or c.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        raise ValueError('Evolution initialization requires FK enforcement and no caller transaction')
    if _objects(c):
        guard(c)
        return
    # Execute statements individually: executescript would implicitly COMMIT a
    # caller transaction. complete_statement preserves trigger bodies atomically.
    with transaction(c):
        statement = ''
        for line in _SQL.read_text(encoding='utf-8').splitlines(True):
            statement += line
            if sqlite3.complete_statement(statement):
                c.execute(statement)
                statement = ''
        guard(c)


def insert(c, project, kind, body, *, identity=None, parent=None, slot=None):
    if not c.in_transaction:
        raise ValueError('Web fact insert requires the owned write transaction')
    guard(c)
    identity = identity or 'evo_' + uuid4().hex
    for value in (identity, project, kind, parent or 'root', slot or parent or identity):
        if type(value) is not str or not _ID.fullmatch(value):
            raise ValueError('Invalid bounded Web fact identity')
    encoded = canonical_json_bytes(body)
    body = strict_json(encoded, MAX_FACT_BYTES)
    if c.execute('SELECT count(*) FROM main.web_evolution_facts').fetchone()[0] >= MAX_FACTS:
        raise ValueError('Web evolution history capacity reached')
    value = {'id': identity, 'projectId': project, 'kind': kind, 'parentId': parent,
             'slot': slot or parent or identity, 'body': body, 'createdAt': utc_now()}
    sha = digest(value)
    cursor = c.execute('INSERT INTO main.web_evolution_facts VALUES(?,?,?,?,?,?,?,?)',
        (identity, project, kind, parent, value['slot'], encoded.decode('utf-8'), sha, value['createdAt']))
    if cursor.rowcount != 1:
        raise sqlite3.IntegrityError('Web evolution insertion was not applied')
    result = load(c, project, identity)
    if result != {**value, 'sha256': sha}:
        raise ValueError('Web evolution inserted fact differs')
    return result


def _row(row):
    value = {'id': row['id'], 'projectId': row['project_id'], 'kind': row['kind'],
             'parentId': row['parent_id'], 'slot': row['slot'],
             'body': strict_json(row['body_json'], MAX_FACT_BYTES), 'createdAt': row['created_at']}
    if (canonical_json_bytes(value['body']).decode('utf-8') != row['body_json']
            or digest(value) != row['fact_sha256']):
        raise ValueError('Web evolution fact bytes or identity hash mismatch')
    return {**value, 'sha256': row['fact_sha256']}


def load(c, project, identity, *, kind=None):
    guard(c)
    row = c.execute('SELECT * FROM main.web_evolution_facts WHERE id=? AND project_id=?',
                    (identity, project)).fetchone()
    if row is None or kind is not None and row['kind'] != kind:
        raise ValueError('Web evolution fact does not belong to this project or kind')
    return _row(row)


def children(c, project, parent, kind=None):
    guard(c)
    return [_row(row) for row in c.execute('SELECT * FROM main.web_evolution_facts '
        'WHERE project_id=? AND parent_id=? AND (? IS NULL OR kind=?) ORDER BY rowid',
        (project, parent, kind, kind))]


def roots(c, project, kind):
    guard(c)
    return [_row(row) for row in c.execute('SELECT * FROM main.web_evolution_facts '
        'WHERE project_id=? AND kind=? ORDER BY rowid DESC LIMIT 64', (project, kind))]

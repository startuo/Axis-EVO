"""Append-only product Agent journal. No research database is opened here."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from .schemas import ApiError, no_redirected_parents, strict_json

MAX_RECORD_BYTES = 512 * 1024
MAX_STORE_BYTES = 256 * 1024 * 1024
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z')
_SCHEMA = """
CREATE TABLE agent_records(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL, workspace_id TEXT NOT NULL, parent_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX agent_records_lookup ON agent_records(kind,workspace_id,parent_id,seq);
CREATE TRIGGER agent_records_no_update BEFORE UPDATE ON agent_records
 BEGIN SELECT RAISE(ABORT,'immutable agent fact'); END;
CREATE TRIGGER agent_records_no_delete BEFORE DELETE ON agent_records
 BEGIN SELECT RAISE(ABORT,'retained agent fact'); END;
CREATE TRIGGER agent_records_no_replace BEFORE INSERT ON agent_records
 WHEN EXISTS(SELECT 1 FROM agent_records WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'agent identity cannot be replaced'); END;
"""


def canonical(value):
    return canonical_json_bytes(value).decode('utf-8')


def digest(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def identity(value):
    if type(value) is not str or not _ID.fullmatch(value):
        raise ApiError('AGENT_ID_INVALID', '记录标识无效。')
    return value


def _objects(c):
    return tuple(tuple(r) for r in c.execute("SELECT type,name,sql FROM sqlite_master "
        "WHERE tbl_name='agent_records' AND name NOT LIKE 'sqlite_%' ORDER BY type,name"))


def _expected():
    with sqlite3.connect(':memory:') as c:
        c.executescript(_SCHEMA)
        return _objects(c)


EXPECTED = _expected()

_FENCE_TABLE = """
CREATE TABLE agent_fenced_paths(
 path_key TEXT NOT NULL,
 intent_id TEXT NOT NULL REFERENCES agent_records(id),
 PRIMARY KEY(path_key,intent_id));
"""
_FENCE_INDEX = "CREATE INDEX agent_fenced_paths_intent ON agent_fenced_paths(intent_id);"


def _fence_objects(c):
    return tuple(tuple(row) for row in c.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE tbl_name='agent_fenced_paths' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
    ))


def _expected_fence_objects():
    with sqlite3.connect(':memory:') as c:
        c.execute(_FENCE_TABLE)
        c.execute(_FENCE_INDEX)
        return _fence_objects(c)


EXPECTED_FENCES = _expected_fence_objects()


def _path_key(path):
    return Path(os.path.normcase(os.path.normpath(path))).as_posix()


class AgentStore:
    def __init__(self, data_dir):
        self.directory = Path(data_dir).absolute()
        self.path = self.directory / 'agent.sqlite3'
        no_redirected_parents(self.directory)
        no_redirected_parents(self.path)

    @property
    def prepared(self):
        return self.path.is_file()

    def prepare(self):
        """Only explicit authenticated workspace setup initializes product state."""
        self.directory.mkdir(parents=True, exist_ok=True)
        no_redirected_parents(self.path)
        c = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        try:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA synchronous=FULL')
            if not _objects(c):
                c.executescript('BEGIN IMMEDIATE;'+_SCHEMA+'COMMIT;')
            if _objects(c) != EXPECTED:
                raise ApiError('AGENT_STORE_INTEGRITY', 'Agent 存储结构无法核对。', 409)
        finally:
            c.close()
        self.prepare_projection()

    def prepare_projection(self):
        """Migrate the derived write fences in one transaction before serving."""
        with self.connect(write=True) as c:
            current = _fence_objects(c)
            if current == EXPECTED_FENCES:
                return
            if current:
                raise ApiError('AGENT_STORE_INTEGRITY', '写入围栏结构无法核对。', 409)
            c.execute(_FENCE_TABLE)
            c.execute(_FENCE_INDEX)
            receipts = {}
            for row in c.execute("SELECT * FROM agent_records WHERE kind='tool_result' ORDER BY seq"):
                receipt = self._decode(row)
                receipts[(receipt['parentId'], receipt['payload'].get('intentId'))] = receipt['payload']['status']
            for row in c.execute("SELECT * FROM agent_records WHERE kind='tool_intent' ORDER BY seq"):
                intent = self._decode(row)
                if receipts.get((intent['parentId'], intent['id']), 'UNKNOWN') == 'UNKNOWN':
                    self._project_intent(c, intent['id'], intent['workspaceId'], intent['payload'])

    def _project_intent(self, c, record_id, workspace_id, payload):
        if not payload.get('mutating'):
            return
        paths = payload.get('canonicalPaths') or [payload.get('canonicalPath')]
        if paths == [None]:
            workspace = self._decode(c.execute("SELECT * FROM agent_records WHERE id=? AND kind='workspace'",
                                               (workspace_id,)).fetchone())
            paths = [str((Path(workspace['payload']['path']) / payload['path']).resolve())]
        c.executemany('INSERT OR IGNORE INTO agent_fenced_paths(path_key,intent_id) VALUES(?,?)',
                      ((_path_key(path), record_id) for path in paths))

    def _project_receipt(self, c, parent_id, payload):
        intent_id = payload.get('intentId')
        if not intent_id:
            return
        if payload['status'] != 'UNKNOWN':
            c.execute('DELETE FROM agent_fenced_paths WHERE intent_id IN '
                      "(SELECT id FROM agent_records WHERE id=? AND parent_id=? AND kind='tool_intent')",
                      (intent_id, parent_id))
            return
        row = c.execute("SELECT * FROM agent_records WHERE id=? AND parent_id=? AND kind='tool_intent'",
                        (intent_id, parent_id)).fetchone()
        if row is not None:
            intent = self._decode(row)
            self._project_intent(c, intent_id, intent['workspaceId'], intent['payload'])

    def has_fenced_path(self, paths):
        """Match exact paths, ancestors, and descendants using the path index."""
        with self.connect() as c:
            if _fence_objects(c) != EXPECTED_FENCES:
                raise ApiError('AGENT_STORE_INTEGRITY', '写入围栏结构无法核对。', 409)
            for value in paths:
                path = Path(value)
                ancestors = [_path_key(parent) for parent in (path, *path.parents)]
                slots = ','.join('?' for _ in ancestors)
                if c.execute(f'SELECT 1 FROM agent_fenced_paths WHERE path_key IN ({slots}) LIMIT 1',
                             ancestors).fetchone():
                    return True
                prefix = _path_key(path).rstrip('/')
                if c.execute('SELECT 1 FROM agent_fenced_paths WHERE path_key>=? AND path_key<? LIMIT 1',
                             (prefix+'/', prefix+'0')).fetchone():
                    return True
        return False

    @contextmanager
    def connect(self, *, write=False):
        no_redirected_parents(self.path)
        if not self.path.is_file() or self.path.stat().st_size > MAX_STORE_BYTES:
            raise ApiError('AGENT_STORAGE_UNAVAILABLE', '请先创建工作区，或检查本地存储容量。', 409)
        c = sqlite3.connect(self.path.as_uri()+'?mode=rw', uri=True, isolation_level=None, timeout=5)
        c.row_factory = sqlite3.Row
        try:
            c.execute('PRAGMA synchronous=FULL')
            c.execute('PRAGMA foreign_keys=ON')
            if _objects(c) != EXPECTED or c.execute('PRAGMA journal_mode').fetchone()[0] != 'wal':
                raise ApiError('AGENT_STORE_INTEGRITY', 'Agent 持久记录无法核对。', 409)
            if write:
                c.execute('BEGIN IMMEDIATE')
                if c.execute('PRAGMA page_count').fetchone()[0]*c.execute('PRAGMA page_size').fetchone()[0] > MAX_STORE_BYTES:
                    raise ApiError('AGENT_STORAGE_LIMIT', 'Agent 持久记录达到容量限制。', 409)
            yield c
            if write:
                c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def _decode(self, row):
        if row is None:
            raise ApiError('AGENT_RECORD_MISSING', '记录不存在。', 404)
        raw = row['payload_json']
        if hashlib.sha256(raw.encode('utf-8')).hexdigest() != row['payload_sha256']:
            raise ApiError('AGENT_STORE_INTEGRITY', '记录摘要无法核对。', 409)
        payload = strict_json(raw, MAX_RECORD_BYTES)
        if type(payload) is not dict or canonical(payload) != raw:
            raise ApiError('AGENT_STORE_INTEGRITY', '记录内容无法核对。', 409)
        return {'id': row['id'], 'kind': row['kind'], 'workspaceId': row['workspace_id'],
                'parentId': row['parent_id'], 'payload': payload, 'createdAt': row['created_at']}

    def append(self, kind, payload, workspace_id='', parent_id='', identity=None):
        record_id = identity or kind+'_'+uuid4().hex
        globals()['identity'](record_id)
        globals()['identity'](kind)
        if workspace_id:
            globals()['identity'](workspace_id)
        if parent_id:
            globals()['identity'](parent_id)
        if type(payload) is not dict:
            raise ValueError('Agent fact payload must be an object')
        raw = canonical(payload)
        strict_json(raw, MAX_RECORD_BYTES)
        created = utc_now()
        with self.connect(write=True) as c:
            c.execute('INSERT INTO agent_records(id,kind,workspace_id,parent_id,payload_json,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?)',
                (record_id, kind, workspace_id, parent_id, raw, hashlib.sha256(raw.encode()).hexdigest(), created))
            if kind == 'tool_intent':
                self._project_intent(c, record_id, workspace_id, payload)
            elif kind == 'tool_result':
                self._project_receipt(c, parent_id, payload)
        return {'id':record_id,'kind':kind,'workspaceId':workspace_id,'parentId':parent_id,'payload':payload,'createdAt':created}

    def get(self, record_id, kind=None):
        identity(record_id)
        with self.connect() as c:
            row = self._decode(c.execute('SELECT * FROM agent_records WHERE id=?', (record_id,)).fetchone())
        if kind is not None and row['kind'] != kind:
            raise ApiError('AGENT_RECORD_KIND', '记录类型不匹配。', 409)
        return row

    def records(self, kind=None, workspace_id=None, parent_id=None, limit=1000):
        if not self.prepared:
            return []
        if type(limit) is not int or not 1 <= limit <= 10000:
            raise ValueError('Invalid Agent query budget')
        clauses, values = [], []
        for column, value in (('kind',kind), ('workspace_id',workspace_id), ('parent_id',parent_id)):
            if value is not None:
                clauses.append(column+'=?')
                values.append(value)
        query = 'SELECT * FROM agent_records'+(' WHERE '+' AND '.join(clauses) if clauses else '')+' ORDER BY seq DESC LIMIT ?'
        with self.connect() as c:
            rows = c.execute(query, (*values, limit)).fetchall()
        return [self._decode(row) for row in reversed(rows)]

    def iter_records(self, kind=None, workspace_id=None, parent_id=None):
        """Complete history for authority/recovery checks, separate from UI paging."""
        if not self.prepared:
            return
        clauses, values = [], []
        for column, value in (('kind',kind), ('workspace_id',workspace_id), ('parent_id',parent_id)):
            if value is not None:
                clauses.append(column+'=?')
                values.append(value)
        after = 0
        while True:
            query = 'SELECT * FROM agent_records WHERE '+ ' AND '.join([*clauses,'seq>?'])+' ORDER BY seq LIMIT 256'
            with self.connect() as c:
                rows = c.execute(query, (*values,after)).fetchall()
            if not rows:
                return
            for row in rows:
                yield self._decode(row)
            after = rows[-1]['seq']

"""Optional append-only browser facts; never alter Core or historical outcomes."""
from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from axis_evo.events import utc_now
from .schemas import ApiError, strict_json

SCHEMA = Path(__file__).with_name('migrations').joinpath('019_web_browser.sql').read_text(encoding='utf-8')
TERMINAL = ('RESULT', 'REJECTED', 'UNKNOWN')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def available(c):
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_operations'").fetchone() is not None


def initialize(c):
    if available(c):
        guard(c)
        return
    try:
        c.executescript('BEGIN IMMEDIATE;' + SCHEMA)
        c.commit()
    except BaseException:
        c.rollback()
        raise
    guard(c)


def objects(c):
    return tuple(tuple(r) for r in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN "
        "('browser_operations','browser_operation_facts') AND name NOT LIKE 'sqlite_%' ORDER BY type,name"))


def guard(c):
    reference = sqlite3.connect(':memory:')
    try:
        reference.executescript(SCHEMA)
        if objects(c) != objects(reference):
            raise ApiError('BROWSER_STORAGE_UNPREPARED', '请显式准备浏览器存储；不会自动更改现有数据库。', 503)
        if c.execute("SELECT 1 FROM sqlite_temp_master WHERE name IN ('browser_operations','browser_operation_facts')").fetchone():
            raise ApiError('BROWSER_STORAGE_REJECTED', '浏览器记录身份不一致。', 409)
    finally:
        reference.close()


@contextmanager
def write(c):
    guard(c)
    c.execute('BEGIN IMMEDIATE')
    try:
        yield
        c.commit()
    except BaseException:
        c.rollback()
        raise


class BrowserStore:
    def __init__(self, providers):
        self.providers = providers

    def create(self, instance, binding, action, request):
        operation = 'edgeop_' + uuid4().hex
        raw = canonical(request)
        if len(raw.encode()) > 32768:
            raise ApiError('BROWSER_REQUEST_LIMIT', '浏览器操作超过大小限制。', 413)
        self.providers.check_text(raw)
        with closing(self.providers.connect()) as c, write(c):
            if c.execute('SELECT count(*) FROM browser_operations').fetchone()[0] >= 4096:
                raise ApiError('BROWSER_STORAGE_LIMIT', '浏览器操作记录已达本地上限。', 409)
            c.execute('INSERT INTO browser_operations VALUES(?,?,?,?,?,?,?)',
                      (operation, instance, binding, action, raw, digest(request), utc_now()))
        return operation

    def fact(self, operation, kind, payload):
        raw = canonical(payload)
        if kind not in (*TERMINAL, 'DISPATCHED', 'LATE_RESULT') or len(raw.encode()) > 524288:
            raise ApiError('BROWSER_RESULT_LIMIT', '浏览器回执超过限制。', 413)
        self.providers.check_text(raw)
        with closing(self.providers.connect()) as c, write(c):
            if not c.execute('SELECT 1 FROM browser_operations WHERE operation_id=?', (operation,)).fetchone():
                raise ApiError('BROWSER_OPERATION_NOT_FOUND', '未找到浏览器操作。', 404)
            prior = c.execute('SELECT kind,payload_json FROM browser_operation_facts WHERE operation_id=? AND kind=?',
                              (operation, kind)).fetchone()
            if prior:
                if prior['payload_json'] != raw:
                    raise ApiError('BROWSER_RECEIPT_CONFLICT', '同一操作的回执不一致。', 409)
                return
            terminal = c.execute("SELECT kind FROM browser_operation_facts WHERE operation_id=? AND kind IN ('RESULT','REJECTED','UNKNOWN')", (operation,)).fetchone()
            if terminal and kind != 'LATE_RESULT':
                raise ApiError('BROWSER_OUTCOME_TERMINAL', '已有终态；不会重放或覆盖原结果。', 409)
            c.execute('INSERT INTO browser_operation_facts(operation_id,kind,payload_json,created_at) VALUES(?,?,?,?)',
                      (operation, kind, raw, utc_now()))

    def get(self, operation):
        with closing(self.providers.connect()) as c:
            guard(c)
            row = c.execute('SELECT * FROM browser_operations WHERE operation_id=?', (operation,)).fetchone()
            if row is None:
                raise ApiError('BROWSER_OPERATION_NOT_FOUND', '未找到浏览器操作。', 404)
            facts = [dict(r) for r in c.execute('SELECT fact_id,kind,payload_json,created_at FROM browser_operation_facts WHERE operation_id=? ORDER BY fact_id', (operation,))]
        request = strict_json(row['request_json'])
        if digest(request) != row['request_sha256']:
            raise ApiError('BROWSER_EVIDENCE_MISMATCH', '浏览器意图摘要不一致。', 409)
        terminal = next((f for f in facts if f['kind'] in TERMINAL), None)
        return {'id': row['operation_id'], 'instanceId': row['instance_id'], 'bindingId': row['binding_id'],
                'action': row['action'], 'request': request, 'requestSha256': row['request_sha256'],
                'createdAt': row['created_at'], 'state': terminal['kind'] if terminal else 'DISPATCHED' if facts else 'QUEUED',
                'result': strict_json(terminal['payload_json'], limit=524288) if terminal else None,
                'facts': [{'seq': f['fact_id'], 'kind': f['kind'], 'payload': strict_json(f['payload_json'], limit=524288), 'createdAt': f['created_at']} for f in facts]}

    def unfinished(self):
        with closing(self.providers.connect()) as c:
            guard(c)
            return [r[0] for r in c.execute("SELECT operation_id FROM browser_operations o WHERE NOT EXISTS(SELECT 1 FROM browser_operation_facts f WHERE f.operation_id=o.operation_id AND f.kind IN ('RESULT','REJECTED','UNKNOWN'))")]

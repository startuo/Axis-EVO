"""Explicit migration 007 and small immutable canonical recovery facts."""

from dataclasses import dataclass
from importlib.resources import files
import sqlite3

from .checkpoint_storage import _guard_schema as _checkpoint_schema, _ddl_objects
from .checkpoint_manager import _sha, _json
from .hashing import canonical_json_bytes
from .planning_provenance import _objects
from .skill_binding import _read_snapshot, _rows
from .skill_storage import _check_write_context, _insert_one


TABLES = ('recovery_cases', 'recovery_assessments', 'recovery_proposals',
          'recovery_dispatches', 'recovery_outcomes')
KEYS = dict(zip(TABLES, ('case_id', 'assessment_id', 'proposal_id', 'case_id', 'case_id')))
MAX_FACT_BYTES = 2 * 1024 * 1024


class RecoveryIntegrityError(ValueError):
    """Uncertifiable evidence; never authorizes repair or replay."""


@dataclass(frozen=True)
class RecoveryFact:
    fact_json: str
    fact_sha256: str

    @property
    def data(self):
        return _json(self.fact_json, MAX_FACT_BYTES)

    @property
    def case_id(self):
        return self.data['case_id']

    @property
    def assessment_id(self):
        return self.data['assessment_id']

    @property
    def proposal_id(self):
        return self.data['proposal_id']

    @property
    def recovery_sha256(self):
        return self.fact_sha256


RecoveryCase = RecoveryAssessment = RecoveryProposal = RecoveryFact


def _schema():
    return files('axis_evo').joinpath('migrations', '007_phase3_recovery.sql').read_text(encoding='utf-8')


def _no_shadows(connection):
    names = ','.join('?' for _ in TABLES)
    if _rows(connection, f"SELECT 1 FROM temp.sqlite_master WHERE type IN ('table','view') AND name COLLATE NOCASE IN ({names})", TABLES):
        raise RecoveryIntegrityError('Recovery rejects TEMP shadowing')


def _guard_schema(connection):
    _checkpoint_schema(connection)
    _no_shadows(connection)
    if _objects(connection, TABLES) != _ddl_objects(_schema()):
        raise RecoveryIntegrityError('Recovery schema is missing, weak or unexpected')


def initialize_recovery_schema(connection):
    """Apply 007 after exact 001–006, without changing connection PRAGMAs."""
    _check_write_context(connection)
    _checkpoint_schema(connection)
    _no_shadows(connection)
    existing = _objects(connection, TABLES)
    if existing and existing != _ddl_objects(_schema()):
        raise RecoveryIntegrityError('Existing recovery schema differs from 007')
    try:
        connection.executescript('BEGIN IMMEDIATE;\n' + _schema())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _load(connection, table, identity):
    if table not in TABLES:
        raise ValueError('Unknown recovery fact table')
    rows = _rows(connection, f'SELECT * FROM main.{table} WHERE {KEYS[table]}=?', (identity,))
    if len(rows) != 1:
        raise RecoveryIntegrityError('Recovery fact does not exist uniquely: ' + table)
    row = dict(rows[0])
    value = _json(row['fact_json'], MAX_FACT_BYTES)
    if (type(value) is not dict or type(value.get('schema_version')) is not int
            or value['schema_version'] != 1 or _sha(row['fact_json'].encode('utf-8')) != row['fact_sha256']
            or any(value.get(k) != v for k, v in row.items() if k not in ('fact_json', 'fact_sha256'))):
        raise RecoveryIntegrityError('Recovery fact identity or digest mismatch: ' + table)
    return RecoveryFact(row['fact_json'], row['fact_sha256'])


def _insert(connection, table, value):
    text = canonical_json_bytes(value).decode('utf-8')
    if len(text.encode('utf-8')) > MAX_FACT_BYTES:
        raise RecoveryIntegrityError('Recovery fact exceeds byte limit')
    columns = [r['name'] for r in _rows(connection, f'PRAGMA main.table_info({table})')]
    row = {k: value[k] for k in columns if k not in ('fact_json', 'fact_sha256')}
    row.update(fact_json=text, fact_sha256=_sha(text.encode('utf-8')))
    _insert_one(connection, f"INSERT INTO main.{table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    recorded = _load(connection, table, value[KEYS[table]])
    if recorded.fact_json != text:
        raise RecoveryIntegrityError('Inserted recovery fact changed')
    return recorded


def get_recovery_proposal(connection, proposal_id):
    from .recovery_manager import _proposal
    with _read_snapshot(connection):
        _guard_schema(connection)
        return _proposal(connection, proposal_id)

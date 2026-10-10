"""Explicit migration 009 and immutable, bounded evaluation facts."""

from dataclasses import dataclass
from importlib.resources import files

from .checkpoint_manager import _json, _sha
from .checkpoint_storage import _ddl_objects
from .hashing import canonical_json_bytes
from .planning_provenance import _objects
from .recovery_storage import _guard_schema as _recovery_schema
from .skill_binding import _read_snapshot, _rows
from .skill_storage import _check_write_context, _insert_one
from .storage import validate_safety_history


TABLE_KEYS = {
    'shadow_suites': 'suite_id', 'shadow_cases': 'case_key',
    'shadow_trial_intents': 'trial_id', 'shadow_trial_results': 'trial_id',
    'skill_comparisons': 'comparison_id', 'skill_trust_assessments': 'assessment_id',
    'skill_trust_evidence_refs': 'ref_id',
}
MAX_FACT_BYTES = 2 * 1024 * 1024
POLICY_VERSION = 'skill-trust-v1'


class TrustIntegrityError(ValueError):
    """Evidence cannot support an assessment; never authorizes repair."""


def digest(value):
    return _sha(canonical_json_bytes(value))


def snapshot(value):
    """Exact JSON-native, detached, bounded snapshot; never coercion."""
    from .runner import _validate_json_native
    _validate_json_native(value)
    return _json(canonical_json_bytes(value).decode('utf-8'), MAX_FACT_BYTES)


@dataclass(frozen=True)
class TrustFact:
    fact_json: str
    fact_sha256: str

    @property
    def data(self):
        return _json(self.fact_json, MAX_FACT_BYTES)


def _schema():
    return files('axis_evo').joinpath('migrations', '009_phase3_skill_trust.sql').read_text(encoding='utf-8')


def _no_shadows(connection):
    names = tuple(TABLE_KEYS)
    if _rows(connection, f"SELECT 1 FROM temp.sqlite_master WHERE type IN ('table','view') AND name COLLATE NOCASE IN ({','.join('?' for _ in names)})", names):
        raise TrustIntegrityError('Trust evaluation rejects TEMP shadowing')


def _guard_schema(connection):
    _recovery_schema(connection)
    # 008 is a stateless history audit, not a fictitious schema-version row.
    validate_safety_history(connection)
    _no_shadows(connection)
    if _objects(connection, tuple(TABLE_KEYS)) != _ddl_objects(_schema()):
        raise TrustIntegrityError('Trust schema is missing, weak or unexpected')


def initialize_skill_trust_schema(connection):
    """Require exact 001–007 and 008 history audit; atomically install 009."""
    _check_write_context(connection)
    _recovery_schema(connection)
    validate_safety_history(connection)
    _no_shadows(connection)
    existing = _objects(connection, tuple(TABLE_KEYS))
    if existing and existing != _ddl_objects(_schema()):
        raise TrustIntegrityError('Existing trust schema differs from 009')
    try:
        connection.executescript('BEGIN IMMEDIATE;\n' + _schema())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _load(connection, table, identity):
    if table not in TABLE_KEYS:
        raise ValueError('Unknown evaluation fact table')
    rows = _rows(connection, f'SELECT * FROM main.{table} WHERE {TABLE_KEYS[table]}=?', (identity,))
    if len(rows) != 1:
        raise TrustIntegrityError('Missing evaluation fact: ' + table)
    row = dict(rows[0])
    value = _json(row['fact_json'], MAX_FACT_BYTES)
    if (type(value) is not dict or type(value.get('schema_version')) is not int or value['schema_version'] != 1
            or _sha(row['fact_json'].encode('utf-8')) != row['fact_sha256']
            or any(value.get(k) != v for k, v in row.items() if k not in ('fact_json', 'fact_sha256'))):
        raise TrustIntegrityError('Evaluation fact identity/canonical digest mismatch: ' + table)
    return TrustFact(row['fact_json'], row['fact_sha256'])


def _insert(connection, table, value):
    value = snapshot(value)
    text = canonical_json_bytes(value).decode('utf-8')
    columns = [r['name'] for r in _rows(connection, f'PRAGMA main.table_info({table})')]
    row = {k: value[k] for k in columns if k not in ('fact_json', 'fact_sha256')}
    row.update(fact_json=text, fact_sha256=_sha(text.encode('utf-8')))
    _insert_one(connection, f"INSERT INTO main.{table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    fact = _load(connection, table, value[TABLE_KEYS[table]])
    if fact.fact_json != text:
        raise TrustIntegrityError('Evaluation insertion changed its bytes')
    return fact


def get_shadow_trial(connection, trial_id):
    from .shadow_evaluation import _trial_report
    with _read_snapshot(connection):
        _guard_schema(connection)
        return _trial_report(connection, trial_id)

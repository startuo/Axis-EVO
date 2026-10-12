"""Explicit migration 010 and immutable evolution facts; no implicit writes."""

from dataclasses import dataclass
from importlib.resources import files
import re

from .checkpoint_manager import _json, _sha
from .checkpoint_storage import _ddl_objects
from .events import utc_now
from .hashing import canonical_json_bytes
from .planning_provenance import _objects
from .skill_binding import _read_snapshot, _rows
from .skill_storage import _check_write_context, _insert_one, _skill_transaction
from .skill_trust_storage import _guard_schema as _trust_schema, snapshot, digest


TABLE_KEYS = {
    'evolution_governance': 'governance_id', 'evolution_cases': 'case_id',
    'skill_revision_intents': 'revision_id', 'skill_revision_proposals': 'revision_id',
    'skill_revision_approvals': 'revision_id', 'skill_evolution_candidates': 'revision_id',
    'skill_promotion_proposals': 'proposal_id', 'skill_promotion_approvals': 'proposal_id',
    'skill_promotion_receipts': 'proposal_id', 'skill_activation_proposals': 'activation_id',
    'skill_activation_approvals': 'activation_id', 'skill_activation_events': 'activation_id',
}
MAX_EVOLUTION_FACT_BYTES = 2 * 1024 * 1024
MAX_REVISION_BYTES = 64 * 1024
MAX_REVISION_TEXT_BYTES = 32 * 1024


class EvolutionError(ValueError):
    """A requested evolution operation is not authorized; no retry is implied."""


class EvolutionIntegrityError(EvolutionError):
    """Persisted evolution facts disagree. Reads never repair them."""


@dataclass(frozen=True)
class EvolutionFact:
    fact_json: str
    fact_sha256: str

    @property
    def data(self):
        return _json(self.fact_json, MAX_EVOLUTION_FACT_BYTES)


def _keys(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise EvolutionIntegrityError('Unexpected evolution fact fields')


def _text(value, limit=MAX_REVISION_TEXT_BYTES):
    if type(value) is not str or not value.strip() or len(value.encode('utf-8')) > limit:
        raise EvolutionError('Expected bounded nonempty UTF-8 text')
    return value


def _hash(value):
    if type(value) is not str or re.fullmatch('[0-9a-f]{64}', value) is None:
        raise EvolutionError('Approval requires the exact lowercase SHA-256 digest')
    return value


def _schema():
    return files('axis_evo').joinpath('migrations', '010_phase3_skill_evolution.sql').read_text(encoding='utf-8')


def _no_shadows(connection):
    names = tuple(TABLE_KEYS)
    if _rows(connection, f"SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN ({','.join('?' for _ in names)})", names):
        raise EvolutionIntegrityError('Evolution rejects TEMP shadowing')


def _guard_schema(connection):
    _trust_schema(connection)
    _no_shadows(connection)
    if _objects(connection, tuple(TABLE_KEYS)) != _ddl_objects(_schema()):
        raise EvolutionIntegrityError('Evolution schema is missing, weak or unexpected')


def initialize_skill_evolution_schema(connection):
    """Atomically install 010 after exact 001–009; preserve caller PRAGMAs."""
    _check_write_context(connection)
    _trust_schema(connection)
    _no_shadows(connection)
    existing = _objects(connection, tuple(TABLE_KEYS))
    if existing and existing != _ddl_objects(_schema()):
        raise EvolutionIntegrityError('Existing evolution schema differs from 010')
    try:
        connection.executescript('BEGIN IMMEDIATE;\n' + _schema())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _load(connection, table, identity):
    if table not in TABLE_KEYS:
        raise EvolutionError('Unknown evolution table')
    rows = _rows(connection, f'SELECT * FROM main.{table} WHERE {TABLE_KEYS[table]}=?', (identity,))
    if len(rows) != 1:
        raise EvolutionIntegrityError('Missing evolution fact: ' + table)
    row = dict(rows[0])
    try:
        value = _json(row['fact_json'], MAX_EVOLUTION_FACT_BYTES)
        if (type(value) is not dict or type(value.get('schema_version')) is not int or value['schema_version'] != 1
                or _sha(row['fact_json'].encode('utf-8')) != row['fact_sha256']
                or any(value.get(k) != v for k, v in row.items() if k not in ('fact_json', 'fact_sha256'))):
            raise EvolutionIntegrityError('Evolution identity/canonical digest mismatch: ' + table)
    except (TypeError, KeyError, UnicodeError) as error:
        raise EvolutionIntegrityError('Malformed evolution fact: ' + table) from error
    return EvolutionFact(row['fact_json'], row['fact_sha256'])


def _insert(connection, table, value):
    if table not in TABLE_KEYS:
        raise EvolutionError('Unknown evolution table')
    value = snapshot(value)
    text = canonical_json_bytes(value).decode('utf-8')
    if len(text.encode('utf-8')) > MAX_EVOLUTION_FACT_BYTES:
        raise EvolutionError('Evolution fact exceeds limit')
    columns = [r['name'] for r in _rows(connection, f'PRAGMA main.table_info({table})')]
    row = {k: value[k] for k in columns if k not in ('fact_json', 'fact_sha256')}
    row.update(fact_json=text, fact_sha256=_sha(text.encode('utf-8')))
    _insert_one(connection, f"INSERT INTO main.{table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    fact = _load(connection, table, value[TABLE_KEYS[table]])
    if fact.fact_json != text:
        raise EvolutionIntegrityError('Evolution insertion changed its bytes')
    return fact


def _approval(connection, table, identity, subject):
    fact = _load(connection, table, identity)
    d = fact.data
    _keys(d, ('schema_version', TABLE_KEYS[table], 'approved_sha256', 'created_at'))
    if _hash(d['approved_sha256']) != subject.fact_sha256:
        raise EvolutionIntegrityError('Approval belongs to a different immutable fact')
    _text(d['created_at'])
    return fact


def _approve(connection, table, identity, digest_value, subject_loader):
    _check_write_context(connection)
    _hash(digest_value)
    with _skill_transaction(connection):
        _guard_schema(connection)
        subject = subject_loader(connection, identity)
        if digest_value != subject.fact_sha256:
            raise EvolutionError('Approval digest does not match the persisted proposal')
        if _present(connection, table, identity):
            raise EvolutionError('Approval is already recorded; replay is rejected')
        fact = _insert(connection, table, {'schema_version': 1, TABLE_KEYS[table]: identity,
                                         'approved_sha256': digest_value, 'created_at': utc_now()})
        _approval(connection, table, identity, subject)
    return fact


def _present(connection, table, identity):
    return bool(_rows(connection, f'SELECT 1 FROM main.{table} WHERE {TABLE_KEYS[table]}=?', (identity,)))

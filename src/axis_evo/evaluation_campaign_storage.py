"""Explicit additive migration014; legacy evidence schemas remain unchanged."""
from importlib.resources import files

from .checkpoint_storage import _ddl_objects
from .hashing import canonical_json_bytes
from .planning_provenance import _objects
from .skill_binding import _rows
from .skill_storage import _check_write_context, _insert_one
from .skill_evolution_storage import (EvolutionFact, EvolutionIntegrityError, EvolutionError,
    _guard_schema as _evolution_schema, digest, snapshot)

TABLES = {'evaluation_policy_scopes': 'policy_id', 'evaluation_campaigns': 'campaign_id',
          'evaluation_dispatches': 'claim_id', 'evaluation_campaign_receipts': 'campaign_id'}


def _schema():
    return files('axis_evo').joinpath('migrations', '014_phase5_evaluation_campaigns.sql').read_text('utf-8')


def _no_shadows(connection):
    names = tuple(TABLES)
    if _rows(connection, f"SELECT 1 FROM temp.sqlite_master WHERE name COLLATE NOCASE IN ({','.join('?' for _ in names)})", names):
        raise EvolutionIntegrityError('Campaigns reject TEMP shadowing')


def _guard_schema(connection):
    _evolution_schema(connection)
    _no_shadows(connection)
    if _objects(connection, tuple(TABLES)) != _ddl_objects(_schema()):
        raise EvolutionIntegrityError('Campaign schema missing, weak or unexpected')
    if _rows(connection, 'PRAGMA main.foreign_key_check'):
        raise EvolutionIntegrityError('Campaign evidence has orphan foreign keys')


def initialize_evaluation_campaign_schema(connection):
    _check_write_context(connection)
    _evolution_schema(connection)
    _no_shadows(connection)
    existing = _objects(connection, tuple(TABLES))
    if existing and existing != _ddl_objects(_schema()):
        raise EvolutionIntegrityError('Existing campaign schema differs from014')
    try:
        connection.executescript('BEGIN IMMEDIATE;\n' + _schema())
        _guard_schema(connection)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def _load(connection, table, identity):
    if table not in TABLES:
        raise EvolutionError('Unknown campaign fact table')
    rows = _rows(connection, f'SELECT * FROM main.{table} WHERE {TABLES[table]}=?', (identity,))
    if len(rows) != 1:
        raise EvolutionIntegrityError('Missing or ambiguous campaign fact')
    row = dict(rows[0])
    fact = EvolutionFact(row['fact_json'], row['fact_sha256'])
    value = fact.data
    if (type(value) is not dict or type(value.get('schema_version')) is not int or value['schema_version'] != 1
            or canonical_json_bytes(value).decode('utf-8') != fact.fact_json
            or digest(value) != fact.fact_sha256
            or any(value.get(k) != v for k, v in row.items() if k not in ('fact_json', 'fact_sha256'))):
        raise EvolutionIntegrityError('Campaign fact identity/canonical digest mismatch')
    return fact


def _insert(connection, table, value):
    if table not in TABLES:
        raise EvolutionError('Unknown campaign table')
    value = snapshot(value)
    columns = [r['name'] for r in _rows(connection, f'PRAGMA main.table_info({table})')]
    row = {k: value[k] for k in columns if k not in ('fact_json', 'fact_sha256')}
    row.update(fact_json=canonical_json_bytes(value).decode('utf-8'), fact_sha256=digest(value))
    _insert_one(connection, f"INSERT INTO main.{table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    fact = _load(connection, table, value[TABLES[table]])
    if fact.fact_json != row['fact_json']:
        raise EvolutionIntegrityError('Campaign insertion changed submitted bytes')
    return fact

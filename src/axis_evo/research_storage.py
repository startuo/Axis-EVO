"""Research-only append journal. Never initializes an ordinary production DB."""
from importlib.resources import files
from pathlib import Path
import sqlite3

from .checkpoint_storage import _ddl_objects
from .planning_provenance import _objects
from .hashing import canonical_json_bytes
from .skill_binding import _rows
from .skill_evolution_storage import EvolutionFact, digest
from .skill_storage import _insert_one

TABLES = {'research_experiments': 'experiment_id', 'research_submissions': 'slot_id',
          'research_observations': 'slot_id', 'research_seals': 'experiment_id'}
MAX_JOURNAL_BYTES = 256 * 1024 * 1024


def _schema():
    return files('axis_evo').joinpath('migrations', '015_phase5_research_journal.sql').read_text('utf-8')


def guard(connection):
    if (_objects(connection, tuple(TABLES)) != _ddl_objects(_schema())
            or _rows(connection, 'SELECT 1 FROM temp.sqlite_master WHERE name IN (?,?,?,?)', tuple(TABLES))
            or _rows(connection, 'PRAGMA main.foreign_key_check')):
        raise ValueError('Research journal schema or foreign-key integrity mismatch')


def connect(directory, *, readonly=False):
    from .agent_episode_storage import _absolute_directory
    from .sandbox import Sandbox
    root = _absolute_directory(Path(directory).absolute())
    path = Sandbox(root).resolve('experiment.sqlite3')
    if not path.is_file():
        raise ValueError('Research database must already exist')
    c = sqlite3.connect(Path(path).as_uri() + ('?mode=ro' if readonly else '?mode=rw'), uri=True, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=5000')
    if c.execute('PRAGMA page_count').fetchone()[0] * c.execute('PRAGMA page_size').fetchone()[0] > MAX_JOURNAL_BYTES:
        c.close()
        raise ValueError('Research journal exceeds its total database byte budget')
    if readonly:
        c.execute('PRAGMA query_only=ON')
    else:
        c.execute('PRAGMA synchronous=FULL')
        pages = MAX_JOURNAL_BYTES // c.execute('PRAGMA page_size').fetchone()[0]
        c.execute(f'PRAGMA max_page_count={pages}')
    try:
        guard(c)
        return c
    except BaseException:
        c.close()
        raise


def present(connection, table, identity):
    key = TABLES[table]
    return bool(_rows(connection, f'SELECT 1 FROM main.{table} WHERE {key}=?', (identity,)))


def load(connection, table, identity):
    rows = _rows(connection, f'SELECT * FROM main.{table} WHERE {TABLES[table]}=?', (identity,))
    if len(rows) != 1:
        raise ValueError('Missing research fact')
    row = dict(rows[0])
    fact = EvolutionFact(row['fact_json'], row['fact_sha256'])
    d = fact.data
    if (type(d) is not dict or type(d.get('schema_version')) is not int or d['schema_version'] != 1
            or digest(d) != fact.fact_sha256 or canonical_json_bytes(d).decode('utf-8') != fact.fact_json
            or any(d.get(k) != v for k, v in row.items() if k not in ('fact_json', 'fact_sha256'))):
        raise ValueError('Research fact canonical digest/identity mismatch')
    return fact


def insert(connection, table, value):
    columns = [r['name'] for r in _rows(connection, f'PRAGMA main.table_info({table})')]
    row = {k: value[k] for k in columns if k not in ('fact_json', 'fact_sha256')}
    row.update(fact_json=canonical_json_bytes(value).decode('utf-8'), fact_sha256=digest(value))
    _insert_one(connection, f"INSERT INTO main.{table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))
    result = load(connection, table, value[TABLES[table]])
    if result.fact_json != row['fact_json']:
        raise ValueError('Research insertion changed submitted bytes')
    return result

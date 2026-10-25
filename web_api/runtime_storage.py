"""Explicit Web storage preparation and read-only production preflight.

Startup verifies existing schema; only an explicit maintenance call may create
or upgrade metadata. This module never migrates a configured Core database.
"""
from contextlib import closing, contextmanager
from html.parser import HTMLParser
from pathlib import Path
import sqlite3
import sys
import time
from urllib.parse import urlsplit

from .schemas import ApiError, MAX_DATABASE_BYTES, no_redirected_parents, strict_json


def require_sqlite_compatibility():
    """Probe the secure backup/authorizer read path, not a version heuristic."""
    source, target = sqlite3.connect(':memory:'), sqlite3.connect(':memory:')
    try:
        source.executescript("CREATE TABLE probe(payload TEXT CHECK(json_valid(payload)));"
                             "INSERT INTO probe VALUES('{}');")
        source.backup(target)
        target.execute('PRAGMA trusted_schema=OFF')
        target.set_authorizer(lambda *args: sqlite3.SQLITE_OK)
        if target.execute('SELECT payload FROM probe').fetchone() != ('{}',):
            raise ValueError('Secure SQLite read probe failed')
    except (sqlite3.Error, ValueError):
        raise ApiError('UNSUPPORTED_SQLITE', 'This SQLite build cannot support secure Web inspection.', 503) from None
    finally:
        target.close()
        source.close()


@contextmanager
def existing_database(path):
    path = Path(path).absolute()
    no_redirected_parents(path)
    if not path.is_file() or path.stat().st_size > MAX_DATABASE_BYTES:
        raise ApiError('STORAGE_UNPREPARED', 'An existing bounded database is required; run explicit setup.', 503)
    c = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, isolation_level=None, timeout=5)
    c.row_factory = sqlite3.Row
    try:
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA trusted_schema=OFF')
        c.execute('PRAGMA query_only=ON')
        if c.execute('PRAGMA journal_mode').fetchone()[0] != 'wal':
            raise ValueError('Existing database must already use WAL')
        c.execute('BEGIN')
        yield c
    finally:
        c.rollback()
        c.close()


def require_provider_schema(c):
    from .provider_store import _schema_objects, _expected_schema
    if _schema_objects(c) != _expected_schema():
        raise ValueError('Provider schema is missing or unexpected; explicit setup is required')


def require_base_schema(c):
    from .runtime_service import _schema_objects, _expected_schema
    from . import runtime_jobs
    require_provider_schema(c)
    runtime_jobs._unshadowed(c)
    if _schema_objects(c) != _expected_schema() or runtime_jobs._objects(c) != runtime_jobs._expected():
        raise ValueError('Runtime schema is missing or unexpected; explicit setup is required')


def require_complete_schema(c):
    from . import conversation_store, evolution_store
    require_base_schema(c)
    conversation_store.guard(c)
    evolution_store.guard(c)
    from .conversation_replies import reply_guard
    reply_guard(c)
    from .runtime_read_policy import guard
    guard(c)
    if c.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or c.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Runtime storage integrity check failed')


def require_runtime_interpreter():
    # Store/alias interpreter chains are not qualified for process lifetime
    # containment. Keep them out of production execution; do not weaken Jobs.
    if sys.platform == 'win32' and 'windowsapps' in sys.base_prefix.replace('\\', '/').lower().split('/'):
        raise ValueError('Microsoft Store Python Runtime execution is unsupported; use ordinary CPython')


def require_runtime_inputs(config, workbench):
    from axis_evo.planning_provenance import _require_planning_schema
    from .runtime_policy import load_template
    from .provider_store import _sensitive_input
    require_runtime_interpreter()
    def check_text(text):
        if _sensitive_input(text, tuple(config.credentials.values())):
            raise ApiError('SENSITIVE_INPUT', 'Configured task data contains prohibited secret content.')
    for runtime in config.projects:
        project = workbench.project(runtime.id)
        if not any(config.data_dir.is_relative_to(root) for root in project.workspace_roots):
            raise ValueError('Runtime data must remain inside its configured workspace root')
        with existing_database(project.database) as c:
            _require_planning_schema(c)
            if c.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or c.execute('PRAGMA foreign_key_check').fetchone():
                raise ValueError('Core integrity check failed')
        for name, task in (('default', runtime.task_spec_path), *runtime.task_templates):
            scope = runtime.read_policy.allowed_paths if runtime.read_policy and runtime.read_policy.task_template_id == name else None
            load_template(task, check_text, allowed_paths=scope)


def require_existing_runtime(config, workbench):
    require_sqlite_compatibility()
    require_runtime_inputs(config, workbench)
    directory = config.data_dir/'threads'
    no_redirected_parents(directory)
    if not directory.is_dir():
        raise ValueError('Explicit Runtime storage setup is required')
    with existing_database(config.data_dir/'runtime.sqlite3') as c:
        require_complete_schema(c)


def _initialize_metadata(providers):
    from .runtime_service import _schema_objects, _expected_schema, _SCHEMA
    from . import runtime_jobs, conversation_store, evolution_store
    with closing(providers.connect()) as c:
        existing = _schema_objects(c)
        if existing and existing != _expected_schema():
            raise ValueError('Unexpected Runtime thread schema')
        if existing and not runtime_jobs._objects(c) and c.execute('SELECT 1 FROM runtime_threads LIMIT 1').fetchone():
            raise ValueError('Nonempty pre-job history requires a separately reviewed migration')
        try:
            c.executescript('BEGIN IMMEDIATE;'+_SCHEMA)
            c.commit()
            runtime_jobs.initialize(c)
            conversation_store.initialize(c)
            evolution_store.initialize(c)
            from .conversation_replies import initialize_reply_schema
            initialize_reply_schema(c)
            from .runtime_read_policy import initialize
            initialize(c)
            require_complete_schema(c)
        except BaseException:
            c.rollback()
            raise


def initialize_runtime_storage(config, workbench):
    """Explicit fresh initialization; interrupted prefixes are never auto-fixed."""
    from .provider_store import ProviderStore
    from .runtime_process import CoordinatorLock
    require_sqlite_compatibility()
    require_runtime_inputs(config, workbench)
    no_redirected_parents(config.data_dir)
    database, threads = config.data_dir/'runtime.sqlite3', config.data_dir/'threads'
    no_redirected_parents(database)
    no_redirected_parents(threads)
    if database.exists() or threads.exists():
        raise ValueError('Fresh setup refuses existing Runtime data; use an explicit copy upgrade')
    config.data_dir.mkdir(parents=True, exist_ok=True)
    lock = CoordinatorLock(config.data_dir)
    try:
        with database.open('xb'):
            pass
        _initialize_metadata(ProviderStore(config))
        threads.mkdir(exist_ok=False)
        require_existing_runtime(config, workbench)
    finally:
        lock.close()
    return {'status': 'PREPARED', 'coreMigrated': False, 'executionStarted': False}


def backup_database(source, destination):
    """Committed SQLite snapshot to a new file; not a task-workspace backup."""
    source, destination = Path(source).absolute(), Path(destination).absolute()
    no_redirected_parents(source)
    no_redirected_parents(destination)
    _separate_output(source, destination)
    if not source.is_file() or source.stat().st_size > MAX_DATABASE_BYTES:
        raise ValueError('An existing bounded source database is required')
    with destination.open('xb'):
        pass
    original = copy = None
    deadline = time.monotonic()+15
    try:
        original = sqlite3.connect(source.as_uri()+'?mode=ro', uri=True, isolation_level=None, timeout=5)
        original.execute('PRAGMA query_only=ON')
        original.execute('PRAGMA trusted_schema=OFF')
        copy = sqlite3.connect(destination, isolation_level=None, timeout=5)
        page_size = original.execute('PRAGMA page_size').fetchone()[0]
        def progress(status, remaining, total):
            if time.monotonic() >= deadline or total*page_size > MAX_DATABASE_BYTES:
                raise ValueError('Database backup exceeded its resource budget')
        original.backup(copy, pages=128, progress=progress, sleep=0.01)
        copy.execute('PRAGMA trusted_schema=OFF')
        if copy.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or copy.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Copied database integrity failed')
    finally:
        if copy is not None:
            copy.close()
        if original is not None:
            original.close()
    return {'status': 'COPIED_COMMITTED_DATABASE', 'workspaceRestored': False, 'executionStarted': False}


def _separate_output(source, destination):
    # A new filename may still be SQLite's live journal/coordination namespace.
    for suffix in ('', '-wal', '-shm', '-journal'):
        reserved = source.with_name(source.name+suffix)
        if destination == reserved or reserved in destination.parents:
            raise ValueError('Maintenance output overlaps the source SQLite namespace')


def upgrade_runtime_copy(config, workbench, destination):
    """Prepare missing empty metadata stages on a new, offline database copy.

    No task files are copied or invented. Existing paths and history stay exact;
    the operator must separately restore files and review configuration before use.
    """
    from dataclasses import replace
    from .provider_store import ProviderStore
    from .runtime_process import CoordinatorLock
    require_sqlite_compatibility()
    require_runtime_inputs(config, workbench)
    destination = Path(destination).absolute()
    no_redirected_parents(destination)
    _separate_output(config.data_dir/'runtime.sqlite3', destination)
    if destination == Path(destination.anchor):
        raise ValueError('A new scoped output directory is required')
    with existing_database(config.data_dir/'runtime.sqlite3') as c:
        require_provider_schema(c)
    lock = CoordinatorLock(config.data_dir)
    try:
        destination.mkdir(exist_ok=False)
        backup_database(config.data_dir/'runtime.sqlite3', destination/'runtime.sqlite3')
        _initialize_metadata(ProviderStore(replace(config, data_dir=destination)))
    finally:
        lock.close()
    return {'status': 'DATABASE_COPY_PREPARED', 'workspaceRestored': False, 'executionStarted': False}


class _Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and values.get('src'):
            self.paths.append(values['src'])
        elif tag == 'link' and values.get('href'):
            self.paths.append(values['href'])


def require_frontend(directory):
    root = Path(directory).absolute()
    no_redirected_parents(root)
    root = root.resolve(strict=True)
    index = root/'index.html'
    no_redirected_parents(index)
    with index.open('rb') as stream:
        raw = stream.read(1024*1024+1)
    if len(raw) > 1024*1024:
        raise ValueError('Built frontend index exceeds its budget')
    parser = _Assets()
    parser.feed(raw.decode('utf-8', errors='strict'))
    def check_asset(value):
        if type(value) is not str or not value:
            raise ValueError('Invalid built frontend asset')
        url = urlsplit(value)
        if url.scheme or url.netloc or url.query or url.fragment or '\\' in value:
            raise ValueError('Built frontend assets must be local')
        path = root/url.path.lstrip('/')
        no_redirected_parents(path)
        path = path.resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size > 8*1024*1024:
            raise ValueError('Built frontend asset is missing or exceeds its budget')
    for value in parser.paths:
        check_asset(value)
    manifest_path = root/'.vite/manifest.json'
    no_redirected_parents(manifest_path)
    with manifest_path.open('rb') as stream:
        manifest = strict_json(stream.read(256*1024+1), limit=256*1024)
    if type(manifest) is not dict or not 1 <= len(manifest) <= 512:
        raise ValueError('A bounded Vite build manifest is required')
    for entry in manifest.values():
        if type(entry) is not dict:
            raise ValueError('Invalid build manifest entry')
        check_asset(entry.get('file'))
        for key in ('css', 'assets', 'imports', 'dynamicImports'):
            values = entry.get(key, [])
            if type(values) is not list or len(values) > 512:
                raise ValueError('Invalid build manifest dependency list')
            for value in values:
                if key in ('imports', 'dynamicImports'):
                    if type(value) is not str or value not in manifest:
                        raise ValueError('Missing build manifest dependency')
                else:
                    check_asset(value)
    entry = manifest.get('index.html', {})
    if (entry.get('isEntry') is not True
            or '/'+entry['file'] not in {'/'+path.lstrip('/') for path in parser.paths}):
        raise ValueError('Built index and asset manifest do not match')
    return root


def main(argv=None):
    import argparse
    import json
    from .runtime_config import RuntimeConfig
    from .schemas import WorkbenchConfig
    parser = argparse.ArgumentParser(description='Explicit local storage maintenance; never execute or resume tasks')
    parser.add_argument('action', choices=('init', 'upgrade-copy', 'backup-database'))
    parser.add_argument('--config', type=Path)
    parser.add_argument('--runtime-config', type=Path)
    parser.add_argument('--source', type=Path, help='Database-only source; not a complete task backup')
    parser.add_argument('--output', type=Path, help='New output only; existing files/directories are refused')
    args = parser.parse_args(argv)
    try:
        require_sqlite_compatibility()
        if args.action == 'backup-database':
            if not args.source or not args.output:
                parser.error('backup-database requires --source and --output')
            result = backup_database(args.source, args.output)
        else:
            if not args.config or not args.runtime_config:
                parser.error('Explicit --config and --runtime-config are required')
            workbench = WorkbenchConfig.from_file(args.config)
            config = RuntimeConfig.from_file(args.runtime_config, workbench)
            if args.action == 'init':
                result = initialize_runtime_storage(config, workbench)
            else:
                if not args.output:
                    parser.error('upgrade-copy requires a new --output directory')
                result = upgrade_runtime_copy(config, workbench, args.output)
    except (ApiError, OSError, ValueError, sqlite3.Error):
        parser.error('Maintenance rejected; existing source data was not migrated. Failed new output may remain; see docs/RELEASE_OPERATIONS.md')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

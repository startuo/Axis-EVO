"""Public offline installation smoke; writes only its own temporary directory.

This exercises real Core persistence and independent file Acceptance. It is not
the private regression suite, a model test, a trust assessment or certification.
"""
import json
from pathlib import Path
import platform
import sqlite3
import tempfile

from axis_evo.inspector import inspect_run
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import PlanStep, run_task
from axis_evo.storage import connect_database
from axis_evo.tools import PatchFileTool
from web_api.runtime_storage import require_sqlite_compatibility


def main():
    require_sqlite_compatibility()
    with tempfile.TemporaryDirectory(prefix='axis-release-smoke-') as directory:
        root = Path(directory)
        (root/'seed').mkdir()
        (root/'seed/config.txt').write_bytes(b'timeout=10\n')
        task = {'schema_version': 1, 'task_id': 'public-release-smoke', 'title': 'Offline smoke',
            'goal': 'Change timeout from 10 to 20', 'workspace': {'seed_dir': 'seed'},
            'acceptance': {'pytest': {'enabled': False, 'args': []}, 'file_assertions': [
                {'path': 'config.txt', 'operator': 'equals', 'expected': 'timeout=20\n'}]}}
        path = root/'task.json'
        path.write_text(json.dumps(task), encoding='utf-8')
        registry = PluginRegistry()
        registry.register(PatchFileTool())
        connection = connect_database(root/'core.sqlite3')
        try:
            run = run_task(connection, path, root/'workspace', [PlanStep('patch', 'patch_file',
                {'path': 'config.txt', 'old': 'timeout=10', 'new': 'timeout=20'})], registry)
            kinds = [row[0] for row in connection.execute(
                'SELECT event_type FROM events WHERE run_id=? ORDER BY seq', (run.run_id,))]
            inspection = inspect_run(connection, run.run_id)
            if (run.status.value != 'COMPLETED' or not inspection['trace']['consistent']
                    or (root/'workspace/config.txt').read_bytes() != b'timeout=20\n'
                    or kinds.index('VALIDATION_PASSED') >= kinds.index('RUN_COMPLETED')):
                raise RuntimeError('Public smoke failed')
        finally:
            connection.close()
    print(json.dumps({'status': 'PASS', 'python': platform.python_version(),
        'sqlite': sqlite3.sqlite_version, 'externalModelCalls': 0,
        'execution': 'temporary explicit plan', 'acceptance': 'independent file equality',
        'privateRegressionSuite': False}))


if __name__ == '__main__':
    main()

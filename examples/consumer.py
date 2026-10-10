"""Public consumer example using the actual deterministic Runner API."""

import argparse
import json
from pathlib import Path

from axis_evo.inspector import inspect_database
from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.storage import connect_database
from axis_evo.tools import PatchFileTool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_directory', type=Path, help='A new directory for this demonstration')
    parser.add_argument('--failed', action='store_true', help='Demonstrate a reported patch failure')
    args = parser.parse_args()
    root = args.output_directory.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root / 'seed').mkdir()
    (root / 'seed' / 'config.txt').write_bytes(b'timeout=10\r\n')
    task = {'schema_version': 1, 'task_id': 'public-consumer', 'title': 'Update timeout',
            'goal': 'Replace timeout=10 with timeout=20.', 'workspace': {'seed_dir': 'seed'},
            'acceptance': {'pytest': {'enabled': False, 'args': []},
                           'file_assertions': [{'path': 'config.txt', 'operator': 'equals', 'expected': 'timeout=20\r\n'}]}}
    task_path = root / 'task.json'
    task_path.write_text(json.dumps(task), encoding='utf-8')
    registry = PluginRegistry()
    registry.register(PatchFileTool())
    connection = connect_database(root / 'facts.sqlite3')
    try:
        run = run_task(connection, task_path, root / 'workspace', [PlanStep('update', 'patch_file', {
            'path': 'config.txt', 'old': 'missing-value' if args.failed else 'timeout=10', 'new': 'timeout=20',
        })], registry, run_id='public-consumer')
        print(json.dumps({'run_id': run.run_id, 'status': run.status, 'database': str(root / 'facts.sqlite3')}, ensure_ascii=False))
    finally:
        connection.close()
    report = inspect_database(root / 'facts.sqlite3', 'public-consumer')
    print(json.dumps({'consistent': report['trace']['consistent'], 'observations': report['observations']}, ensure_ascii=False))


if __name__ == '__main__':
    main()

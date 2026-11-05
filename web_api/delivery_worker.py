"""One approved Markdown write, using the existing Core Runner in a child process."""
import hashlib
from pathlib import Path
import re
import sys

from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.sandbox import WorkspacePathResolver
from axis_evo.storage import connect_database
from axis_evo.tools import WriteFileTool
from .browser_store import canonical, digest
from .schemas import no_redirected_parents, strict_json


def deliver(directory):
    directory = Path(directory).absolute()
    no_redirected_parents(directory)
    if not re.fullmatch(r'delivery_[a-f0-9]{32}', directory.name):
        raise ValueError('Invalid delivery directory')
    with WorkspacePathResolver(directory).resolve('intent.json').open('rb') as stream:
        manifest = strict_json(stream.read(524289), limit=524288)
    if (manifest.keys() != {'request', 'approvalSha256', 'content', 'runId'}
            or digest(manifest['request']) != manifest['approvalSha256']
            or hashlib.sha256(manifest['content'].encode('utf-8')).hexdigest() != manifest['request']['contentSha256']):
        raise ValueError('Approved delivery identity changed')
    name = manifest['request']['filename']
    if Path(name).name != name or '/' in name or '\\' in name or ':' in name or not name.lower().endswith('.md'):
        raise ValueError('Invalid delivery filename')
    task = {'schema_version': 1, 'task_id': directory.name, 'title': name,
            'goal': 'Persist exactly the user-approved Markdown bytes; no semantic quality claim.',
            'workspace': {'seed_dir': 'seed'},
            'acceptance': {'pytest': {'enabled': False, 'args': []},
                           'file_assertions': [{'path': name, 'operator': 'equals', 'expected': manifest['content']}]}}
    # Each delivery uses fresh assets and a fresh Core database. No historical store is opened.
    (directory/'seed').mkdir(exist_ok=False)
    with (directory/'task.json').open('x', encoding='utf-8') as stream:
        stream.write(canonical(task))
    registry = PluginRegistry()
    registry.register(WriteFileTool())
    c = connect_database(directory/'core.sqlite3')
    try:
        return run_task(c, directory/'task.json', directory/'workspace',
            [PlanStep('write_approved_markdown', 'write_file', {'path': name, 'content': manifest['content']})],
            registry, model_plugin='user_approved_delivery:' + manifest['request']['draftId'], run_id=manifest['runId'])
    finally:
        c.close()


if __name__ == '__main__':
    result = deliver(sys.argv[1])
    print(result.status.value)

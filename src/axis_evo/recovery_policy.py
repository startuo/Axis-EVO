"""Small deterministic file-only policy, never an execution-causality oracle."""

from copy import deepcopy
from pathlib import PurePosixPath
import re

from .checkpoint_manager import _manifest, _sha
from .checkpoint_storage import MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES
from .hashing import canonical_json_bytes
from .skill_planner import _arguments, _static_path, _BUILTINS, _tool_schema


SUPPORTED_TOOLS = frozenset(('read_file', 'write_file', 'patch_file'))
POLICY_VERSION = 'controlled-files-v1'


def tool_catalog(plan, registry=None):
    result = {}
    for name in sorted({s['tool_name'] for s in plan}):
        if name not in SUPPORTED_TOOLS:
            raise ValueError('Unsupported recovery operation')
        builtin = _BUILTINS[name]
        if registry is not None:
            tool = registry.get(name)
            if type(tool) is not builtin or tool.name != name:
                raise ValueError('Recovery requires exact trusted built-in tools')
        result[name] = {'implementation':builtin.__module__+'.'+builtin.__qualname__,
                        'arguments':_tool_schema(name)}
    return result


def canonical_path(value):
    _static_path(value)
    if (PurePosixPath(value).as_posix() != value or '\\' in value
            or any(p in ('', '.', '..') for p in value.split('/'))):
        raise ValueError('Recovery requires canonical relative POSIX paths')
    return value


def validate_operations(plan, task, registry=None):
    if task['acceptance'].get('pytest', {}).get('enabled', False):
        raise ValueError('Recovery policy does not admit executable pytest acceptance')
    for assertion in task['acceptance'].get('file_assertions', []):
        canonical_path(assertion['path'])
    for step in plan:
        name = step['tool_name']
        if name not in SUPPORTED_TOOLS:
            raise ValueError('Unsupported recovery operation: ' + name)
        _arguments(name, step['arguments'])
        canonical_path(step['arguments']['path'])
        if registry is not None:
            tool = registry.get(name)
            if type(tool) is not _BUILTINS[name] or tool.name != name:
                raise ValueError('Recovery requires exact trusted built-in tools')


def file_state(path, artifacts):
    data = artifacts.get(path)
    return {'path': path, 'exists': data is not None, 'sha256': _sha(data) if data is not None else None,
            'size_bytes': len(data) if data is not None else None}


def simulate_step(step, manifest_json, artifacts):
    """Apply the audited exact file algorithm to detached bytes, without I/O."""
    name, args = step['tool_name'], step['arguments']
    if name not in SUPPORTED_TOOLS:
        raise ValueError('Unsupported recovery operation')
    _arguments(name, args)
    path = canonical_path(args['path'])
    manifest, after = _manifest(manifest_json), deepcopy(artifacts)
    entries = {e['path']: e for e in manifest['entries']}
    files = {p: e for p, e in entries.items() if e['type'] == 'file'}
    if (set(files) != set(artifacts) or any(type(data) is not bytes
            or files[p]['sha256'] != _sha(data) or files[p]['size_bytes'] != len(data)
            for p, data in artifacts.items())):
        raise ValueError('Manifest and artifact bytes disagree')
    parent = PurePosixPath(path).parent.as_posix()
    if parent != '.' and entries.get(parent, {}).get('type') != 'directory':
        raise ValueError('Operation parent directory is not present')
    if path in entries and entries[path]['type'] != 'file':
        raise ValueError('Operation target is not a regular file')
    if name == 'read_file':
        after[path].decode('utf-8', errors='strict')
        return manifest_json, after
    if name == 'write_file':
        data = args['content'].encode('utf-8', errors='strict')
    else:
        text = after[path].decode('utf-8', errors='strict')
        if len(re.findall('(?=' + re.escape(args['old']) + ')', text)) != 1:
            raise ValueError('patch_file old text must occur exactly once (including overlapping matches)')
        data = text.replace(args['old'], args['new'], 1).encode('utf-8')
    after[path] = data
    entries[path] = {'path': path, 'type': 'file', 'sha256': _sha(data), 'size_bytes': len(data)}
    # Match the frozen depth-first directory traversal, not global path sorting.
    ordered = []
    def visit(parent):
        children = sorted((e for p, e in entries.items() if PurePosixPath(p).parent.as_posix() == parent), key=lambda e: PurePosixPath(e['path']).name)
        for entry in children:
            ordered.append(entry)
            if entry['type'] == 'directory':
                visit(entry['path'])
    visit('.')
    if (len(ordered) != len(entries) or len(entries) > MAX_ENTRIES
            or any(len(b) > MAX_FILE_BYTES for b in after.values())
            or sum(map(len, after.values())) > MAX_TOTAL_BYTES):
        raise ValueError('Simulated workspace exceeds bounded policy')
    result = canonical_json_bytes({'schema_version': 1, 'entries': ordered}).decode('utf-8')
    _manifest(result)
    return result, after

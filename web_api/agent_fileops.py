"""Bounded file lifecycle with retained bytes and explicit non-atomic receipts."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
from uuid import uuid4

from axis_evo.sandbox import _pin_windows_parents
from .agent_workspace import EXCLUDED, MAX_FILE_BYTES, fail, relative_path
from .schemas import no_redirected_parents

MUTATIONS = frozenset(('write_file', 'patch_file', 'create_directory', 'move_file', 'delete_file'))


def directory_path(value):
    if (type(value) is not str or not value or len(value) > 512 or '\\' in value or ':' in value
            or any(ord(c) < 32 for c in value) or PurePosixPath(value).is_absolute()
            or any(p in ('', '.', '..') or p.startswith('.') or p.casefold() in EXCLUDED for p in value.split('/'))):
        fail('WORKSPACE_PATH_DENIED', '需要工作区内的普通相对目录路径。', 403)
    return value


def paths(name, args):
    if name not in MUTATIONS:
        return []
    result = [directory_path(args['path']) if name == 'create_directory' else relative_path(args['path'])]
    if name == 'move_file':
        result.append(relative_path(args['destination']))
    return result


@contextmanager
def pinned_parents(resolver, targets):
    chains = [resolver._fence(target) for target in targets]
    close, handles = None, []
    try:
        if os.name == 'nt':
            parents = tuple(dict.fromkeys(item for chain in chains for item in chain))
            close, handles = _pin_windows_parents(parents)
        if chains != [resolver._fence(target) for target in targets]:
            raise ValueError('parent identity changed')
        yield
    finally:
        if close:
            for handle in reversed(handles):
                close(handle)


def execute(service, turn, call_id, name, args):
    wid = turn['workspaceId']
    names = paths(name, args)
    resolver = service.workspaces.resolver(wid, write=True)
    targets = [resolver.resolve(path) for path in names]
    for target in targets:
        no_redirected_parents(target)
    if name == 'create_directory':
        if targets[0].exists():
            fail('DIRECTORY_EXISTS', '目标已存在，请先观察。', 409)
        service.bind_execution(turn, call_id, 'filesystem', {'operation': name, 'paths': names})
        with pinned_parents(resolver, targets):
            targets[0].mkdir()
            no_redirected_parents(targets[0])
            if not targets[0].is_dir():
                raise RuntimeError('DIRECTORY_UNCONFIRMED')
        fact = service.store.append('file_operation', {'operation': name, 'paths': names, 'changes': [],
            'verified': True, 'atomic': False}, wid, turn['id'])
        return {'operationId': fact['id'], **fact['payload']}
    expected = args['expectedSha256']
    if type(expected) is not str or not re.fullmatch('[a-f0-9]{64}', expected):
        fail('FILE_EXPECTED_DIGEST', '操作需要已读取文件的 SHA-256。')
    if name == 'move_file' and (os.path.normcase(str(targets[0])) == os.path.normcase(str(targets[1])) or targets[1].exists()):
        fail('FILE_EXISTS', '移动目标已存在，不能覆盖。', 409)
    with targets[0].open('rb') as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES or hashlib.sha256(raw).hexdigest() != expected:
        fail('FILE_CHANGED', '文件已变化或超过操作上限，请重新读取。', 409)
    service.runtime.providers.check_text(raw.decode('utf-8-sig'))
    directory = service.store.directory / 'agent-file-operations' / ('op_' + uuid4().hex)
    no_redirected_parents(directory)
    directory.mkdir(parents=True)
    with (directory / 'before.bin').open('xb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    service.bind_execution(turn, call_id, 'filesystem', {'operation': name, 'paths': names, 'directory': str(directory)})
    with pinned_parents(resolver, targets):
        # Revalidate after preserving the backup and immediately before dispatch.
        with targets[0].open('rb') as stream:
            if stream.read(MAX_FILE_BYTES + 1) != raw:
                raise RuntimeError('FILE_CHANGED_AFTER_INTENT')
        if name == 'move_file':
            with targets[1].open('xb') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            with targets[1].open('rb') as stream:
                if stream.read(MAX_FILE_BYTES + 1) != raw:
                    raise RuntimeError('MOVE_COPY_UNCONFIRMED')
        targets[0].unlink()
        if targets[0].exists():
            raise RuntimeError('DELETE_UNCONFIRMED')
    changes = [{'path': names[0], 'beforeSha256': expected, 'afterSha256': None}]
    if name == 'move_file':
        changes.append({'path': names[1], 'beforeSha256': None, 'afterSha256': expected})
    fact = service.store.append('file_operation', {'operation': name, 'paths': names, 'changes': changes,
        'directory': str(directory), 'sha256': expected, 'sizeBytes': len(raw), 'verified': True, 'atomic': False}, wid, turn['id'])
    return {'operationId': fact['id'], **{k: v for k, v in fact['payload'].items() if k != 'directory'}}


def retained(service, payload):
    directory = Path(payload['directory'])
    if not directory.is_relative_to(service.store.directory / 'agent-file-operations'):
        fail('ARTIFACT_INTEGRITY', '文件操作原件位置不匹配。', 409)
    no_redirected_parents(directory / 'before.bin')
    with (directory / 'before.bin').open('rb') as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) != payload['sizeBytes'] or hashlib.sha256(raw).hexdigest() != payload['sha256']:
        fail('ARTIFACT_INTEGRITY', '文件操作原件摘要不匹配。', 409)
    return raw

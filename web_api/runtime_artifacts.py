"""Explicit bounded previews of recorded Runtime files, with source-byte checks."""
import hashlib

from axis_evo.sandbox import WorkspacePathResolver
from .schemas import ApiError, strict_json


def preview(runtime, project, thread_id, body):
    if type(body) is not dict or body.keys() != {'path', 'sha256'} or type(body['path']) is not str or type(body['sha256']) is not str:
        raise ApiError('ARTIFACT_REQUEST_REJECTED', '需要已记录文件的精确路径与摘要。', 400)
    thread = runtime.get_thread(project, thread_id)
    files = (thread.get('run') or {}).get('files', [])
    latest = next((item for item in reversed(files) if item['path'] == body['path']), None)
    if not latest or not latest['exists'] or latest['sha256'] != body['sha256']:
        raise ApiError('ARTIFACT_NOT_BOUND', '该文件不属于当前加载的持久化观察。', 409)
    root = runtime._directory(thread_id)
    try:
        current = WorkspacePathResolver(root/'workspace').resolve(body['path'])
        with current.open('rb') as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ApiError('ARTIFACT_PREVIEW_LIMIT', '此文件超过预览上限，请在本地工作区查看。', 413)
        if hashlib.sha256(raw).hexdigest() != latest['sha256'] or len(raw) != latest['sizeBytes']:
            raise ApiError('ARTIFACT_CHANGED', '现场文件与已记录摘要不同，不会当作原交付物展示。', 409)
        content = raw.decode('utf-8', errors='strict')
        runtime.providers.check_text(content)
        row = runtime._row(project, thread_id)
        manifest = strict_json(row['manifest_json'])
        previous = manifest['seed']['files'].get(body['path'])
        before = None
        if previous:
            seed = WorkspacePathResolver(root/'seed').resolve(body['path'])
            with seed.open('rb') as stream:
                original = stream.read(65537)
            if len(original) > 65536 or hashlib.sha256(original).hexdigest() != previous['sha256']:
                raise ApiError('ARTIFACT_SOURCE_CHANGED', '原始文件快照与任务身份不同。', 409)
            before = original.decode('utf-8', errors='strict')
            runtime.providers.check_text(before)
    except ApiError:
        raise
    except (OSError, ValueError, UnicodeError):
        raise ApiError('ARTIFACT_UNAVAILABLE', '文件无法安全预览。', 409) from None
    return {'threadId': thread_id, 'runId': thread['runId'], 'path': body['path'], 'sha256': latest['sha256'],
            'content': content, 'before': before, 'currentBytesVerified': True,
            'taskStatus': thread['status'], 'source': 'RECORDED_HASH_MATCHED_LOCAL_BYTES'}

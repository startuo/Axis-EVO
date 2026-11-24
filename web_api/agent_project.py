"""Project observations and immutable command inputs; never executes project code."""
import difflib
import hashlib
import io
import os
from pathlib import Path
import stat
import tarfile
import time

from .agent_store import digest
from .agent_workspace import EXCLUDED, PUBLIC_DOTFILES, fail, relative_path
from .schemas import ApiError, no_redirected_parents

MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
MAX_DIRECTORY_ENTRIES = 400
MAX_DIRECTORY_SCAN = 2000


def list_directory(workspaces, wid, path):
    if (type(path) is not str or len(path) > 512 or any(c in path for c in ('\\', ':', '\x00'))
            or path and any(not part or part.startswith('.') or part.lower() in EXCLUDED
                            for part in path.split('/'))):
        fail('WORKSPACE_PATH_DENIED', '请选择工作区内的相对目录。', 403)
    resolver = workspaces.resolver(wid)
    entries, truncated = [], False
    deadline = time.monotonic() + 2
    try:
        no_redirected_parents(resolver.root / path)
        directory = resolver.resolve(path) if path else resolver.root
        with os.scandir(directory) as found:
            for index, entry in enumerate(found):
                if index >= MAX_DIRECTORY_SCAN or time.monotonic() > deadline:
                    truncated = True
                    break
                name = entry.name
                if (name.startswith('.') and name not in PUBLIC_DOTFILES
                        or name.lower() in EXCLUDED):
                    continue
                try:
                    info = Path(entry.path).lstat()
                except FileNotFoundError:
                    continue
                if getattr(info, 'st_file_attributes', 0) & 0x400:
                    continue
                if stat.S_ISDIR(info.st_mode):
                    entries.append({'name': name, 'type': 'dir', 'size': 0})
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    try:
                        relative_path((Path(path) / name).as_posix())
                    except ApiError:
                        continue
                    entries.append({'name': name, 'type': 'file', 'size': info.st_size})
    except (FileNotFoundError, NotADirectoryError):
        fail('WORKSPACE_DIRECTORY_MISSING', '请先选择此工作区内的现有文件夹。', 404)
    except ValueError:
        fail('WORKSPACE_PATH_DENIED', '请选择工作区内的相对目录。', 403)
    except OSError:
        fail('WORKSPACE_DIRECTORY_UNAVAILABLE', '无法读取此工作区目录。', 409)
    entries.sort(key=lambda item: (item['type'], item['name'].casefold(), item['name']))
    return {'path': path, 'entries': entries[:MAX_DIRECTORY_ENTRIES],
            'truncated': truncated or len(entries) > MAX_DIRECTORY_ENTRIES}


def preview_file(workspaces, wid, path, max_bytes):
    try:
        data = workspaces.read(wid, 'workspace', path, max_chars=max_bytes)
    except FileNotFoundError:
        fail('WORKSPACE_FILE_MISSING', '文件已移动或不存在。', 404)
    except UnicodeDecodeError:
        fail('WORKSPACE_FILE_NOT_UTF8', '文件不是可预览的 UTF-8 文本。', 409)
    except ValueError:
        fail('WORKSPACE_PATH_DENIED', '请选择工作区内的相对文件。', 403)
    except OSError:
        fail('WORKSPACE_FILE_UNAVAILABLE', '无法读取此文件。', 409)
    encoded = data['content'].encode('utf-8')
    return {'path': data['path'], 'size': data['sizeBytes'], 'sha256': data['sha256'],
            'content': encoded[:max_bytes].decode('utf-8', errors='ignore'),
            'truncated': data['truncated'] or len(encoded) > max_bytes}


def snapshot(workspaces, wid):
    listing = workspaces.files(wid)
    if listing['truncated']:
        fail('PROJECT_SNAPSHOT_LIMIT', '项目文件列表不完整，请缩小工作目录后执行。', 409)
    files, total = [], 0
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        for item in listing['files']:
            material = workspaces.read(wid, 'workspace', item['path'], max_chars=4 * 1024 * 1024)
            raw = material['content'].encode('utf-8')
            if hashlib.sha256(raw).hexdigest()!=material['sha256']:
                raw=b'\xef\xbb\xbf'+raw  # Preserve an original UTF-8 BOM, never synthesize different input bytes.
            if material['truncated'] or hashlib.sha256(raw).hexdigest() != material['sha256']:
                fail('PROJECT_SNAPSHOT_CHANGED', '无法完整核对项目输入。', 409)
            total += len(raw)
            if total > MAX_SNAPSHOT_BYTES:
                fail('PROJECT_SNAPSHOT_LIMIT', '项目文本副本超过16MiB，请缩小工作目录。', 409)
            entry = tarfile.TarInfo(item['path'])
            entry.size, entry.mode, entry.mtime = len(raw), 0o600, 0
            tar.addfile(entry, io.BytesIO(raw))
            files.append({'path':item['path'], 'sha256':material['sha256'], 'sizeBytes':len(raw)})
    manifest = {'files':files, 'bytes':total, 'scope':'AUTHORIZED_TEXT_FILES_ONLY',
        'excluded':'Only curated public dotfiles are included. Credentials, links, binaries, dependencies and build outputs are not copied.'}
    return {'manifest':manifest, 'sha256':digest(manifest), 'archive':archive.getvalue()}


def overview(workspaces, wid):
    listing = workspaces.files(wid)
    paths = [row['path'] for row in listing['files']]
    configs = [path for path in paths if Path(path).name.lower() in (
        'package.json', 'pyproject.toml', 'requirements.txt', 'cargo.toml', 'go.mod', 'makefile', 'dockerfile')]
    return {'files':listing['files'][:300], 'totalFiles':len(paths),
        'truncated':listing['truncated'] or len(paths)>300, 'projectFiles':configs[:40],
        'testFiles':[path for path in paths if 'test' in path.lower()][:60],
        'nextStep':'Read project configuration and relevant files before choosing commands. Names are observations, not authorization.'}


def fixed_inputs(inputs, protected):
    """Overlay first-party frozen checks; a candidate never supplies their bytes."""
    with tarfile.open(fileobj=io.BytesIO(inputs['archive'])) as source:
        files={entry.name:source.extractfile(entry).read() for entry in source.getmembers() if entry.isfile()}
    for row in protected:
        raw=row['content'].encode('utf-8')
        if hashlib.sha256(raw).hexdigest()!=row['sha256']:
            fail('EXECUTION_CHECK_INTEGRITY','固定验证材料摘要不匹配。',409)
        files[row['path']]=raw
    buf=io.BytesIO()
    manifest=[]
    with tarfile.open(fileobj=buf,mode='w') as target:
        for path,raw in sorted(files.items()):
            entry=tarfile.TarInfo(path); entry.size=len(raw); entry.mode=0o600
            target.addfile(entry,io.BytesIO(raw))
            manifest.append({'path':path,'sha256':hashlib.sha256(raw).hexdigest(),'sizeBytes':len(raw)})
    value={**inputs['manifest'],'files':manifest,'bytes':sum(len(raw) for raw in files.values()),
        'fixedVerificationPaths':[row['path'] for row in protected]}
    return {'archive':buf.getvalue(),'manifest':value,'sha256':digest(value)}


def update_plan(service, turn, steps):
    if type(steps) is not list or not 1 <= len(steps) <= 12:
        fail('TASK_PLAN_INVALID', '计划需包含1至12项步骤。')
    for step in steps:
        if (type(step) is not dict or step.keys() != {'title','status'}
                or type(step['title']) is not str or not 1 <= len(step['title']) <= 160
                or step['status'] not in ('pending','in_progress','completed')):
            fail('TASK_PLAN_INVALID', '计划步骤字段无效。')
    if sum(step['status']=='in_progress' for step in steps)>1:
        fail('TASK_PLAN_INVALID', '同一计划只标记一个当前步骤。')
    record = service.store.append('task_plan', {'steps':steps, 'basis':'MODEL_REPORTED_PLAN_NOT_EXECUTION_PROOF'},
        turn['workspaceId'], turn['id'])
    return {'planId':record['id'], **record['payload']}


def changes(service, tid):
    turn = service.store.get(tid, 'turn')
    grouped = {}
    directories=[]
    from .agent_fileops import retained
    for row in service.store.iter_records(parent_id=tid):
        payload=row['payload']
        if row['kind']=='artifact':
            old=None
            if payload['previousSha256'] is not None:
                directory=Path(payload['directory'])
                if not directory.is_relative_to(service.store.directory/'agent-files'):
                    fail('ARTIFACT_INTEGRITY','变更前版本身份无效。',409)
                no_redirected_parents(directory/'before.bin')
                with (directory/'before.bin').open('rb') as stream:
                    old=stream.read(128*1024+1)
                if hashlib.sha256(old).hexdigest()!=payload['previousSha256']:
                    fail('ARTIFACT_INTEGRITY','变更前版本摘要不匹配。',409)
            current=service.artifact(row)
            grouped.setdefault(payload['path'],[]).append((old,current['content'].encode('utf-8')))
        elif row['kind']=='file_operation':
            if payload['operation']=='create_directory':
                directories.extend(payload['paths'])
                continue
            raw=retained(service,payload)
            for change in payload['changes']:
                grouped.setdefault(change['path'],[]).append((raw if change['beforeSha256'] else None,
                    raw if change['afterSha256'] else None))
    results, total = [], 0
    for path, rows in grouped.items():
        old,after=rows[0][0],rows[-1][1]
        before_sha=hashlib.sha256(old).hexdigest() if old is not None else None
        after_sha=hashlib.sha256(after).hexdigest() if after is not None else None
        try:
            if after is None:
                resolver=service.workspaces.resolver(turn['workspaceId'])
                no_redirected_parents(resolver.root/path)
                matches=not resolver.resolve(path).exists()
            else:
                matches=service.workspaces.read(turn['workspaceId'],'workspace',path)['sha256']==after_sha
        except (OSError,ValueError,ApiError):
            matches=False
        diff = ''.join(difflib.unified_diff((old or b'').decode('utf-8-sig').splitlines(True),
            (after or b'').decode('utf-8-sig').splitlines(True), fromfile='before/'+path, tofile='after/'+path))
        total += len(diff.encode('utf-8'))
        if total > 192 * 1024:
            fail('PROJECT_DIFF_LIMIT', '差异超过显示上限，请分别查看交付版本。', 409)
        results.append({'path':path, 'beforeSha256':before_sha,
            'afterSha256':after_sha, 'matchesCurrentFile':matches, 'diff':diff})
    return {'turnId':tid, 'workspaceId':turn['workspaceId'], 'files':results,
        'directoriesCreated':directories,'basis':'FIRST_RETAINED_BEFORE_TO_LAST_VERIFIED_AFTER', 'atomic':False}

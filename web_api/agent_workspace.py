"""User-owned workspace grants and bounded, identity-checked material access."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time
from uuid import uuid4

from axis_evo.sandbox import WorkspacePathResolver
from .schemas import ApiError, no_redirected_parents, public_text

MAX_FILE_BYTES = 128 * 1024
MAX_READ_FILE_BYTES = 4 * 1024 * 1024
MAX_SCAN_ENTRIES = 2000
MAX_SEARCH_BYTES = 8 * 1024 * 1024
TEXT_SUFFIXES = frozenset(('.md','.txt','.rst','.csv','.tsv','.json','.yaml','.yml','.toml',
    '.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.html','.css','.scss','.c','.h','.cpp','.rs','.go','.java','.xml','.sql',
    '.sh','.ps1','.bat','.cmd','.ini','.cfg','.lock','.vue','.svelte'))
TEXT_NAMES = frozenset(('makefile','dockerfile','license','readme','py.typed'))
PUBLIC_DOTFILES = frozenset(('.gitignore','.gitattributes','.editorconfig','.prettierrc','.prettierrc.json','.eslintrc.json'))
EXCLUDED = frozenset(('.git','.svn','.hg','.local','.axis-evo','.ssh','.aws','.azure','.gnupg','.config',
    'node_modules','__pycache__','.venv','venv','dist','build','.cache','appdata','windows','program files',
    'program files (x86)','$recycle.bin','system volume information'))


def fail(code, message, status=400):
    raise ApiError(code, message, status)


def _line_start(text, line, offset=0):
    for _ in range(line - 1):
        newline = text.find('\n', offset)
        if newline == -1:
            return None
        offset = newline + 1
    return offset


def bounded_text(value, limit=256):
    if type(value) is not str or not value.strip() or len(value) > limit or public_text(value, limit) != value:
        fail('WORKSPACE_INPUT_INVALID', '请输入有效的名称或文本。')
    return value.strip()


def relative_path(value):
    if type(value) is not str or not value or len(value) > 512 or '\\' in value or ':' in value or '\x00' in value:
        fail('WORKSPACE_PATH_DENIED', '工具需要工作区内的相对路径。', 403)
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in ('..','.') or p.startswith('.') and not (i==len(path.parts)-1 and p in PUBLIC_DOTFILES)
            or p.lower() in EXCLUDED for i,p in enumerate(path.parts)):
        fail('WORKSPACE_PATH_DENIED', '此路径不在可用的材料范围内。', 403)
    if (path.suffix.lower() not in TEXT_SUFFIXES and path.name.lower() not in TEXT_NAMES and path.name not in PUBLIC_DOTFILES
            or path.name.lower() in ('credentials.json','secrets.json')):
        fail('WORKSPACE_FILE_TYPE', '当前工具仅处理授权目录中的普通文本文件。', 403)
    return path.as_posix()


def root_identity(path):
    no_redirected_parents(path)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode):
        fail('WORKSPACE_ROOT_INVALID', '请选择已有的本地文件夹。')
    return [info.st_dev, info.st_ino]


class AgentWorkspaces:
    def __init__(self, store, providers):
        self.store, self.providers = store, providers

    def _root(self, value):
        if type(value) is not str or not Path(value).is_absolute():
            fail('WORKSPACE_ROOT_INVALID', '请输入已有文件夹的绝对路径。')
        path = Path(value).absolute()
        no_redirected_parents(path)
        path = path.resolve(strict=True)
        if (path == Path(path.anchor) or path == Path.home() or path.is_relative_to(self.store.directory)
                or self.store.directory.is_relative_to(path)):
            fail('WORKSPACE_ROOT_INVALID', '请选择具体的工作文件夹。')
        if any(p.lower() in EXCLUDED for p in path.parts):
            # Explicit .local test workspaces are allowed, but OS/credential roots are not.
            if any(p.lower() in EXCLUDED - {'.local'} for p in path.parts):
                fail('WORKSPACE_ROOT_INVALID', '系统与凭据目录不能注册为工作材料。', 403)
        return path, root_identity(path)

    def create(self, body):
        if type(body) is not dict or body.keys() != {'name','path','writeMode','shareWithProvider'} or body['shareWithProvider'] is not True:
            fail('WORKSPACE_AUTHORITY_REQUIRED', '创建工作区需要明确授权所选目录和模型材料访问。', 403)
        name = bounded_text(body['name'], 80)
        if body['writeMode'] not in ('read','write'):
            fail('WORKSPACE_POLICY_INVALID', '请选择只读或允许写入。')
        path, pin = self._root(body['path'])
        self.store.prepare()
        for workspace in self.store.iter_records('workspace'):
            if os.path.normcase(workspace['payload']['path']) == os.path.normcase(str(path)):
                return self.get(workspace['id'])
        record = self.store.append('workspace', {'name':name,'path':str(path),'rootIdentity':pin,
            'policy':{'writeMode':body['writeMode'],'evolutionMode':'observe','style':'balanced'},'shareWithProvider':True},
            identity='workspace_'+uuid4().hex)
        return self.get(record['id'])

    def list(self):
        return [self.get(r['id']) for r in self.store.records('workspace',limit=1000) if not r['payload'].get('internalEvaluation')]

    def get(self, workspace_id):
        row = self.store.get(workspace_id,'workspace')
        changes = list(self.store.iter_records('workspace_settings',workspace_id=workspace_id))
        value = row['payload']
        sources = []
        for source in self.store.records('source',workspace_id=workspace_id,limit=100):
            revoked = self.store.records('source_revoked',workspace_id=workspace_id,parent_id=source['id'],limit=1)
            sources.append({'id':source['id'],**source['payload'],'enabled':not revoked})
        return {'id':workspace_id,**value,'revision':len(changes)+1,
                'policy':changes[-1]['payload'] if changes else value['policy'],'sources':sources}

    def settings(self, workspace_id, body):
        self.get(workspace_id)
        if (type(body) is not dict or body.keys() != {'writeMode','evolutionMode','style'}
                or body['writeMode'] not in ('read','write') or body['evolutionMode'] not in ('off','observe','auto')
                or body['style'] not in ('concise','balanced','detailed')):
            fail('WORKSPACE_POLICY_INVALID', '工作区策略无效。')
        self.store.append('workspace_settings',dict(body),workspace_id)
        return self.get(workspace_id)

    def add_source(self, workspace_id, body):
        workspace = self.get(workspace_id)
        if type(body) is not dict or body.keys() != {'name','path','kind','shareWithProvider'} or body['shareWithProvider'] is not True:
            fail('SOURCE_AUTHORITY_REQUIRED','接入材料需要明确授权目录及模型访问。',403)
        if body['kind'] not in ('knowledge','skills') or len(workspace['sources']) >= 32:
            fail('SOURCE_LIMIT','来源类型无效或已达到32个来源上限。')
        path,pin = self._root(body['path'])
        self.store.append('source',{'name':bounded_text(body['name'],80),'path':str(path),'kind':body['kind'],
            'rootIdentity':pin,'shareWithProvider':True},workspace_id)
        return self.get(workspace_id)

    def revoke_source(self, workspace_id, source_id):
        self.source(workspace_id, source_id)
        self.store.append('source_revoked',{'reason':'USER_REVOKED'},workspace_id,source_id)
        return self.get(workspace_id)

    def source(self, workspace_id, source_id='workspace'):
        workspace = self.get(workspace_id)
        if source_id == 'workspace':
            return {'id':'workspace','kind':'workspace','enabled':True,**workspace}
        for source in workspace['sources']:
            if source['id'] == source_id and source['enabled']:
                return source
        fail('SOURCE_NOT_AUTHORIZED','该来源尚未授权或已撤销。',403)

    def resolver(self, workspace_id, source_id='workspace', *, write=False):
        source = self.source(workspace_id,source_id)
        if write and (source_id != 'workspace' or source['policy']['writeMode'] != 'write'):
            fail('WORKSPACE_WRITE_DENIED','此工作区当前为只读；请在设置中修改授权。',403)
        root = Path(source['path'])
        if not self.get(workspace_id).get('internalEvaluation') and (
                root.is_relative_to(self.store.directory) or self.store.directory.is_relative_to(root)):
            fail('WORKSPACE_ROOT_INVALID','工作材料与 Agent 状态目录需要分别存放。',403)
        if root_identity(root) != source['rootIdentity']:
            fail('WORKSPACE_ROOT_CHANGED','工作区目录身份发生变化，请重新选择。',409)
        return WorkspacePathResolver(root)

    def read(self, workspace_id, source_id, path, *, max_chars=24000, start_char=0,
             start_line=None, end_line=None, expected_sha256=None):
        if (type(start_char) is not int or start_char < 0 or type(max_chars) is not int
                or not 1 <= max_chars <= MAX_READ_FILE_BYTES):
            fail('WORKSPACE_READ_RANGE', '读取范围需要非负字符起点和有效长度。')
        if start_line is not None and (type(start_line) is not int or start_line < 1 or start_char != 0):
            fail('WORKSPACE_READ_RANGE', '请使用从1开始的 startLine，或使用 startChar。')
        if end_line is not None and (type(end_line) is not int or start_line is None or end_line <= start_line):
            fail('WORKSPACE_READ_RANGE', 'endLine 不含指定行，且必须大于 startLine。')
        if expected_sha256 is not None and (type(expected_sha256) is not str
                or not re.fullmatch('[a-f0-9]{64}', expected_sha256)):
            fail('FILE_EXPECTED_DIGEST', '分段读取需要来源返回的 SHA-256。')
        path = relative_path(path)
        resolver = self.resolver(workspace_id,source_id)
        no_redirected_parents(resolver.root / path)
        target = resolver.resolve(path)
        with target.open('rb') as stream:
            data = stream.read(MAX_READ_FILE_BYTES+1)
        if len(data)>MAX_READ_FILE_BYTES:
            fail('WORKSPACE_FILE_LIMIT','文件超过4MiB文本读取上限。',413)
        sha256 = hashlib.sha256(data).hexdigest()
        if expected_sha256 is not None and sha256 != expected_sha256:
            fail('FILE_CHANGED', '来源已变化，请重新检索并核对范围。', 409)
        text = data.decode('utf-8-sig')
        self.providers.check_text(text)
        stop = len(text)
        if start_line is not None:
            start_char = _line_start(text, start_line)
            if start_char is None:
                last_line = text.count('\n') + 1
                fail('WORKSPACE_READ_RANGE', f'文件末行是 {last_line}，请选择文件内起点。')
            if end_line is not None:
                boundary = _line_start(text, end_line - start_line + 1, start_char)
                if boundary is not None:
                    stop = boundary
        if start_char > len(text):
            fail('WORKSPACE_READ_RANGE', f'文件共有 {len(text)} 字符，请使用有效的 startChar 或指定行。')
        end_char = min(stop, start_char + max_chars)
        partial = start_char != 0 or end_char != len(text)
        return {'sourceId':source_id,'path':path,'sha256':sha256,
            'sizeBytes':len(data),'content':text[start_char:end_char],
            'startChar':start_char,'endChar':end_char,'totalChars':len(text),
            'startLine':text.count('\n',0,start_char)+1,
            'endLine':text.count('\n',0,max(start_char,end_char-1))+1,
            'nextStartChar':end_char if end_char<len(text) else None,
            'coverage':'PARTIAL' if partial else 'FULL','truncated':partial,
            'trust':'UNTRUSTED_MATERIAL'}

    def files(self, workspace_id, source_id='workspace'):
        resolver = self.resolver(workspace_id,source_id)
        stack, found, visited = [resolver.root], [], 0
        deadline = time.monotonic()+3
        truncated = False
        oversized = 0
        while stack:
            directory = stack.pop()
            no_redirected_parents(directory)
            if time.monotonic()>deadline:
                truncated=True
                break
            with os.scandir(directory) as entries:
                for entry in entries:
                    visited += 1
                    if visited>MAX_SCAN_ENTRIES or time.monotonic()>deadline:
                        truncated=True
                        break
                    if entry.name.startswith('.') and entry.name not in PUBLIC_DOTFILES or entry.name.lower() in EXCLUDED:
                        continue
                    # Windows scandir's cached stat reports st_nlink=0. Use an
                    # actual lstat before enforcing the no-hardlinks boundary.
                    info=Path(entry.path).lstat() if os.name=='nt' else entry.stat(follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
                        continue
                    if stat.S_ISDIR(info.st_mode):
                        stack.append(Path(entry.path))
                    elif stat.S_ISREG(info.st_mode) and info.st_nlink==1:
                        try:
                            name=relative_path(Path(entry.path).relative_to(resolver.root).as_posix())
                        except ApiError:
                            continue
                        if info.st_size>MAX_READ_FILE_BYTES:
                            oversized+=1
                            continue
                        found.append({'sourceId':source_id,'path':name,'sizeBytes':info.st_size})
                if truncated:
                    break
        return {'files':sorted(found,key=lambda f:f['path'].casefold()),'truncated':truncated or oversized>0,
            'entriesExamined':visited,'oversizedFilesSkipped':oversized,'maximumFileBytes':MAX_READ_FILE_BYTES}

    def search(self, workspace_id, query, source_id=None):
        query=bounded_text(query,160)
        pattern=re.compile(re.escape(query),re.IGNORECASE)
        workspace=self.get(workspace_id)
        sources=[source_id] if source_id else ['workspace']+[s['id'] for s in workspace['sources'] if s['enabled'] and s['kind']=='knowledge']
        matches, used, truncated = [],0,False
        for source in sources:
            listing=self.files(workspace_id,source)
            truncated |= listing['truncated']
            for item in listing['files']:
                if used+item['sizeBytes']>MAX_SEARCH_BYTES or len(matches)>=30:
                    return {'matches':matches,'truncated':True,'bytesExamined':used}
                try:
                    material=self.read(workspace_id,source,item['path'],max_chars=MAX_READ_FILE_BYTES)
                except (ApiError,UnicodeError,OSError,ValueError):
                    truncated=True
                    continue
                used+=material['sizeBytes']
                content=material['content']
                match=pattern.search(content)
                at=match.start() if match else -1
                if at>=0 or query.casefold() in item['path'].casefold():
                    start=max(0,at-120)
                    end=min(len(content),start+480)
                    matches.append({**item,'sha256':material['sha256'],'excerpt':content[start:end],
                        'startChar':start,'endChar':end,'totalChars':len(content),
                        'startLine':content.count('\n',0,start)+1,
                        'endLine':content.count('\n',0,max(start,end-1))+1,
                        'matchStartChar':at if match else None,
                        'matchLine':content.count('\n',0,at)+1 if match else None,
                        'truncated':start>0 or end<len(content),'trust':'UNTRUSTED_MATERIAL'})
        return {'matches':matches,'truncated':truncated,'bytesExamined':used}

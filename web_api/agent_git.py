"""Bounded Agent observations and explicit first-party Git review actions."""
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
from tempfile import NamedTemporaryFile
from axis_evo.process_limits import bounded_run, OutputLimitExceeded
from .process_environment import child_environment

from .agent_workspace import bounded_text, relative_path, fail
from .schemas import ApiError, no_redirected_parents


DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--no-color']
STATUS = ['status', '--porcelain=v1', '--branch', '--untracked-files=normal', '--ignore-submodules=all']
MUTATIONS = {'stage', 'unstage', 'revert', 'commit'}
MAX_GIT_METADATA_ENTRIES = 24_000


def _validate_metadata_trees(metadata):
    trees = {'objects','refs','logs','info'}
    pending = [metadata]
    visited = 0
    while pending:
        folder = pending.pop()
        try:
            children = os.scandir(folder)
        except FileNotFoundError:
            continue
        with children:
            for entry in children:
                visited += 1
                if visited > MAX_GIT_METADATA_ENTRIES:
                    fail('GIT_METADATA_LIMIT','Git 元数据超出本地审查容量。',409)
                info = os.lstat(entry.path)
                if (stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0) & 0x400
                        or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) and info.st_nlink==1)):
                    fail('GIT_EXECUTION_POLICY','Git 元数据不能引用授权目录之外的文件。',403)
                if stat.S_ISDIR(info.st_mode) and (folder != metadata or entry.name in trees):
                    pending.append(Path(entry.path))


def _git(service, wid, *, write=False):
    root = service.workspaces.resolver(wid, write=write).root
    metadata = root / '.git'
    no_redirected_parents(metadata)
    # A linked worktree's gitdir can point outside the granted folder. That
    # additional repository must be authorized separately, never inferred.
    if not metadata.is_dir():
        fail('GIT_REPOSITORY_REQUIRED', '此工具需要授权目录自身包含 .git 的独立仓库；关联工作树暂不读取外部 Git 目录。', 409)
    for entry in ('config', 'index', 'HEAD', 'objects', 'refs', 'packed-refs', 'shallow', 'commondir',
                  'objects/info/alternates', 'objects/info/http-alternates', 'logs','info','reftable'):
        no_redirected_parents(metadata / entry)
    for entry in ('config','index','HEAD','packed-refs','shallow'):
        _require_worktree_file(metadata/entry)
    _validate_metadata_trees(metadata)
    executable = shutil.which('git')
    if not executable:
        fail('GIT_UNAVAILABLE', '本机未安装 Git。', 409)
    options = ['--no-pager', '--literal-pathspecs',
        '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=' + os.devnull,
        '-c', 'core.attributesFile=' + os.devnull, '-c', 'core.quotePath=true',
        '-c', 'diff.external=', '-c', 'pager.status=false', '-c', 'log.showSignature=false', '-c', 'commit.gpgSign=false',
        '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
        '--git-dir=' + str(metadata), '--work-tree=' + str(root)]
    env = child_environment()
    env.update({'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':os.devnull,'GIT_ATTR_NOSYSTEM':'1','GIT_NO_LAZY_FETCH':'1',
                'GIT_TERMINAL_PROMPT':'0','GIT_PAGER':'cat','GIT_OPTIONAL_LOCKS':'0'})
    repo = root, [executable, *options], env
    _review_config(repo)
    return repo


def _run_git(repo, command, *, bounded=True):
    root, git, env = repo
    try:
        result = bounded_run([*git, *command], cwd=root, env=env, timeout=10)
    except OutputLimitExceeded as error:
        if not bounded:
            fail('GIT_ACTION_OUTPUT_LIMIT', 'Git 操作输出超过限制。', 409)
        return error.stdout, True, None
    except (OSError, subprocess.TimeoutExpired):
        fail('GIT_EXECUTION_UNCONFIRMED', 'Git 未在时限内确认结果。', 409)
    return result.stdout, False, result.returncode


def _success(result):
    text, truncated, code = result
    if code:
        fail('GIT_OBSERVATION_FAILED', 'Git 无法读取此仓库状态。', 409)
    return text, truncated


def observe(service, turn, name, args):
    wid = turn['workspaceId']
    repo = _git(service, wid)
    if name == 'git_status':
        command = STATUS
    elif name == 'git_log':
        command = ['log', '-8', '--format=%h %s', '--no-decorate', '--no-show-signature']
    else:
        path = relative_path(args['path'])
        service.workspaces.read(wid, 'workspace', path)
        command = [*DIFF, 'HEAD', '--', path]
    result = _run_git(repo, command)
    text, truncated = _success(result)
    service.runtime.providers.check_text(text)
    return {'operation': name, 'text': text, 'truncated': truncated,
        'readOnly': True, 'scope': 'LOCAL_REPOSITORY','commandCompleted':not truncated,'exitCode': result[2]}


def _branch(repo):
    head, _, code = _run_git(repo, ['symbolic-ref','--quiet','--short','HEAD'])
    if code not in (0, 1):
        fail('GIT_OBSERVATION_FAILED','无法核对当前 Git 分支。',409)
    branches, truncated = _success(_run_git(repo, [
        'for-each-ref','--format=%(refname:short)','refs/heads','refs/remotes']))
    return {'current':head.strip() or None,'detached':code==1,'branches':branches.splitlines(),'truncated':truncated}


def _guard_paths(service, wid, root, paths):
    if not paths or len(paths)>500:
        fail('GIT_PATHS_REQUIRED','请选择要操作的 Git 文件。')
    values = [relative_path(path) for path in paths]
    for path in values:
        _require_worktree_file(root/path)
        if service.execution.is_protected(wid,path):
            fail('VERIFICATION_FILE_PROTECTED','此路径是固定验证内容。',403)
    if service.store.has_fenced_path([str((root/path).resolve()) for path in values]):
        fail('PREVIOUS_OUTCOME_UNKNOWN','路径存在尚未确认的执行结果。',409)
    return values


def _require_worktree_file(target):
    try:
        no_redirected_parents(target)
        info = target.stat()
    except FileNotFoundError:
        return  # A tracked deletion remains reviewable.
    except (OSError, ValueError):
        fail('GIT_PATH_INVALID','无法确认 Git 路径位于授权目录内。',403)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        fail('GIT_PATH_INVALID','Git 操作只接受无重定向的普通文件。',403)


def _scoped_diff(repo, refs, paths, *, worktree=False):
    command=[*DIFF,*refs]
    omitted=False
    if not paths:
        names, _ = _success(_run_git(repo,[*command,'--name-only','--no-renames','-z','--'],bounded=False))
        for name in names.split('\0')[:-1]:
            try:
                paths.append(relative_path(name))
            except ApiError:
                omitted=True
        if not paths:
            return '',omitted
    if worktree:
        for path in paths:
            _require_worktree_file(repo[0]/path)
    text,truncated=_success(_run_git(repo,[*command,'--',*paths]))
    return text,truncated or omitted


def _read_review(service, wid, repo, operation, params):
    if operation == 'branch':
        result = _branch(repo)
        service.runtime.providers.check_text(str(result))
        return result
    if operation == 'status':
        text, truncated = _success(_run_git(repo, STATUS))
        lines = text.splitlines()
        branch = _branch(repo)['current']
        service.runtime.providers.check_text(text)
        return {'clean':not truncated and len(lines)==1,'branch':branch,'text':text,'truncated':truncated}
    if operation == 'log':
        limit=params.get('limit',20)
        if type(limit) is not int or not 1<=limit<=100:
            fail('GIT_LOG_LIMIT','日志条数应介于 1 和 100。')
        text, truncated = _success(_run_git(repo,['log',f'-{limit}','--format=%h %s','--no-show-signature']))
        service.runtime.providers.check_text(text)
        return {'entries':text.splitlines(),'truncated':truncated}
    if operation == 'compare':
        branches = _branch(repo)['branches']
        base=params.get('base') or next((b for b in ('main','master','origin/main') if b in branches),None)
        if base not in branches or type(base) is not str or not re.fullmatch(r'[\w./@-]{1,200}',base) or base.startswith('-'):
            fail('GIT_BASE_INVALID','请选择可见的 Git 基准分支。',409)
        sha, _ = _success(_run_git(repo,['merge-base','HEAD',base]))
        sha=sha.strip()
        if not re.fullmatch('[a-f0-9]{40,64}',sha):
            fail('GIT_BASE_INVALID','无法核对 Git 合并基准。',409)
        text, truncated = _scoped_diff(repo,[sha,'HEAD'],[])
        service.runtime.providers.check_text(text)
        return {'base':base,'mergeBase':sha,'diff':text,'truncated':truncated}
    if operation != 'diff':
        fail('GIT_OPERATION_INVALID','未知 Git 审查操作。')
    paths = []
    if params.get('path'):
        paths=[relative_path(params['path'])]
    staged=params.get('staged',False)
    if type(staged) is not bool:
        fail('GIT_OPERATION_INVALID','staged 须为布尔值。')
    text, truncated = _scoped_diff(repo,['--cached'] if staged else [],paths,worktree=not staged)
    service.runtime.providers.check_text(text)
    return {'diff':text,'truncated':truncated}


def _review_config(repo):
    root, _, _ = repo
    metadata=root/'.git'
    if any((metadata/entry).exists() for entry in (
            'commondir','objects/info/alternates','objects/info/http-alternates','reftable')):
        fail('GIT_EXECUTION_POLICY','此仓库引用了授权目录之外的 Git 元数据。',403)
    options, _ = _success(_run_git(repo,['config','--file',str(metadata/'config'),
                                         '--no-includes','--name-only','--list'], bounded=False))
    if any(k.startswith(('filter.','include.','includeif.','extensions.worktreeconfig',
                         'extensions.partialclone','extensions.refstorage'))
           or (k.startswith('remote.') and k.endswith(('.promisor','.partialclonefilter')))
           for k in map(str.lower,options.splitlines())):
        fail('GIT_EXECUTION_POLICY','此仓库配置了工作台不支持的外部 Git 配置或过滤器。',403)


def _commit_args(service, wid, repo, params):
    root, _, _ = repo
    message = bounded_text(params.get('message'),8000)
    service.runtime.providers.check_text(message)
    metadata=root/'.git'
    symbolic, _, code = _run_git(repo,['symbolic-ref','--quiet','HEAD'])
    ref=symbolic.strip()
    if code not in (0,1) or (code==0 and not ref.startswith('refs/heads/')):
        fail('GIT_BRANCH_INVALID','当前 Git 提交引用无法核对。',409)
    if code==0 and _run_git(repo,['check-ref-format',ref])[2]!=0:
        fail('GIT_BRANCH_INVALID','当前 Git 提交引用无法核对。',409)
    for path in ('HEAD','logs/HEAD','COMMIT_EDITMSG',*([ref,'logs/'+ref] if code==0 else [])):
        _require_worktree_file(metadata/path)
        _require_worktree_file(metadata/(path+'.lock'))
    staged, _ = _success(_run_git(repo,[*DIFF,'--cached','--name-only','--no-renames','-z','--'],bounded=False))
    staged_paths = staged.split('\0')[:-1]
    paths = _guard_paths(service,wid,root,params.get('paths') or staged_paths)
    if not set(paths)<=set(staged_paths):
        fail('GIT_COMMIT_NOT_STAGED','提交前请暂存选定文件。',409)
    for variable in ('GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT'):
        _, _, code = _run_git(repo,['var',variable])
        if code:
            fail('GIT_IDENTITY_REQUIRED','请为此仓库配置 Git 提交者姓名和邮箱。',409)
    if params.get('paths'):
        _, _, clean = _run_git(repo,[*DIFF,'--quiet','--',*paths])
        if clean!=0:
            fail('GIT_COMMIT_WORKTREE_DIFF','选定文件还有未暂存修改，请先确认提交范围。',409)
        return paths,['commit','--only','-m',message,'--',*paths]
    return paths,['commit','-m',message]


def _dispatch_mutation(service, wid, repo, operation, paths, command):
    canonical_paths=[str((repo[0]/path).resolve()) for path in paths]
    intent=service.store.append('tool_intent',{'tool':'user_git_'+operation,'mutating':True,
                                'path':paths[0],'canonicalPaths':canonical_paths,'paths':paths},wid,wid)
    try:
        text, _, code = _run_git(repo,command,bounded=False)
        service.runtime.providers.check_text(text)
        if code:
            fail('GIT_ACTION_UNCONFIRMED','Git 未确认操作完成，请检查本地仓库状态。',409)
        service.store.append('tool_result',{'intentId':intent['id'],'status':'SUCCESS'},wid,wid)
    except (ApiError,OSError):
        service.store.append('tool_result',{'intentId':intent['id'],'status':'UNKNOWN'},wid,wid)
        raise
    return {'ok':True,'paths':paths,'output':text}


def _apply_hunk(service, wid, repo, operation, patch):
    if type(patch) is not str or '\0' in patch or not 1<=len(patch.encode('utf-8'))<=60*1024:
        fail('GIT_PATCH_INVALID','差异块必须是有界文本。')
    service.runtime.providers.check_text(patch)
    headers = patch.splitlines()
    if (sum(line.startswith('diff --git ') for line in headers)!=1
            or sum(line.startswith('@@ ') for line in headers)!=1
            or any(line.startswith(('GIT binary patch','Binary files ','rename ','copy ','old mode ','new mode '))
                   or line.startswith(('new file mode ','deleted file mode ','index '))
                   and line.rsplit(' ',1)[-1] in ('120000','160000') for line in headers)):
        fail('GIT_PATCH_INVALID','只允许单个普通文本文件的差异块。')
    no_redirected_parents(service.store.directory)
    file = NamedTemporaryFile(prefix='review-',suffix='.patch',dir=service.store.directory,delete=False)
    path = Path(file.name)
    try:
        with file:
            file.write(patch.encode('utf-8'))
        rows, _ = _success(_run_git(repo,['apply','--numstat','-z','--',str(path)],bounded=False))
        fields=rows.split('\0')
        if len(fields)!=2 or fields[1] or fields[0].count('\t')!=2:
            fail('GIT_PATCH_INVALID','每次仅可应用一个文件的文本差异块。')
        _, _, file_path=fields[0].split('\t')
        paths=_guard_paths(service,wid,repo[0],[file_path])
        flags=(['--cached'] if operation in ('stage','unstage') else [])+(['-R'] if operation!='stage' else [])
        _, _, code = _run_git(repo,['apply','--check',*flags,'--',str(path)])
        if code:
            fail('GIT_PATCH_STALE','差异块已变动，请刷新审查面板。',409)
        return _dispatch_mutation(service,wid,repo,operation,paths,['apply',*flags,'--',str(path)])
    finally:
        path.unlink(missing_ok=True)


def user_git(service, wid, operation, params):
    """Called by the first-party HTTP mutation route, never by the model."""
    if operation not in MUTATIONS:
        return _read_review(service,wid,_git(service,wid),operation,params)
    with service._lock:
        repo = _git(service,wid,write=True)
        if operation=='commit':
            paths, command=_commit_args(service,wid,repo,params)
        elif 'patch' in params:
            if params.get('paths'):
                fail('GIT_PATCH_INVALID','请选择文件或差异块。')
            return _apply_hunk(service,wid,repo,operation,params['patch'])
        else:
            if type(params.get('paths')) is not list:
                fail('GIT_PATHS_REQUIRED','请选择要操作的 Git 文件。')
            paths = _guard_paths(service,wid,repo[0],params['paths'])
            if operation=='revert':
                tracked, _ = _success(_run_git(repo,['ls-files','--stage','-z','--',*paths],bounded=False))
                entries = tracked.split('\0')[:-1]
                if (len(entries)!=len(paths) or any(
                        not re.fullmatch(r'100(?:644|755) [a-f0-9]{40,64} 0\t[^\0]+',entry)
                        for entry in entries)):
                    fail('GIT_PATH_INVALID','只可撤销已跟踪的普通文件。',409)
            command={
                'stage':['add','-A'],
                'unstage':['restore','--staged'],
                'revert':['restore','--worktree'],
            }[operation]+['--',*paths]
        return _dispatch_mutation(service,wid,repo,operation,paths,command)

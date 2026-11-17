"""Read-only Git observations. No shell, hooks, fetch, checkout or index writes."""
import os
from pathlib import Path
import shutil
import subprocess
from axis_evo.process_limits import bounded_run, child_environment, OutputLimitExceeded

from .agent_workspace import relative_path, fail
from .schemas import no_redirected_parents

def observe(service, turn, name, args):
    root = service.workspaces.resolver(turn['workspaceId']).root
    metadata = root / '.git'
    no_redirected_parents(metadata)
    # A linked worktree's gitdir can point outside the granted folder. That
    # additional repository must be authorized separately, never inferred.
    if not metadata.is_dir():
        fail('GIT_REPOSITORY_REQUIRED', '此工具需要授权目录自身包含 .git 的独立仓库；关联工作树暂不读取外部 Git 目录。', 409)
    for entry in ('config', 'index', 'HEAD', 'objects', 'refs'):
        no_redirected_parents(metadata / entry)
    executable = shutil.which('git')
    if not executable:
        fail('GIT_UNAVAILABLE', '本机未安装 Git。', 409)
    options = ['--no-pager', '--no-optional-locks', '--literal-pathspecs',
        '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=' + os.devnull,
        '-c', 'core.attributesFile=' + os.devnull, '-c', 'core.quotePath=true',
        '-c', 'diff.external=', '-c', 'pager.status=false', '-c', 'log.showSignature=false',
        '--git-dir=' + str(metadata), '--work-tree=' + str(root)]
    if name == 'git_status':
        command = ['status', '--porcelain=v1', '--branch', '--untracked-files=normal', '--ignore-submodules=all']
    elif name == 'git_log':
        command = ['log', '-8', '--format=%h %s', '--no-decorate', '--no-show-signature']
    else:
        path = relative_path(args['path'])
        service.workspaces.read(turn['workspaceId'], 'workspace', path)
        command = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--no-color', 'HEAD', '--', path]
    env = child_environment()
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
        'GIT_TERMINAL_PROMPT': '0', 'GIT_PAGER': 'cat', 'GIT_OPTIONAL_LOCKS': '0'})
    try:
        output = bounded_run([executable, *options, *command], cwd=root, env=env,timeout=10)
        text=output.stdout
        truncated=False
        code=output.returncode
    except OutputLimitExceeded as error:
        text=error.stdout
        truncated=True
        code=None
    except (OSError, subprocess.TimeoutExpired):
        fail('GIT_OBSERVATION_FAILED', 'Git 未在时限内完成观察。', 409)
    if code:
        fail('GIT_OBSERVATION_FAILED', 'Git 无法读取此仓库状态。', 409)
    service.runtime.providers.check_text(text)
    return {'operation': name, 'text': text, 'truncated': truncated,
        'readOnly': True, 'scope': 'LOCAL_REPOSITORY','commandCompleted':not truncated,'exitCode': code}

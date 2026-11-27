"""Host-pinned acceptance criteria and evidence for the current task snapshot."""
import os

from .agent_documents import MAX_DOCUMENT_BYTES
from .agent_project import fixed_inputs, snapshot
from .agent_store import canonical, digest
from .agent_workspace import DOCUMENT_SUFFIXES, MAX_READ_FILE_BYTES, bounded_text, fail, relative_path, TEXT_SUFFIXES
from .schemas import ApiError


MAX_ROUNDS = 32
MAX_CALLS = 96
DEFAULT_BUDGET = {'maxRounds':MAX_ROUNDS, 'maxToolSteps':MAX_CALLS, 'softTokens':None, 'hardTokens':None}
FILE_CONDITIONS = {'file_exists', 'file_nonempty', 'file_unchanged'}


def _path(value):
    return relative_path(value, suffixes=TEXT_SUFFIXES | DOCUMENT_SUFFIXES)


def protects(paths, target):
    key = os.path.normcase(target)
    return any(key == saved or saved.startswith(key + os.sep) or key.startswith(saved + os.sep)
               for saved in map(os.path.normcase, paths))


def _budget(overrides):
    if type(overrides) is not dict or not overrides.keys() <= DEFAULT_BUDGET.keys():
        fail('TASK_CONTRACT_INVALID', '任务预算字段无效。')
    value = DEFAULT_BUDGET | overrides
    for key, limit in (('maxRounds', MAX_ROUNDS), ('maxToolSteps', MAX_CALLS),
                       ('softTokens', 2_000_000), ('hardTokens', 2_000_000)):
        count = value[key]
        if key.endswith('Tokens') and count is None:
            continue
        if type(count) is not int or not 1 <= count <= limit:
            fail('TASK_CONTRACT_INVALID', '任务预算超过可用范围。')
    if value['hardTokens'] is not None and (value['softTokens'] or 0) > value['hardTokens']:
        fail('TASK_CONTRACT_INVALID', 'Token 软阈值不得超过硬上限。')
    return value


def file_fact(service, wid, path):
    try:
        if any(path.lower().endswith(suffix) for suffix in DOCUMENT_SUFFIXES):
            result, _ = service.workspaces.read_material(wid, 'workspace', path,
                suffixes=DOCUMENT_SUFFIXES, limit=MAX_DOCUMENT_BYTES)
        else:
            result = service.workspaces.read(wid, 'workspace', path, max_chars=MAX_READ_FILE_BYTES)
    except FileNotFoundError:
        return {'path':path, 'sha256':None, 'sizeBytes':None}
    except ApiError as error:
        if error.code != 'WORKSPACE_FILE_MISSING':
            raise
        return {'path':path, 'sha256':None, 'sizeBytes':None}
    return {key:result[key] for key in ('path', 'sha256', 'sizeBytes')}


def prepare_contract(service, wid, prompt, override, policy, *, can_check):
    names = [check['name'] for check in policy['checks']] if policy['enabled'] and can_check else []
    draft = {'goal':' '.join(prompt.split())[:240], 'doneWhen':[{'kind':'check_passed', 'name':name} for name in names],
             'protectedPaths':[], 'verificationMode':'advisory' if names else 'none', 'budget':{}}
    if type(override) is not dict or not override.keys() <= draft.keys():
        fail('TASK_CONTRACT_INVALID', '任务契约字段无效。')
    if 'goal' in override:
        override = {**override, 'goal':bounded_text(override['goal'], 240)}
    contract = draft | override
    modes = ('required', 'advisory', 'none')
    if contract['verificationMode'] not in modes:
        fail('TASK_CONTRACT_INVALID', '请选择有效的验证模式。')
    conditions = contract['doneWhen']
    paths = contract['protectedPaths']
    if type(paths) is not list or len(paths) > 16 or type(conditions) is not list or len(conditions) > 16:
        fail('TASK_CONTRACT_INVALID', '任务最多包含16项验收条件和16个保护路径。')
    paths = {_path(path) for path in paths}
    entries = []
    for item in conditions:
        if type(item) is not dict or type(item.get('kind')) is not str:
            fail('TASK_CONTRACT_INVALID', '验收条件需要可核查的类型。')
        kind = item['kind']
        if kind in FILE_CONDITIONS and item.keys() == {'kind', 'path'}:
            path = _path(item['path'])
            entries.append({'kind':kind, 'path':path})
            if kind == 'file_unchanged':
                paths.add(path)
        elif kind == 'check_passed' and item.keys() == {'kind', 'name'}:
            entries.append({'kind':kind, 'name':bounded_text(item['name'], 80)})
        else:
            fail('TASK_CONTRACT_INVALID', '验收条件必须使用受支持的文件条件或固定检查名称。')
    if len(paths) > 16 or len({canonical(item) for item in entries}) != len(entries):
        fail('TASK_CONTRACT_INVALID', '验收条件不可重复，保护路径最多16个。')
    contract.update(doneWhen=entries, protectedPaths=sorted(paths), budget=_budget(contract['budget']),
                    origin='explicit' if override else 'inferred')
    service.runtime.providers.check_text(canonical(contract))
    try:
        pinned = {path:file_fact(service, wid, path) for path in contract['protectedPaths']}
    except (OSError, ValueError, UnicodeError, ApiError):
        fail('TASK_CONTRACT_PROTECTION_UNAVAILABLE', '无法确认保护路径的初始文件字节。', 409)
    return contract, pinned


def _passed_checks(service, turn, snapshot_sha, policy, report):
    if not report or not snapshot_sha or report.get('snapshotSha256') != snapshot_sha:
        return {}
    if report.get('policySha256') != digest({key:value for key,value in policy.items() if key != 'id'}):
        return {}
    approved = {check['name']:check for check in policy['checks']}
    verified = {}
    for check in report['checks']:
        if not check['passed'] or check['name'] not in approved:
            continue
        receipt = service.store.get(check['receiptId'], 'verification_result')
        proof = receipt['payload']
        intent = service.store.get(proof['intentId'], 'verification_intent')
        if (receipt['parentId'] == intent['parentId'] == turn['id']
                and proof['name'] == check['name'] and proof['passed']
                and proof['result']['status'] == 'SUCCESS' and proof['result']['exitCode'] == 0
                and intent['payload']['policyId'] == policy['id']
                and intent['payload']['snapshotSha256'] == snapshot_sha
                and intent['payload']['check'] == approved[check['name']]):
            verified[check['name']] = receipt['id']
    return verified


def assess_contract(service, turn, report=None):
    payload, wid = turn['payload'], turn['workspaceId']
    contract = payload['taskContract']
    mode = contract['verificationMode']
    cases = contract['doneWhen'] if mode != 'none' else []
    checked, missing, contradictions = [], [], []
    files = {}
    for path in sorted(set(contract['protectedPaths']) | {item['path'] for item in cases if 'path' in item}):
        try:
            files[path] = file_fact(service, wid, path)
        except (ApiError, OSError, ValueError, UnicodeError):
            missing.append({'code':'FILE_BYTES_UNAVAILABLE', 'path':path})
    for path, baseline in payload['contractProtectedFiles'].items():
        if path in files and files[path] != baseline:
            contradictions.append({'code':'PROTECTED_BYTES_CHANGED', 'path':path})

    snapshot_sha, checks = None, {}
    check_cases = any(item['kind'] == 'check_passed' for item in cases)
    if check_cases:
        policy = service.execution.policy(wid)
        if policy['enabled'] and policy['id'] == payload['executionPolicyId'] and report and report.get('snapshotSha256'):
            try:
                live = snapshot(service.workspaces, wid)
                live_files = {item['path']:item['sha256'] for item in live['manifest']['files']}
                contradictions.extend({'code':'FIXED_INPUT_BYTES_CHANGED', 'path':item['path']}
                    for item in policy['protectedInputs'] if live_files.get(item['path']) != item['sha256'])
                snapshot_sha = fixed_inputs(live, policy['protectedInputs'])['sha256']
                checks = _passed_checks(service, turn, snapshot_sha, policy, report)
            except (ApiError, OSError, ValueError, UnicodeError):
                missing.append({'code':'CHECK_SNAPSHOT_UNAVAILABLE'})
    for item in cases:
        kind = item['kind']
        if kind == 'check_passed':
            if item['name'] in checks:
                checked.append({**item, 'receiptId':checks[item['name']]})
            else:
                missing.append({'code':'MATCHING_PASS_RECEIPT_REQUIRED', **item})
        elif (fact := files.get(item['path'])) is not None:
            if ((kind == 'file_exists' and fact['sha256'] is not None)
                    or (kind == 'file_nonempty' and (fact['sizeBytes'] or 0) > 0)
                    or (kind == 'file_unchanged' and fact['sha256'] is not None
                        and fact == payload['contractProtectedFiles'][item['path']])):
                checked.append({**item, 'fileSha256':fact['sha256'], 'sizeBytes':fact['sizeBytes']})
            else:
                contradictions.append({'code':'FILE_CRITERION_UNMET', **item})
    if mode == 'required' and not cases:
        missing.append({'code':'ACCEPTANCE_CRITERIA_MISSING'})
    status = ('REJECTED' if contradictions else 'UNVERIFIED' if missing or not cases else 'VERIFIED')
    return {'status':status, 'mode':mode, 'contractSha256':digest(contract),
            'snapshotSha256':snapshot_sha, 'fileFactsSha256':digest(files),
            'checkedItems':checked, 'missingEvidence':missing, 'contradictions':contradictions}

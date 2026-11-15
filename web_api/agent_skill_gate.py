"""Product Skill evidence gate; it does not reinterpret the frozen Shadow gates.

Only server-read task records and explicit user checks enter this gate. A model
review is separately labelled advice. Passing a format check is not evidence of
general semantic improvement or a new tool permission.
"""
import hashlib
import os
from pathlib import PurePosixPath
import re

from axis_evo.hashing import canonical_json_bytes
from .schemas import ApiError


POLICY_ID = 'agent-skill-product-gate-v2'
SUCCESS = frozenset(('COMPLETED', 'SUCCEEDED', 'FINISHED', 'SUCCESS'))
TERMINAL = SUCCESS | frozenset(('FAILED', 'UNKNOWN', 'STOPPED', 'CANCELLED', 'INTERRUPTED',
    'BLOCKED', 'LIMIT_REACHED'))


def validate_checks(value):
    if type(value) is not list or len(value) > 16:
        raise ApiError('EVOLUTION_CHECKS_INVALID', '最多提供 16 项明确的文档检查。')
    result = []
    for check in value:
        if (type(check) is not dict or check.keys() != {'kind', 'value'}
                or check['kind'] not in ('contains', 'not_contains', 'heading')
                or type(check['value']) is not str or not check['value'].strip()
                or len(check['value'].encode('utf-8')) > 512
                or any(ord(c) < 32 for c in check['value'])):
            raise ApiError('EVOLUTION_CHECKS_INVALID', '文档检查须为必含文本、禁含文本或标题。')
        if check in result:
            raise ApiError('EVOLUTION_CHECKS_INVALID', '文档检查不可重复。')
        result.append(dict(check))
    return result


def task_summary(task):
    """Bound the evidence snapshot without treating the answer as a fact."""
    if type(task) is not dict or task.get('status') not in TERMINAL:
        raise ApiError('EVOLUTION_TASK_PENDING', '任务结束后才能记录这次反馈。', 409)
    uses = task.get('skillUses', [])
    artifacts = task.get('artifacts', [])
    if type(uses) is not list or len(uses) > 32 or type(artifacts) is not list or len(artifacts) > 64:
        raise ApiError('EVOLUTION_EVIDENCE_LIMIT', '任务证据超过当前演化范围。', 409)
    return {'turnId': task['id'], 'workspaceId': task['workspaceId'],
        'status': task['status'], 'skillUses': [
            {key: use[key] for key in ('skillId', 'version', 'cardSha256')} for use in uses],
        'artifacts': [{key: artifact[key] for key in
            ('id', 'path', 'sha256', 'sizeBytes', 'verified') if key in artifact} for artifact in artifacts],
        'attribution': 'UNDETERMINED', 'dataRole': 'DEVELOPMENT',
        'answerIsExecutionEvidence': False}


def _path_key(path):
    # Keep the host's path semantics; Linux case-sensitive names remain distinct.
    return os.path.normcase(PurePosixPath(path).as_posix()).replace('\\', '/')


def _verified_documents(task):
    if task.get('status') not in SUCCESS:
        return None
    artifacts = task.get('artifacts', [])
    if type(artifacts) is not list or not artifacts or len(artifacts) > 64:
        return None
    # Records are ordered by execution. Only the final revision of each file
    # can demonstrate the delivered content; superseded bytes remain evidence
    # in task_summary but cannot make a removed heading pass this gate.
    latest = {}
    for artifact in artifacts:
        path = artifact.get('path')
        if type(path) is not str or not path:
            return None
        path = PurePosixPath(path).as_posix()
        latest[_path_key(path)] = artifact
    documents = {}
    total = 0
    for path, artifact in latest.items():
        content = artifact.get('content')
        if artifact.get('verified') is not True or type(content) is not str:
            return None
        raw = content.encode('utf-8')
        total += len(raw)
        if (total > 256 * 1024 or hashlib.sha256(raw).hexdigest() != artifact.get('sha256')
                or artifact.get('sizeBytes') != len(raw)):
            return None
        documents[path] = content
    return documents


def check_document(text, check):
    if text is None:
        return False
    if check['kind'] == 'contains':
        return check['value'] in text
    if check['kind'] == 'not_contains':
        return check['value'] not in text
    # A quoted example inside a fenced/indented code block is not a heading.
    fence = None
    for line in text.splitlines():
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if marker:
            if fence is None:
                fence = (marker[1][0], len(marker[1]))
            elif marker[1][0] == fence[0] and len(marker[1]) >= fence[1] and not marker[2].strip():
                fence = None
            continue
        if fence is not None:
            continue
        heading = re.match(r'^ {0,3}#{1,6}[ \t]+(.+?)\s*$', line)
        if heading and re.sub(r'[ \t]+#+[ \t]*$', '', heading[1]).strip() == check['value']:
            return True
    return False


def assess_comparison(reference, candidate, reference_skill, candidate_skill, checks, review=None,
                      *, output_paths=None):
    """Recalculate every check from independently read, hash-verified output."""
    checks = validate_checks(checks)
    reasons = []
    if not checks:
        reasons.append('NO_EXPLICIT_USER_CHECKS')
    if reference.get('id') == candidate.get('id'):
        reasons.append('EVALUATION_TASKS_NOT_DISTINCT')
    for label, task, skill in (('REFERENCE', reference, reference_skill), ('CANDIDATE', candidate, candidate_skill)):
        exact = {key: skill[key] for key in ('skillId', 'version', 'cardSha256')}
        uses = [{key: use.get(key) for key in exact} for use in task.get('skillUses', [])]
        if uses != [exact]:
            reasons.append(label + '_SKILL_BINDING_MISMATCH')
        if task.get('status') not in SUCCESS:
            reasons.append(label + '_EXECUTION_UNCONFIRMED')
    before, after = _verified_documents(reference), _verified_documents(candidate)
    if before is None or after is None:
        reasons.append('OUTPUT_BYTES_NOT_VERIFIED')
    # The original task fixes the delivery set before either replay runs. A
    # candidate cannot pass by putting the requested heading in an extra file,
    # or by moving an existing requirement from one document to another.
    targets = sorted({_path_key(path) for path in output_paths}) if output_paths is not None else sorted(before or {})
    if not targets or set(before or {}) != set(targets) or set(after or {}) != set(targets):
        reasons.append('EVALUATION_OUTPUT_SET_CHANGED')
    results = []
    for check in checks:
        documents = [{'path': path,
            'referencePassed': check_document((before or {}).get(path), check),
            'candidatePassed': check_document((after or {}).get(path), check)} for path in targets]
        results.append({'check': check,
            'referencePassed': bool(documents) and all(row['referencePassed'] for row in documents),
            'candidatePassed': bool(documents) and all(row['candidatePassed'] for row in documents),
            'documents': documents})
    regressions = sum(row['referencePassed'] and not row['candidatePassed']
        for check in results for row in check['documents'])
    improvements = sum(not row['referencePassed'] and row['candidatePassed']
        for check in results for row in check['documents'])
    if regressions:
        reasons.append('REGRESSION_DETECTED')
    if results and not all(row['candidatePassed'] for row in results):
        reasons.append('CANDIDATE_CHECK_FAILED')
    if not improvements:
        reasons.append('NO_MEASURED_IMPROVEMENT')
    if review and review.get('verdict') in ('REJECT', 'UNCERTAIN'):
        reasons.append('REVIEW_CONCERNS_UNRESOLVED')
    manifest = {'policyId': POLICY_ID, 'reference': task_summary(reference),
        'candidate': task_summary(candidate), 'checks': results,
        'regressions': regressions, 'improvements': improvements,
        'reviewRole': 'ADVISORY_ONLY', 'reasons': reasons,
        'scope': 'EXPLICIT_USER_DOCUMENT_CHECKS',
        'outputPaths': targets, 'checkApplication': 'EACH_ORIGINAL_OUTPUT_DOCUMENT',
        'limitations': ['Format and literal text checks do not establish general semantic quality.',
            'Development feedback and its replay are not an independent heldout research experiment.']}
    return {**manifest, 'eligible': not reasons,
        'manifestSha256': hashlib.sha256(canonical_json_bytes(manifest)).hexdigest()}

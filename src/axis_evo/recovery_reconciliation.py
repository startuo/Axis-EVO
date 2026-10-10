"""Read-only cross-checking and bounded current-state reconciliation."""

from dataclasses import asdict, dataclass

from .checkpoint_manager import (_raw, _prefix, _task_identity, _skill_identity, _plan_identity,
    _capture_workspace, _sha, _json, _artifacts, get_checkpoint, verify_checkpoint)
from .hashing import canonical_json_bytes
from .inspector import inspect_run
from .planning_provenance import _load as _planning_load, inspect_planning_provenance
from .recovery_policy import POLICY_VERSION, validate_operations, simulate_step, file_state
from .recovery_storage import RecoveryIntegrityError, _guard_schema, _load
from .skill_binding import _read_snapshot, _rows, inspect_skill_trace


@dataclass(frozen=True)
class RecoveryBoundary:
    """Trusted caller asserts source and staging writers remain excluded.

    This records a cooperative boundary, not an OS lock or caller identity proof.
    The caller holds it through assessment, adoption and approved execution.
    """
    source_run_id: str
    exclusive_execution_id: str


def digest(value):
    return _sha(canonical_json_bytes(value))


def source_facts(connection, run_id):
    raw = _raw(connection, run_id)
    dispatches = [dict(r) for r in _rows(connection,
        'SELECT * FROM main.agent_dispatches WHERE reserved_run_id=?', (run_id,))]
    episodes = []
    for dispatch in dispatches:
        eid = dispatch['episode_id']
        for table in ('agent_episodes', 'agent_attempts', 'agent_attempt_facts', 'agent_dispatches'):
            episodes.append({'table': table, 'rows': [dict(r) for r in _rows(connection,
                f'SELECT * FROM main.{table} WHERE episode_id=? ORDER BY 1,2', (eid,))]})
    return {'source': raw, 'agent_lineage': {'dispatches': dispatches, 'episode_facts': episodes}}


def require_boundary(boundary, source_run_id):
    if (type(boundary) is not RecoveryBoundary or boundary.source_run_id != source_run_id
            or type(boundary.exclusive_execution_id) is not str or not boundary.exclusive_execution_id.strip()):
        raise ValueError('Recovery requires an explicit exclusive source boundary')


def verified_source(connection, run_id, checkpoint_id):
    """Cross-API snapshots are bracketed by full facts, not silently combined."""
    with _read_snapshot(connection):
        _guard_schema(connection)
        before = source_facts(connection, run_id)
        raw = before['source']
        _prefix(raw, len(raw['events']))
        _task_identity(raw['run'])
        skill, plan = _skill_identity(connection, raw), _plan_identity(connection, raw)
        if skill is None or plan is None:
            raise RecoveryIntegrityError('Recovery requires exact Skill and approved original Plan')
        proposal = _planning_load(connection, plan['proposal_id'])
    checkpoint = get_checkpoint(connection, checkpoint_id)
    verification = verify_checkpoint(connection, checkpoint_id, compare_workspace=True)
    inspectors = {'execution': inspect_run(connection, run_id),
                  'skill': inspect_skill_trace(connection, run_id),
                  'planning': inspect_planning_provenance(connection, run_id)}
    if (checkpoint.run_id != run_id or checkpoint.checkpoint_kind != 'CONTROLLED_STEP'
            or checkpoint.skill_id != skill['skill_id'] or checkpoint.skill_version != skill['skill_version']
            or checkpoint.card_sha256 != skill['card_sha256'] or checkpoint.plan_sha256 != plan['plan_sha256']
            or checkpoint.proposal_id != plan['proposal_id']
            or any(c['status'] != 'VALID' for c in verification['checks'].values())
            or not inspectors['execution']['trace']['consistent']
            or not inspectors['skill']['consistent'] or not inspectors['planning']['consistent']):
        raise RecoveryIntegrityError('Source/Checkpoint evidence failed cross-verification')
    with _read_snapshot(connection):
        _guard_schema(connection)
        if source_facts(connection, run_id) != before:
            raise RecoveryIntegrityError('Source evidence changed during verification')
        latest = _rows(connection, 'SELECT * FROM main.checkpoint_records WHERE checkpoint_id=?',(checkpoint_id,))
        if len(latest)!=1 or dict(latest[0])!=asdict(checkpoint):
            raise RecoveryIntegrityError('Checkpoint changed during verification')
        _artifacts(connection,checkpoint)
        artifacts = {r['path']: r['content'] for r in _rows(connection,
            'SELECT path,content FROM main.checkpoint_artifacts WHERE checkpoint_id=? ORDER BY path', (checkpoint_id,))}
    return {'facts': before, 'checkpoint': asdict(checkpoint), 'checkpoint_verification': verification,
            'inspectors': inspectors, 'skill': skill, 'plan': _json(proposal.plan_json, 32768),
            'plan_identity': plan, 'artifacts': artifacts}


def _history(source):
    raw, cp, plan = source['facts']['source'], source['checkpoint'], source['plan']['steps']
    events, cursor = raw['events'], cp['event_cursor_seq']
    planned = [e for e in events if e['event_type'] == 'STEP_PLANNED']
    confirmed = [e for e in events if e['event_type'] == 'STEP_CONFIRMED' and e['seq'] <= cursor]
    k = len(confirmed)
    if (k < 1 or len(planned) != k + 1 or len(planned) > len(plan)
            or events[cursor-1]['event_type'] != 'STEP_CONFIRMED'
            or len(raw['bindings']) != len(planned)
            or [e['event_type'] for e in events[:2]] != ['RUN_STARTED', 'TASK_LOADED']):
        raise RecoveryIntegrityError('Source is not a checkpoint prefix plus one pending invocation')
    consumed = {events[0]['event_id'], events[1]['event_id']}
    for index, planned_event in enumerate(planned):
        step, call = plan[index], planned_event['tool_call_id']
        facts = [e for e in events if e['tool_call_id'] == call]
        binding = [b for b in raw['bindings'] if b['tool_call_id'] == call]
        payload = _json(planned_event['payload_json'], 65536)
        if (planned_event['step_id'] != step['step_id'] or payload != {key: step[key] for key in ('tool_name','arguments')}
                or len(binding) != 1 or binding[0]['arguments_sha256'] != digest(step['arguments'])
                or binding[0]['step_id'] != step['step_id'] or binding[0]['tool_name'] != step['tool_name']
                or any(binding[0][key] != source['skill'][key] for key in source['skill'])
                or any(e['step_id'] != step['step_id'] for e in facts)):
            raise RecoveryIntegrityError('Invocation does not match original approved Plan/Skill')
        intent = [e for e in facts if e['event_type'] == 'TOOL_INTENT']
        if len(intent) != 1:
            raise RecoveryIntegrityError('Invocation lacks one exact TOOL_INTENT')
        ip = _json(intent[0]['payload_json'], 65536)
        mutation = step['tool_name'] != 'read_file'
        if (ip['tool_name'] != step['tool_name'] or ip['arguments'] != step['arguments'] or ip['mutating'] != mutation
                or [t['path'] for t in ip['targets']] != ([step['arguments']['path']] if mutation else [])):
            raise RecoveryIntegrityError('Intent differs from approved operation')
        types = [e['event_type'] for e in facts]
        expected = ['STEP_PLANNED'] + (['FILE_OBSERVED'] if mutation else []) + ['TOOL_INTENT']
        if index < k:
            expected += (['FILE_OBSERVED'] if mutation else []) + ['TOOL_RESULT', 'STEP_CONFIRMED']
            if (types != expected or facts[-1]['seq'] > cursor
                    or _json(facts[-2]['payload_json'], 2097152)['status'] != 'SUCCESS'
                    or _json(facts[-1]['payload_json'], 65536)['tool_status'] != 'SUCCESS'):
                raise RecoveryIntegrityError('Checkpoint prefix is not completely confirmed SUCCESS')
        elif (types not in (expected, expected + ['FILE_OBSERVED']) or planned_event['seq'] <= cursor):
            raise RecoveryIntegrityError('Pending invocation is not a valid incomplete prefix')
        if index == k and len(types) > len(expected):
            post = _json(facts[-1]['payload_json'], 65536)
            if not mutation or post.get('reason') != 'POST_TOOL' or post.get('path') != step['arguments']['path']:
                raise RecoveryIntegrityError('Pending tail must be an exact target POST_TOOL observation')
        if mutation:
            pre = _json(facts[1]['payload_json'], 65536)
            target = ip['targets'][0]
            if pre != {'reason': 'PRE_TOOL', 'path': target['path'], 'exists': target['exists'],
                       'sha256': target['before_sha256'], 'size_bytes': target['size_bytes']}:
                raise RecoveryIntegrityError('PRE/INTENT evidence mismatch')
        consumed.update(e['event_id'] for e in facts)
    if len(consumed) != len(events) or [e['tool_call_id'] for e in confirmed] != [e['tool_call_id'] for e in planned[:k]]:
        raise RecoveryIntegrityError('Unexpected source event or invocation order')
    # Global sequence must consist of non-interleaved invocation groups.
    if any(planned[i+1]['seq'] <= max(e['seq'] for e in events if e['tool_call_id'] == planned[i]['tool_call_id']) for i in range(len(planned)-1)):
        raise RecoveryIntegrityError('Interleaved invocation history is unsupported')
    pending = planned[k]
    intent = next(e for e in events if e['tool_call_id'] == pending['tool_call_id'] and e['event_type'] == 'TOOL_INTENT')
    return k, pending, _json(intent['payload_json'], 65536)


def reconcile(connection, case_id, *, boundary):
    from .recovery_manager import _case
    with _read_snapshot(connection):
        _guard_schema(connection)
        case = _case(connection, case_id).data
    require_boundary(boundary, case['source_run_id'])
    base = {'schema_version': 1, 'case_id': case_id, 'source_run_id': case['source_run_id'],
            'checkpoint_id': case['checkpoint_id'], 'policy_version': POLICY_VERSION,
            'boundary': asdict(boundary), 'executable': False, 'state': 'HALTED_INTEGRITY',
            'eligibility': 'INTEGRITY_FAILURE', 'source_result_unknown': None,
            'accepted_postconditions': [], 'remaining_plan': [], 'unresolved_effects': [],
            'verification_checks': {}, 'integrity_issues': []}
    try:
        source = verified_source(connection, case['source_run_id'], case['checkpoint_id'])
        if digest(source['facts']) != case['source_evidence_sha256'] or digest(source['checkpoint']) != case['checkpoint_sha256']:
            raise RecoveryIntegrityError('Source or checkpoint identity changed since case creation')
        base['verification_checks'] = {'checkpoint': source['checkpoint_verification'],
            'source_trace': source['inspectors']['execution']['trace'],
            'skill_trace': source['inspectors']['skill'], 'plan_trace': source['inspectors']['planning']}
        base['source_result_unknown'] = 'EXECUTION_RESULT_UNKNOWN' in source['inspectors']['execution']['observations']
        base['source_evidence_sha256'] = digest(source['facts'])
        if source['facts']['source']['run']['status'] != 'RUNNING' or source['facts']['source']['run']['ended_at'] is not None:
            base.update(state='HALTED_UNSUPPORTED', eligibility='UNSUPPORTED_OPERATION')
            return base, None
        task = _json(source['facts']['source']['run']['task_spec_json'], 524288)
        try:
            validate_operations(source['plan']['steps'], task)
        except ValueError as error:
            base.update(state='HALTED_UNSUPPORTED', eligibility='UNSUPPORTED_OPERATION')
            base['unresolved_effects'].append({'message': str(error)})
            return base, None
        k, pending, intent = _history(source)
        step = source['plan']['steps'][k]
        base['unresolved_effects'] = [{'tool_call_id': pending['tool_call_id'], 'step_id': step['step_id'],
                                     'original_tool_result': 'UNKNOWN'}]
        if step['tool_name'] == 'read_file':
            base.update(state='HALTED_UNSUPPORTED', eligibility='UNSUPPORTED_OPERATION')
            return base, None
        before = file_state(step['arguments']['path'], source['artifacts'])
        target = intent['targets'][0]
        if before != {'path': target['path'], 'exists': target['exists'], 'sha256': target['before_sha256'], 'size_bytes': target['size_bytes']}:
            raise RecoveryIntegrityError('Checkpoint before bytes disagree with PRE/TOOL_INTENT')
        expected_manifest, expected_bytes = simulate_step(step, source['checkpoint']['workspace_manifest_json'], source['artifacts'])
        posts = [e for e in source['facts']['source']['events'] if e['tool_call_id'] == pending['tool_call_id']
                 and e['event_type'] == 'FILE_OBSERVED' and _json(e['payload_json'],65536).get('reason') == 'POST_TOOL']
        for post in posts:
            if _json(post['payload_json'],65536) != {'reason':'POST_TOOL', **file_state(step['arguments']['path'],expected_bytes)}:
                raise RecoveryIntegrityError('Recorded POST disagrees with the deterministically verified postcondition')
        current, artifacts = _capture_workspace(source['checkpoint']['workspace_root'])
        again, again_bytes = _capture_workspace(source['checkpoint']['workspace_root'])
        with _read_snapshot(connection):
            _guard_schema(connection)
            if source_facts(connection, case['source_run_id']) != source['facts']:
                raise RecoveryIntegrityError('Source evidence changed during reconciliation')
        if (again, again_bytes) != (current, artifacts):
            raise RecoveryIntegrityError('Workspace changed during reconciliation')
        base.update(current_manifest_json=current, current_manifest_sha256=_sha(current.encode('utf-8')))
        if (current != expected_manifest or artifacts != expected_bytes
                or expected_manifest == source['checkpoint']['workspace_manifest_json']):
            base.update(state='HALTED_UNKNOWN', eligibility='AMBIGUOUS_EFFECT')
            return base, None
        remaining = source['plan']['steps'][k+1:]
        if not remaining:
            base.update(state='HALTED_UNSUPPORTED', eligibility='UNSUPPORTED_OPERATION')
            base['unresolved_effects'][0]['message'] = 'Frozen Skill-bound Runner requires a nonempty suffix'
            return base, None
        base.update(state='AWAITING_APPROVAL', eligibility='POSTCONDITION_VERIFIED', executable=True,
            remaining_plan=remaining, accepted_postconditions=[{'step_id': step['step_id'],
                'tool_call_id': pending['tool_call_id'], 'state': file_state(step['arguments']['path'], artifacts),
                'classification': 'POSTCONDITION_VERIFIED', 'original_tool_result': 'UNKNOWN'}])
        return base, artifacts
    except (ValueError, TypeError, KeyError, OSError, RuntimeError) as error:
        base['integrity_issues'].append({'code': 'RECOVERY_EVIDENCE_INVALID', 'message': str(error)})
        return base, None

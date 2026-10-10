"""Read-only historical evidence classification; observations are not blame."""

import json

from .agent_feedback import extract_verified_feedback
from .checkpoint_manager import _task_identity, _prefix, verify_checkpoint
from .hashing import canonical_json_bytes
from .inspector import inspect_run
from .planning_provenance import inspect_planning_provenance
from .recovery_manager import _case as _recovery_case, _assessment, _proposal, inspect_recovery_case
from .recovery_reconciliation import source_facts
from .skill_binding import _read_snapshot, _rows, _ref, inspect_skill_trace
from .skill_trust_storage import TrustIntegrityError, _guard_schema, digest, snapshot
from .shadow_evaluation import _skill_anchor


HISTORY_LIMITATIONS = [
    'Observed failure or timeout does not establish a Skill defect.',
    'UNKNOWN is preserved; changed external state does not prove tool causality.',
    'Recovery Child success does not rewrite the Source outcome.',
    'Local hashes verify consistency, not authenticity against a fully rewritten database.',
]


def _selection(connection, ref):
    params = (ref.skill_id, ref.skill_version)
    ids = {r[0] for r in _rows(connection, 'SELECT DISTINCT run_id FROM main.skill_invocation_bindings WHERE skill_id=? AND skill_version=?', params)}
    ids |= {r[0] for r in _rows(connection, 'SELECT l.run_id FROM main.plan_run_links l JOIN main.plan_proposals p ON l.proposal_id=p.proposal_id WHERE p.skill_id=? AND p.skill_version=?', params)}
    # A Recovery child may crash before the first binding. Its committed exact
    # proposal/dispatch establishes attribution eligibility, not execution.
    for row in _rows(connection, 'SELECT d.reserved_child_run_id,p.fact_json FROM main.recovery_dispatches d JOIN main.recovery_proposals p ON d.proposal_id=p.proposal_id'):
        data = json.loads(row[1])
        skill = data.get('skill') or {}
        if skill.get('skill_id') == ref.skill_id and skill.get('skill_version') == ref.skill_version:
            if _rows(connection, 'SELECT 1 FROM main.runs WHERE run_id=?', (row[0],)):
                ids.add(row[0])
    return sorted(ids)


def _collect(connection, ref, run_ids):
    """Raw closure, callable inside one owned snapshot/transaction."""
    card, anchor = _skill_anchor(connection, ref)
    eligible = _selection(connection, ref)
    selected = eligible if run_ids is None else sorted(run_ids)
    if len(set(selected)) != len(selected) or any(type(r) is not str or r not in eligible for r in selected):
        raise TrustIntegrityError('Run evidence is not bound to the exact requested SkillRef')
    runs = {rid: source_facts(connection, rid) for rid in selected}
    recovery, checkpoints = {}, {}
    for row in _rows(connection, 'SELECT * FROM main.recovery_cases ORDER BY case_id'):
        cid = row['case_id']
        child_ids = [r[0] for r in _rows(connection, 'SELECT reserved_child_run_id FROM main.recovery_dispatches WHERE case_id=?', (cid,))]
        if row['source_run_id'] not in selected and not set(child_ids) & set(selected):
            continue
        bundle = {}
        for table in ('recovery_cases', 'recovery_assessments', 'recovery_proposals', 'recovery_dispatches', 'recovery_outcomes'):
            bundle[table] = [dict(r) for r in _rows(connection, f'SELECT * FROM main.{table} WHERE case_id=? ORDER BY fact_json', (cid,))]
        bundle['source'] = source_facts(connection, row['source_run_id'])
        bundle['children'] = {rid: source_facts(connection, rid) for rid in child_ids if _rows(connection, 'SELECT 1 FROM main.runs WHERE run_id=?', (rid,))}
        recovery[cid] = bundle
    context_ids = set(selected) | {b['recovery_cases'][0]['source_run_id'] for b in recovery.values()}
    from .checkpoint_manager import _sha
    for rid in sorted(context_ids):
        for r in _rows(connection, 'SELECT * FROM main.checkpoint_records WHERE run_id=? ORDER BY checkpoint_id', (rid,)):
            record = dict(r)
            artifacts = []
            for a in _rows(connection, 'SELECT * FROM main.checkpoint_artifacts WHERE checkpoint_id=? ORDER BY path', (r['checkpoint_id'],)):
                if _sha(a['content']) != a['sha256'] or len(a['content']) != a['size_bytes']:
                    raise TrustIntegrityError('Checkpoint artifact integrity failure')
                artifacts.append({k: a[k] for k in ('path', 'size_bytes', 'sha256')})
            checkpoints[r['checkpoint_id']] = {'record': record, 'artifacts': artifacts}
    return snapshot({'skill_ref': ref.to_dict(), 'card_sha256': digest(card.to_dict()), 'skill_anchor': anchor,
                     'selected_run_ids': selected, 'runs': runs, 'recovery': recovery, 'checkpoints': checkpoints})


def _terminal_outcome(raw):
    """Verified frozen Runner terminal evidence, including unplanned children."""
    run, events = raw['run'], raw['events']
    if run['status'] not in ('RUNNING', 'INTERRUPTED', 'COMPLETED', 'FAILED'):
        raise TrustIntegrityError('Invalid persisted Run status')
    if run['status'] == 'RUNNING' and run['ended_at'] is not None:
        raise TrustIntegrityError('RUNNING Run has ended_at')
    if run['status'] not in ('COMPLETED', 'FAILED'):
        return 'EXECUTION_OUTCOME_UNKNOWN'
    if not events or run['ended_at'] is None:
        raise TrustIntegrityError('Terminal Run has no terminal evidence')
    if (len(events) < 3 or events[0]['event_type'] != 'RUN_STARTED' or events[1]['event_type'] != 'TASK_LOADED'
            or sum(e['event_type'] == 'RUN_STARTED' for e in events) != 1 or sum(e['event_type'] == 'TASK_LOADED' for e in events) != 1
            or json.loads(events[0]['payload_json']) != {'workspace_path': run['workspace_path'], 'model_plugin': run['model_plugin']}
            or json.loads(events[1]['payload_json']) != {'task_spec_sha256': run['task_spec_sha256']}):
        raise TrustIntegrityError('Terminal Runner prefix is incomplete')
    terminal = events[-1]
    expected = 'RUN_COMPLETED' if run['status'] == 'COMPLETED' else 'RUN_FAILED'
    if terminal['event_type'] != expected or terminal['occurred_at'] != run['ended_at']:
        raise TrustIntegrityError('Run row and terminal event disagree')
    results = {e['tool_call_id']: e for e in events if e['event_type'] == 'TOOL_RESULT'}
    planned = [e for e in events if e['event_type'] == 'STEP_PLANNED']
    confirmed = {e['tool_call_id']: e for e in events if e['event_type'] == 'STEP_CONFIRMED'}
    if (len(results) != len(planned) or len(confirmed) != len(planned)
            or any(e['tool_call_id'] not in results or e['tool_call_id'] not in confirmed for e in planned)):
        raise TrustIntegrityError('Terminal Runner has an unconfirmed invocation')
    payload = json.loads(terminal['payload_json'])
    if payload.get('reason') == 'TOOL_REPORTED_FAILURE':
        call = payload.get('tool_call_id')
        result = json.loads(results[call]['payload_json']) if call in results else {}
        if (run['status'] != 'FAILED' or not planned or call != planned[-1]['tool_call_id']
                or result.get('status') not in ('FAILED', 'TIMEOUT') or payload.get('tool_status') != result['status']
                or payload != {'reason': 'TOOL_REPORTED_FAILURE', 'step_id': planned[-1]['step_id'], 'tool_call_id': call, 'tool_status': result.get('status')}
                or any(json.loads(results[e['tool_call_id']]['payload_json'])['status'] != 'SUCCESS' for e in planned[:-1])
                or any(e['event_type'].startswith('VALIDATION_') for e in events)):
            raise TrustIntegrityError('Tool failure terminal evidence mismatch')
        return 'TOOL_EXECUTION_FAILURE'
    validation = [e for e in events if e['event_id'] == payload.get('validation_event_id')]
    expected_validation = 'VALIDATION_PASSED' if run['status'] == 'COMPLETED' else 'VALIDATION_FAILED'
    starts = [e for e in events if e['event_type'] == 'VALIDATION_STARTED']
    decisions = [e for e in events if e['event_type'] in ('VALIDATION_PASSED', 'VALIDATION_FAILED')]
    if (len(validation) != 1 or len(decisions) != 1 or len(starts) != 1 or validation[0] != decisions[0]
            or validation[0]['event_type'] != expected_validation
            or not starts[0]['seq'] < validation[0]['seq'] < terminal['seq']
            or json.loads(validation[0]['payload_json']).get('passed') is not (run['status'] == 'COMPLETED')
            or payload != ({'validation_event_id': validation[0]['event_id']} if run['status'] == 'COMPLETED' else
                           {'validation_event_id': validation[0]['event_id'], 'reason': 'VALIDATION_FAILED'})
            or any(json.loads(e['payload_json'])['status'] != 'SUCCESS' for e in results.values())):
        raise TrustIntegrityError('Independent Acceptance terminal evidence mismatch')
    return 'VERIFIED_TASK_SUCCESS' if run['status'] == 'COMPLETED' else 'ACCEPTANCE_FAILURE'


def _derived_history(before):
    """Recompute every stored classification/reference/denominator from anchors."""
    ref = before['skill_ref']
    if before['selected_run_ids'] != sorted(before['runs']):
        raise TrustIntegrityError('Historical Run selection does not match anchors')
    recoveries, reports = [], []
    for cid, bundle in sorted(before['recovery'].items()):
        source_id = bundle['recovery_cases'][0]['source_run_id']
        source = bundle['source']['source']
        results = {e['tool_call_id'] for e in source['events'] if e['event_type'] == 'TOOL_RESULT'}
        unknown = any(e['event_type'] == 'TOOL_INTENT' and e['tool_call_id'] not in results for e in source['events'])
        dispatches = bundle['recovery_dispatches']
        child_id = dispatches[0]['reserved_child_run_id'] if dispatches else None
        outcomes = bundle['recovery_outcomes']
        recovery_outcome = 'UNKNOWN'
        if outcomes:
            outcome = json.loads(outcomes[0]['fact_json'])
            child = bundle['children'].get(child_id)
            if child is None or outcome['child_evidence_sha256'] != digest({'run': child['source']['run'], 'events': child['source']['events'], 'bindings': child['source']['bindings']}):
                raise TrustIntegrityError('Recovery Outcome does not match anchored child facts')
            observed = _terminal_outcome(child['source'])
            recovery_outcome = 'VERIFIED_SUCCESS' if observed == 'VERIFIED_TASK_SUCCESS' else 'VERIFIED_FAILURE'
        recoveries.append({'case_id': cid, 'source_run_id': source_id, 'child_run_id': child_id,
                           'source_execution_outcome': 'UNKNOWN' if unknown else 'RESULT_RECORDED', 'recovery_outcome': recovery_outcome})
    for rid in before['selected_run_ids']:
        raw = before['runs'][rid]['source']
        _task_identity(raw['run'])
        if raw['events']:
            _prefix(raw, len(raw['events']))
        outcome = _terminal_outcome(raw)
        linked = raw['links'][0] if raw['links'] else None
        reports.append({'skill_ref': ref, 'card_sha256': before['card_sha256'], 'run_id': rid,
                        'task_spec_sha256': raw['run']['task_spec_sha256'],
                        'plan_proposal_id': linked['proposal_id'] if linked else None,
                        'approved_plan_sha256': linked['approved_plan_sha256'] if linked else None,
                        'tool_invocations': [{'tool_call_id': e['tool_call_id'], 'step_id': e['step_id'], 'seq': e['seq'],
                                              'payload': json.loads(e['payload_json'])} for e in raw['events'] if e['event_type'] in ('TOOL_INTENT', 'TOOL_RESULT')],
                        'acceptance_evidence': [{'event_id': e['event_id'], 'seq': e['seq'], 'payload': json.loads(e['payload_json'])}
                                                for e in raw['events'] if e['event_type'] in ('VALIDATION_PASSED', 'VALIDATION_FAILED')],
                        'checkpoint_ids': [k for k, v in before['checkpoints'].items() if v['record']['run_id'] == rid],
                        'recovery_case_ids': [r['case_id'] for r in recoveries if rid in (r['source_run_id'], r['child_run_id'])],
                        'source_evidence_sha256': digest(before['runs'][rid]), 'integrity_status': 'VERIFIED', 'observed_outcome': outcome,
                        'attribution': 'NO_NEGATIVE_EVIDENCE' if outcome == 'VERIFIED_TASK_SUCCESS' else 'INDETERMINATE'})
    source_ids = {r['source_run_id'] for r in recoveries}
    child_ids = {r['child_run_id'] for r in recoveries}
    standalone = [r for r in reports if r['run_id'] not in source_ids | child_ids]
    return {'schema_version': 1, 'skill_ref': ref, 'card_sha256': before['card_sha256'],
            'source_evidence_sha256': digest(before), 'source_snapshot': before, 'runs': reports, 'recovery_lineages': recoveries,
            'integrity_issues': [], 'attribution': 'INDETERMINATE',
            'denominators': {'historical_runs': len(reports), 'recovery_lineages': len(recoveries), 'business_tasks': len(standalone) + len(recoveries),
                             'verified_business_task_successes': sum(r['observed_outcome'] == 'VERIFIED_TASK_SUCCESS' for r in standalone) +
                             sum(r['recovery_outcome'] == 'VERIFIED_SUCCESS' for r in recoveries)},
            'limitations': list(HISTORY_LIMITATIONS)}


def inspect_skill_evidence(connection, skill_ref, *, run_ids=None):
    """Collect historical facts without model, lifecycle or workspace mutation."""
    if connection.in_transaction:
        raise ValueError('Evidence inspection rejects an active caller transaction')
    ref = _ref(skill_ref)
    if run_ids is not None and type(run_ids) not in (list, tuple):
        raise ValueError('run_ids must be an explicit list/tuple')
    with _read_snapshot(connection):
        _guard_schema(connection)
        before = _collect(connection, ref, run_ids)
    issues, reports, recoveries = [], [], []
    for cid, bundle in before['recovery'].items():
        with _read_snapshot(connection):
            _guard_schema(connection)
            _recovery_case(connection, cid)
            for a in bundle['recovery_assessments']:
                _assessment(connection, a['assessment_id'], cid)
            for p in bundle['recovery_proposals']:
                _proposal(connection, p['proposal_id'])
        if bundle['recovery_dispatches']:
            recovery = inspect_recovery_case(connection, cid)
            if recovery['integrity_issues']:
                issues.append({'code': 'RECOVERY_INTEGRITY_FAILURE', 'case_id': cid})
            recoveries.append({'case_id': cid, 'source_run_id': recovery['source_run_id'], 'child_run_id': recovery['child_run_id'],
                               'source_execution_outcome': 'UNKNOWN' if recovery.get('source_result_unknown') else 'RESULT_RECORDED',
                               'recovery_outcome': 'VERIFIED_SUCCESS' if recovery['state'] == 'RECOVERY_SUCCEEDED' else
                               'VERIFIED_FAILURE' if recovery['state'] == 'RECOVERY_FAILED' else 'UNKNOWN'})
    for checkpoint_id in before['checkpoints']:
        report = verify_checkpoint(connection, checkpoint_id, compare_workspace=False)
        if report['integrity_issues']:
            issues.append({'code': 'CHECKPOINT_INTEGRITY_FAILURE', 'checkpoint_id': checkpoint_id})
    for rid in before['selected_run_ids']:
        raw = before['runs'][rid]['source']
        _task_identity(raw['run'])
        execution, binding = inspect_run(connection, rid), inspect_skill_trace(connection, rid)
        plan = inspect_planning_provenance(connection, rid)
        local = []
        if not execution['trace']['consistent'] or not binding['consistent'] or not plan['consistent']:
            local.append({'code': 'EXECUTION_EVIDENCE_INVALID', 'run_id': rid})
        for b in raw['bindings']:
            if (b['skill_id'], b['skill_version']) != (ref.skill_id, ref.skill_version):
                local.append({'code': 'CROSS_VERSION_EVIDENCE', 'run_id': rid})
        try:
            outcome = _terminal_outcome(raw)
            if raw['links'] and outcome != 'EXECUTION_OUTCOME_UNKNOWN':
                verified = extract_verified_feedback(connection, rid)
                kind = verified.get('failure_kind')
                if outcome == 'TOOL_EXECUTION_FAILURE' and kind != 'TOOL_REPORTED_FAILURE':
                    raise TrustIntegrityError('Verified feedback classification disagrees')
        except (ValueError, KeyError, TypeError) as error:
            outcome = 'EVIDENCE_INTEGRITY_FAILURE'
            local.append({'code': 'TERMINAL_EVIDENCE_INVALID', 'run_id': rid, 'message': str(error)})
        if local:
            outcome = 'EVIDENCE_INTEGRITY_FAILURE'
        issues.extend(local)
        linked = raw['links'][0] if raw['links'] else None
        reports.append({'skill_ref': ref.to_dict(), 'card_sha256': before['card_sha256'], 'run_id': rid,
                        'task_spec_sha256': raw['run']['task_spec_sha256'],
                        'plan_proposal_id': linked['proposal_id'] if linked else None,
                        'approved_plan_sha256': linked['approved_plan_sha256'] if linked else None,
                        'tool_invocations': [{'tool_call_id': e['tool_call_id'], 'step_id': e['step_id'], 'seq': e['seq'],
                                              'payload': json.loads(e['payload_json'])} for e in raw['events'] if e['event_type'] in ('TOOL_INTENT', 'TOOL_RESULT')],
                        'acceptance_evidence': [{'event_id': e['event_id'], 'seq': e['seq'], 'payload': json.loads(e['payload_json'])}
                                                for e in raw['events'] if e['event_type'] in ('VALIDATION_PASSED', 'VALIDATION_FAILED')],
                        'checkpoint_ids': [k for k, v in before['checkpoints'].items() if v['record']['run_id'] == rid],
                        'recovery_case_ids': [r['case_id'] for r in recoveries if rid in (r['source_run_id'], r['child_run_id'])],
                        'source_evidence_sha256': digest(before['runs'][rid]),
                        'integrity_status': 'BLOCKED' if local else 'VERIFIED', 'observed_outcome': outcome,
                        'attribution': 'INTEGRITY_BLOCKED' if local else 'NO_NEGATIVE_EVIDENCE' if outcome == 'VERIFIED_TASK_SUCCESS' else 'INDETERMINATE'})
    with _read_snapshot(connection):
        _guard_schema(connection)
        if _collect(connection, ref, run_ids) != before:
            raise TrustIntegrityError('Evidence changed during inspection; no assessment published')
    if not issues:
        return _derived_history(before)
    source_ids = {r['source_run_id'] for r in recoveries}
    child_ids = {r['child_run_id'] for r in recoveries}
    successful_lineages = sum(r['recovery_outcome'] == 'VERIFIED_SUCCESS' for r in recoveries)
    standalone_successes = sum(r['observed_outcome'] == 'VERIFIED_TASK_SUCCESS' and r['run_id'] not in source_ids | child_ids for r in reports)
    return {'schema_version': 1, 'skill_ref': ref.to_dict(), 'card_sha256': before['card_sha256'],
            'source_evidence_sha256': digest(before), 'source_snapshot': before, 'runs': reports, 'recovery_lineages': recoveries,
            'integrity_issues': issues, 'attribution': 'INTEGRITY_BLOCKED' if issues else 'INDETERMINATE',
            'denominators': {'historical_runs': len(reports), 'recovery_lineages': len(recoveries),
                             'business_tasks': len([r for r in reports if r['run_id'] not in source_ids | child_ids]) + len(recoveries),
                             'verified_business_task_successes': standalone_successes + successful_lineages},
            'limitations': list(HISTORY_LIMITATIONS)}

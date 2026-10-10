"""Explicit state adoption and immutable recovery lineage; never old-Run repair."""

from copy import deepcopy
import os
from pathlib import Path
import stat
from uuid import uuid4

from .checkpoint_manager import _sha, _json, _directory, _capture_workspace, _stored, _artifacts, _unsafe_link, _fingerprint
from .checkpoint_storage import CheckpointRecord
from .events import utc_now
from .hashing import canonical_json_bytes
from .recovery_policy import validate_operations, tool_catalog
from .recovery_reconciliation import RecoveryBoundary, digest, source_facts, verified_source, reconcile
from .recovery_storage import (RecoveryCase, RecoveryAssessment, RecoveryProposal,
    RecoveryIntegrityError, _guard_schema, _load, _insert)
from .skill_binding import _read_snapshot, _rows
from .skill_storage import _check_write_context, _skill_transaction
from .task_spec import task_spec_from_dict
from .skill_planner import _task_data


def _case(connection, case_id):
    fact = _load(connection, 'recovery_cases', case_id)
    data = fact.data
    expected = {'schema_version','case_id','source_run_id','checkpoint_id','checkpoint_sha256',
        'source_evidence_sha256','original_task_spec_sha256','skill','original_plan','agent_lineage','created_at'}
    if data.keys() != expected:
        raise RecoveryIntegrityError('Unexpected Recovery Case shape')
    facts = source_facts(connection, data['source_run_id'])
    cp = _rows(connection, 'SELECT * FROM main.checkpoint_records WHERE checkpoint_id=?', (data['checkpoint_id'],))
    raw = facts['source']
    if (len(cp) != 1 or cp[0]['run_id'] != data['source_run_id'] or digest(dict(cp[0])) != data['checkpoint_sha256']
            or digest(facts) != data['source_evidence_sha256'] or facts['agent_lineage'] != data['agent_lineage']
            or raw['run']['task_spec_sha256'] != data['original_task_spec_sha256']
            or data['skill'] != {'skill_id': cp[0]['skill_id'], 'skill_version': cp[0]['skill_version'], 'card_sha256': cp[0]['card_sha256']}
            or data['original_plan'] != {'proposal_id': cp[0]['proposal_id'], 'plan_sha256': cp[0]['plan_sha256'], 'approved_plan_sha256': cp[0]['plan_sha256']}):
        raise RecoveryIntegrityError('Recovery Case source/checkpoint lineage mismatch')
    checkpoint = CheckpointRecord(**dict(cp[0]))
    _stored(checkpoint)
    _artifacts(connection,checkpoint)
    return fact


def create_recovery_case(connection, source_run_id, checkpoint_id, *, recovery_case_id=None):
    _check_write_context(connection)
    source = verified_source(connection, source_run_id, checkpoint_id)
    if source['facts']['source']['run']['status'] not in ('RUNNING', 'FAILED'):
        raise ValueError('Completed source cannot create a recovery execution')
    case_id = 'recovery_' + uuid4().hex if recovery_case_id is None else recovery_case_id
    if type(case_id) is not str or not case_id.strip():
        raise ValueError('case_id must be nonempty')
    value = {'schema_version': 1, 'case_id': case_id, 'source_run_id': source_run_id,
        'checkpoint_id': checkpoint_id, 'checkpoint_sha256': digest(source['checkpoint']),
        'source_evidence_sha256': digest(source['facts']),
        'original_task_spec_sha256': source['facts']['source']['run']['task_spec_sha256'],
        'skill': source['skill'], 'original_plan': source['plan_identity'],
        'agent_lineage': source['facts']['agent_lineage'], 'created_at': utc_now()}
    with _skill_transaction(connection):
        _guard_schema(connection)
        if source_facts(connection, source_run_id) != source['facts']:
            raise RecoveryIntegrityError('Source evidence changed before Case publication')
        fact = _insert(connection, 'recovery_cases', value)
        _case(connection, case_id)
    return fact


def assess_recovery(connection, case_id, *, boundary):
    """Pure read API; returns diagnostic dimensions without recording approval."""
    return reconcile(connection, case_id, boundary=boundary)[0]


def assess_and_record_recovery(connection, case_id, *, boundary):
    _check_write_context(connection)
    report = assess_recovery(connection, case_id, boundary=boundary)
    value = {**report, 'assessment_id': 'assessment_' + uuid4().hex, 'created_at': utc_now()}
    with _skill_transaction(connection):
        _guard_schema(connection)
        case = _case(connection, case_id).data
        if report.get('source_evidence_sha256', case['source_evidence_sha256']) != case['source_evidence_sha256']:
            raise RecoveryIntegrityError('Source evidence changed before Assessment publication')
        fact = _insert(connection, 'recovery_assessments', value)
        _case(connection, case_id)
    return fact


def _assessment(connection, assessment_id, case_id):
    fact = _load(connection, 'recovery_assessments', assessment_id)
    data = fact.data
    case = _case(connection,case_id).data
    required = {'schema_version','case_id','source_run_id','checkpoint_id','policy_version','boundary',
        'executable','state','eligibility','source_result_unknown','accepted_postconditions','remaining_plan',
        'unresolved_effects','verification_checks','integrity_issues','assessment_id','created_at'}
    optional = {'source_evidence_sha256','current_manifest_json','current_manifest_sha256'}
    pairs = {'AWAITING_APPROVAL':'POSTCONDITION_VERIFIED','HALTED_UNKNOWN':'AMBIGUOUS_EFFECT',
             'HALTED_UNSUPPORTED':'UNSUPPORTED_OPERATION','HALTED_INTEGRITY':'INTEGRITY_FAILURE'}
    if (not required <= data.keys() or not data.keys() <= required|optional
            or any(data[k] != case[k] for k in ('case_id','source_run_id','checkpoint_id'))
            or data.get('source_evidence_sha256',case['source_evidence_sha256']) != case['source_evidence_sha256']
            or type(data['executable']) is not bool or (data['source_result_unknown'] is not None and type(data['source_result_unknown']) is not bool)
            or data['policy_version'] != 'controlled-files-v1' or pairs.get(data['state']) != data['eligibility']
            or data['executable'] != (data['state']=='AWAITING_APPROVAL')
            or any(type(data[k]) is not list for k in ('accepted_postconditions','remaining_plan','unresolved_effects','integrity_issues'))
            or type(data['verification_checks']) is not dict):
        raise RecoveryIntegrityError('Assessment structure, state or source evidence mismatch')
    from .recovery_reconciliation import require_boundary
    require_boundary(RecoveryBoundary(**data['boundary']),case['source_run_id'])
    if 'current_manifest_json' in data:
        from .checkpoint_manager import _manifest
        _manifest(data['current_manifest_json'])
        if _sha(data['current_manifest_json'].encode('utf-8')) != data.get('current_manifest_sha256'):
            raise RecoveryIntegrityError('Assessment current manifest digest mismatch')
    if data['executable'] and (not data['remaining_plan'] or not data['accepted_postconditions']
                              or 'current_manifest_json' not in data or data['integrity_issues']):
        raise RecoveryIntegrityError('Executable Assessment lacks complete adoption evidence')
    raw = source_facts(connection,case['source_run_id'])['source']
    results = {e['tool_call_id'] for e in raw['events'] if e['event_type']=='TOOL_RESULT'}
    unknown = any(e['event_type']=='TOOL_INTENT' and e['tool_call_id'] not in results for e in raw['events'])
    if data['source_result_unknown'] is not None and data['source_result_unknown'] != unknown:
        raise RecoveryIntegrityError('Assessment invents a missing-result observation')
    if data['executable']:
        from .planning_provenance import _load as _planning_load
        from .recovery_reconciliation import _history
        from .recovery_policy import simulate_step, file_state
        proposal = _planning_load(connection,case['original_plan']['proposal_id'])
        cp = dict(_rows(connection,'SELECT * FROM main.checkpoint_records WHERE checkpoint_id=?',(case['checkpoint_id'],))[0])
        artifacts = {r['path']:r['content'] for r in _rows(connection,'SELECT path,content FROM main.checkpoint_artifacts WHERE checkpoint_id=?',(case['checkpoint_id'],))}
        plan = _json(proposal.plan_json,32768)
        source = {'facts':{'source':raw},'checkpoint':cp,'plan':plan,'skill':case['skill']}
        k,pending,intent = _history(source)
        step = plan['steps'][k]
        before = file_state(step['arguments']['path'],artifacts)
        if step['tool_name']=='read_file' or before != {'path':intent['targets'][0]['path'],
                'exists':intent['targets'][0]['exists'],'sha256':intent['targets'][0]['before_sha256'],
                'size_bytes':intent['targets'][0]['size_bytes']}:
            raise RecoveryIntegrityError('Assessment before-state identity mismatch')
        expected,after = simulate_step(step,cp['workspace_manifest_json'],artifacts)
        for event in raw['events']:
            if event['tool_call_id']==pending['tool_call_id'] and event['event_type']=='FILE_OBSERVED':
                payload = _json(event['payload_json'],65536)
                if payload['reason']=='POST_TOOL' and payload != {'reason':'POST_TOOL',**file_state(step['arguments']['path'],after)}:
                    raise RecoveryIntegrityError('Assessment conflicts with recorded POST state')
        postconditions = [{'step_id':step['step_id'],'tool_call_id':pending['tool_call_id'],
            'state':file_state(step['arguments']['path'],after),'classification':'POSTCONDITION_VERIFIED','original_tool_result':'UNKNOWN'}]
        unresolved = [{'tool_call_id':pending['tool_call_id'],'step_id':step['step_id'],'original_tool_result':'UNKNOWN'}]
        if (data['remaining_plan'] != plan['steps'][k+1:] or data['accepted_postconditions'] != postconditions
                or data['unresolved_effects'] != unresolved or data['current_manifest_json'] != expected
                or expected == cp['workspace_manifest_json'] or raw['run']['status']!='RUNNING' or not unknown):
            raise RecoveryIntegrityError('Assessment contradicts deterministic source reconciliation')
        validate_operations(plan['steps'],_json(raw['run']['task_spec_json'],524288))
    return fact


def _assessment_body(data):
    return {k: v for k, v in data.items() if k not in ('assessment_id','created_at')}


def _proposal(connection, proposal_id):
    fact = _load(connection, 'recovery_proposals', proposal_id)
    data = fact.data
    expected = {'schema_version','case_id','proposal_id','assessment_id','assessment_sha256',
        'source_run_id','checkpoint_id','source_evidence_sha256','checkpoint_sha256','skill',
        'original_plan','original_task_spec_sha256','state_adoption','remaining_plan','remaining_plan_sha256',
        'derived_task','derived_task_spec_sha256','task_spec_path','seed_path','seed_manifest_json',
        'seed_sha256','workspace_path','reserved_child_run_id','tool_catalog','safety_constraints','created_at'}
    if data.keys() != expected:
        raise RecoveryIntegrityError('Unexpected Recovery Proposal shape')
    case = _case(connection, data['case_id']).data
    assessment = _assessment(connection, data['assessment_id'], data['case_id'])
    adoption = _assessment_body(assessment.data)
    if (not adoption.get('executable') or data['assessment_sha256'] != assessment.fact_sha256
            or data['state_adoption'] != adoption or data['remaining_plan'] != adoption.get('remaining_plan')
            or data['remaining_plan_sha256'] != digest({'schema_version':1, 'steps':data['remaining_plan']})
            or any(data[k] != case[k] for k in ('source_run_id','checkpoint_id','source_evidence_sha256',
                'checkpoint_sha256','skill','original_plan','original_task_spec_sha256'))
            or data['seed_manifest_json'] != adoption.get('current_manifest_json')
            or data['seed_sha256'] != _sha(data['seed_manifest_json'].encode('utf-8'))
            or data['derived_task_spec_sha256'] != digest(_task_data(task_spec_from_dict(data['derived_task'])))
            or data['tool_catalog'] != tool_catalog(data['remaining_plan'])):
        raise RecoveryIntegrityError('Proposal adoption, Plan or digest mismatch')
    original = _json(source_facts(connection, case['source_run_id'])['source']['run']['task_spec_json'], 524288)
    derived = data['derived_task']
    if (derived['task_id'] == original['task_id'] or derived['workspace'] != {'seed_dir':'seed'}
            or {k:v for k,v in derived.items() if k not in ('task_id','workspace')}
                != {k:v for k,v in original.items() if k not in ('task_id','workspace')}
            or not data['remaining_plan']):
        raise RecoveryIntegrityError('Derived TaskSpec must preserve the independent original Acceptance')
    task_path, seed, workspace = (Path(data[k]) for k in ('task_spec_path','seed_path','workspace_path'))
    if (any(not p.is_absolute() for p in (task_path,seed,workspace)) or seed != task_path.parent/'seed'
            or workspace != task_path.parent/'workspace' or task_path.name != 'task.json'
            or not data['reserved_child_run_id'].startswith('recovery_run_')
            or data['safety_constraints'] != ['exclusive_cooperative_boundary','file_only','one_dispatch','no_source_repair','no_automatic_retry']):
        raise RecoveryIntegrityError('Proposal asset/reservation identity mismatch')
    validate_operations(data['remaining_plan'], derived)
    return fact


def _validate_assets(data, *, workspace_absent=True):
    task_path, seed, workspace = (Path(data[k]) for k in ('task_spec_path','seed_path','workspace_path'))
    bundle = _directory(task_path.parent)
    info = task_path.lstat()
    if (_unsafe_link(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>524288
            or task_path.resolve(strict=True)!=task_path):
        raise RecoveryIntegrityError('Derived TaskSpec file identity is unsafe or oversized')
    flags = os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_NONBLOCK',0)
    with os.fdopen(os.open(task_path,flags),'rb') as stream:
        if _fingerprint(os.fstat(stream.fileno()))!=_fingerprint(info):
            raise RecoveryIntegrityError('Derived TaskSpec changed during validation')
        raw = stream.read(524289)
        if _fingerprint(os.fstat(stream.fileno()))!=_fingerprint(info):
            raise RecoveryIntegrityError('Derived TaskSpec changed during validation')
    if (_fingerprint(task_path.lstat())!=_fingerprint(info)
            or raw != canonical_json_bytes(data['derived_task']) or _sha(raw)!=data['derived_task_spec_sha256']):
        raise RecoveryIntegrityError('Derived TaskSpec changed')
    manifest, artifacts = _capture_workspace(seed)
    if manifest != data['seed_manifest_json'] or _sha(manifest.encode('utf-8')) != data['seed_sha256']:
        raise RecoveryIntegrityError('Staging seed changed')
    if workspace_absent and (workspace.exists() or workspace.is_symlink()):
        raise RecoveryIntegrityError('Reserved child workspace already exists')
    if workspace.parent != bundle:
        raise RecoveryIntegrityError('Child workspace parent changed')
    return manifest, artifacts


def propose_recovery(connection, case_id, assessment_id, tool_registry, assets_root, *, boundary):
    """Stage detached verified current bytes, then publish one immutable proposal."""
    _check_write_context(connection)
    with _read_snapshot(connection):
        _guard_schema(connection)
        case = _case(connection, case_id).data
        assessment = _assessment(connection, assessment_id, case_id)
        if _rows(connection, 'SELECT 1 FROM main.recovery_proposals WHERE case_id=?', (case_id,)):
            raise ValueError('Case already has an immutable proposal')
    report, artifacts = reconcile(connection, case_id, boundary=boundary)
    if not report['executable'] or report != _assessment_body(assessment.data):
        raise ValueError('Assessment is not executable or is stale')
    with _read_snapshot(connection):
        original = _json(source_facts(connection, case['source_run_id'])['source']['run']['task_spec_json'], 524288)
    validate_operations(report['remaining_plan'], original, tool_registry)
    root = _directory(assets_root)
    with _read_snapshot(connection):
        source_path = source_facts(connection, case['source_run_id'])['source']['run']['workspace_path']
    source_root = _directory(source_path)
    if root == source_root or root.is_relative_to(source_root) or source_root.is_relative_to(root):
        raise ValueError('Recovery staging root must be separate from source workspace')
    # No DB writer is held across filesystem staging. Orphan assets are preserved.
    proposal_id = 'recovery_proposal_' + uuid4().hex
    bundle = root/proposal_id
    bundle.mkdir()
    seed = bundle/'seed'
    seed.mkdir()
    manifest = _json(report['current_manifest_json'], 131072)
    for entry in manifest['entries']:
        path = seed/entry['path']
        if entry['type'] == 'directory':
            path.mkdir()
        else:
            with path.open('xb') as stream:
                stream.write(artifacts[entry['path']])
    derived = deepcopy(original)
    derived.update(task_id='recovery_task_' + uuid4().hex, workspace={'seed_dir':'seed'})
    task_spec_from_dict(derived)
    task_path = bundle/'task.json'
    with task_path.open('xb') as stream:
        stream.write(canonical_json_bytes(derived))
    value = {'schema_version':1, 'case_id':case_id, 'proposal_id':proposal_id,
        'assessment_id':assessment_id, 'assessment_sha256':assessment.fact_sha256,
        **{k:case[k] for k in ('source_run_id','checkpoint_id','source_evidence_sha256','checkpoint_sha256',
            'skill','original_plan','original_task_spec_sha256')}, 'state_adoption':report,
        'remaining_plan':report['remaining_plan'],
        'remaining_plan_sha256':digest({'schema_version':1,'steps':report['remaining_plan']}),
        'derived_task':derived, 'derived_task_spec_sha256':digest(derived),
        'task_spec_path':str(task_path), 'seed_path':str(seed),
        'seed_manifest_json':report['current_manifest_json'], 'seed_sha256':report['current_manifest_sha256'],
        'workspace_path':str(bundle/'workspace'), 'reserved_child_run_id':'recovery_run_' + uuid4().hex,
        'tool_catalog':tool_catalog(report['remaining_plan'], tool_registry),
        'safety_constraints':['exclusive_cooperative_boundary','file_only','one_dispatch','no_source_repair','no_automatic_retry'],
        'created_at':utc_now()}
    _validate_assets(value)
    if reconcile(connection, case_id, boundary=boundary)[0] != report:
        raise RecoveryIntegrityError('Source state changed during staging')
    with _skill_transaction(connection):
        _guard_schema(connection)
        _case(connection, case_id)
        fact = _insert(connection, 'recovery_proposals', value)
        _proposal(connection, proposal_id)
    return fact


def inspect_recovery_case(connection, case_id):
    """Read committed facts; corruption is reported, never repaired or replayed."""
    from .recovery_continuation import inspect_child, _dispatch
    if connection.in_transaction:
        raise ValueError('Recovery inspection rejects an active caller transaction')
    report = {'schema_version':1,'case_id':case_id,'state':'CASE_CREATED','source_run_id':None,
        'checkpoint_id':None,'assessment':None,'unresolved_effects':[], 'proposal':None,'approval':None,
        'dispatch':None,'child_run_id':None,'child_status':None,'verification_checks':{},'integrity_issues':[],
        'inputs_currently_verified':False}
    try:
        with _read_snapshot(connection):
            _guard_schema(connection)
            case = _case(connection, case_id).data
            report.update(source_run_id=case['source_run_id'], checkpoint_id=case['checkpoint_id'],
                source_evidence_sha256=case['source_evidence_sha256'], original_skill=case['skill'],
                original_agent_lineage=case['agent_lineage'])
            source = source_facts(connection,case['source_run_id'])['source']
            result_calls = {e['tool_call_id'] for e in source['events'] if e['event_type']=='TOOL_RESULT'}
            report['source_result_unknown'] = any(e['event_type']=='TOOL_INTENT' and e['tool_call_id'] not in result_calls for e in source['events'])
            report['original_result'] = 'UNKNOWN' if report['source_result_unknown'] else 'RESULT_RECORDED'
            assessments = _rows(connection,
                "SELECT assessment_id FROM main.recovery_assessments WHERE case_id=? ORDER BY json_extract(fact_json,'$.created_at'),assessment_id", (case_id,))
            if assessments:
                a = _assessment(connection, assessments[-1][0], case_id).data
                report.update(assessment=a, state=a['state'], unresolved_effects=a['unresolved_effects'],verification_checks=a['verification_checks'])
            else:
                report['state']='ASSESSMENT_REQUIRED'
            proposals = _rows(connection,'SELECT proposal_id FROM main.recovery_proposals WHERE case_id=?',(case_id,))
            proposal = _proposal(connection, proposals[0][0]) if proposals else None
            if proposal:
                report.update(proposal={'proposal_id':proposal.proposal_id,'recovery_sha256':proposal.recovery_sha256,
                    'remaining_plan':proposal.data['remaining_plan'],'derived_task_spec_sha256':proposal.data['derived_task_spec_sha256']},state='AWAITING_APPROVAL')
            dispatch = _dispatch(connection, case_id, proposal) if _rows(connection,'SELECT 1 FROM main.recovery_dispatches WHERE case_id=?',(case_id,)) else None
            if dispatch:
                report.update(dispatch=dispatch.data, approval=dispatch.data['approved_recovery_sha256'],
                    child_run_id=dispatch.data['reserved_child_run_id'],state='DISPATCH_RESERVED')
        # Frozen inspectors own their own snapshots. Child inspection brackets them.
        if dispatch:
            child = inspect_child(connection, proposal, dispatch)
            report.update(child_status=child['status'],state=child['state'],child=child)
        else:
            cp = verified_source(connection, case['source_run_id'], case['checkpoint_id'])
            report['verification_checks']['checkpoint'] = cp['checkpoint_verification']
    except (ValueError, TypeError, KeyError, OSError, RuntimeError) as error:
        report['state']='HALTED_INTEGRITY'
        report['integrity_issues'].append({'code':'RECOVERY_EVIDENCE_INVALID','message':str(error)})
    return report

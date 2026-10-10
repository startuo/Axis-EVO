"""One-shot digest-approved continuation through the unmodified Runner."""

from pathlib import Path

from .checkpoint_manager import _capture_workspace, _json
from .events import utc_now
from .hashing import canonical_json_bytes
from .inspector import inspect_run
from .models import PlanStep
from .recovery_manager import _case, _proposal, _validate_assets
from .recovery_policy import validate_operations, simulate_step, tool_catalog
from .recovery_reconciliation import digest, reconcile, source_facts
from .recovery_storage import RecoveryIntegrityError, _guard_schema, _load, _insert
from .runner import run_task
from .skill_binding import _rows, _read_snapshot, inspect_skill_trace
from .skill_card import SkillRef
from .skill_storage import _check_write_context, _skill_transaction


def _dispatch(connection, case_id, proposal):
    if proposal is None:
        raise RecoveryIntegrityError('Dispatch has no proposal')
    fact = _load(connection, 'recovery_dispatches', case_id)
    data, p = fact.data, proposal.data
    expected = {'schema_version','case_id','proposal_id','approved_recovery_sha256',
        'reserved_child_run_id','workspace_path','derived_task_spec_sha256','seed_sha256','reserved_at'}
    if (data.keys() != expected or data['approved_recovery_sha256'] != proposal.recovery_sha256
            or any(data[k] != p[k] for k in ('case_id','proposal_id','reserved_child_run_id',
                'workspace_path','derived_task_spec_sha256','seed_sha256'))):
        raise RecoveryIntegrityError('Dispatch approval or reservation mismatch')
    return fact


def _child_facts(connection, run_id):
    rows = _rows(connection, 'SELECT * FROM main.runs WHERE run_id=?', (run_id,))
    return {'run': dict(rows[0]) if rows else None,
        'events': [dict(r) for r in _rows(connection, 'SELECT * FROM main.events WHERE run_id=? ORDER BY seq', (run_id,))],
        'bindings': [dict(r) for r in _rows(connection, 'SELECT * FROM main.skill_invocation_bindings WHERE run_id=? ORDER BY tool_call_id', (run_id,))]}


def _child_identity(facts, p):
    run = facts['run']
    if run is None:
        if facts['events'] or facts['bindings']:
            raise RecoveryIntegrityError('Child facts exist without a Run')
        return []
    if (run['run_id'] != p['reserved_child_run_id'] or run['workspace_path'] != p['workspace_path']
            or run['task_spec_sha256'] != p['derived_task_spec_sha256']
            or run['task_spec_json'].encode('utf-8') != canonical_json_bytes(p['derived_task'])
            or run['task_id'] != p['derived_task']['task_id'] or run['model_plugin'] != 'recovery_verified_suffix'):
        raise RecoveryIntegrityError('Child Run differs from reserved derived-state identity')
    planned = [e for e in facts['events'] if e['event_type'] == 'STEP_PLANNED']
    if len(planned) > len(p['remaining_plan']) or len({e['tool_call_id'] for e in planned}) != len(planned):
        raise RecoveryIntegrityError('Child Plan is not a proper approved suffix prefix')
    used = set()
    call_ids = {e['tool_call_id'] for e in planned}
    if any(e['tool_call_id'] is not None and e['tool_call_id'] not in call_ids for e in facts['events']):
        raise RecoveryIntegrityError('Child invocation facts lie outside approved planned prefix')
    for index, event in enumerate(planned):
        step = p['remaining_plan'][index]
        invocation = [r for r in facts['events'] if r['tool_call_id']==event['tool_call_id'] and r['event_type']!='RUN_FAILED']
        mutation = step['tool_name']!='read_file'
        expected_types = ['STEP_PLANNED'] + (['FILE_OBSERVED'] if mutation else []) + ['TOOL_INTENT'] + (['FILE_OBSERVED'] if mutation else []) + ['TOOL_RESULT','STEP_CONFIRMED']
        if [r['event_type'] for r in invocation] != expected_types[:len(invocation)]:
            raise RecoveryIntegrityError('Child invocation is not a frozen Runner execution prefix')
        observations = [r for r in invocation if r['event_type']=='FILE_OBSERVED']
        if any(_json(r['payload_json'],65536)['reason'] != ('PRE_TOOL' if i==0 else 'POST_TOOL') for i,r in enumerate(observations)):
            raise RecoveryIntegrityError('Child observation stage differs from approved invocation')
        if index < len(planned)-1:
            if (len(invocation)!=len(expected_types) or max(r['seq'] for r in invocation)>=planned[index+1]['seq']
                    or _json(invocation[-2]['payload_json'],2097152)['status']!='SUCCESS'
                    or _json(invocation[-1]['payload_json'],65536)['tool_status']!='SUCCESS'):
                raise RecoveryIntegrityError('Child suffix steps are interleaved or earlier result is incomplete')
        if (event['step_id'] != step['step_id'] or _json(event['payload_json'],65536)
                != {'tool_name':step['tool_name'],'arguments':step['arguments']}):
            raise RecoveryIntegrityError('Persisted child step differs from approved suffix')
        matching = [b for b in facts['bindings'] if b['tool_call_id'] == event['tool_call_id']]
        if len(matching) != 1:
            raise RecoveryIntegrityError('Child invocation lacks exact Skill binding')
        used.add(event['tool_call_id'])
        for fact in (r for r in facts['events'] if r['tool_call_id']==event['tool_call_id']):
            payload = _json(fact['payload_json'],2097152)
            if fact['event_type']=='TOOL_INTENT' and (payload['tool_name'] != step['tool_name']
                    or payload['arguments'] != step['arguments']
                    or payload['mutating'] != (step['tool_name']!='read_file')
                    or [t['path'] for t in payload['targets']] != ([step['arguments']['path']] if step['tool_name']!='read_file' else [])):
                raise RecoveryIntegrityError('Child intent differs from approved operation')
            if fact['event_type']=='TOOL_RESULT' and payload['tool_name'] != step['tool_name']:
                raise RecoveryIntegrityError('Child result tool identity mismatch')
    # A hard exit between binding COMMIT and STEP_PLANNED COMMIT is legal.
    extra = [b for b in facts['bindings'] if b['tool_call_id'] not in used]
    if len(extra) > 1 or (extra and len(planned) >= len(p['remaining_plan'])):
        raise RecoveryIntegrityError('Unexpected child Skill bindings')
    if extra and planned:
        previous = [e for e in facts['events'] if e['tool_call_id']==planned[-1]['tool_call_id'] and e['event_type']=='STEP_CONFIRMED']
        if len(previous)!=1 or _json(previous[0]['payload_json'],65536)['tool_status']!='SUCCESS':
            raise RecoveryIntegrityError('Next binding precedes complete successful previous invocation')
    for binding in facts['bindings']:
        matches = [i for i,s in enumerate(p['remaining_plan']) if s['step_id'] == binding['step_id']]
        if len(matches) != 1 or (binding in extra and matches[0] != len(planned)):
            raise RecoveryIntegrityError('Binding is outside approved prefix')
        step = p['remaining_plan'][matches[0]]
        if (binding['tool_name'] != step['tool_name'] or binding['arguments_sha256'] != digest(step['arguments'])
                or any(binding[k] != p['skill'][k] for k in p['skill']) or binding['bound_state'] != 'TRUSTED'):
            raise RecoveryIntegrityError('Child Skill/arguments authorization mismatch')
    if run['status']=='COMPLETED':
        if len(planned)!=len(p['remaining_plan']):
            raise RecoveryIntegrityError('Completed child did not persist the entire approved suffix')
        last_confirmation = 0
        for event in planned:
            results = [r for r in facts['events'] if r['tool_call_id']==event['tool_call_id'] and r['event_type']=='TOOL_RESULT']
            confirmations = [r for r in facts['events'] if r['tool_call_id']==event['tool_call_id'] and r['event_type']=='STEP_CONFIRMED']
            if (len(results)!=1 or len(confirmations)!=1 or _json(results[0]['payload_json'],2097152)['status']!='SUCCESS'
                    or _json(confirmations[0]['payload_json'],65536)['tool_status']!='SUCCESS'):
                raise RecoveryIntegrityError('Completed child requires all suffix results and confirmations SUCCESS')
            last_confirmation=max(last_confirmation,confirmations[0]['seq'])
        validation = [r for r in facts['events'] if r['event_type']=='VALIDATION_STARTED']
        if len(validation)!=1 or validation[0]['seq']<=last_confirmation:
            raise RecoveryIntegrityError('Completed child Acceptance did not follow the approved suffix')
    return planned


def inspect_child(connection, proposal, dispatch):
    p = proposal.data
    with _read_snapshot(connection):
        _guard_schema(connection)
        _case(connection, p['case_id'])
        _proposal(connection, p['proposal_id'])
        _dispatch(connection, p['case_id'], proposal)
        before = _child_facts(connection, p['reserved_child_run_id'])
        planned = _child_identity(before,p)
        outcomes = _rows(connection,'SELECT 1 FROM main.recovery_outcomes WHERE case_id=?',(p['case_id'],))
        outcome = _load(connection,'recovery_outcomes',p['case_id']) if outcomes else None
    if before['run'] is None:
        if outcome:
            raise RecoveryIntegrityError('Outcome has no child Run')
        return {'status':None,'state':'DISPATCH_RESERVED','event_count':0,'steps':[],
            'observations':[], 'outcome_recorded':False}
    execution, skill = inspect_run(connection,p['reserved_child_run_id']), inspect_skill_trace(connection,p['reserved_child_run_id'])
    if not execution['trace']['consistent'] or not skill['consistent']:
        raise RecoveryIntegrityError('Child execution evidence is inconsistent')
    with _read_snapshot(connection):
        _guard_schema(connection)
        _case(connection,p['case_id'])
        if _child_facts(connection,p['reserved_child_run_id']) != before:
            raise RecoveryIntegrityError('Child evidence changed during inspection')
        _dispatch(connection,p['case_id'],_proposal(connection,p['proposal_id']))
    status = before['run']['status']
    if outcome:
        o = outcome.data
        if (o.keys() != {'schema_version','case_id','child_run_id','child_status','child_evidence_sha256','final_manifest_sha256','recorded_at'}
                or o['child_run_id'] != p['reserved_child_run_id'] or o['child_status'] != status
                or o['child_evidence_sha256'] != digest(before) or status not in ('COMPLETED','FAILED')):
            raise RecoveryIntegrityError('Recovery Outcome contradicts terminal child evidence')
        state = 'RECOVERY_SUCCEEDED' if status == 'COMPLETED' else 'RECOVERY_FAILED'
    else:
        # A stored RUNNING row is not evidence that its process is still alive.
        state = 'RECOVERY_OUTCOME_UNKNOWN'
    return {'status':status,'state':state,'event_count':len(before['events']),
        'child_evidence_sha256':digest(before),
        'steps':[{'step_id':e['step_id'],'tool_call_id':e['tool_call_id'],'planned_seq':e['seq'],
            'intent_seqs':[r['seq'] for r in before['events'] if r['tool_call_id']==e['tool_call_id'] and r['event_type']=='TOOL_INTENT'],
            'result_seqs':[r['seq'] for r in before['events'] if r['tool_call_id']==e['tool_call_id'] and r['event_type']=='TOOL_RESULT']}
            for e in planned], 'observations':execution['observations'],'outcome_recorded':outcome is not None}


class _ContinuationPermit:
    """Fresh in-memory permit from this dispatch COMMIT; never reconstructable replay.

    get() delegates exact instances, while checking the actual Runner prefix
    before handing a tool to its execution loop. It does not execute tools.
    """
    def __init__(self, connection, proposal, registry, boundary, initial_manifest, initial_bytes):
        self.connection, self.proposal, self.registry, self.boundary = connection, proposal, registry, boundary
        self.initial_manifest, self.initial_bytes = initial_manifest, initial_bytes

    def get(self,name):
        c,p = self.connection,self.proposal.data
        tool = self.registry.get(name)
        validate_operations([s for s in p['remaining_plan'] if s['tool_name']==name],p['derived_task'],self.registry)
        if tool_catalog(p['remaining_plan'],self.registry) != p['tool_catalog']:
            raise RecoveryIntegrityError('Trusted tool catalog changed')
        with _read_snapshot(c):
            _guard_schema(c)
            fresh = _proposal(c,p['proposal_id'])
            if fresh != self.proposal:
                raise RecoveryIntegrityError('Proposal changed after dispatch')
            dispatch = _dispatch(c,p['case_id'],fresh)
            before = _child_facts(c,p['reserved_child_run_id'])
            planned = _child_identity(before,p)
        if before['run'] is None:
            # Frozen Runner's whole-plan snapshot calls get before Run creation.
            return tool
        if (before['run']['status'] != 'RUNNING' or before['run']['ended_at'] is not None
                or not planned or len(before['bindings']) != len(planned)
                or p['remaining_plan'][len(planned)-1]['tool_name'] != name
                or before['events'][-1] != planned[-1]):
            raise RecoveryIntegrityError('Permit does not match the next actual Runner invocation')
        report,_ = reconcile(c,p['case_id'],boundary=self.boundary)
        if report != p['state_adoption']:
            raise RecoveryIntegrityError('Source state changed after approval')
        _validate_assets(p,workspace_absent=False)
        manifest, artifacts = self.initial_manifest, self.initial_bytes
        for index,event in enumerate(planned[:-1]):
            facts = [r for r in before['events'] if r['tool_call_id']==event['tool_call_id']]
            results = [r for r in facts if r['event_type']=='TOOL_RESULT']
            confirmed = [r for r in facts if r['event_type']=='STEP_CONFIRMED']
            if (len(results)!=1 or len(confirmed)!=1 or _json(results[0]['payload_json'],2097152)['status']!='SUCCESS'
                    or _json(confirmed[0]['payload_json'],65536)['tool_status']!='SUCCESS'):
                raise RecoveryIntegrityError('Earlier child step is not fully confirmed SUCCESS')
            manifest,artifacts = simulate_step(p['remaining_plan'][index],manifest,artifacts)
        if _capture_workspace(Path(p['workspace_path'])) != (manifest,artifacts):
            raise RecoveryIntegrityError('Actual copied child workspace differs from approved input/prefix')
        # Inspectors are read-only, own snapshots, and must not hide evidence changes.
        if not inspect_run(c,p['reserved_child_run_id'])['trace']['consistent'] or not inspect_skill_trace(c,p['reserved_child_run_id'])['consistent']:
            raise RecoveryIntegrityError('Actual child invocation prefix is inconsistent')
        with _read_snapshot(c):
            _guard_schema(c)
            _proposal(c,p['proposal_id'])
            _dispatch(c,p['case_id'],self.proposal)
            if _child_facts(c,p['reserved_child_run_id']) != before:
                raise RecoveryIntegrityError('Child changed at tool-entry boundary')
        return tool


def execute_approved_recovery(connection, case_id, proposal_id, approved_recovery_sha256, tool_registry, *, boundary):
    """Consume one exact approved adoption once; a crash never rebuilds this permit."""
    _check_write_context(connection)
    with _read_snapshot(connection):
        _guard_schema(connection)
        proposal = _proposal(connection,proposal_id)
        p = proposal.data
        if (p['case_id'] != case_id or type(approved_recovery_sha256) is not str
                or approved_recovery_sha256 != proposal.recovery_sha256):
            raise ValueError('Exact Recovery Proposal digest approval is required')
        if _rows(connection,'SELECT 1 FROM main.recovery_dispatches WHERE case_id=?',(case_id,)):
            raise ValueError('Recovery dispatch is already reserved; automatic replay is forbidden')
    report,_ = reconcile(connection,case_id,boundary=boundary)
    if report != p['state_adoption'] or not report['executable']:
        raise RecoveryIntegrityError('Approved state adoption is stale or no longer eligible')
    validate_operations(p['remaining_plan'],p['derived_task'],tool_registry)
    if tool_catalog(p['remaining_plan'],tool_registry) != p['tool_catalog']:
        raise RecoveryIntegrityError('Approved tool catalog changed')
    manifest, artifacts = _validate_assets(p)
    value = {'schema_version':1,**{k:p[k] for k in ('case_id','proposal_id','reserved_child_run_id','workspace_path','derived_task_spec_sha256','seed_sha256')},
        'approved_recovery_sha256':approved_recovery_sha256,'reserved_at':utc_now()}
    with _skill_transaction(connection):
        _guard_schema(connection)
        if _proposal(connection,proposal_id) != proposal:
            raise RecoveryIntegrityError('Proposal changed before dispatch')
        _insert(connection,'recovery_dispatches',value)
        _dispatch(connection,case_id,proposal)
        _proposal(connection,proposal_id)
    permit = _ContinuationPermit(connection,proposal,tool_registry,boundary,manifest,artifacts)
    steps = tuple(PlanStep(s['step_id'],s['tool_name'],s['arguments']) for s in p['remaining_plan'])
    ref = SkillRef(p['skill']['skill_id'],p['skill']['skill_version'])
    run = run_task(connection,p['task_spec_path'],p['workspace_path'],steps,permit,
        model_plugin='recovery_verified_suffix',run_id=p['reserved_child_run_id'],skill_ref=ref)
    child = inspect_child(connection,proposal,dispatch=_dispatch(connection,case_id,proposal))
    final_manifest,_ = _capture_workspace(p['workspace_path'])
    with _skill_transaction(connection):
        _guard_schema(connection)
        _proposal(connection,proposal_id)
        _dispatch(connection,case_id,proposal)
        facts = _child_facts(connection,run.run_id)
        _child_identity(facts,p)
        if digest(facts) != child['child_evidence_sha256']:
            raise RecoveryIntegrityError('Child changed before Outcome publication')
        _insert(connection,'recovery_outcomes',{'schema_version':1,'case_id':case_id,'child_run_id':run.run_id,
            'child_status':facts['run']['status'],'child_evidence_sha256':digest(facts),
            'final_manifest_sha256':digest(_json(final_manifest,131072)),'recorded_at':utc_now()})
        _case(connection,case_id)
        if _child_facts(connection,run.run_id) != facts:
            raise RecoveryIntegrityError('Child evidence changed during Outcome publication')
    return run

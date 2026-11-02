"""A versioned 96-attempt feasibility proposal; not executable authorization."""
import json
from .hashing import canonical_json_bytes
from .research_comparison import _hash, _digest

PROTOCOL_ID='minutes-feasibility-v4-proposal'
ROLES={'DEVELOPMENT':6,'GATE':4,'EVALUATION':8}
REPLICATES=3


def prepare_feasibility(cases, *, exposed_source_hashes, exposed_origin_hashes):
    cases=json.loads(canonical_json_bytes(cases))
    if type(cases) is not list or len(cases)!=18:
        raise ValueError('18 independently sourced cases required, not historical calibration materials')
    for inventory in (exposed_source_hashes,exposed_origin_hashes):
        if type(inventory) not in (list,tuple,set) or not inventory:raise ValueError('Exposed inventories required')
        for value in inventory:_digest(value)
    seen={k:set() for k in ('case_id','semantic_cluster','source_sha256','origin_sha256')}
    counts={r:0 for r in ROLES};blocks={i:[] for i in range(1,4)}
    for case in cases:
        if type(case) is not dict or set(case)!={'case_id','semantic_cluster','source_sha256','origin_sha256',
                                               'policy_sha256','reference_sha256','role','development_block'}:
            raise ValueError('Exact case identities required')
        for key in ('source_sha256','origin_sha256','policy_sha256','reference_sha256'):_digest(case[key])
        for key in ('case_id','semantic_cluster'):
            if type(case[key]) is not str or not case[key].strip() or len(case[key])>128:raise ValueError('Invalid identifier')
        for key in seen:
            if case[key] in seen[key]:raise ValueError('Duplicate event, cluster, case or source')
            seen[key].add(case[key])
        if case['source_sha256'] in exposed_source_hashes or case['origin_sha256'] in exposed_origin_hashes:
            raise ValueError('Exposed source cannot be reused as unseen data')
        role,block=case['role'],case['development_block']
        if type(role) is not str or role not in ROLES:raise ValueError('Unsupported role; formal holdout excluded')
        counts[role]+=1
        if role=='DEVELOPMENT':
            if type(block) is not int or block not in blocks:raise ValueError('Three independent development blocks required')
            blocks[block].append(case['case_id'])
        elif block is not None:raise ValueError('Deployment/Gate cannot belong to revision training blocks')
    if counts!=ROLES or any(len(ids)!=2 for ids in blocks.values()):raise ValueError('Predeclared allocation differs')
    if len({c['policy_sha256'] for c in cases})!=1:raise ValueError('Organization policy must remain identical')
    versions=['S0']+[f'{a}_{b:02d}' for b in blocks for a in ('FB','NF')]
    slots=[]
    def add(phase,case,arm,depends=()):
        identity=_hash([PROTOCOL_ID,phase,case,arm])
        slots.append({'slot_id':identity,'phase':phase,'case_id':case,'arm':arm,'depends_on':sorted(depends)})
        return identity
    dev={}
    for c in sorted(cases,key=lambda c:c['case_id']):
        if c['role']=='DEVELOPMENT':dev[c['case_id']]=add('DEVELOPMENT',c['case_id'],'S0')
        else:
            for v in versions:add(c['role'],c['case_id'],v)
    for block,ids in blocks.items():
        for a in ('FB','NF'):add('REVISION',f'block_{block:02d}',f'{a}_{block:02d}',[dev[i] for i in ids])
    ordered=[]
    for phase in ('DEVELOPMENT','REVISION','GATE','EVALUATION'):
        ordered.extend(sorted((s for s in slots if s['phase']==phase),key=lambda s:_hash([20261102,s['slot_id']])))
    assert len(ordered)==96
    manifest={'schema_version':1,'protocol_id':PROTOCOL_ID,'status':'PROPOSAL_NOT_AUTHORIZED',
        'case_manifest':sorted(cases,key=lambda c:c['case_id']),'slots':ordered,'attempt_budget':96,
        'phase_attempts':{'DEVELOPMENT':6,'REVISION':6,'GATE':28,'EVALUATION':56},
        'excluded_conditions':['NO_SKILL','DIRECT_REFINE'],'revision_pairs':3,'independent_evaluation_events':8,
        'human_session_counts':{'source_reference':36,'output_review':180,'candidate_review':6,'adjudication':None},
        'human_hours':None,'money_budget':None,'budget_basis':'PENDING_OBSERVED_CALIBRATION_AND_PROVIDER_APPROVAL',
        'exposure_source_inventory_sha256':_hash(sorted(set(exposed_source_hashes))),
        'exposure_origin_inventory_sha256':_hash(sorted(set(exposed_origin_hashes))),
        'semantic_independence_review':'PENDING','human_calibration':'PENDING','model_configuration':'PENDING',
        'automatic_retries':0,'external_calls_made':0,'final_holdout':'NOT_FROZEN_NOT_RUN','thesis_main_experiment':'NOT_STARTED'}
    return {'manifest':manifest,'manifest_sha256':_hash(manifest)}

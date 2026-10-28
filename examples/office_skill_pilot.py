"""Office pilot preparation only: no model calls, database writes or experiment execution.

The allocation is a reviewable proposal, not admitted research data. Actual
datasets must still pass the unchanged Core load_research_dataset validator.
"""
import re
from axis_evo.hashing import canonical_json_bytes
from axis_evo.research_dataset import load_research_dataset

GROUPS = {'DEVELOPMENT': (6, 'DEVELOPMENT'), 'GATE': (5, 'GATE'), 'PILOT_REUSE': (3, 'GATE')}
FAMILIES = {
    'DEVELOPMENT': ('dev_action_recall','dev_owner_uncertainty','dev_date_uncertainty',
        'dev_status_fidelity','dev_format','dev_information_retention'),
    'GATE': ('gate_cross_team_handoff','gate_decision_log','gate_dependency_review',
        'gate_ambiguous_commitment','gate_multi_topic_minutes'),
    'PILOT_REUSE': ('reuse_retrospective','reuse_customer_followup','reuse_operational_brief'),
}


def pilot_template():
    return {'schema_version': 1, 'protocol_id': 'office-feedback-exploratory-v1',
        'source_skill_status': 'PENDING_REAL_SKILL', 'independent_oracles': 'PENDING',
        'provider_authorization': 'PENDING', 'protocol_approval': 'PENDING',
        'live_pilot_executed': False, 'final_holdout': 'NOT_FROZEN_NOT_RUN',
        'formal_thesis_experiment': 'NOT_STARTED', 'revision_exposed_case_ids': [],
        'cases': [{'case_id': family, 'task_family': family, 'group': group,
            'core_case_role': GROUPS[group][1], 'material_status': 'PENDING_SANITIZED_INPUT',
            'dataset_slot': 'reuse' if group == 'PILOT_REUSE' else 'development' if group == 'DEVELOPMENT' else 'gate'}
            for group, families in FAMILIES.items() for family in families]}


def validate_pilot(value):
    """Validate preparation metadata; never certify real Skill/data admission."""
    expected = pilot_template()
    if (type(value) is not dict or value.keys() != expected.keys()
            or any(value[k] != expected[k] or type(value[k]) is not type(expected[k])
                for k in expected if k not in ('cases','revision_exposed_case_ids'))):
        raise ValueError('Preparation states cannot claim admission, authorization or execution')
    cases = value['cases']
    if type(cases) is not list or len(cases) != 14:
        raise ValueError('Review the proposed 6/5/3 allocation before changing the protocol')
    ids, families, counts = {}, {}, dict.fromkeys(GROUPS, 0)
    for row in cases:
        if type(row) is not dict or row.keys() != expected['cases'][0].keys():
            raise ValueError('Invalid pilot case metadata')
        group = row['group']
        if type(group) is not str or group not in GROUPS:
            raise ValueError('Formal holdout is outside this pilot preparation')
        for field in ('case_id','task_family'):
            if type(row[field]) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', row[field]):
                raise ValueError('Bounded case and family identities required')
        if (row['case_id'] in ids or row['core_case_role'] != GROUPS[group][1]
                or row['material_status'] != 'PENDING_SANITIZED_INPUT'
                or row['dataset_slot'] != ('reuse' if group == 'PILOT_REUSE' else group.lower())
                or row['task_family'] in families and families[row['task_family']] != group):
            raise ValueError('Duplicate identity, incompatible roles or cross-group family contamination')
        ids[row['case_id']], families[row['task_family']] = group, group
        counts[group] += 1
    if any(counts[g] != GROUPS[g][0] for g in GROUPS):
        raise ValueError('Pilot allocation mismatch')
    exposed = value['revision_exposed_case_ids']
    if (type(exposed) is not list or any(type(cid) is not str or ids.get(cid) != 'DEVELOPMENT' for cid in exposed)
            or len(set(exposed)) != len(exposed)):
        raise ValueError('Only Development evidence may be exposed to the revision model')
    return value


def validate_private_dataset(root, manifest_path, preparation, group):
    """Read-only admission check around the existing validator, not a new runner.

    Inputs/Oracles stay private. The caller receives identities and counts only.
    This check does not approve the source Skill, provider or protocol.
    """
    validate_pilot(preparation)
    if group not in GROUPS:
        raise ValueError('Unknown pilot group')
    dataset = load_research_dataset(root, manifest_path)
    declared = [r for r in preparation['cases'] if r['group'] == group]
    by_id = {r['case_id']: r for r in declared}
    if {c['case_id'] for c in dataset.data['cases']} != set(by_id):
        raise ValueError('Dataset must contain the entire declared group, without favorable selection')
    for case in dataset.data['cases']:
        row = by_id[case['case_id']]
        if case['case_role'] != row['core_case_role'] or case['task_family'] != row['task_family']:
            raise ValueError('Private dataset role/family does not match the prepared protocol')
    return {'dataset_id': dataset.data['dataset_id'], 'dataset_sha256': dataset.manifest_sha256,
        'data_status': dataset.data['data_status'], 'case_count': len(declared), 'group': group,
        'execution_started': False, 'source_skill_status': preparation['source_skill_status']}


def validate_private_datasets(inputs, preparation):
    """Check cross-dataset content identities as well as each frozen Core role.

    inputs explicitly maps each group to (authorized_root, relative_manifest).
    No personal directory discovery, Oracle export or model call takes place.
    """
    if type(inputs) is not dict or inputs.keys() != GROUPS.keys():
        raise ValueError('All three separately identified private datasets are required')
    fingerprints, reports = {}, []
    for group, (root, manifest_path) in inputs.items():
        reports.append(validate_private_dataset(root, manifest_path, preparation, group))
        dataset = load_research_dataset(root, manifest_path)
        for case in dataset.data['cases']:
            fingerprint = (case['seed_manifest_sha256'], case['oracle_sha256'])
            if fingerprint in fingerprints and fingerprints[fingerprint] != group:
                raise ValueError('Identical input/Oracle evidence crosses pilot groups')
            fingerprints[fingerprint] = group
    return reports


if __name__ == '__main__':
    # Emits only a public preparation template; never discovers personal files.
    print(canonical_json_bytes(validate_pilot(pilot_template())).decode('utf-8'))

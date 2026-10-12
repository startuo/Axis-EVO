"""Transparent public toy evolution; no private fixtures or live model call."""

import argparse
import base64
import json
from pathlib import Path

from axis_evo.agent_episode_storage import initialize_agent_episode_schema
from axis_evo.checkpoint_storage import initialize_checkpoint_schema
from axis_evo.planning_adapter import PlanningResponse
from axis_evo.planning_provenance import initialize_skill_planning_schema
from axis_evo.plugins import PluginRegistry
from axis_evo.recovery_storage import initialize_recovery_schema
from axis_evo.shadow_evaluation import create_shadow_suite, create_shadow_trial
from axis_evo.skill_binding import initialize_skill_binding_schema
from axis_evo.skill_evolution import (
    initialize_skill_evolution_schema, enable_evolution_governance,
    create_evolution_case, create_revision_proposal, approve_skill_revision,
    materialize_skill_candidate, evaluate_evolution_gate, propose_skill_promotion,
    approve_skill_promotion, promote_evaluated_skill, propose_skill_activation,
    approve_skill_activation, activate_approved_skill, resolve_preferred_skill,
    inspect_skill_evolution,
)
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_planner import generate_skill_plan, execute_approved_skill_plan
from axis_evo.skill_storage import initialize_skill_schema
from axis_evo.skill_trust import create_skill_comparison, create_trust_assessment
from axis_evo.skill_trust_storage import initialize_skill_trust_schema
from axis_evo.storage import connect_database
from axis_evo.tools import ReadFileTool, WriteFileTool, PatchFileTool


def encoded(files):
    return {p: base64.b64encode(v.encode('utf-8')).decode('ascii') for p, v in files.items()}


def tasks():
    # Public goals and acceptance contain these expectations. These are not the
    # private research benchmark's hidden Oracle answers or holdout evidence.
    definitions = [
        ('public_port', {'server.ini': 'port=8080\n'}, {'server.ini': 'port=8090\n'},
         [('patch_file', {'path': 'server.ini', 'old': 'port=8080', 'new': 'port=8090'})]),
        ('public_unicode', {'greeting.txt': '星灯\r\n'}, {'greeting.txt': '晨星\r\n'},
         [('patch_file', {'path': 'greeting.txt', 'old': '星灯', 'new': '晨星'})]),
        ('public_context', {'flags.ini': '[prod]\nflag=off\n[dev]\nflag=off\n'},
         {'flags.ini': '[prod]\nflag=off\n[dev]\nflag=on\n'},
         [('patch_file', {'path': 'flags.ini', 'old': '[dev]\nflag=off', 'new': '[dev]\nflag=on'})]),
        ('public_create', {'out/input.txt': 'source\n'}, {'out/receipt.txt': 'accepted\n'},
         [('write_file', {'path': 'out/receipt.txt', 'content': 'accepted\n'})]),
        ('public_pair', {'left.txt': 'x=1\n', 'right.txt': 'y=1\n'}, {'left.txt': 'x=2\n', 'right.txt': 'y=3\n'},
         [('patch_file', {'path': 'left.txt', 'old': 'x=1', 'new': 'x=2'}),
          ('patch_file', {'path': 'right.txt', 'old': 'y=1', 'new': 'y=3'})]),
    ]
    cases, plans = [], {}
    for case_id, initial, expected, steps in definitions:
        task = {'schema_version': 1, 'task_id': case_id, 'title': case_id,
                'goal': 'Produce these public exact UTF-8 values, preserving other files: ' + json.dumps(expected, ensure_ascii=False),
                'workspace': {'seed_dir': 'seed'}, 'acceptance': {'pytest': {'enabled': False, 'args': []},
                    'file_assertions': [{'path': p, 'operator': 'equals', 'expected': v} for p, v in expected.items()]}}
        cases.append({'case_id': case_id, 'case_version': 1, 'task_spec': task, 'initial_files': encoded(initial),
                      'oracle': {'expected_files': encoded(expected), 'forbid_extra_files': True, 'preserve_unmentioned': True}})
        plans[case_id] = json.dumps({'schema_version': 1, 'steps': [
            {'step_id': 'step_' + str(i), 'tool_name': name, 'arguments': arguments}
            for i, (name, arguments) in enumerate(steps, 1)]}, ensure_ascii=False)
    return cases, plans


class PublicStaticAdapter:
    adapter_name = 'public_static_example'
    model_id = 'caller-authored-plans-v1'

    def __init__(self, plans):
        self.plans = plans

    def plan(self, request_json):
        request = json.loads(request_json)
        return PlanningResponse(self.plans[request['task_spec']['task_id']], self.adapter_name, self.model_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_directory', type=Path, help='A new disposable output directory')
    root = parser.parse_args().output_directory.resolve()
    root.mkdir(parents=True, exist_ok=False)
    connection = connect_database(root / 'facts.sqlite3')
    try:
        for initialize in (initialize_skill_schema, initialize_skill_binding_schema, initialize_skill_planning_schema,
                           initialize_agent_episode_schema, initialize_checkpoint_schema, initialize_recovery_schema,
                           initialize_skill_trust_schema, initialize_skill_evolution_schema):
            initialize(connection)
        manager = SkillManager(connection)
        parent = manager.create_version('public.evolution', name='Public exact edits', description='Transparent toy baseline',
            instructions='Perform the specified exact edits and preserve other bytes.',
            allowed_tools=['read_file', 'write_file', 'patch_file'])
        manager.promote(parent.skill_id, parent.skill_version, 'SHADOW')
        manager.promote(parent.skill_id, parent.skill_version, 'TRUSTED')
        cases, plans = tasks()
        suite = create_shadow_suite(connection, {'suite_id': 'public-transparent-five', 'suite_version': 1, 'cases': cases})
        enable_evolution_governance(connection, {'policy_id': 'evolution-gate-v1', 'suite_id': 'public-transparent-five',
            'suite_sha256': suite.fact_sha256, 'minimum_eligible_cases': 5, 'repetitions_per_case': 1})
        source = create_trust_assessment(connection, parent.ref)
        case = create_evolution_case(connection, parent.ref, {'assessment_id': source.data['assessment_id']},
            'Caller-requested clarification; no causal defect or autonomous improvement claim.')
        revision = create_revision_proposal(connection, case.data['case_id'], {
            'name': 'Public precise edits', 'description': 'Approved deterministic revision',
            'instructions': 'Use unique context and preserve exact UTF-8 bytes and line endings; update every specified target.',
            'allowed_tools': list(parent.allowed_tools), 'change_summary': 'Clarify exact byte preservation.',
            'reason_codes': ['USER_REQUESTED_IMPROVEMENT'], 'supporting_evidence_ids': [source.data['assessment_id']],
            'declared_risks': ['Toy examples do not prove model generalization.'], 'expected_behavior_change': 'More explicit guidance.'})
        approve_skill_revision(connection, revision.data['revision_id'], revision.fact_sha256)
        candidate = materialize_skill_candidate(connection, revision.data['revision_id'])
        manager.promote(candidate.skill_id, candidate.skill_version, 'SHADOW')
        direct_blocked = False
        try:
            manager.promote(candidate.skill_id, candidate.skill_version, 'TRUSTED')
        except ValueError:
            direct_blocked = True
        pairs = []
        adapter = PublicStaticAdapter(plans)
        for definition in cases:
            a, b = [create_shadow_trial(connection, 'public-transparent-five', definition['case_id'], ref, adapter)
                    for ref in (parent.ref, candidate.ref)]
            pairs.append({'case_id': definition['case_id'], 'reference_trial_id': a['trial_id'], 'candidate_trial_id': b['trial_id']})
        comparison = create_skill_comparison(connection, parent.ref, candidate.ref, 'public-transparent-five', trial_pairs=pairs)
        assessment = create_trust_assessment(connection, candidate.ref, comparison_id=comparison.data['comparison_id'])
        gate = evaluate_evolution_gate(connection, candidate.ref, assessment.data['assessment_id'])
        proposal = propose_skill_promotion(connection, case.data['case_id'], candidate.ref, assessment.data['assessment_id'])
        approve_skill_promotion(connection, proposal.data['proposal_id'], proposal.fact_sha256)
        promote_evaluated_skill(connection, proposal.data['proposal_id'], proposal.fact_sha256)
        activation = propose_skill_activation(connection, candidate.ref)
        approve_skill_activation(connection, activation.data['activation_id'], activation.fact_sha256)
        activate_approved_skill(connection, activation.data['activation_id'], activation.fact_sha256)
        (root / 'seed').mkdir()
        (root / 'seed' / 'server.ini').write_bytes(b'port=8080\n')
        (root / 'task.json').write_text(json.dumps(cases[0]['task_spec'], ensure_ascii=False), encoding='utf-8')
        registry = PluginRegistry()
        for tool in (ReadFileTool(), WriteFileTool(), PatchFileTool()):
            registry.register(tool)
        plan = generate_skill_plan(connection, root / 'task.json', candidate.ref, registry, adapter)
        run = execute_approved_skill_plan(connection, plan.proposal_id, plan.plan_sha256, root / 'task.json', root / 'workspace', registry)
        report = inspect_skill_evolution(connection, case.data['case_id'])
        print(json.dumps({'gate_status': gate['status'], 'direct_promotion_blocked': direct_blocked,
            'preferred_skill_ref': resolve_preferred_skill(connection, candidate.skill_id).to_dict(),
            'run_status': run.status, 'exact_output': (root / 'workspace' / 'server.ini').read_bytes() == b'port=8090\n',
            'integrity_issues': report['integrity_issues'], 'live_provider_calls': 0, 'autonomous_improvement_claimed': False}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == '__main__':
    main()

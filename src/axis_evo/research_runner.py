"""Explicitly approved, disposable, file-simulation experiments using frozen Core.

This is a research controller, not a second task executor or a trust bypass.
Production Runs still require the normal approved Skill-bound Runner API.
"""
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import sys
from time import monotonic
from uuid import uuid4

from .evaluation_campaign import _profile
from .evaluation_campaign_adapter import bind_campaign_adapter
from .events import utc_now
from .research_dataset import ResearchDataset, load_research_case, _identity
from . import research_storage as journal
from .sandbox import Sandbox, WorkspacePathResolver
from .shadow_evaluation import (create_shadow_suite, reserve_shadow_trial, record_shadow_trial_result,
    _intent, _trial_report, _request, _case_value, TRANSPORT_CATEGORIES)
from .planning_adapter import PlanningTransportError
from .skill_binding import _read_snapshot, _rows
from .skill_card import SkillRef
from .skill_evolution_activation import _activation_history, _eligibility
from .skill_evolution_promotion import _candidate_for_ref
from .skill_evolution_storage import EvolutionFact, _keys, _hash, digest
from .skill_storage import _check_write_context, _skill_transaction

MAX_RESEARCH_CALLS = 64
MAX_RESEARCH_PROTOCOL_BYTES = 2 * 1024 * 1024
MAX_RESEARCH_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SOURCE_TABLE_ROWS = 8192
METRIC_POLICY = 'all-declared-cases-unknown-retained-v1'


def research_source_identity():
    """Hash actual engine bytes, separately from a caller-supplied commit label."""
    root = Path(__file__).parent
    paths = sorted([*root.glob('*.py'), *root.joinpath('migrations').glob('*.sql')])
    values = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    return {'files': values, 'sha256': digest(values)}


def _registry_census(connection, research_suite_id):
    """Original registry bytes stay fixed; only the one research Suite may grow."""
    names = [r[0] for r in _rows(connection, "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
             if r[0] not in journal.TABLES]
    if len(names) > 64 or any(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', n) is None for n in names):
        raise ValueError('Unsupported research source table namespace')
    filters = {'shadow_suites': 'suite_id<>?', 'shadow_cases': 'suite_id<>?',
        'shadow_trial_intents': 'case_key NOT IN (SELECT case_key FROM main.shadow_cases WHERE suite_id=?)',
        'shadow_trial_results': 'trial_id NOT IN (SELECT t.trial_id FROM main.shadow_trial_intents t JOIN main.shadow_cases c '
                                'ON c.case_key=t.case_key WHERE c.suite_id=?)'}
    facts, total_bytes = {}, 0
    for name in names:
        where = ' WHERE ' + filters[name] if name in filters else ''
        columns = _rows(connection, f'PRAGMA main.table_info({name})')
        primary = sorted((row for row in columns if row['pk']), key=lambda row: row['pk'])
        order = ','.join('"' + row['name'].replace('"', '""') + '"' for row in (primary or columns))
        rows = _rows(connection, f'SELECT * FROM main.{name}{where} ORDER BY {order} LIMIT {MAX_SOURCE_TABLE_ROWS + 1}',
                     (research_suite_id,) if where else ())
        if len(rows) > MAX_SOURCE_TABLE_ROWS:
            raise ValueError('Research source row census exceeds its budget')
        from .hashing import canonical_json_bytes
        encoded = canonical_json_bytes([list(row) for row in rows])
        total_bytes += len(encoded)
        if total_bytes > MAX_RESEARCH_SOURCE_BYTES:
            raise ValueError('Original registry census exceeds its byte budget')
        facts[name] = {'rows': len(rows), 'sha256': hashlib.sha256(encoded).hexdigest()}
    return facts


def _gate_evidence(connection, candidate, assessment_id=None, pinned=None):
    from .skill_evolution_policy import _gate_locked
    from .skill_evolution_promotion import _promotion
    from .skill_evidence import _collect
    from .skill_manager import SkillManager
    manager = SkillManager(connection)
    card = manager.get_version(candidate.skill_id, candidate.skill_version)
    promoted = _rows(connection, 'SELECT proposal_id FROM main.skill_promotion_receipts WHERE skill_id=? AND skill_version=?',
                     (candidate.skill_id, candidate.skill_version))
    if promoted:
        if len(promoted) != 1:
            raise ValueError('Candidate promotion evidence is ambiguous')
        proposal = _promotion(connection, promoted[0][0])
        gate = proposal.data['gate']
        if assessment_id is not None and assessment_id != gate['manifest']['assessment_id']:
            raise ValueError('Research cannot replace the admitted Assessment')
        if pinned is not None and pinned != gate:
            raise ValueError('Frozen admitted Gate evidence changed')
        return {'assessment_id': gate['manifest']['assessment_id'],
            'policy_id': gate['manifest']['policy']['policy_id'], 'gate_manifest_sha256': gate['manifest_sha256'],
            'eligible': True, 'status': gate['status'], 'promotion_proposal_sha256': proposal.fact_sha256, 'gate': gate}
    if assessment_id is None:
        raise ValueError('A nonadmitted candidate needs an exact completed Gate Assessment; no implicit latest selection')
    policy = 'evolution-gate-v1'
    if _rows(connection, "SELECT 1 FROM main.sqlite_master WHERE name='evaluation_campaigns'"):
        from .evaluation_campaign_storage import _guard_schema
        _guard_schema(connection)
        if _rows(connection, 'SELECT 1 FROM main.evaluation_campaigns WHERE skill_id=? AND skill_version=?',
                 (candidate.skill_id, candidate.skill_version)):
            policy = 'evolution-gate-v2'
    if pinned is not None:
        _keys(pinned, ('eligible', 'status', 'reasons', 'manifest', 'manifest_sha256'))
        if digest(pinned['manifest']) != pinned['manifest_sha256']:
            raise ValueError('Frozen Gate manifest digest mismatch')
        gate = _gate_locked(connection, candidate, assessment_id, policy, historical=pinned['manifest'])
        if gate != pinned:
            raise ValueError('Frozen pre-experiment Gate evidence is not preserved')
    else:
        histories = [_collect(connection, card.source.ref, None), _collect(connection, candidate, None)]
        gate = _gate_locked(connection, candidate, assessment_id, policy, histories)
    return {'assessment_id': assessment_id, 'policy_id': policy, 'gate_manifest_sha256': gate['manifest_sha256'],
            'eligible': gate['eligible'], 'status': gate['status'], 'promotion_proposal_sha256': None, 'gate': gate}


def _selection(connection, baseline, candidate, assessment_id=None, pinned_gate=None):
    from .skill_manager import SkillManager
    manager = SkillManager(connection)
    original = manager.get_version(baseline.skill_id, baseline.skill_version)
    proposed = manager.get_version(candidate.skill_id, candidate.skill_version)
    from .shadow_evaluation import _skill_anchor
    _, lineage = _skill_anchor(connection, candidate)
    if (baseline.skill_version != 1 or len(lineage) > 8
            or (lineage[-1]['card']['skill_id'], lineage[-1]['card']['skill_version'])
                != (baseline.skill_id, baseline.skill_version)):
        raise ValueError('Research compares original v1 with an exact bounded descendant from the shared pool')
    if manager.get_current_state(candidate.skill_id, candidate.skill_version) not in ('SHADOW', 'TRUSTED'):
        raise ValueError('Experimental candidate must be SHADOW or TRUSTED')
    receipt = _candidate_for_ref(connection, candidate)
    baseline_proof = _eligibility(connection, baseline)
    history = _activation_history(connection, baseline.skill_id)
    if not history:
        raise ValueError('C requires independently committed preferred-version selection')
    latest = history[-1]
    selected = SkillRef(latest.data['skill_id'], latest.data['skill_version'])
    if selected not in (baseline, candidate):
        raise ValueError('C selection is outside the fixed shared candidate pool')
    selected_proof = _eligibility(connection, selected)
    gate = _gate_evidence(connection, candidate, assessment_id, pinned_gate)
    if set(proposed.allowed_tools) != set(original.allowed_tools):
        raise ValueError('Research conditions cannot expand tool capabilities')
    return {'baseline': {**baseline.to_dict(), 'card_sha256': digest(original.to_dict())},
        'candidate_pool': [{**candidate.to_dict(), 'card_sha256': digest(proposed.to_dict()),
                            'candidate_receipt_sha256': receipt.fact_sha256}],
        'conditions': {'A': baseline.to_dict(), 'B': candidate.to_dict(), 'C': selected.to_dict()},
        'baseline_eligibility': baseline_proof, 'selected_eligibility': selected_proof,
        'gate_evidence': gate, 'lineage_sha256': digest(lineage),
        'activation_id': latest.data['activation_id'], 'activation_sha256': latest.fact_sha256,
        'selection_rule': 'ONE_PREDECLARED_CANDIDATE_C_USES_APPROVED_PREFERRED_OR_V1'}


def build_research_protocol(connection, dataset, baseline_ref, candidate_ref, model_profile, *,
                            source_commit, case_role='DEVELOPMENT', run_kind='ENGINEERING_DRY_RUN', gate_assessment_id=None):
    """Pure preparation. Caller must approve the returned complete manifest SHA."""
    if type(dataset) is not ResearchDataset or type(baseline_ref) is not SkillRef or type(candidate_ref) is not SkillRef:
        raise ValueError('Research requires exact dataset and Skill identities')
    if case_role not in ('DEVELOPMENT', 'GATE') or run_kind not in ('ENGINEERING_DRY_RUN', 'LIVE_PILOT'):
        raise ValueError('Formal final holdout is not authorized in this milestone')
    if type(source_commit) is not str or re.fullmatch('[0-9a-f]{40}', source_commit) is None:
        raise ValueError('An exact source commit label is required')
    profile = _profile(model_profile)
    if connection.execute('PRAGMA page_count').fetchone()[0] * connection.execute('PRAGMA page_size').fetchone()[0] > MAX_RESEARCH_SOURCE_BYTES:
        raise ValueError('Research source database exceeds the bounded backup budget')
    if run_kind == 'ENGINEERING_DRY_RUN' and profile['transport']['kind'] != 'injected-test':
        raise ValueError('A dry run cannot authorize real provider transport')
    cases = [c for c in dataset.data['cases'] if c['case_role'] == case_role]
    if not cases or len(cases) * 2 > MAX_RESEARCH_CALLS:
        raise ValueError('Research case universe exceeds its fixed budget')
    definitions = []
    for case in cases:
        actual = load_research_case(dataset, case['case_id'])
        if case['model_profile_identity'] != profile:
            raise ValueError('Dataset and experiment model profile differ')
        definitions.append(actual['definition'])
    identity = 'experiment_' + uuid4().hex
    with _read_snapshot(connection):
        selection = _selection(connection, baseline_ref, candidate_ref, gate_assessment_id)
        registry = _registry_census(connection, 'research-' + identity)
    for ref in (baseline_ref, candidate_ref):
        from .skill_manager import SkillManager
        card = SkillManager(connection).get_version(ref.skill_id, ref.skill_version)
        if any(set(case['allowed_tools']) != set(card.allowed_tools) for case in cases):
            raise ValueError('Dataset and immutable Skill tool policies differ')
        for definition in definitions:
            # Same Core request constructor, with a same-length placeholder
            # digest for pure byte-budget preflight. No request is dispatched.
            _request(_case_value('research-' + identity, definition), card, profile['adapter_name'], profile['model_id'],
                     {'experiment_sha256': '0' * 64, 'profile': profile})
    definitions.sort(key=lambda case: case['case_id'])
    slots = [{'slot_id': 'slot_' + digest([case['case_id'], ref.to_dict()])[:32],
              'trial_id': 'trial_' + uuid4().hex, 'case_id': case['case_id'], 'skill_ref': ref.to_dict(), 'attempt': 1}
             for case in sorted(cases, key=lambda c: c['case_id']) for ref in (baseline_ref, candidate_ref)]
    value = {'schema_version': 1, 'experiment_id': identity, 'run_kind': run_kind,
        'dataset_id': dataset.data['dataset_id'], 'dataset_version': dataset.data['dataset_version'],
        'dataset_manifest_sha256': dataset.manifest_sha256, 'case_role': case_role,
        'source_registry_census': registry,
        'case_ids': sorted(c['case_id'] for c in cases), 'source_commit_label': source_commit,
        'case_manifest': [{k: case[k] for k in ('case_id', 'task_family', 'case_role', 'task_spec_sha256',
            'seed_manifest_sha256', 'oracle_sha256')} for case in sorted(cases, key=lambda case: case['case_id'])],
        'execution_environment': {'python_version': sys.version, 'sqlite_version': sqlite3.sqlite_version, 'os_name': os.name},
        'source_identity': research_source_identity(), 'model_profile': profile, 'selection': selection,
        'suite_definition': {'suite_id': 'research-' + identity, 'suite_version': 1, 'cases': definitions},
        'suite_definition_sha256': digest(definitions), 'slots': slots, 'metric_policy': METRIC_POLICY,
        'repeat_policy': 'ONE_SUBMISSION_PER_SLOT_NO_AUTOMATIC_RETRY', 'created_at': utc_now()}
    # Private data remain in the full local protocol; public exports whitelist
    # only digests and identities, never the Suite definitions or Oracle bytes.
    from .hashing import canonical_json_bytes
    encoded = canonical_json_bytes(value)
    if len(encoded) > MAX_RESEARCH_PROTOCOL_BYTES:
        raise ValueError('Research protocol exceeds its explicit immutable-fact byte budget')
    return EvolutionFact(encoded.decode('utf-8'), digest(value))


def _protocol(fact):
    if type(fact) is not EvolutionFact or digest(fact.data) != fact.fact_sha256:
        raise ValueError('Research protocol digest mismatch')
    d = fact.data
    _keys(d, ('schema_version', 'experiment_id', 'run_kind', 'dataset_id', 'dataset_version',
        'dataset_manifest_sha256', 'case_role', 'source_registry_census', 'case_ids', 'case_manifest', 'execution_environment',
        'source_commit_label', 'source_identity', 'model_profile',
        'selection', 'suite_definition', 'suite_definition_sha256', 'slots', 'metric_policy', 'repeat_policy', 'created_at'))
    _identity(d['experiment_id'])
    if re.fullmatch('experiment_[0-9a-f]{32}', d['experiment_id']) is None:
        raise ValueError('Research experiment identity must be a generated UUID')
    if (type(d['schema_version']) is not int or d['schema_version'] != 1
            or d['run_kind'] not in ('ENGINEERING_DRY_RUN', 'LIVE_PILOT')
            or d['case_role'] not in ('DEVELOPMENT', 'GATE') or d['metric_policy'] != METRIC_POLICY
            or d['repeat_policy'] != 'ONE_SUBMISSION_PER_SLOT_NO_AUTOMATIC_RETRY'
            or digest(d['suite_definition']['cases']) != d['suite_definition_sha256']
            or digest(d['source_identity']['files']) != d['source_identity']['sha256']):
        raise ValueError('Unsupported or corrupted frozen research protocol')
    _hash(d['dataset_manifest_sha256'])
    _profile(d['model_profile'])
    if d['run_kind'] == 'ENGINEERING_DRY_RUN' and d['model_profile']['transport']['kind'] != 'injected-test':
        raise ValueError('A dry run cannot authorize real provider transport')
    _keys(d['source_identity'], ('files', 'sha256'))
    if type(d['source_commit_label']) is not str or re.fullmatch('[0-9a-f]{40}', d['source_commit_label']) is None:
        raise ValueError('Invalid research source commit label')
    cases = d['case_ids']
    if (type(cases) is not list or not 1 <= len(cases) <= MAX_RESEARCH_CALLS // 2
            or cases != sorted(set(cases))):
        raise ValueError('Research case universe must be complete, bounded and unique')
    for case in cases:
        _identity(case)
    if type(d['case_manifest']) is not list or [case['case_id'] for case in d['case_manifest']] != cases:
        raise ValueError('Research task-family manifest differs from its case universe')
    for case in d['case_manifest']:
        _keys(case, ('case_id', 'task_family', 'case_role', 'task_spec_sha256', 'seed_manifest_sha256', 'oracle_sha256'))
        _identity(case['task_family'])
        if case['case_role'] != d['case_role']:
            raise ValueError('Research manifest cannot relabel dataset roles')
        for key in ('task_spec_sha256', 'seed_manifest_sha256', 'oracle_sha256'):
            _hash(case[key])
    _keys(d['execution_environment'], ('python_version', 'sqlite_version', 'os_name'))
    suite = d['suite_definition']
    _keys(suite, ('suite_id', 'suite_version', 'cases'))
    if (suite['suite_id'] != 'research-' + d['experiment_id'] or type(suite['suite_version']) is not int
            or suite['suite_version'] != 1 or type(suite['cases']) is not list
            or [c['case_id'] for c in suite['cases']] != cases):
        raise ValueError('Research Suite must cover the exact declared case universe')
    selection = d['selection']
    _keys(selection, ('baseline', 'candidate_pool', 'conditions', 'baseline_eligibility',
        'selected_eligibility', 'gate_evidence', 'lineage_sha256', 'activation_id', 'activation_sha256', 'selection_rule'))
    _hash(selection['lineage_sha256'])
    _keys(selection['gate_evidence'], ('assessment_id', 'policy_id', 'gate_manifest_sha256', 'eligible',
                                      'status', 'promotion_proposal_sha256', 'gate'))
    if type(selection['candidate_pool']) is not list or len(selection['candidate_pool']) != 1:
        raise ValueError('A research block must freeze one shared candidate for B and C')
    baseline, candidate = selection['baseline'], selection['candidate_pool'][0]
    _keys(baseline, ('skill_id', 'skill_version', 'card_sha256'))
    _keys(candidate, ('skill_id', 'skill_version', 'card_sha256', 'candidate_receipt_sha256'))
    refs = [SkillRef(row['skill_id'], row['skill_version']).to_dict() for row in (baseline, candidate)]
    conditions = selection['conditions']
    _keys(conditions, ('A', 'B', 'C'))
    if (baseline['skill_version'] != 1 or refs[0] == refs[1] or conditions['A'] != refs[0]
            or conditions['B'] != refs[1] or conditions['C'] not in refs
            or selection['selection_rule'] != 'ONE_PREDECLARED_CANDIDATE_C_USES_APPROVED_PREFERRED_OR_V1'):
        raise ValueError('Research conditions differ from the fixed shared candidate block')
    slots, seen = d['slots'], set()
    if type(slots) is not list or len(slots) != 2 * len(cases):
        raise ValueError('Research Trial slots must cover the complete declared universe')
    for slot, (case, ref) in zip(slots, [(cid, ref) for cid in cases for ref in refs]):
        _keys(slot, ('slot_id', 'trial_id', 'case_id', 'skill_ref', 'attempt'))
        if (slot['slot_id'] != 'slot_' + digest([case, ref])[:32] or slot['case_id'] != case
                or slot['skill_ref'] != ref or type(slot['attempt']) is not int or slot['attempt'] != 1
                or type(slot['trial_id']) is not str or re.fullmatch('trial_[0-9a-f]{32}', slot['trial_id']) is None
                or slot['trial_id'] in seen):
            raise ValueError('Research slot identity or attempt differs from the approved universe')
        seen.add(slot['trial_id'])
    return d


def _verify_inputs(connection, dataset, protocol):
    d = _protocol(protocol)
    if dataset.manifest_sha256 != d['dataset_manifest_sha256'] or research_source_identity() != d['source_identity']:
        raise ValueError('Frozen dataset or actual research source identity changed')
    if d['execution_environment'] != {'python_version': sys.version, 'sqlite_version': sqlite3.sqlite_version, 'os_name': os.name}:
        raise ValueError('Research execution environment changed; inspection remains read-only')
    if _registry_census(connection, d['suite_definition']['suite_id']) != d['source_registry_census']:
        raise ValueError('Frozen source registry evidence changed outside the declared research Suite')
    selected_cases = [case for case in dataset.data['cases'] if case['case_role'] == d['case_role']]
    if (sorted(case['case_id'] for case in selected_cases) != d['case_ids']
            or any(case['model_profile_identity'] != d['model_profile'] for case in selected_cases)):
        raise ValueError('Research role, model profile or complete dataset universe mismatch')
    if [{k: case[k] for k in ('case_id', 'task_family', 'case_role', 'task_spec_sha256', 'seed_manifest_sha256', 'oracle_sha256')}
            for case in sorted(selected_cases, key=lambda case: case['case_id'])] != d['case_manifest']:
        raise ValueError('Research task-family or private Oracle identity changed')
    actual = [load_research_case(dataset, cid)['definition'] for cid in d['case_ids']]
    if sorted(actual, key=lambda c: c['case_id']) != sorted(d['suite_definition']['cases'], key=lambda c: c['case_id']):
        raise ValueError('Frozen Suite, TaskSpec, seed or Oracle identity mismatch')
    b, c = d['selection']['baseline'], d['selection']['candidate_pool'][0]
    if _selection(connection, SkillRef(b['skill_id'], b['skill_version']), SkillRef(c['skill_id'], c['skill_version']),
                  d['selection']['gate_evidence']['assessment_id'], d['selection']['gate_evidence']['gate']) != d['selection']:
        raise ValueError('Frozen candidate pool, Gate receipt or independent activation changed')
    return d


def create_research_experiment(source_connection, output_directory, dataset, protocol, approved_protocol_sha256):
    """Create a new disposable SQLite backup; never write the source connection."""
    _check_write_context(source_connection)
    _hash(approved_protocol_sha256)
    if type(protocol) is not EvolutionFact or approved_protocol_sha256 != protocol.fact_sha256:
        raise ValueError('Explicit exact protocol approval is required')
    if _rows(source_connection, "SELECT 1 FROM main.sqlite_master WHERE name='research_experiments'"):
        raise ValueError('A research journal cannot serve as an ordinary source registry')
    with _read_snapshot(source_connection):
        d = _verify_inputs(source_connection, dataset, protocol)
    directory = Path(output_directory).absolute()
    WorkspacePathResolver._directories(directory.parent)
    if directory.exists() or directory.is_symlink() or directory.resolve().is_relative_to(Path(dataset.root)):
        raise ValueError('Research output must be a new disposable directory outside the dataset')
    directory.mkdir()
    c = sqlite3.connect(directory / 'experiment.sqlite3', isolation_level=None)
    c.row_factory = sqlite3.Row
    try:
        source_connection.backup(c)
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA synchronous=FULL')
        _verify_inputs(c, dataset, protocol)
        c.executescript('BEGIN IMMEDIATE;\n' + journal._schema())
        journal.guard(c)
        journal.insert(c, 'research_experiments', d)
        c.commit()
        create_shadow_suite(c, d['suite_definition'])
        (directory / 'workspaces').mkdir()
    except BaseException:
        if c.in_transaction:
            c.rollback()
        raise
    finally:
        c.close()
    return {'experimentId': d['experiment_id'], 'protocolSha256': protocol.fact_sha256,
            'directory': str(directory), 'sourceDatabaseModified': False}


def _load_protocol(connection):
    rows = _rows(connection, 'SELECT experiment_id FROM main.research_experiments')
    if len(rows) != 1:
        raise ValueError('Exactly one frozen experiment must own this disposable database')
    fact = journal.load(connection, 'research_experiments', rows[0][0])
    _protocol(fact)
    return fact


def execute_research_experiment(directory, dataset, model_adapter, approved_protocol_sha256):
    c = journal.connect(directory)
    try:
        protocol = _load_protocol(c)
        _hash(approved_protocol_sha256)
        if protocol.fact_sha256 != approved_protocol_sha256:
            raise ValueError('Research execution approval digest mismatch')
        with _read_snapshot(c):
            d = _verify_inputs(c, dataset, protocol)
            _report(c, protocol)  # Reject existing wrong/undeclared facts before any model call.
        adapter = bind_campaign_adapter(model_adapter, d['model_profile'])
        if journal.present(c, 'research_seals', d['experiment_id']):
            return _report(c, protocol)
        for slot in d['slots']:
            sid, trial = slot['slot_id'], slot['trial_id']
            if journal.present(c, 'research_observations', sid):
                continue
            submitted = journal.present(c, 'research_submissions', sid)
            if submitted:
                # A Result committed before the controller died is observable.
                # A submitted call without it stays UNKNOWN, never replayed.
                if _rows(c, 'SELECT 1 FROM main.shadow_trial_results WHERE trial_id=?', (trial,)):
                    _observe(c, protocol, slot)
                continue
            case = load_research_case(dataset, slot['case_id'])
            workspace = Path(directory) / 'workspaces' / sid
            if workspace.exists():
                from .agent_episode_storage import seed_manifest
                if seed_manifest(workspace)[1] != case['seed_manifest_sha256']:
                    raise ValueError('Disposable initial workspace changed before submission')
            else:
                Sandbox.from_seed(case['seed_path'], workspace)
            from .agent_episode_storage import seed_manifest
            if seed_manifest(workspace)[1] != case['seed_manifest_sha256']:
                raise ValueError('Restored disposable seed differs from its frozen identity')
            if not _rows(c, 'SELECT 1 FROM main.shadow_trial_intents WHERE trial_id=?', (trial,)):
                reserve_shadow_trial(c, d['suite_definition']['suite_id'], slot['case_id'], SkillRef(**slot['skill_ref']),
                    adapter.adapter_name, adapter.model_id, planning_parameters={'experiment_sha256': protocol.fact_sha256,
                        'profile': d['model_profile']}, trial_id=trial)
            intent = _intent(c, trial)
            with _skill_transaction(c):
                journal.guard(c)
                from .research_results import _slot_evidence
                _slot_evidence(c, protocol, slot)
                if journal.present(c, 'research_submissions', sid):
                    continue
                journal.insert(c, 'research_submissions', {'schema_version': 1, 'slot_id': sid,
                    'experiment_id': d['experiment_id'], 'trial_id': trial, 'protocol_sha256': protocol.fact_sha256,
                    'intent_sha256': intent.fact_sha256, 'created_at': utc_now()})
            start, response, category = monotonic(), None, None
            try:
                response = adapter.plan(intent.data['request_json'])
            except PlanningTransportError as error:
                category = {'http_error': 'http', 'network': 'connection', 'oversized_response': 'response_too_large',
                            'invalid_json': 'invalid_response'}.get(error.category, error.category)
                if category not in TRANSPORT_CATEGORIES:
                    category = 'invalid_response'
            except TimeoutError:
                category = 'timeout'
            record_shadow_trial_result(c, trial, response, transport_category=category,
                                       latency_ms=int((monotonic() - start) * 1000))
            _observe(c, protocol, slot)
        return _report(c, protocol)
    finally:
        c.close()


def _observe(connection, protocol, slot):
    result = _trial_report(connection, slot['trial_id'])
    with _skill_transaction(connection):
        journal.guard(connection)
        if journal.present(connection, 'research_observations', slot['slot_id']):
            # Another controller may have observed the same immutable Result.
            # Validate that exact fact under the lock; never replace or ignore
            # a conflicting row, and never submit a model call from this path.
            from .research_results import _slot_evidence
            _slot_evidence(connection, protocol, slot)
            return journal.load(connection, 'research_observations', slot['slot_id'])
        journal.insert(connection, 'research_observations', {'schema_version': 1, 'slot_id': slot['slot_id'],
            'protocol_sha256': protocol.fact_sha256, 'trial_id': slot['trial_id'],
            'intent_sha256': result['intent_sha256'], 'result_sha256': result['result_sha256'],
            'outcome': result['outcome'], 'created_at': utc_now()})


def _report(connection, protocol):
    if not connection.in_transaction:
        with _read_snapshot(connection):
            return _report_locked(connection, protocol)
    return _report_locked(connection, protocol)


def _report_locked(connection, protocol):
    from .research_results import report_research_results
    d = _protocol(protocol)
    if _registry_census(connection, d['suite_definition']['suite_id']) != d['source_registry_census']:
        raise ValueError('Original registry bytes changed outside the declared research Suite')
    return report_research_results(connection, protocol)


def inspect_research_experiment(directory):
    c = journal.connect(directory, readonly=True)
    try:
        with _read_snapshot(c):
            return _report(c, _load_protocol(c))
    finally:
        c.close()


def seal_research_experiment(directory, approved_protocol_sha256):
    """Explicitly close a census, including UNKNOWN; closing never retries it."""
    c = journal.connect(directory)
    try:
        with _skill_transaction(c):
            protocol = _load_protocol(c)
            _hash(approved_protocol_sha256)
            if protocol.fact_sha256 != approved_protocol_sha256:
                raise ValueError('Research seal approval digest mismatch')
            report = _report(c, protocol)
            return journal.insert(c, 'research_seals', {'schema_version': 1,
                'experiment_id': protocol.data['experiment_id'], 'protocol_sha256': protocol.fact_sha256,
                'slots': report['slots'], 'created_at': utc_now()})
    finally:
        c.close()


def export_research_results(directory, export_directory):
    from .research_results import write_research_exports
    return write_research_exports(inspect_research_experiment(directory), export_directory)

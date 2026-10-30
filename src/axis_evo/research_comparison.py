"""Pure Stage 2D planning, without production state, transport or authority.

This is deliberately NOT another Runner. It predeclares independent measurement
slots, including no-Skill and feedback ablations the legacy A/B/C API cannot
express. Human semantic-independence review is still needed beyond hash checks.
"""
import hashlib
import json

from .hashing import canonical_json_bytes

PROTOCOL_ID = 'minutes-causal-pilot-v3-proposal'
SCHEDULE_SEED = 20261031
ROLES = {'DEVELOPMENT': 12, 'GATE': 8, 'EVALUATION': 24}
REPLICATES = 6
MAX_ATTEMPTS = 488


def _hash(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _digest(value):
    if type(value) is not str or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Exact SHA-256 identity required')


def prepare_comparison(cases, *, exposed_source_hashes, exposed_origin_hashes,
                       semantic_review_record_sha256=None):
    """Validate a proposed registry and emit an outcome-independent schedule.

    Origins identify underlying events, not filenames. The caller supplies the
    complete exposed inventory, including 2B/2C, preparation and public examples.
    A hash/cluster declaration alone never proves semantic independence. No data
    or parameter authorization is created, even with a review attestation.
    """
    cases = json.loads(canonical_json_bytes(cases))
    if type(cases) is not list or len(cases) != sum(ROLES.values()):
        raise ValueError('Exactly 12 development, 8 Gate and 24 evaluation cases required')
    for inventory in (exposed_source_hashes, exposed_origin_hashes):
        if type(inventory) not in (list, tuple, set) or not inventory:
            raise ValueError('Explicit nonempty exposed inventories required')
        for digest in inventory:
            _digest(digest)
    seen = {name: set() for name in ('case_id', 'semantic_cluster', 'source_sha256', 'origin_sha256')}
    counts = {role: 0 for role in ROLES}
    blocks = {i: 0 for i in range(1, REPLICATES+1)}
    for case in cases:
        if type(case) is not dict or set(case) != {'case_id', 'semantic_cluster', 'source_sha256',
                'origin_sha256', 'policy_sha256', 'reference_sha256', 'role', 'development_block'}:
            raise ValueError('Unexpected comparison case fields')
        for key in ('source_sha256', 'origin_sha256', 'policy_sha256', 'reference_sha256'):
            _digest(case[key])
        for key in ('case_id', 'semantic_cluster'):
            if type(case[key]) is not str or not case[key].strip() or len(case[key]) > 128:
                raise ValueError('Explicit bounded case and semantic cluster identifiers required')
        for key in seen:
            if case[key] in seen[key]:
                raise ValueError('Duplicate content, origin or semantic cluster, even under a new filename')
            seen[key].add(case[key])
        if case['source_sha256'] in exposed_source_hashes or case['origin_sha256'] in exposed_origin_hashes:
            raise ValueError('Exposed data cannot become unseen evaluation data')
        role, block = case['role'], case['development_block']
        if type(role) is not str or role not in ROLES:
            raise ValueError('Formal Final Holdout is outside this proposal')
        counts[role] += 1
        if role == 'DEVELOPMENT':
            if type(block) is not int or block not in blocks:
                raise ValueError('Development needs one of six independent revision blocks')
            blocks[block] += 1
        elif block is not None:
            raise ValueError('Evaluation cases cannot be attached to a revision training block')
    if counts != ROLES or set(blocks.values()) != {2}:
        raise ValueError('Predeclared role or revision block sizes differ')
    if len({c['policy_sha256'] for c in cases}) != 1:
        raise ValueError('All conditions use the same predeclared organization policy')
    if semantic_review_record_sha256 is not None:
        _digest(semantic_review_record_sha256)
    versions = ['S0'] + [f'{arm}_{i:02d}' for i in blocks for arm in ('FB', 'NF')]
    slots = []

    def add(phase, case_id, arm, depends_on=None):
        slot_id = _hash([PROTOCOL_ID, phase, case_id, arm])
        slots.append({'slot_id': slot_id, 'phase': phase, 'case_id': case_id,
                      'arm': arm, 'depends_on': depends_on})
        return slot_id

    for case in sorted(cases, key=lambda c: c['case_id']):
        role, identifier = case['role'], case['case_id']
        if role == 'DEVELOPMENT':
            add('DEVELOPMENT', identifier, 'S0')
        elif role == 'GATE':
            for arm in versions:
                add('GATE', identifier, arm)
        else:
            for arm in ['NO_SKILL', *versions]:
                parent = add('EVALUATION', identifier, arm)
                if arm == 'S0':
                    add('EVALUATION', identifier, 'DIRECT_REFINE', parent)
    for block in blocks:
        for arm in ('FB', 'NF'):
            add('REVISION', f'block_{block:02d}', f'{arm}_{block:02d}')
    # Stable hash priorities and topological order, independent of Python RNG,
    # wall time, responses, filenames on disk and any production Gate history.
    ordered, completed = [], set()
    for phase in ('DEVELOPMENT', 'REVISION', 'GATE', 'EVALUATION'):
        pending = [s for s in slots if s['phase'] == phase]
        while pending:
            available = [s for s in pending if s['depends_on'] is None or s['depends_on'] in completed]
            chosen = min(available, key=lambda s: _hash([SCHEDULE_SEED, s['slot_id']]))
            ordered.append(chosen)
            completed.add(chosen['slot_id'])
            pending.remove(chosen)
    assert len(ordered) == MAX_ATTEMPTS
    manifest = {'schema_version': 1, 'protocol_id': PROTOCOL_ID,
        'status': 'PROPOSAL_NOT_AUTHORIZED', 'case_manifest': sorted(cases, key=lambda c: c['case_id']),
        'case_manifest_sha256': _hash(sorted(cases, key=lambda c: c['case_id'])),
        'exposed_source_inventory_sha256': _hash(sorted(set(exposed_source_hashes))),
        'exposed_origin_inventory_sha256': _hash(sorted(set(exposed_origin_hashes))),
        'semantic_independence': 'ATTESTED_NOT_AUTHENTICATED' if semantic_review_record_sha256 else 'PENDING',
        'semantic_review_record_sha256': semantic_review_record_sha256,
        'schedule_seed': SCHEDULE_SEED, 'slots': ordered,
        'attempt_budget': MAX_ATTEMPTS, 'automatic_retries': 0,
        'outcomes': 'NOT_RUN', 'model_configuration': 'PENDING_EXACT_APPROVAL',
        'human_reference_review': 'PENDING', 'provider_cost_cap': 'PENDING',
        'final_holdout': 'NOT_FROZEN_NOT_RUN', 'thesis_main_experiment': 'NOT_STARTED'}
    return {'manifest': manifest, 'manifest_sha256': _hash(manifest)}

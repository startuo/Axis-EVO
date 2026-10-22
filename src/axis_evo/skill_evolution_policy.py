"""Independent, closed evidence gate. Recommendations are never permission."""

from .events import utc_now
from .shadow_evaluation import _suite, _skill_anchor, _verify_anchor, _trial_report
from .skill_binding import _read_snapshot, _rows
from .skill_evidence import inspect_skill_evidence, _collect
from .skill_storage import _check_write_context, _skill_transaction
from .skill_trust import _assessment_fact, _comparison, _preserved
from .skill_revision import _ref, _candidate
from .skill_evolution_storage import (
    TABLE_KEYS, EvolutionError, EvolutionIntegrityError, _guard_schema, _no_shadows,
    _load, _insert, _keys, digest, snapshot,
)


GATE_POLICY_ID = 'evolution-gate-v1'
MINIMUM_ELIGIBLE_CASES = 5
REPETITIONS_PER_CASE = 1


def _policy(value):
    _keys(value, ('policy_id', 'suite_id', 'suite_sha256', 'minimum_eligible_cases', 'repetitions_per_case'))
    if (value['policy_id'] != GATE_POLICY_ID or type(value['minimum_eligible_cases']) is not int
            or value['minimum_eligible_cases'] != MINIMUM_ELIGIBLE_CASES
            or type(value['repetitions_per_case']) is not int or value['repetitions_per_case'] != REPETITIONS_PER_CASE):
        raise EvolutionError('POLICY_UNSUPPORTED: fixed v1 requires minimum 5 cases and one repetition')
    return value


def _governance(connection):
    """Probe under the caller-owned lock; absence alone preserves legacy mode."""
    _no_shadows(connection)
    names = tuple(TABLE_KEYS)
    objects = _rows(connection, f"SELECT 1 FROM main.sqlite_master WHERE tbl_name COLLATE NOCASE IN ({','.join('?' for _ in names)})", names)
    if not objects:
        return None
    _guard_schema(connection)
    rows = _rows(connection, 'SELECT governance_id FROM main.evolution_governance')
    if not rows:
        return None
    if len(rows) != 1:
        raise EvolutionIntegrityError('Governance is not a single permanent enablement')
    fact = _load(connection, 'evolution_governance', 'enabled')
    d = fact.data
    _keys(d, ('schema_version', 'governance_id', 'mode', 'policy', 'baseline_trusted', 'created_at'))
    policy = _policy(d['policy'])
    if d['mode'] != 'EVIDENCE_GATED' or _suite(connection, policy['suite_id']).fact_sha256 != policy['suite_sha256']:
        raise EvolutionIntegrityError('Governance mode or pinned Suite mismatch')
    seen = set()
    for anchor in d['baseline_trusted']:
        card = _verify_anchor(connection, anchor)
        if card.ref in seen or anchor[0]['history'][-1]['state'] != 'TRUSTED':
            raise EvolutionIntegrityError('Invalid closed bootstrap TRUSTED anchor')
        seen.add(card.ref)
    return fact


def enable_evolution_governance(connection, governance_policy):
    """One-way explicit opt-in; pin old TRUSTED versions and one gate Suite."""
    _check_write_context(connection)
    policy = _policy(snapshot(governance_policy))
    with _skill_transaction(connection):
        _guard_schema(connection)
        if _governance(connection) is not None:
            raise EvolutionError('Governance is already enabled and cannot be disabled')
        if _suite(connection, policy['suite_id']).fact_sha256 != policy['suite_sha256']:
            raise EvolutionError('Governance Suite digest mismatch')
        anchors = []
        for r in _rows(connection, "SELECT skill_id,skill_version FROM main.skill_state_events WHERE state='TRUSTED' ORDER BY skill_id,skill_version"):
            from .skill_card import SkillRef
            _, anchor = _skill_anchor(connection, SkillRef(r[0], r[1]))
            anchors.append(anchor)
        fact = _insert(connection, 'evolution_governance', {
            'schema_version': 1, 'governance_id': 'enabled', 'mode': 'EVIDENCE_GATED',
            'policy': policy, 'baseline_trusted': anchors, 'created_at': utc_now()})
        _governance(connection)
    return fact


def _prepare_histories(connection, reference, candidate):
    if connection.in_transaction:
        raise EvolutionError('Evolution rejects an active caller transaction')
    histories = []
    for ref in (reference, candidate):
        history = inspect_skill_evidence(connection, ref)
        if history['integrity_issues']:
            raise EvolutionIntegrityError('Historical execution evidence is inconsistent')
        histories.append(history['source_snapshot'])
    return histories


def _census(connection, reference, candidate, suite_id):
    rows = _rows(connection, '''SELECT trial_id FROM main.shadow_trial_intents
        WHERE (skill_id=? AND skill_version=? AND case_key IN
          (SELECT case_key FROM main.shadow_cases WHERE suite_id=?))
          OR (skill_id=? AND skill_version=?) ORDER BY trial_id''',
        (reference.skill_id, reference.skill_version, suite_id, candidate.skill_id, candidate.skill_version))
    reports = [_trial_report(connection, r[0]) for r in rows]
    return [{k: r[k] for k in ('trial_id', 'intent_sha256', 'result_sha256', 'suite_id', 'case_id', 'skill_ref', 'outcome')} for r in reports]


def _gate_locked(connection, candidate, assessment_id, policy_id, histories=None, historical=None):
    """Pure reads in an already owned snapshot/transaction. No nested BEGIN."""
    if policy_id == 'evolution-gate-v2':
        from .evaluation_campaign import _gate_locked as campaign_gate
        return campaign_gate(connection, candidate, assessment_id, policy_id, histories, historical)
    governance = _governance(connection)
    if governance is None:
        raise EvolutionError('EVIDENCE_GATED governance must be explicitly enabled')
    policy = governance.data['policy']
    if policy_id != policy['policy_id']:
        raise EvolutionError('POLICY_UNSUPPORTED')
    receipts = _rows(connection, 'SELECT revision_id FROM main.skill_evolution_candidates WHERE skill_id=? AND skill_version=?',
                     (candidate.skill_id, candidate.skill_version))
    if len(receipts) != 1:
        raise EvolutionIntegrityError('Gate requires the exact approved candidate creation receipt')
    _candidate(connection, receipts[0][0])
    card, candidate_anchor = _skill_anchor(connection, candidate)
    reference = card.source.ref
    if reference is None:
        raise EvolutionError('Candidate must be DERIVED from an exact parent')
    parent, reference_anchor = _skill_anchor(connection, reference)
    assessment = _assessment_fact(connection, assessment_id)
    a = assessment.data
    if (a['skill_id'], a['skill_version']) != (candidate.skill_id, candidate.skill_version) or a['comparison_id'] is None:
        raise EvolutionIntegrityError('Assessment is not for the exact candidate with a Comparison')
    comparison = _comparison(connection, a['comparison_id'])
    c = comparison.data
    if (c['reference_skill_ref'] != reference.to_dict() or c['suite_id'] != policy['suite_id']
            or c['evaluation']['suite_sha256'] != policy['suite_sha256']):
        raise EvolutionIntegrityError('Gate Comparison has foreign parent or Suite')
    current = [_collect(connection, reference, None), _collect(connection, candidate, None)]
    census = _census(connection, reference, candidate, policy['suite_id'])
    if historical is None:
        if histories is None or current != histories:
            raise EvolutionError('STALE: historical evidence changed during gate preparation')
        if a['history']['source_snapshot'] != current[1]:
            raise EvolutionError('STALE: Assessment does not cover current complete history')
        source_histories = current
    else:
        source_histories = historical['history_snapshots']
        if (len(source_histories) != 2 or any(not _preserved(old, now) for old, now in zip(source_histories, current))
                or source_histories[1] != a['history']['source_snapshot']):
            raise EvolutionIntegrityError('Approved historical gate prefix no longer matches')
        pinned = historical['trial_census']
        actual = {r['trial_id']: r for r in census}
        if any(actual.get(r['trial_id']) != r for r in pinned):
            raise EvolutionIntegrityError('Approved Trial evidence no longer matches')
        census = pinned
    candidate_state = source_histories[1]['skill_anchor'][0]['history'][-1]['state']
    reference_state = source_histories[0]['skill_anchor'][0]['history'][-1]['state']
    pairs = c['evaluation']['pairs']
    chosen = sorted([p[side + '_trial_id'] for p in pairs for side in ('reference', 'candidate')])
    metrics = c['evaluation']['metrics']
    reasons = []
    if reference_state != 'TRUSTED' or candidate_state != 'SHADOW':
        reasons.append('LIFECYCLE_INELIGIBLE')
    if not set(card.allowed_tools) <= set(parent.allowed_tools):
        reasons.append('CAPABILITY_EXPANSION_REQUIRED')
    if set(card.allowed_tools) != set(parent.allowed_tools) or not c['evaluation']['lineage_verified']:
        reasons.append('INCOMPARABLE')
    if metrics['total_cases'] < MINIMUM_ELIGIBLE_CASES:
        reasons.append('INSUFFICIENT_COVERAGE')
    if (chosen != sorted(r['trial_id'] for r in census)
            or any(r['suite_id'] != policy['suite_id'] for r in census)):
        reasons.append('TRIAL_CENSUS_MISMATCH')
    if metrics['paired_regression_count']:
        reasons.append('REGRESSION_BLOCKED')
    if (metrics['eligible_cases'] != metrics['total_cases']
            or any(p['candidate']['outcome'] != 'SIMULATED_PASS' for p in pairs)):
        reasons.append('INSUFFICIENT_EVIDENCE')
    manifest = {'policy': policy, 'governance_sha256': governance.fact_sha256,
                'reference_skill_ref': reference.to_dict(), 'candidate_skill_ref': candidate.to_dict(),
                'reference_card_sha256': digest(parent.to_dict()), 'candidate_card_sha256': digest(card.to_dict()),
                'comparison_id': a['comparison_id'], 'comparison_sha256': comparison.fact_sha256,
                'assessment_id': assessment_id, 'assessment_sha256': assessment.fact_sha256,
                'history_snapshots': source_histories, 'trial_census': census,
                'trial_census_sha256': digest(census), 'metrics': metrics}
    return {'eligible': not reasons, 'status': reasons[0] if reasons else 'ELIGIBLE_FOR_APPROVAL',
            'reasons': list(dict.fromkeys(reasons)), 'manifest': manifest, 'manifest_sha256': digest(manifest)}


def evaluate_evolution_gate(connection, candidate_skill_ref, trust_assessment_id, gate_policy_id=GATE_POLICY_ID):
    candidate = _ref(candidate_skill_ref)
    if connection.in_transaction:
        raise EvolutionError('Evolution rejects an active caller transaction')
    try:
        with _read_snapshot(connection):
            _guard_schema(connection)
            card, _ = _skill_anchor(connection, candidate)
            reference = card.source.ref
        if reference is None:
            raise EvolutionError('Candidate has no direct parent')
        histories = _prepare_histories(connection, reference, candidate)
        with _read_snapshot(connection):
            _guard_schema(connection)
            return _gate_locked(connection, candidate, trust_assessment_id, gate_policy_id, histories)
    except (ValueError, KeyError, TypeError, IndexError) as error:
        status = 'STALE' if str(error).startswith('STALE') else 'INTEGRITY_BLOCKED'
        return {'eligible': False, 'status': status, 'reasons': [str(error)], 'manifest': None, 'manifest_sha256': None}

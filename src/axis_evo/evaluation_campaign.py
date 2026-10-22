"""Prospective Gate v2 campaigns; the original v1 policy is never redefined."""
from time import monotonic
from uuid import uuid4

from .events import utc_now
from .planning_adapter import PlanningTransportError
from .shadow_evaluation import (_suite, _skill_anchor, _verify_anchor, _intent, _trial_report,
    reserve_shadow_trial, record_shadow_trial_result, TRANSPORT_CATEGORIES)
from .skill_binding import _read_snapshot, _rows
from .skill_card import SkillRef
from .skill_evidence import _collect
from .skill_storage import _check_write_context, _skill_transaction
from .skill_trust import create_skill_comparison, create_trust_assessment, _comparison, _assessment_fact, _preserved
from .skill_evolution_storage import EvolutionError, EvolutionIntegrityError, _keys, _text, _hash, digest, snapshot
from .evaluation_campaign_storage import _guard_schema, _load, _insert
from .evaluation_campaign_adapter import CampaignPlanningAdapter, validate_transport

POLICY_ID = 'evolution-gate-v2'
MINIMUM_CASES = 5
MAX_CONTEXT_TRIALS = 256
MAX_GENERATIONS = 8


def _profile(value):
    value = snapshot(value)
    _keys(value, ('adapter_name', 'model_id', 'profile_id', 'profile_revision', 'config_sha256', 'effective_parameters', 'transport'))
    for key in ('adapter_name', 'model_id', 'profile_id'):
        _text(value[key], 256)
    _hash(value['config_sha256'])
    if type(value['profile_revision']) is not int or value['profile_revision'] < 1:
        raise EvolutionError('An immutable model profile revision is required')
    p = value['effective_parameters']
    _keys(p, ('model', 'stream', 'n'))
    if p['model'] != value['model_id'] or p['stream'] is not False or type(p['n']) is not int or p['n'] != 1:
        raise EvolutionError('Only the actual supported nonstreaming wire parameters may be declared')
    validate_transport(value['transport'])
    return value


def enable_campaign_policy(connection):
    """Explicit opt-in alongside immutable v1 governance, never its replacement."""
    from .skill_evolution_policy import _governance
    _check_write_context(connection)
    with _skill_transaction(connection):
        _guard_schema(connection)
        old = _governance(connection)
        if old is None:
            raise EvolutionError('Campaign v2 requires existing explicit v1 governance')
        policy = old.data['policy']
        if len(_suite(connection, policy['suite_id']).data['cases']) < MINIMUM_CASES:
            raise EvolutionError('Campaign v2 requires at least five complete Suite cases')
        return _insert(connection, 'evaluation_policy_scopes', {'schema_version': 1, 'policy_id': POLICY_ID,
            'governance_id': 'enabled', 'governance_sha256': old.fact_sha256,
            'suite_id': policy['suite_id'], 'suite_sha256': policy['suite_sha256'],
            'minimum_eligible_cases': MINIMUM_CASES, 'repetitions_per_case': 1,
            'repeat_policy': 'ONE_CAMPAIGN_PER_CANDIDATE_NO_RETRY', 'max_generations': MAX_GENERATIONS,
            'benchmark_policy': 'skill-trust-v1', 'created_at': utc_now()})


def _scope(connection):
    from .skill_evolution_policy import _governance
    fact = _load(connection, 'evaluation_policy_scopes', POLICY_ID)
    d, old = fact.data, _governance(connection)
    _keys(d, ('schema_version', 'policy_id', 'governance_id', 'governance_sha256', 'suite_id', 'suite_sha256',
              'minimum_eligible_cases', 'repetitions_per_case', 'repeat_policy', 'max_generations', 'benchmark_policy', 'created_at'))
    if (old is None or d['policy_id'] != POLICY_ID or d['governance_id'] != 'enabled'
            or d['governance_sha256'] != old.fact_sha256 or d['suite_id'] != old.data['policy']['suite_id']
            or d['suite_sha256'] != old.data['policy']['suite_sha256']
            or d['minimum_eligible_cases'] != MINIMUM_CASES or type(d['minimum_eligible_cases']) is not int
            or d['repetitions_per_case'] != 1 or type(d['repetitions_per_case']) is not int
            or d['repeat_policy'] != 'ONE_CAMPAIGN_PER_CANDIDATE_NO_RETRY'
            or d['max_generations'] != MAX_GENERATIONS or d['benchmark_policy'] != 'skill-trust-v1'
            or _suite(connection, d['suite_id']).fact_sha256 != d['suite_sha256']):
        raise EvolutionIntegrityError('Campaign policy scope does not match its permanent authorization')
    _text(d['created_at'])
    return fact


def _trial_summary(connection, trial_id, case_id=None, role=None):
    rows = _rows(connection, 'SELECT 1 FROM main.shadow_trial_intents WHERE trial_id=?', (trial_id,))
    if not rows:
        return {'trial_id': trial_id, 'case_id': case_id, 'role': role, 'intent_sha256': None,
                'result_sha256': None, 'outcome': 'MISSING_INTENT'}
    report = _trial_report(connection, trial_id)
    return {'trial_id': trial_id, 'case_id': report['case_id'], 'role': role,
            'intent_sha256': report['intent_sha256'], 'result_sha256': report['result_sha256'], 'outcome': report['outcome']}


def _context(connection, parent, candidate):
    rows = _rows(connection, 'SELECT trial_id FROM main.shadow_trial_intents WHERE '
        '(skill_id=? AND skill_version=?) OR (skill_id=? AND skill_version=?) ORDER BY trial_id',
        (parent.skill_id, parent.skill_version, candidate.skill_id, candidate.skill_version))
    if len(rows) > MAX_CONTEXT_TRIALS:
        raise EvolutionError('Campaign historical Trial context exceeds its declared budget')
    return [_trial_summary(connection, row[0]) for row in rows]


def create_evaluation_campaign(connection, candidate_skill_ref, model_profile):
    from .skill_evolution_activation import _eligibility
    from .skill_evolution_promotion import _candidate_for_ref
    _check_write_context(connection)
    if type(candidate_skill_ref) is not SkillRef:
        raise EvolutionError('Campaign requires an exact SkillRef')
    profile = _profile(model_profile)
    with _skill_transaction(connection):
        _guard_schema(connection)
        scope = _scope(connection)
        candidate, anchor = _skill_anchor(connection, candidate_skill_ref)
        if len(anchor) > MAX_GENERATIONS or anchor[0]['history'][-1]['state'] != 'SHADOW':
            raise EvolutionError('Campaign requires SHADOW and bounded direct lineage')
        parent = candidate.source.ref
        if parent is None:
            raise EvolutionError('Campaign candidate must have an exact direct parent')
        parent_card, parent_anchor = _skill_anchor(connection, parent)
        eligibility = _eligibility(connection, parent)
        record = _candidate_for_ref(connection, candidate.ref)
        if _rows(connection, 'SELECT 1 FROM main.shadow_trial_intents WHERE skill_id=? AND skill_version=?',
                 (candidate.skill_id, candidate.skill_version)):
            raise EvolutionError('A candidate with prior Trials cannot start a fresh campaign')
        context = _context(connection, parent, candidate.ref)
        if any(row['result_sha256'] is None for row in context):
            raise EvolutionError('Unresolved parent Trial context cannot be hidden in a new campaign')
        cases = sorted(case['case_id'] for case in _suite(connection, scope.data['suite_id']).data['cases'])
        slots = [{'case_id': case, 'role': role, 'attempt': 1, 'trial_id': 'trial_' + uuid4().hex}
                 for case in cases for role in ('reference', 'candidate')]
        fact = _insert(connection, 'evaluation_campaigns', {'schema_version': 1,
            'campaign_id': 'campaign_' + uuid4().hex, 'policy_id': POLICY_ID, **candidate.ref.to_dict(),
            'policy_sha256': scope.fact_sha256, 'suite_id': scope.data['suite_id'], 'suite_sha256': scope.data['suite_sha256'],
            'reference_skill_ref': parent.to_dict(), 'reference_card_sha256': digest(parent_card.to_dict()),
            'candidate_card_sha256': digest(candidate.to_dict()), 'reference_anchor': parent_anchor,
            'candidate_anchor': anchor, 'parent_eligibility': eligibility, 'candidate_receipt_sha256': record.fact_sha256,
            'profile': profile, 'case_ids': cases, 'slots': slots, 'historical_context': context,
            'historical_context_sha256': digest(context), 'created_at': utc_now()})
        _campaign(connection, fact.data['campaign_id'])
    return fact


def _campaign(connection, identity):
    from .skill_evolution_activation import _eligibility
    from .skill_evolution_promotion import _candidate_for_ref
    fact, scope = _load(connection, 'evaluation_campaigns', identity), _scope(connection)
    d = fact.data
    _keys(d, ('schema_version', 'campaign_id', 'policy_id', 'skill_id', 'skill_version', 'policy_sha256',
        'suite_id', 'suite_sha256', 'reference_skill_ref', 'reference_card_sha256', 'candidate_card_sha256',
        'reference_anchor', 'candidate_anchor', 'parent_eligibility', 'candidate_receipt_sha256', 'profile',
        'case_ids', 'slots', 'historical_context', 'historical_context_sha256', 'created_at'))
    candidate, parent = _verify_anchor(connection, d['candidate_anchor']), _verify_anchor(connection, d['reference_anchor'])
    record = _candidate_for_ref(connection, candidate.ref)
    cases = sorted(case['case_id'] for case in _suite(connection, d['suite_id']).data['cases'])
    if (candidate.ref.to_dict() != {k: d[k] for k in ('skill_id', 'skill_version')}
            or candidate.source.ref != parent.ref or d['reference_skill_ref'] != parent.ref.to_dict()
            or digest(parent.to_dict()) != d['reference_card_sha256'] or digest(candidate.to_dict()) != d['candidate_card_sha256']
            or len(d['candidate_anchor']) > MAX_GENERATIONS
            or d['candidate_anchor'][0]['history'][-1]['state'] != 'SHADOW'
            or d['reference_anchor'][0]['history'][-1]['state'] != 'TRUSTED'
            or record.fact_sha256 != d['candidate_receipt_sha256'] or d['policy_id'] != POLICY_ID
            or d['policy_sha256'] != scope.fact_sha256 or d['suite_id'] != scope.data['suite_id']
            or d['suite_sha256'] != scope.data['suite_sha256'] or d['case_ids'] != cases or len(cases) < MINIMUM_CASES
            or digest(d['historical_context']) != d['historical_context_sha256']):
        raise EvolutionIntegrityError('Campaign identity, exact lineage, policy or Suite mismatch')
    _profile(d['profile'])
    if type(d['slots']) is not list or len(d['slots']) != 2 * len(cases):
        raise EvolutionIntegrityError('Campaign must prospectively declare the complete paired universe')
    seen = set()
    for slot, expected in zip(d['slots'], [(case, role) for case in cases for role in ('reference', 'candidate')]):
        _keys(slot, ('case_id', 'role', 'attempt', 'trial_id'))
        _text(slot['trial_id'], 128)
        if ((slot['case_id'], slot['role']) != expected or type(slot['attempt']) is not int or slot['attempt'] != 1
                or slot['trial_id'] in seen):
            raise EvolutionIntegrityError('Campaign slot/attempt universe is invalid')
        seen.add(slot['trial_id'])
    if seen & {r['trial_id'] for r in d['historical_context']}:
        raise EvolutionIntegrityError('Historical Trials cannot be reused as new campaign slots')
    if d['parent_eligibility'] != _eligibility(connection, parent.ref):
        raise EvolutionIntegrityError('Campaign parent has no matching trusted authorization')
    if len(d['historical_context']) > MAX_CONTEXT_TRIALS or any(
            _trial_summary(connection, row['trial_id']) != row for row in d['historical_context']):
        raise EvolutionIntegrityError('Campaign historical Trial context no longer matches')
    _text(d['created_at'])
    return fact


def _parameters(campaign):
    d = campaign.data
    return {'campaign_id': d['campaign_id'], 'policy_id': POLICY_ID, 'profile': d['profile']}


def _claim(connection, campaign, phase, slot_id='one', **proof):
    with _skill_transaction(connection):
        _guard_schema(connection)
        # The entry point already verified the full immutable lineage. Compare
        # that exact fact under this owned write lock, rather than recursively
        # revalidating every ancestor for each individual dispatch.
        if _load(connection, 'evaluation_campaigns', campaign.data['campaign_id']) != campaign:
            raise EvolutionIntegrityError('Campaign changed before dispatch')
        claims = _claims(connection, campaign)
        finalized = any(f.data['phase'] == 'FINALIZE' for f in claims)
        if phase == 'EVALUATE' and (claims or _rows(connection,
                'SELECT 1 FROM main.evaluation_campaign_receipts WHERE campaign_id=?', (campaign.data['campaign_id'],))):
            raise EvolutionError('A sealed or claimed campaign cannot begin again')
        if phase == 'TRIAL' and (finalized or not any(f.data['phase'] == 'EVALUATE' for f in claims)):
            raise EvolutionError('A Trial requires an unsealed campaign execution claim')
        if phase == 'TRIAL' and _rows(connection, 'SELECT 1 FROM main.shadow_trial_results WHERE trial_id=?', (slot_id,)):
            raise EvolutionError('Existing Trial Result cannot be followed by a new dispatch')
        if phase == 'FINALIZE':
            census = [_trial_summary(connection, s['trial_id'], s['case_id'], s['role']) for s in campaign.data['slots']]
            if proof != {'trial_census': census, 'trial_census_sha256': digest(census)}:
                raise EvolutionError('Trial census changed before the first finalization claim')
        return _insert(connection, 'evaluation_dispatches', {'schema_version': 1,
            'claim_id': 'claim_' + uuid4().hex, 'campaign_id': campaign.data['campaign_id'],
            'phase': phase, 'slot_id': slot_id, 'campaign_sha256': campaign.fact_sha256,
            'proof': proof, 'created_at': utc_now()})


def _claims(connection, campaign):
    rows = _rows(connection, 'SELECT claim_id FROM main.evaluation_dispatches WHERE campaign_id=? ORDER BY phase,slot_id',
                 (campaign.data['campaign_id'],))
    facts = [_load(connection, 'evaluation_dispatches', row[0]) for row in rows]
    slots = {s['trial_id'] for s in campaign.data['slots']}
    seen = set()
    for fact in facts:
        d = fact.data
        _keys(d, ('schema_version', 'claim_id', 'campaign_id', 'phase', 'slot_id', 'campaign_sha256', 'proof', 'created_at'))
        if (d['campaign_sha256'] != campaign.fact_sha256 or (d['phase'], d['slot_id']) in seen
                or (d['phase'] == 'TRIAL' and d['slot_id'] not in slots)
                or (d['phase'] in ('EVALUATE', 'FINALIZE') and d['slot_id'] != 'one')):
            raise EvolutionIntegrityError('Campaign dispatch identity mismatch')
        if d['phase'] == 'EVALUATE' and d['proof'] != {}:
            raise EvolutionIntegrityError('Unexpected campaign phase proof')
        if d['phase'] == 'FINALIZE':
            _keys(d['proof'], ('trial_census', 'trial_census_sha256'))
            census = d['proof']['trial_census']
            if (type(census) is not list or len(census) != len(campaign.data['slots'])
                    or d['proof']['trial_census_sha256'] != digest(census)):
                raise EvolutionIntegrityError('First finalization census is invalid')
            for row, slot in zip(census, campaign.data['slots']):
                _keys(row, ('trial_id', 'case_id', 'role', 'intent_sha256', 'result_sha256', 'outcome'))
                if any(row[k] != slot[k] for k in ('trial_id', 'case_id', 'role')):
                    raise EvolutionIntegrityError('First finalization changed the declared Trial universe')
        _text(d['created_at'])
        seen.add((d['phase'], d['slot_id']))
    return facts


def execute_evaluation_campaign(connection, campaign_id, model_adapter):
    """One dispatch only. All Core Intents commit before the first model call."""
    _check_write_context(connection)
    with _read_snapshot(connection):
        _guard_schema(connection)
        campaign = _campaign(connection, campaign_id)
        if _claims(connection, campaign) or _rows(connection,
                'SELECT 1 FROM main.evaluation_campaign_receipts WHERE campaign_id=?', (campaign_id,)):
            raise EvolutionError('A claimed or sealed campaign cannot be replayed')
        d = campaign.data
        if type(model_adapter) is not CampaignPlanningAdapter:
            raise EvolutionError('Campaign requires an explicitly configuration-bound adapter')
        model_adapter.verify(d['profile'])
        if _context(connection, SkillRef(**d['reference_skill_ref']), SkillRef(d['skill_id'], d['skill_version'])) != d['historical_context']:
            raise EvolutionError('Campaign context changed before dispatch')
    _claim(connection, campaign, 'EVALUATE')
    for slot in d['slots']:
        ref = SkillRef(**d['reference_skill_ref']) if slot['role'] == 'reference' else SkillRef(d['skill_id'], d['skill_version'])
        reserve_shadow_trial(connection, d['suite_id'], slot['case_id'], ref,
            d['profile']['adapter_name'], d['profile']['model_id'], planning_parameters=_parameters(campaign), trial_id=slot['trial_id'])
    for slot in d['slots']:
        with _read_snapshot(connection):
            intent = _intent(connection, slot['trial_id'])
        _claim(connection, campaign, 'TRIAL', slot['trial_id'], intent_sha256=intent.fact_sha256,
               request_sha256=intent.data['request_sha256'])
        start, response, category = monotonic(), None, None
        try:
            response = model_adapter.plan(intent.data['request_json'])
        except PlanningTransportError as error:
            category = {'http_error': 'http', 'network': 'connection', 'oversized_response': 'response_too_large',
                        'invalid_json': 'invalid_response'}.get(error.category, error.category)
            if category not in TRANSPORT_CATEGORIES:
                category = 'invalid_response'
        except TimeoutError:
            category = 'timeout'
        record_shadow_trial_result(connection, slot['trial_id'], response, transport_category=category,
                                   latency_ms=int((monotonic() - start) * 1000))
    return seal_evaluation_campaign(connection, campaign_id)


def seal_evaluation_campaign(connection, campaign_id):
    """Seal the first complete or incomplete census. Null results never upgrade."""
    _check_write_context(connection)
    with _read_snapshot(connection):
        _guard_schema(connection)
        campaign = _campaign(connection, campaign_id)
        census = [_trial_summary(connection, s['trial_id'], s['case_id'], s['role']) for s in campaign.data['slots']]
    _claim(connection, campaign, 'FINALIZE', trial_census=census, trial_census_sha256=digest(census))
    d, comparison, assessment = campaign.data, None, None
    if all(row['intent_sha256'] is not None for row in census):
        pairs = [{'case_id': case, **{role + '_trial_id': next(s['trial_id'] for s in d['slots']
            if s['case_id'] == case and s['role'] == role) for role in ('reference', 'candidate')}} for case in d['case_ids']]
        comparison = create_skill_comparison(connection, SkillRef(**d['reference_skill_ref']),
            SkillRef(d['skill_id'], d['skill_version']), d['suite_id'], trial_pairs=pairs)
        assessment = create_trust_assessment(connection, SkillRef(d['skill_id'], d['skill_version']),
                                             comparison_id=comparison.data['comparison_id'])
    with _skill_transaction(connection):
        _guard_schema(connection)
        current = [_trial_summary(connection, s['trial_id'], s['case_id'], s['role']) for s in d['slots']]
        if current != census:
            raise EvolutionError('Trial census changed while finalization was prepared')
        return _insert(connection, 'evaluation_campaign_receipts', {'schema_version': 1, 'campaign_id': campaign_id,
            'campaign_sha256': campaign.fact_sha256, 'comparison_id': comparison.data['comparison_id'] if comparison else None,
            'comparison_sha256': comparison.fact_sha256 if comparison else None,
            'assessment_id': assessment.data['assessment_id'] if assessment else None,
            'assessment_sha256': assessment.fact_sha256 if assessment else None,
            'trial_census': census, 'trial_census_sha256': digest(census), 'created_at': utc_now()})


def _receipt(connection, campaign):
    fact = _load(connection, 'evaluation_campaign_receipts', campaign.data['campaign_id'])
    d = fact.data
    _keys(d, ('schema_version', 'campaign_id', 'campaign_sha256', 'comparison_id', 'comparison_sha256',
              'assessment_id', 'assessment_sha256', 'trial_census', 'trial_census_sha256', 'created_at'))
    census = [_trial_summary(connection, s['trial_id'], s['case_id'], s['role']) for s in campaign.data['slots']]
    finalized = [f for f in _claims(connection, campaign) if f.data['phase'] == 'FINALIZE']
    if len(finalized) != 1 or finalized[0].data['proof'] != {'trial_census': census, 'trial_census_sha256': digest(census)}:
        raise EvolutionIntegrityError('First sealed census cannot be replaced by later Trial evidence')
    if d['campaign_sha256'] != campaign.fact_sha256 or d['trial_census'] != census or d['trial_census_sha256'] != digest(census):
        raise EvolutionIntegrityError('Sealed campaign evidence changed, including a formerly missing Result')
    if d['comparison_id'] is not None:
        comparison, assessment = _comparison(connection, d['comparison_id']), _assessment_fact(connection, d['assessment_id'])
        if (comparison.fact_sha256 != d['comparison_sha256'] or assessment.fact_sha256 != d['assessment_sha256']
                or assessment.data['comparison_id'] != d['comparison_id']):
            raise EvolutionIntegrityError('Campaign Comparison/Assessment changed')
    elif d['assessment_id'] is not None or d['comparison_sha256'] is not None or d['assessment_sha256'] is not None:
        raise EvolutionIntegrityError('Incomplete campaign cannot carry a replacement Assessment')
    _text(d['created_at'])
    return fact


def _gate_locked(connection, candidate, assessment_id, policy_id, histories=None, historical=None):
    _guard_schema(connection)
    scope = _scope(connection)
    rows = _rows(connection, 'SELECT campaign_id FROM main.evaluation_campaigns WHERE skill_id=? AND skill_version=?',
                 (candidate.skill_id, candidate.skill_version))
    if policy_id != POLICY_ID or len(rows) != 1:
        raise EvolutionError('Exact opt-in campaign is required for Gate v2')
    campaign = _campaign(connection, rows[0][0])
    d, receipt = campaign.data, _receipt(connection, campaign)
    r = receipt.data
    if r['assessment_id'] is None or assessment_id != r['assessment_id']:
        raise EvolutionError('The first sealed campaign has no matching complete Assessment')
    parent = SkillRef(**d['reference_skill_ref'])
    comparison, assessment = _comparison(connection, r['comparison_id']), _assessment_fact(connection, assessment_id)
    c, a = comparison.data, assessment.data
    if (c['reference_skill_ref'] != parent.to_dict() or c['suite_id'] != d['suite_id']
            or c['candidate_card_sha256'] != d['candidate_card_sha256']
            or c['reference_card_sha256'] != d['reference_card_sha256']
            or (a['skill_id'], a['skill_version']) != (candidate.skill_id, candidate.skill_version)):
        raise EvolutionIntegrityError('Campaign Comparison belongs to another generation')
    chosen = sorted(p[role + '_trial_id'] for p in c['trial_pairs'] for role in ('reference', 'candidate'))
    if chosen != sorted(s['trial_id'] for s in d['slots']):
        raise EvolutionIntegrityError('Comparison did not use the entire prospective slot universe')
    claims = _claims(connection, campaign)
    trials = {f.data['slot_id']: f for f in claims if f.data['phase'] == 'TRIAL'}
    reasons = []
    if not any(f.data['phase'] == 'EVALUATE' for f in claims):
        reasons.append('MISSING_EVALUATION_DISPATCH')
    if not any(f.data['phase'] == 'FINALIZE' for f in claims):
        reasons.append('MISSING_FINALIZATION_DISPATCH')
    for slot in d['slots']:
        intent = _intent(connection, slot['trial_id'])
        i, claim = intent.data, trials.get(slot['trial_id'])
        expected_ref = parent.to_dict() if slot['role'] == 'reference' else candidate.to_dict()
        if (i['suite_id'] != d['suite_id'] or i['case_id'] != slot['case_id']
                or {k: i[k] for k in ('skill_id', 'skill_version')} != expected_ref
                or i['adapter_name'] != d['profile']['adapter_name'] or i['model_id'] != d['profile']['model_id']
                or i['planning_parameters'] != _parameters(campaign)
                or claim is None or claim.data['proof'] != {'intent_sha256': intent.fact_sha256, 'request_sha256': i['request_sha256']}):
            reasons.append('CAMPAIGN_TRIAL_IDENTITY_MISMATCH')
    now = [_collect(connection, parent, None), _collect(connection, candidate, None)]
    actual = _context(connection, parent, candidate)
    pinned_context = d['historical_context']
    if historical is None:
        if histories is None or histories != now or a['history']['source_snapshot'] != now[1]:
            raise EvolutionError('STALE: campaign Assessment/source history changed')
        expected = sorted(pinned_context + [{**row, 'role': None} for row in r['trial_census']], key=lambda row: row['trial_id'])
        if actual != expected:
            reasons.append('TRIAL_CENSUS_MISMATCH')
        source_histories = now
    else:
        source_histories = historical['history_snapshots']
        if (len(source_histories) != 2 or any(not _preserved(old, current) for old, current in zip(source_histories, now))
                or source_histories[1] != a['history']['source_snapshot']):
            raise EvolutionIntegrityError('Historical campaign history no longer preserved')
    actual_by_id = {row['trial_id']: row for row in actual}
    if any(actual_by_id.get(row['trial_id']) != row for row in pinned_context):
        raise EvolutionIntegrityError('Historical Trial context was rewritten')
    metrics = c['evaluation']['metrics']
    if (source_histories[0]['skill_anchor'][0]['history'][-1]['state'] != 'TRUSTED'
            or source_histories[1]['skill_anchor'][0]['history'][-1]['state'] != 'SHADOW'):
        reasons.append('LIFECYCLE_INELIGIBLE')
    if not c['evaluation']['lineage_verified'] or not c['evaluation']['capabilities_equal']:
        reasons.append('INCOMPARABLE')
    if metrics['total_cases'] < MINIMUM_CASES or metrics['total_cases'] != len(d['case_ids']):
        reasons.append('INSUFFICIENT_COVERAGE')
    if metrics['paired_regression_count']:
        reasons.append('REGRESSION_BLOCKED')
    if metrics['eligible_cases'] != len(d['case_ids']) or any(p['candidate']['outcome'] != 'SIMULATED_PASS' for p in c['evaluation']['pairs']):
        reasons.append('INSUFFICIENT_EVIDENCE')
    manifest = {'policy': scope.data, 'policy_sha256': scope.fact_sha256, 'campaign_id': d['campaign_id'],
        'campaign_sha256': campaign.fact_sha256, 'campaign_receipt_sha256': receipt.fact_sha256,
        'assessment_id': assessment_id, 'assessment_sha256': assessment.fact_sha256,
        'comparison_id': r['comparison_id'], 'comparison_sha256': comparison.fact_sha256,
        'reference_skill_ref': parent.to_dict(), 'candidate_skill_ref': candidate.to_dict(),
        'history_snapshots': source_histories, 'trial_census': r['trial_census'],
        'historical_context_sha256': d['historical_context_sha256'], 'metrics': metrics}
    return {'eligible': not reasons, 'status': reasons[0] if reasons else 'ELIGIBLE_FOR_APPROVAL',
            'reasons': list(dict.fromkeys(reasons)), 'manifest': manifest, 'manifest_sha256': digest(manifest)}


def inspect_evaluation_campaign(connection, campaign_id):
    """Logical read-only; no migration, dispatch, sealing or provider request."""
    if connection.in_transaction:
        raise EvolutionError('Campaign inspection rejects an active caller transaction')
    with _read_snapshot(connection):
        _guard_schema(connection)
        campaign = _campaign(connection, campaign_id)
        d = campaign.data
        rows = _rows(connection, 'SELECT 1 FROM main.evaluation_campaign_receipts WHERE campaign_id=?', (campaign_id,))
        receipt = _receipt(connection, campaign) if rows else None
        trials = [_trial_summary(connection, s['trial_id'], s['case_id'], s['role']) for s in d['slots']]
        claims = _claims(connection, campaign)
        return {'schemaVersion': 1, 'campaignId': campaign_id, 'campaignSha256': campaign.fact_sha256,
            'policyId': POLICY_ID, 'policySha256': d['policy_sha256'], 'suiteId': d['suite_id'], 'suiteSha256': d['suite_sha256'],
            'referenceSkillRef': d['reference_skill_ref'], 'candidateSkillRef': {k: d[k] for k in ('skill_id', 'skill_version')},
            'profile': d['profile'], 'historicalContext': d['historical_context'], 'trials': trials,
            'sealed': receipt is not None, 'complete': bool(receipt and all(row['result_sha256'] for row in trials)),
            'receiptSha256': receipt.fact_sha256 if receipt else None,
            'assessmentId': receipt.data['assessment_id'] if receipt else None,
            'dispatchClaimCount': sum(f.data['phase'] == 'TRIAL' for f in claims),
            'unknownCount': sum(row['result_sha256'] is None for row in trials),
            'heldoutImprovement': 'NOT_MEASURED', 'tokenUsage': None, 'tokenUsageStatus': 'TOKEN_USAGE_UNAVAILABLE'}

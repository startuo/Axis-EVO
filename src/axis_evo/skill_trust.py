"""Paired comparison and immutable recommendations, never lifecycle decisions."""

from uuid import uuid4

from .events import utc_now
from .planning_adapter import MAX_REQUEST_BYTES, _strict_json
from .skill_card import SkillRef
from .skill_binding import _read_snapshot, _rows, _ref
from .skill_storage import _check_write_context, _skill_transaction
from .skill_evidence import inspect_skill_evidence, _collect, _derived_history, HISTORY_LIMITATIONS
from .skill_trust_storage import POLICY_VERSION, TrustIntegrityError, _guard_schema, _insert, _load, digest, snapshot
from .shadow_evaluation import _keys, _suite, _skill_anchor, _verify_anchor, _intent, _trial_report, LIMITATIONS


def _pinned_trial(connection, trial_id, result_sha256):
    report = _trial_report(connection, trial_id)
    if result_sha256 is None:
        report.update(result_id=None, result_sha256=None, outcome='TRIAL_OUTCOME_UNKNOWN', evaluation=None)
    elif report['result_sha256'] != result_sha256:
        raise TrustIntegrityError('Comparison references a changed Trial Result')
    return report


def _derive_comparison(connection, reference, candidate, suite_id, pairs):
    suite = _suite(connection, suite_id)
    refcard, _ = _skill_anchor(connection, reference)
    candidatecard, ancestry = _skill_anchor(connection, candidate)
    lineage = any((a['card']['skill_id'], a['card']['skill_version']) == (reference.skill_id, reference.skill_version) for a in ancestry[1:])
    capability_equal = set(refcard.allowed_tools) == set(candidatecard.allowed_tools)
    expected_cases = {c['case_id'] for c in suite.data['cases']}
    if type(pairs) is not list or {p.get('case_id') for p in pairs} != expected_cases or len(pairs) != len(expected_cases):
        raise TrustIntegrityError('Comparison must cover the exact closed suite once')
    seen, reports = set(), []
    for pair in sorted(pairs, key=lambda p: p['case_id']):
        _keys(pair, ('case_id', 'reference_trial_id', 'candidate_trial_id', 'reference_result_sha256', 'candidate_result_sha256'))
        a, b = [_pinned_trial(connection, pair[side + '_trial_id'], pair[side + '_result_sha256']) for side in ('reference', 'candidate')]
        ia, ib = [_intent(connection, r['trial_id']).data for r in (a, b)]
        for report, expected, state, intent in ((a, reference, 'TRUSTED', ia), (b, candidate, 'SHADOW', ib)):
            if (report['trial_id'] in seen or report['skill_ref'] != expected.to_dict() or report['suite_id'] != suite_id
                    or report['case_id'] != pair['case_id'] or intent['skill_anchor'][0]['history'][-1]['state'] != state):
                raise TrustIntegrityError('Comparison Trial belongs to a different case/Skill/state')
            seen.add(report['trial_id'])
        if any(ia[k] != ib[k] for k in ('suite_id', 'case_key', 'case_sha256', 'adapter_name', 'model_id', 'planning_parameters', 'evaluation_policy_version')):
            raise TrustIntegrityError('Paired evaluation conditions differ')
        catalogs = [_strict_json(i['request_json'], MAX_REQUEST_BYTES)['tool_catalog'] for i in (ia, ib)]
        comparable = lineage and capability_equal and catalogs[0] == catalogs[1]
        eligible = comparable and all(r['outcome'] in ('SIMULATED_PASS', 'SIMULATED_FAILURE') for r in (a, b))
        difference = 'INCOMPARABLE' if not comparable else 'INCOMPLETE'
        if eligible:
            difference = ('REGRESSION_OBSERVED' if a['outcome'] == 'SIMULATED_PASS' and b['outcome'] == 'SIMULATED_FAILURE' else
                          'IMPROVEMENT_OBSERVED' if a['outcome'] == 'SIMULATED_FAILURE' and b['outcome'] == 'SIMULATED_PASS' else 'TIE')
        reports.append({**pair, 'reference': a, 'candidate': b, 'eligible': eligible, 'observed_difference': difference})
    trials = [r[k] for r in reports for k in ('reference', 'candidate')]
    oracle_trials = [t for t in trials if t['outcome'] in ('SIMULATED_PASS', 'SIMULATED_FAILURE')]
    metrics = {'total_cases': len(reports), 'eligible_cases': sum(r['eligible'] for r in reports),
               'trial_count': len(trials), 'valid_plan_count': sum(bool(t['evaluation'] and t['evaluation']['plan_valid']) for t in trials),
               'oracle_trial_count': len(oracle_trials), 'oracle_verified_success_count': sum(t['outcome'] == 'SIMULATED_PASS' for t in oracle_trials),
               'paired_regression_count': sum(r['observed_difference'] == 'REGRESSION_OBSERVED' for r in reports),
               'paired_improvement_count': sum(r['observed_difference'] == 'IMPROVEMENT_OBSERVED' for r in reports),
               'paired_tie_count': sum(r['observed_difference'] == 'TIE' for r in reports),
               'incomparable_count': sum(r['observed_difference'] == 'INCOMPARABLE' for r in reports),
               'unknown_trial_count': sum(t['outcome'] == 'TRIAL_OUTCOME_UNKNOWN' for t in trials),
               'unsupported_trial_count': sum(t['outcome'] == 'UNSUPPORTED' for t in trials),
               'invalid_plan_count': sum(t['outcome'] == 'PLANNING_INVALID' for t in trials),
               'transport_failure_count': sum(t['outcome'] == 'PLANNING_TRANSPORT_FAILURE' for t in trials),
               'token_usage': None}
    metrics['valid_plan_rate'] = {'numerator': metrics['valid_plan_count'], 'denominator': len(trials)}
    metrics['oracle_verified_success_rate'] = {'numerator': metrics['oracle_verified_success_count'], 'denominator': len(oracle_trials)}
    return {'suite_sha256': suite.fact_sha256, 'lineage_verified': lineage, 'capabilities_equal': capability_equal,
            'pairs': reports, 'metrics': metrics, 'limitations': list(LIMITATIONS)}


def create_skill_comparison(connection, reference_skill_ref, candidate_skill_ref, suite_id, *, trial_pairs):
    """Publish explicit pairs for every case; never cherry-pick a passing Trial."""
    reference, candidate = _ref(reference_skill_ref), _ref(candidate_skill_ref)
    pairs = snapshot(trial_pairs)
    with _skill_transaction(connection):
        _guard_schema(connection)
        refcard, refanchor = _skill_anchor(connection, reference)
        card, anchor = _skill_anchor(connection, candidate)
        if refanchor[0]['history'][-1]['state'] != 'TRUSTED' or anchor[0]['history'][-1]['state'] != 'SHADOW':
            raise ValueError('Comparison requires TRUSTED reference and SHADOW candidate')
        pinned = []
        for pair in pairs:
            _keys(pair, ('case_id', 'reference_trial_id', 'candidate_trial_id'))
            pinned.append({**pair, **{side + '_result_sha256': _trial_report(connection, pair[side + '_trial_id'])['result_sha256'] for side in ('reference', 'candidate')}})
        value = {'schema_version': 1, 'comparison_id': 'comparison_' + uuid4().hex, 'suite_id': suite_id,
                 **candidate.to_dict(), 'reference_skill_ref': reference.to_dict(), 'candidate_card_sha256': digest(card.to_dict()),
                 'reference_card_sha256': digest(refcard.to_dict()), 'skill_anchor': anchor, 'reference_anchor': refanchor,
                 'trial_pairs': pinned, 'evaluation_policy_version': POLICY_VERSION, 'created_at': utc_now(),
                 'evaluation': _derive_comparison(connection, reference, candidate, suite_id, pinned)}
        fact = _insert(connection, 'skill_comparisons', value)
        _comparison(connection, value['comparison_id'])
    return fact


def _comparison(connection, comparison_id):
    fact = _load(connection, 'skill_comparisons', comparison_id)
    d = fact.data
    _keys(d, ('schema_version', 'comparison_id', 'suite_id', 'skill_id', 'skill_version', 'reference_skill_ref', 'candidate_card_sha256',
              'reference_card_sha256', 'skill_anchor', 'reference_anchor', 'trial_pairs', 'evaluation_policy_version', 'created_at', 'evaluation'))
    card, reference = _verify_anchor(connection, d['skill_anchor']), _verify_anchor(connection, d['reference_anchor'])
    candidate_ref = SkillRef(d['skill_id'], d['skill_version'])
    if (card.ref != candidate_ref or reference.ref.to_dict() != d['reference_skill_ref']
            or digest(card.to_dict()) != d['candidate_card_sha256'] or digest(reference.to_dict()) != d['reference_card_sha256']
            or d['evaluation_policy_version'] != POLICY_VERSION
            or _derive_comparison(connection, reference.ref, candidate_ref, d['suite_id'], d['trial_pairs']) != d['evaluation']):
        raise TrustIntegrityError('Comparison semantic identity mismatch')
    return fact


def _recommendation(history, comparison):
    if history['integrity_issues']:
        return 'INTEGRITY_BLOCKED'
    metrics = comparison['evaluation']['metrics'] if comparison else None
    if metrics:
        if metrics['paired_regression_count']:
            return 'REGRESSION_OBSERVED'
        if metrics['incomparable_count']:
            return 'INCOMPARABLE'
        if metrics['unknown_trial_count'] or metrics['unsupported_trial_count'] or metrics['invalid_plan_count'] or metrics['transport_failure_count']:
            return 'REVIEW_REQUIRED'
        if metrics['eligible_cases']:
            return 'NO_REGRESSION_OBSERVED'
    if any(r['observed_outcome'] != 'VERIFIED_TASK_SUCCESS' for r in history['runs']):
        return 'REVIEW_REQUIRED'
    return 'INSUFFICIENT_EVIDENCE'


def create_trust_assessment(connection, skill_ref, evidence_refs=None, comparison_id=None):
    """Publish a recommendation plus its complete evidence manifest atomically.

    evidence_refs is None (all eligible Runs), an explicit list of Run IDs,
    or an unchanged report from inspect_skill_evidence(). No causal blame API.
    """
    _check_write_context(connection)
    ref = _ref(skill_ref)
    if type(evidence_refs) is dict:
        history = snapshot(evidence_refs)
        if history.get('skill_ref') != ref.to_dict():
            raise TrustIntegrityError('Historical evidence belongs to a different SkillRef')
        verified = inspect_skill_evidence(connection, ref, run_ids=history['source_snapshot']['selected_run_ids'])
        if verified != history:
            raise TrustIntegrityError('Supplied evidence is stale or altered')
    else:
        history = inspect_skill_evidence(connection, ref, run_ids=evidence_refs)
    if history['integrity_issues']:
        raise TrustIntegrityError('Corrupted historical evidence blocks publication')
    with _skill_transaction(connection):
        _guard_schema(connection)
        if _collect(connection, ref, history['source_snapshot']['selected_run_ids']) != history['source_snapshot']:
            raise TrustIntegrityError('Historical evidence changed before publication')
        comparison = _comparison(connection, comparison_id) if comparison_id is not None else None
        if comparison and (comparison.data['skill_id'], comparison.data['skill_version']) != (ref.skill_id, ref.skill_version):
            raise TrustIntegrityError('Foreign comparison cannot support this Skill version')
        aid = 'trust_' + uuid4().hex
        refs = [{'schema_version': 1, 'ref_id': aid + '_' + str(n), 'assessment_id': aid, 'ordinal': n,
                 **ref.to_dict(), 'run_id': run['run_id'], 'comparison_id': None,
                 'evidence_sha256': run['source_evidence_sha256']} for n, run in enumerate(history['runs'])]
        if comparison:
            refs.append({'schema_version': 1, 'ref_id': aid + '_' + str(len(refs)), 'assessment_id': aid, 'ordinal': len(refs),
                         **ref.to_dict(), 'run_id': None, 'comparison_id': comparison_id, 'evidence_sha256': comparison.fact_sha256})
        value = {'schema_version': 1, 'assessment_id': aid, **ref.to_dict(), 'comparison_id': comparison_id,
                 'comparison_sha256': comparison.fact_sha256 if comparison else None,
                 'history': history, 'evidence_refs': refs, 'evaluation_policy_version': POLICY_VERSION,
                 'recommendation': _recommendation(history, comparison.data if comparison else None),
                 'created_at': utc_now(), 'limitations': list(dict.fromkeys(HISTORY_LIMITATIONS + LIMITATIONS))}
        fact = _insert(connection, 'skill_trust_assessments', value)
        for reference in refs:
            _insert(connection, 'skill_trust_evidence_refs', reference)
        _assessment_fact(connection, aid)
    return fact


def _preserved(old, current):
    """Old facts remain a prefix/subset; only Run terminal progress is mutable."""
    if type(old) is not type(current):
        return False
    if type(old) is dict:
        if 'run_id' in old and 'task_spec_json' in old and old.get('status') == 'RUNNING':
            old = {k: v for k, v in old.items() if k not in ('status', 'ended_at')}
        return old.keys() <= current.keys() and all(
            current[k][:len(v)] == v if k in ('events', 'history', 'states') and type(v) is list
            else _preserved(v, current[k]) for k, v in old.items())
    if type(old) is list:
        # Binding rows are sorted by random call ID; legal append can insert
        # between existing items. Each previous immutable item must remain.
        remaining = list(current)
        for item in old:
            found = next((i for i, v in enumerate(remaining) if _preserved(item, v)), None)
            if found is None:
                return False
            remaining.pop(found)
        return True
    return old == current


def _assessment_fact(connection, assessment_id):
    fact = _load(connection, 'skill_trust_assessments', assessment_id)
    d = fact.data
    _keys(d, ('schema_version', 'assessment_id', 'skill_id', 'skill_version', 'comparison_id', 'comparison_sha256',
              'history', 'evidence_refs', 'evaluation_policy_version', 'recommendation', 'created_at', 'limitations'))
    ref = SkillRef(d['skill_id'], d['skill_version'])
    history = d['history']
    card = _verify_anchor(connection, history['source_snapshot']['skill_anchor'])
    if history['skill_ref'] != ref.to_dict() or history['source_snapshot']['skill_ref'] != ref.to_dict():
        raise TrustIntegrityError('Assessment contains cross-version evidence')
    if card.ref != ref or digest(card.to_dict()) != history['source_snapshot']['card_sha256']:
        raise TrustIntegrityError('Historical Skill anchor identity mismatch')
    current = _collect(connection, ref, None)
    if not _preserved(history['source_snapshot'], current) or digest(history['source_snapshot']) != history['source_evidence_sha256']:
        raise TrustIntegrityError('Historical assessment anchors no longer match')
    if _derived_history(history['source_snapshot']) != history:
        raise TrustIntegrityError('Historical classification/denominators disagree with anchored facts')
    comparison = _comparison(connection, d['comparison_id']) if d['comparison_id'] else None
    if comparison is None and d['comparison_sha256'] is not None:
        raise TrustIntegrityError('Nonapplicable comparison digest must be null')
    if comparison and ((comparison.data['skill_id'], comparison.data['skill_version']) != (ref.skill_id, ref.skill_version)
                       or comparison.fact_sha256 != d['comparison_sha256']):
        raise TrustIntegrityError('Assessment comparison identity mismatch')
    rows = _rows(connection, 'SELECT ref_id FROM main.skill_trust_evidence_refs WHERE assessment_id=? ORDER BY ordinal', (assessment_id,))
    actual = [_load(connection, 'skill_trust_evidence_refs', r[0]).data for r in rows]
    expected = [{'schema_version': 1, 'ref_id': assessment_id + '_' + str(n), 'assessment_id': assessment_id, 'ordinal': n,
                 **ref.to_dict(), 'run_id': r['run_id'], 'comparison_id': None, 'evidence_sha256': r['source_evidence_sha256']}
                for n, r in enumerate(history['runs'])]
    if comparison:
        n = len(expected)
        expected.append({'schema_version': 1, 'ref_id': assessment_id + '_' + str(n), 'assessment_id': assessment_id, 'ordinal': n,
                         **ref.to_dict(), 'run_id': None, 'comparison_id': d['comparison_id'], 'evidence_sha256': comparison.fact_sha256})
    if (actual != d['evidence_refs'] or actual != expected or d['evaluation_policy_version'] != POLICY_VERSION
            or d['limitations'] != list(dict.fromkeys(HISTORY_LIMITATIONS + LIMITATIONS))
            or _recommendation(history, comparison.data if comparison else None) != d['recommendation']):
        raise TrustIntegrityError('Assessment manifest or recommendation mismatch')
    return fact


def get_trust_assessment(connection, assessment_id):
    if connection.in_transaction:
        raise ValueError('Trust inspection rejects an active caller transaction')
    with _read_snapshot(connection):
        _guard_schema(connection)
        initial = _load(connection, 'skill_trust_assessments', assessment_id)
    d = initial.data
    ref = SkillRef(d['skill_id'], d['skill_version'])
    current = inspect_skill_evidence(connection, ref)
    if current['integrity_issues']:
        raise TrustIntegrityError('Current execution evidence is inconsistent')
    with _read_snapshot(connection):
        _guard_schema(connection)
        if _collect(connection, ref, None) != current['source_snapshot']:
            raise TrustIntegrityError('Evidence changed during assessment inspection')
        fact = _assessment_fact(connection, assessment_id)
        if fact != initial:
            raise TrustIntegrityError('Assessment changed during inspection')
        return fact


def inspect_skill_trust(connection, skill_ref, *, assessment_id=None):
    """JSON-native read-only inspection; corruption blocks, never repairs."""
    if connection.in_transaction:
        raise ValueError('Trust inspection rejects an active caller transaction')
    ref = _ref(skill_ref)
    report = {'schema_version': 1, 'skill_ref': ref.to_dict(), 'assessment_id': assessment_id,
              'recommendation': 'INSUFFICIENT_EVIDENCE', 'integrity_issues': [], 'freshness': 'CURRENT',
              'historical_denominators': None, 'comparison_metrics': None, 'limitations': list(LIMITATIONS)}
    try:
        current_history = inspect_skill_evidence(connection, ref)
        if current_history['integrity_issues']:
            raise TrustIntegrityError('Current execution evidence is inconsistent')
        with _read_snapshot(connection):
            _guard_schema(connection)
            if _collect(connection, ref, None) != current_history['source_snapshot']:
                raise TrustIntegrityError('Evidence changed during Trust inspection')
            _skill_anchor(connection, ref)
            if assessment_id is None:
                rows = _rows(connection, 'SELECT assessment_id FROM main.skill_trust_assessments WHERE skill_id=? AND skill_version=? ORDER BY json_extract(fact_json,\'$.created_at\'),assessment_id', (ref.skill_id, ref.skill_version))
                assessment_id = rows[-1][0] if rows else None
            if assessment_id is not None:
                fact = _assessment_fact(connection, assessment_id)
                d = fact.data
                if (d['skill_id'], d['skill_version']) != (ref.skill_id, ref.skill_version):
                    raise TrustIntegrityError('Assessment belongs to another exact SkillRef')
                comparison = _comparison(connection, d['comparison_id']) if d['comparison_id'] else None
                report.update(assessment_id=assessment_id, assessment_sha256=fact.fact_sha256, recommendation=d['recommendation'],
                              historical_denominators=d['history']['denominators'],
                              comparison_metrics=comparison.data['evaluation']['metrics'] if comparison else None,
                              freshness='CURRENT' if _collect(connection, ref, None) == d['history']['source_snapshot'] else 'NEW_EVIDENCE_AVAILABLE',
                              evidence_refs=d['evidence_refs'])
    except (ValueError, TypeError, KeyError, RuntimeError) as error:
        report.update(recommendation='INTEGRITY_BLOCKED', integrity_issues=[{'code': 'TRUST_EVIDENCE_INVALID', 'message': str(error)}])
    return report

"""Conservative evidence adjudication v2; legacy v1 bytes stay reproducible.

This adds provenance context and full-output audit disputes, not semantic NLI,
human authentication, automatic adoption or a claim of calibrated accuracy.
"""
import hashlib
from pathlib import Path
import json

from .hashing import canonical_json_bytes
from . import minutes_quality as legacy

EVALUATOR_ID = 'minutes-quality-ledger-v2'


def digest(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def adjudicate_minutes(initial_files, final_files, reference, *, expected_reference_sha256,
                       candidate_author, context, expected_context_sha256, reviews=(), reference_review=None):
    """Context is frozen separately; declarations are not independently verified.

    Source standards disputed by a human can block a recorded pass. Corrections
    need a new reference and new reviews; this API never edits historical facts.
    """
    context = json.loads(canonical_json_bytes(context))
    legacy._keys(context, ('reference_sha256', 'reference_timing', 'reference_validity',
                           'reviewer_declarations'))
    if (digest(context) != expected_context_sha256 or context['reference_sha256'] != reference.sha256
            or context['reference_timing'] not in ('PRE_OUTPUT', 'POSTHOC', 'UNKNOWN')
            or context['reference_validity'] not in ('PENDING', 'CONFIRMED', 'DISPUTED')):
        raise ValueError('Pinned evaluation context differs')
    declarations = context['reviewer_declarations']
    if type(declarations) is not list or len(declarations) > 8:
        raise ValueError('Bounded reviewer declarations required')
    by_id = {}
    for declaration in declarations:
        legacy._keys(declaration, ('reviewer_id', 'independence_group', 'version_blind', 'prior_exposure'))
        for field in ('reviewer_id', 'independence_group'):
            legacy._text(declaration[field])
        if (declaration['reviewer_id'] in by_id or type(declaration['version_blind']) is not bool
                or declaration['prior_exposure'] not in ('YES', 'NO', 'UNKNOWN')):
            raise ValueError('Invalid or duplicate reviewer declaration')
        by_id[declaration['reviewer_id']] = declaration
    if set(by_id) != {r['reviewer_id'] for r in reviews}:
        raise ValueError('Every review needs its exact provenance declaration')
    result = legacy.evaluate_minutes(initial_files, final_files, reference,
        expected_reference_sha256=expected_reference_sha256, candidate_author=candidate_author,
        reviews=reviews, reference_review=reference_review)
    old = result['report']
    audit_votes = [r['unsupported_claims'] for r in old['reviews']]
    # A CLEAR and an ISSUES vote (or different issue sets) cannot be consensus.
    # Reason wording alone does not create a disagreement.
    signatures = {digest({'status': a['status'], 'issues': sorted(
        [{'severity': i['severity'], 'output_span': i['output_span']} for i in a['issues']], key=digest)})
        for a in audit_votes}
    audit_disputed = len(signatures) > 1
    concerns = []
    if context['reference_timing'] != 'PRE_OUTPUT':
        concerns.append('REFERENCE_NOT_PROSPECTIVE')
    if context['reference_validity'] != 'CONFIRMED':
        concerns.append('REFERENCE_'+context['reference_validity'])
    if any(not d['version_blind'] or d['prior_exposure'] != 'NO' for d in declarations):
        concerns.append('BLINDNESS_OR_EXPOSURE_LIMITATION')
    if len({d['independence_group'] for d in declarations}) < len(declarations):
        concerns.append('DECLARED_CORRELATED_REVIEWERS')
    if audit_disputed:
        concerns.append('FULL_OUTPUT_AUDIT_DISPUTED')
    disposition = old['disposition']
    if old['artifact']['status'] != 'FAIL':
        if context['reference_validity'] == 'DISPUTED':
            disposition = 'REFERENCE_DISPUTED'
        elif audit_disputed or old['disputes']:
            disposition = 'DISPUTED'
        elif disposition == 'HUMAN_SUPPORTED_FOR_DECISION':
            # Even declared human consensus is a measurement, not authentication.
            disposition = 'NO_FAILURE_REPORTED_WITH_DECLARED_HUMAN_REVIEWS'
    report = {'schema_version': 2, 'evaluator_id': EVALUATOR_ID,
        'evaluator_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'dependency_source_sha256': hashlib.sha256(Path(legacy.__file__).read_bytes()).hexdigest(),
        'legacy_report': result, 'context': context, 'context_sha256': digest(context),
        'disposition': disposition, 'evidence_concerns': concerns,
        'full_output_audit_disputed': audit_disputed,
        'semantic_truth': 'NOT_ESTABLISHED_BY_SOFTWARE', 'human_calibration': 'PENDING',
        'quality_improved': 'NOT_INFERRED', 'adoption_authorized': False,
        'historical_evidence': 'UNCHANGED'}
    return {'report': report, 'report_sha256': digest(report)}

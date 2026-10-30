"""Versioned, offline minutes adjudication; never a Core validator or promotion.

Only artifact checks, identities, evidence locations and adjudication mechanics
are deterministic. Semantic judgments are attributed to their reviewers. A
matching quote does NOT prove entailment, completeness or reviewer independence.
"""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from .hashing import canonical_json_bytes

EVALUATOR_ID = 'minutes-quality-ledger-v1'
DIMENSIONS = ('ACTION_RECALL', 'OWNER', 'DEADLINE', 'DECISION_STATUS',
              'BUSINESS_FACT', 'UNCERTAINTY', 'POLICY')
INPUT_PATHS = {'meeting.md', 'organization-policy.md'}
MAX_BYTES = 64 * 1024


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _keys(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise ValueError('Unexpected quality evidence fields')


def _text(value):
    if type(value) is not str or not value.strip() or len(value.encode('utf-8')) > MAX_BYTES or '\x00' in value:
        raise ValueError('Nonempty bounded evidence text required')


def _files(value):
    if (type(value) is not dict or len(value) > 8
            or any(type(k) is not str or type(v) is not bytes or len(v) > MAX_BYTES for k, v in value.items())):
        raise ValueError('Bounded byte files required')
    return {k: {'sha256': _sha(v), 'bytes': len(v)} for k, v in sorted(value.items())}


def _inputs(value):
    manifest = _files(value)
    if set(value) != INPUT_PATHS:
        raise ValueError('Exactly the frozen meeting and organization policy are required')
    for raw in value.values():
        _text(raw.decode('utf-8', errors='strict'))
    return manifest


def _span(value, texts):
    """Offsets count Unicode codepoints, never UTF-8 bytes or line numbers."""
    _keys(value, ('path', 'start', 'end', 'quote'))
    path, start, end, quote = (value[k] for k in ('path', 'start', 'end', 'quote'))
    if (type(path) is not str or path not in texts or type(start) is not int or type(end) is not int
            or not 0 <= start < end <= len(texts[path])):
        raise ValueError('Invalid evidence span')
    _text(quote)
    if texts[path][start:end] != quote:
        raise ValueError('Evidence quote does not match the pinned artifact')


@dataclass(frozen=True)
class MinutesReference:
    canonical: bytes

    @property
    def sha256(self):
        return _sha(self.canonical)

    @property
    def data(self):
        return json.loads(self.canonical)


def prepare_reference(case_id, initial_files, criteria):
    """Call BEFORE viewing candidate outputs. Output cannot enter this API.

    Reference authorship/approval and the temporal ordering need an external
    append-only audit. The digest is an identity, not a signature or freeze lock.
    """
    _text(case_id)
    manifest = _inputs(initial_files)
    texts = {k: v.decode('utf-8') for k, v in initial_files.items()}
    criteria = json.loads(canonical_json_bytes(criteria))
    if type(criteria) is not list or not 1 <= len(criteria) <= 256:
        raise ValueError('A bounded, predeclared atomic checklist is required')
    identifiers = set()
    for item in criteria:
        _keys(item, ('id', 'dimension', 'critical', 'obligation', 'source_spans'))
        _text(item['id'])
        _text(item['obligation'])
        if (item['id'] in identifiers or item['dimension'] not in DIMENSIONS
                or type(item['critical']) is not bool or type(item['source_spans']) is not list
                or not 1 <= len(item['source_spans']) <= 16):
            raise ValueError('Invalid or duplicate atomic criterion')
        identifiers.add(item['id'])
        for span in item['source_spans']:
            _span(span, texts)
    if {item['dimension'] for item in criteria} != set(DIMENSIONS):
        raise ValueError('All seven dimensions need predeclared applicable criteria')
    return MinutesReference(canonical_json_bytes({'schema_version': 1,
        'evaluator_id': EVALUATOR_ID, 'case_id': case_id, 'source_manifest': manifest,
        'criteria': sorted(criteria, key=lambda c: c['id'])}))


def _reference(reference, initial_files, expected_sha256):
    if type(reference) is not MinutesReference or reference.sha256 != expected_sha256:
        raise ValueError('Reference differs from the independently pinned identity')
    value = reference.data
    _keys(value, ('schema_version', 'evaluator_id', 'case_id', 'source_manifest', 'criteria'))
    rebuilt = prepare_reference(value['case_id'], initial_files, value['criteria'])
    if rebuilt.canonical != reference.canonical:
        raise ValueError('Reference source or protocol changed')
    return value


def inspect_artifact(initial_files, final_files):
    """Execution-shaped observations only; no claim of real Runner execution."""
    _inputs(initial_files)
    manifest = _files(final_files)
    raw = final_files.get('minutes.md')
    problems = []
    if set(final_files) != INPUT_PATHS | {'minutes.md'}:
        problems.append('OUTPUT_SET_MISMATCH')
    if any(final_files.get(p) != raw_input for p, raw_input in initial_files.items()):
        problems.append('INPUT_CHANGED_OR_MISSING')
    try:
        if raw is None or not raw.decode('utf-8', errors='strict').strip():
            problems.append('EMPTY_OR_MISSING_MINUTES')
        elif '\x00' in raw.decode('utf-8'):
            problems.append('NUL_IN_MINUTES')
    except UnicodeError:
        problems.append('INVALID_UTF8')
    return {'status': 'FAIL' if problems else 'PASS', 'problems': problems,
            'manifest': manifest, 'core_acceptance': 'NOT_INFERRED', 'real_execution': 'NOT_INFERRED'}


def _review(value, reference, output, candidate_author):
    _keys(value, ('reviewer_id', 'kind', 'context_id', 'candidate_author', 'reference_sha256',
                  'output_sha256', 'findings', 'unsupported_claims', 'subjective'))
    for field in ('reviewer_id', 'context_id', 'candidate_author'):
        _text(value[field])
    if (value['kind'] not in ('HUMAN', 'LLM', 'SYNTHETIC_TEST')
            or value['reviewer_id'] == candidate_author or value['candidate_author'] != candidate_author
            or value['reference_sha256'] != reference.sha256 or value['output_sha256'] != _sha(output)):
        raise ValueError('Review provenance or independence declaration differs')
    texts = {'minutes.md': output.decode('utf-8', errors='strict')}
    criteria = {c['id']: c for c in reference.data['criteria']}
    if type(value['findings']) is not list or len(value['findings']) != len(criteria):
        raise ValueError('Every predeclared criterion must retain its denominator')
    seen = set()
    for finding in value['findings']:
        _keys(finding, ('criterion_id', 'verdict', 'output_spans', 'reason'))
        identifier, verdict = finding['criterion_id'], finding['verdict']
        if (type(identifier) is not str or identifier not in criteria or identifier in seen
                or verdict not in ('PASS', 'FAIL', 'MISSING', 'UNKNOWN')):
            raise ValueError('Invalid, duplicate or unplanned finding')
        seen.add(identifier)
        _text(finding['reason'])
        spans = finding['output_spans']
        if type(spans) is not list or len(spans) > 16 or verdict in ('PASS', 'FAIL') and not spans or verdict == 'MISSING' and spans:
            raise ValueError('Passes require located evidence; omissions use no fabricated span')
        for span in spans:
            _span(span, texts)
    audit = value['unsupported_claims']
    _keys(audit, ('status', 'issues', 'reason'))
    _text(audit['reason'])
    if audit['status'] not in ('CLEAR', 'ISSUES', 'UNKNOWN') or type(audit['issues']) is not list or len(audit['issues']) > 256:
        raise ValueError('Full-output unsupported-claim audit is required')
    if (audit['status'] == 'ISSUES') != bool(audit['issues']):
        raise ValueError('Unsupported-claim audit and issue list differ')
    for issue in audit['issues']:
        _keys(issue, ('severity', 'output_span', 'reason'))
        if issue['severity'] not in ('MAJOR', 'MINOR', 'UNKNOWN'):
            raise ValueError('Invalid unsupported-claim severity')
        _text(issue['reason'])
        _span(issue['output_span'], texts)
    if (type(value['subjective']) is not dict
            or set(value['subjective']) - {'readability', 'usefulness'}
            or any(type(v) is not int or not 0 <= v <= 3 for v in value['subjective'].values())):
        raise ValueError('Subjective ratings stay separate, bounded and optional')
    return value


def evaluate_minutes(initial_files, final_files, reference, *, expected_reference_sha256,
                     candidate_author, reviews=(), reference_review=None):
    """Adjudicate located reviews without inventing semantic or human evidence.

    reference_review is an externally retained human attestation (reviewer_id,
    reference_sha256, record_sha256). This library checks the declaration, not a
    human identity or the record's authenticity. Absent attestation stays pending.
    Conflicting verdicts remain UNKNOWN; a later favorable review cannot erase
    an earlier failure. Subjective scores never enter the disposition.
    """
    _text(candidate_author)
    value = _reference(reference, initial_files, expected_reference_sha256)
    artifact = inspect_artifact(initial_files, final_files)
    reference_status = 'PENDING'
    if reference_review is not None:
        reference_review = json.loads(canonical_json_bytes(reference_review))
        _keys(reference_review, ('reviewer_id', 'reference_sha256', 'record_sha256'))
        _text(reference_review['reviewer_id'])
        record_sha = reference_review['record_sha256']
        if (reference_review['reference_sha256'] != reference.sha256
                or reference_review['reviewer_id'] == candidate_author
                or type(record_sha) is not str or len(record_sha) != 64
                or any(c not in '0123456789abcdef' for c in record_sha)):
            raise ValueError('Reference attestation identity differs')
        reference_status = 'HUMAN_ATTESTED_NOT_AUTHENTICATED'
    if type(reviews) not in (list, tuple) or len(reviews) > 8:
        raise ValueError('Bounded independent reviews required')
    # Freeze a detached snapshot; caller mutation cannot rewrite the report.
    reviews = json.loads(canonical_json_bytes(list(reviews)))
    if reviews and artifact['status'] != 'PASS':
        raise ValueError('Invalid artifacts cannot carry a semantic pass review')
    for review in reviews:
        _review(review, reference, final_files['minutes.md'], candidate_author)
    if len({r['reviewer_id'] for r in reviews}) != len(reviews) or len({r['context_id'] for r in reviews}) != len(reviews):
        raise ValueError('Duplicate reviewer or context is not independent evidence')
    per_dimension = {d: {'PASS': 0, 'FAIL': 0, 'UNKNOWN': 0, 'denominator': 0} for d in DIMENSIONS}
    findings, critical_failures, disputes = [], [], []
    maps = [{f['criterion_id']: f for f in r['findings']} for r in reviews]
    for criterion in value['criteria']:
        votes = [m[criterion['id']]['verdict'] for m in maps]
        normalized = {'FAIL' if v == 'MISSING' else v for v in votes}
        verdict = next(iter(normalized)) if len(normalized) == 1 else 'UNKNOWN'
        if len(normalized) > 1:
            disputes.append(criterion['id'])
        if criterion['critical'] and 'FAIL' in normalized:
            critical_failures.append(criterion['id'])
        counts = per_dimension[criterion['dimension']]
        counts['denominator'] += 1
        counts[verdict] += 1
        findings.append({'criterion_id': criterion['id'], 'verdict': verdict, 'votes': votes})
    audits = [r['unsupported_claims'] for r in reviews]
    major_claims = sum(i['severity'] == 'MAJOR' for a in audits for i in a['issues'])
    any_claims = any(i['severity'] in ('MAJOR', 'MINOR') for a in audits for i in a['issues'])
    unresolved = (any(f['verdict'] == 'UNKNOWN' for f in findings) or not audits
                  or any(a['status'] == 'UNKNOWN' for a in audits)
                  or any(i['severity'] == 'UNKNOWN' for a in audits for i in a['issues']))
    failed = any(f['verdict'] == 'FAIL' for f in findings) or any_claims
    if artifact['status'] == 'FAIL':
        disposition = 'INVALID_ARTIFACT'
    elif disputes:
        disposition = 'DISPUTED'
    elif critical_failures or major_claims:
        disposition = 'REPORTED_MAJOR_FAILURE'
    elif failed:
        disposition = 'REPORTED_CRITERIA_FAILURE'
    elif unresolved:
        disposition = 'INSUFFICIENT_EVIDENCE'
    elif reference_review is not None and reviews and all(r['kind'] == 'HUMAN' for r in reviews):
        disposition = 'HUMAN_SUPPORTED_FOR_DECISION'
    else:
        disposition = 'PROVISIONAL_NO_FAILURE_REPORTED'
    report = {'schema_version': 1, 'evaluator_id': EVALUATOR_ID,
        'evaluator_source_sha256': _sha(Path(__file__).read_bytes()),
        'case_id': value['case_id'], 'reference_sha256': reference.sha256,
        'reference_status': reference_status, 'reference_review': reference_review,
        'candidate_author': candidate_author, 'artifact': artifact, 'findings': findings,
        'dimensions': per_dimension, 'critical_failure_ids': critical_failures,
        'major_claim_reports': major_claims, 'disputes': disputes, 'reviews': reviews,
        'disposition': disposition, 'quality_improved': 'NOT_INFERRED',
        'adoption_authorized': False, 'historical_gate': 'NOT_CHANGED',
        'limitations': ['Semantic judgments, missing claims and applicability require independent review.',
                        'Span matching verifies location, not semantic entailment or review completeness.',
                        'Reviewer identity, human attestations and temporal freezing are external trust assumptions.']}
    # The hash covers the exact complete report, with no self-referential field.
    return {'report': report, 'report_sha256': _sha(canonical_json_bytes(report))}

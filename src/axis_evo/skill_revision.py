"""Verified historical cases and explicitly approved, deterministic revisions."""

from uuid import uuid4

from .events import utc_now
from .hashing import canonical_json_bytes
from .shadow_evaluation import _skill_anchor, _verify_anchor
from .skill_binding import _read_snapshot
from .skill_card import SkillCard, SkillRef, SkillSource
from .skill_evidence import inspect_skill_evidence, _collect
from .skill_manager import SkillManager
from .skill_storage import _check_write_context, _skill_transaction
from .skill_trust import get_trust_assessment, _assessment_fact
from .skill_evolution_storage import (
    EvolutionError, EvolutionIntegrityError, MAX_REVISION_BYTES,
    _guard_schema, _load, _insert, _keys, _text, _approval, _approve, _present,
    digest, snapshot,
)


DRAFT_FIELDS = ('name', 'description', 'instructions', 'allowed_tools', 'change_summary',
                'reason_codes', 'supporting_evidence_ids', 'declared_risks', 'expected_behavior_change')


def _ref(value):
    if type(value) is not SkillRef:
        raise EvolutionError('An exact SkillRef is required')
    return value


def _from_ref(value):
    _keys(value, ('skill_id', 'skill_version'))
    return SkillRef(**value)


def create_evolution_case(connection, source_skill_ref, evidence_refs, objective):
    """Record verified context; neither failure nor UNKNOWN proves Skill fault."""
    _check_write_context(connection)
    ref = _ref(source_skill_ref)
    refs = snapshot(evidence_refs)
    _keys(refs, ('assessment_id',))
    objective = _text(objective)
    assessment = get_trust_assessment(connection, refs['assessment_id'])
    history = inspect_skill_evidence(connection, ref)
    if history['integrity_issues']:
        raise EvolutionIntegrityError('Source execution evidence is inconsistent')
    with _skill_transaction(connection):
        _guard_schema(connection)
        verified = _assessment_fact(connection, refs['assessment_id'])
        card, anchor = _skill_anchor(connection, ref)
        if (verified != assessment or assessment.data['history'] != history
                or history['source_snapshot'] != _collect(connection, ref, None)):
            raise EvolutionError('STALE: source Assessment must cover all current historical evidence')
        if anchor[0]['history'][-1]['state'] != 'TRUSTED':
            raise EvolutionError('An evolution case requires an exact TRUSTED source')
        value = {'schema_version': 1, 'case_id': 'evolution_' + uuid4().hex, **ref.to_dict(),
                 'parent_card_sha256': digest(card.to_dict()), 'parent_anchor': anchor,
                 'source_assessment_id': refs['assessment_id'], 'source_assessment_sha256': verified.fact_sha256,
                 'source_evidence_sha256': history['source_evidence_sha256'],
                 'supporting_evidence_ids': [refs['assessment_id']] + history['source_snapshot']['selected_run_ids'],
                 'objective': objective, 'attribution': 'INDETERMINATE', 'created_at': utc_now()}
        fact = _insert(connection, 'evolution_cases', value)
        _case(connection, value['case_id'])
    return fact


def _case(connection, case_id):
    fact = _load(connection, 'evolution_cases', case_id)
    d = fact.data
    _keys(d, ('schema_version', 'case_id', 'skill_id', 'skill_version', 'parent_card_sha256', 'parent_anchor',
              'source_assessment_id', 'source_assessment_sha256', 'source_evidence_sha256',
              'supporting_evidence_ids', 'objective', 'attribution', 'created_at'))
    ref = SkillRef(d['skill_id'], d['skill_version'])
    card = _verify_anchor(connection, d['parent_anchor'])
    a = _assessment_fact(connection, d['source_assessment_id'])
    if (card.ref != ref or digest(card.to_dict()) != d['parent_card_sha256']
            or a.fact_sha256 != d['source_assessment_sha256']
            or (a.data['skill_id'], a.data['skill_version']) != (ref.skill_id, ref.skill_version)
            or a.data['history']['source_evidence_sha256'] != d['source_evidence_sha256']
            or d['supporting_evidence_ids'] != [d['source_assessment_id']] + a.data['history']['source_snapshot']['selected_run_ids']
            or d['attribution'] != 'INDETERMINATE' or d['parent_anchor'][0]['history'][-1]['state'] != 'TRUSTED'):
        raise EvolutionIntegrityError('Evolution case evidence/parent mismatch')
    _text(d['objective'])
    _text(d['created_at'])
    return fact


def _draft(value, case):
    value = snapshot(value)
    _keys(value, DRAFT_FIELDS)
    if len(canonical_json_bytes(value)) > MAX_REVISION_BYTES:
        raise EvolutionError('Revision exceeds the 64 KiB bound')
    parent = SkillRef(case['skill_id'], case['skill_version'])
    SkillCard(parent.skill_id, 1, value['name'], value['description'], value['instructions'],
              value['allowed_tools'], SkillSource('DERIVED', parent))
    for key in ('name', 'instructions', 'change_summary', 'expected_behavior_change'):
        _text(value[key])
    if len(value['description'].encode('utf-8')) > 32768:
        raise EvolutionError('Description exceeds limit')
    for key in ('reason_codes', 'supporting_evidence_ids', 'declared_risks'):
        items = value[key]
        if type(items) is not list or len(items) > 64 or any(type(v) is not str for v in items):
            raise EvolutionError('Revision list must contain bounded exact strings')
        for item in items:
            _text(item)
    if not value['reason_codes'] or not value['supporting_evidence_ids']:
        raise EvolutionError('Revision requires reasons and verified supporting evidence')
    if not set(value['supporting_evidence_ids']) <= set(case['supporting_evidence_ids']):
        raise EvolutionError('Revision references evidence outside its case')
    return value


def reserve_revision_intent(connection, evolution_case_id, revision_source):
    """Commit exact caller draft input separately from its accepted proposal."""
    _check_write_context(connection)
    source = snapshot(revision_source)
    with _skill_transaction(connection):
        _guard_schema(connection)
        case = _case(connection, evolution_case_id)
        draft = _draft(source, case.data)
        value = {'schema_version': 1, 'revision_id': 'revision_' + uuid4().hex, 'case_id': evolution_case_id,
                 'case_sha256': case.fact_sha256, 'draft_origin': 'CALLER', 'adapter_identity': None,
                 'model_identity': None, 'submitted_draft': draft, 'submitted_draft_sha256': digest(draft),
                 'created_at': utc_now()}
        fact = _insert(connection, 'skill_revision_intents', value)
        _intent(connection, value['revision_id'])
    return fact


def _intent(connection, revision_id):
    fact = _load(connection, 'skill_revision_intents', revision_id)
    d = fact.data
    _keys(d, ('schema_version', 'revision_id', 'case_id', 'case_sha256', 'draft_origin', 'adapter_identity',
              'model_identity', 'submitted_draft', 'submitted_draft_sha256', 'created_at'))
    case = _case(connection, d['case_id'])
    if (case.fact_sha256 != d['case_sha256'] or d['draft_origin'] != 'CALLER'
            or d['adapter_identity'] is not None or d['model_identity'] is not None
            or digest(_draft(d['submitted_draft'], case.data)) != d['submitted_draft_sha256']):
        raise EvolutionIntegrityError('Revision intent identity or draft digest mismatch')
    _text(d['created_at'])
    return fact


def _revision_value(connection, intent):
    i = intent.data
    case = _case(connection, i['case_id']).data
    parent = SkillManager(connection).get_version(case['skill_id'], case['skill_version'])
    draft = _draft(i['submitted_draft'], case)
    return {'schema_version': 1, 'revision_id': i['revision_id'], 'case_id': i['case_id'],
            'intent_sha256': intent.fact_sha256, 'parent_skill_ref': parent.ref.to_dict(),
            'parent_card_sha256': digest(parent.to_dict()), 'draft': draft, 'draft_origin': 'CALLER',
            'adapter_identity': None, 'model_identity': None,
            'capability_status': 'WITHIN_PARENT' if set(draft['allowed_tools']) <= set(parent.allowed_tools)
                                 else 'CAPABILITY_EXPANSION_REQUIRED'}


def record_revision_proposal(connection, revision_id):
    with _skill_transaction(connection):
        _guard_schema(connection)
        intent = _intent(connection, revision_id)
        if _present(connection, 'skill_revision_proposals', revision_id):
            raise EvolutionError('Revision intent already has its immutable result')
        fact = _insert(connection, 'skill_revision_proposals', {**_revision_value(connection, intent), 'created_at': utc_now()})
        _revision(connection, revision_id)
    return fact


def create_revision_proposal(connection, evolution_case_id, revision_source):
    intent = reserve_revision_intent(connection, evolution_case_id, revision_source)
    return record_revision_proposal(connection, intent.data['revision_id'])


def _revision(connection, revision_id):
    fact = _load(connection, 'skill_revision_proposals', revision_id)
    d = fact.data
    expected = _revision_value(connection, _intent(connection, revision_id))
    _keys(d, (*expected, 'created_at'))
    if {k: d[k] for k in expected} != expected:
        raise EvolutionIntegrityError('Revision content/parent/capability disagrees with intent')
    _text(d['created_at'])
    return fact


def get_revision_proposal(connection, revision_id):
    with _read_snapshot(connection):
        _guard_schema(connection)
        return _revision(connection, revision_id)


def approve_skill_revision(connection, revision_id, approved_revision_sha256):
    return _approve(connection, 'skill_revision_approvals', revision_id, approved_revision_sha256, _revision)


def _prepare_candidate(connection, revision_id, draft):
    """Fixed hook inside SkillManager's existing owned write transaction."""
    _guard_schema(connection)
    revision = _revision(connection, revision_id)
    d = revision.data
    _approval(connection, 'skill_revision_approvals', revision_id, revision)
    if _present(connection, 'skill_evolution_candidates', revision_id):
        raise EvolutionError('Revision already consumed by a candidate')
    parent = _from_ref(d['parent_skill_ref'])
    if d['capability_status'] != 'WITHIN_PARENT':
        raise EvolutionError('CAPABILITY_EXPANSION_REQUIRED')
    if SkillManager(connection).get_current_state(parent.skill_id, parent.skill_version) != 'TRUSTED':
        raise EvolutionError('Revision parent is not TRUSTED')
    expected = d['draft']
    if (draft.skill_id != parent.skill_id or draft.source != SkillSource('DERIVED', parent)
            or any(getattr(draft, k) != expected[k] for k in ('name', 'description', 'instructions'))
            or list(draft.allowed_tools) != expected['allowed_tools']):
        raise EvolutionError('Candidate parameters differ from the exact approved revision')
    return revision


def _record_candidate(connection, revision, card, occurred_at):
    d = revision.data
    approval = _approval(connection, 'skill_revision_approvals', d['revision_id'], revision)
    fact = _insert(connection, 'skill_evolution_candidates', {
        'schema_version': 1, 'revision_id': d['revision_id'], 'case_id': d['case_id'], **card.ref.to_dict(),
        'transition_seq': 1, 'card_sha256': digest(card.to_dict()), 'parent_skill_ref': d['parent_skill_ref'],
        'revision_sha256': revision.fact_sha256, 'approval_sha256': approval.fact_sha256,
        'created_at': occurred_at})
    _candidate(connection, d['revision_id'])
    return fact


def _candidate(connection, revision_id):
    fact = _load(connection, 'skill_evolution_candidates', revision_id)
    d = fact.data
    _keys(d, ('schema_version', 'revision_id', 'case_id', 'skill_id', 'skill_version', 'transition_seq',
              'card_sha256', 'parent_skill_ref', 'revision_sha256', 'approval_sha256', 'created_at'))
    revision = _revision(connection, revision_id)
    r = revision.data
    approval = _approval(connection, 'skill_revision_approvals', revision_id, revision)
    manager = SkillManager(connection)
    card = manager.get_version(d['skill_id'], d['skill_version'])
    first = manager.get_state_history(d['skill_id'], d['skill_version'])[0]
    if (d['case_id'] != r['case_id'] or digest(card.to_dict()) != d['card_sha256'] or d['transition_seq'] != 1
            or card.source != SkillSource('DERIVED', _from_ref(r['parent_skill_ref']))
            or d['parent_skill_ref'] != r['parent_skill_ref'] or d['revision_sha256'] != revision.fact_sha256
            or d['approval_sha256'] != approval.fact_sha256 or d['created_at'] != first.occurred_at
            or r['capability_status'] != 'WITHIN_PARENT'
            or any(getattr(card, k) != r['draft'][k] for k in ('name', 'description', 'instructions'))
            or list(card.allowed_tools) != r['draft']['allowed_tools']):
        raise EvolutionIntegrityError('Candidate receipt differs from approved revision or lifecycle')
    return fact


def materialize_skill_candidate(connection, approved_revision_id):
    _check_write_context(connection)
    revision = get_revision_proposal(connection, approved_revision_id).data
    parent = _from_ref(revision['parent_skill_ref'])
    fields = {k: revision['draft'][k] for k in ('name', 'description', 'instructions', 'allowed_tools')}
    return SkillManager(connection).create_version(parent.skill_id, **fields, source=SkillSource('DERIVED', parent),
                                                    _evolution_revision_id=approved_revision_id)

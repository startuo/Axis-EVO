"""Exact approval and atomic lifecycle/receipt integration in SkillManager."""

from uuid import uuid4

from .events import utc_now
from .skill_binding import _read_snapshot, _rows
from .skill_card import SkillRef
from .skill_manager import SkillManager
from .skill_storage import _check_write_context, _skill_transaction
from .skill_revision import _candidate, _case, _from_ref, _ref
from .skill_evolution_policy import GATE_POLICY_ID, _governance, _prepare_histories, _gate_locked
from .skill_evolution_storage import (
    EvolutionError, EvolutionIntegrityError, _guard_schema, _load, _insert,
    _keys, _hash, _text, _approval, _approve, _present, digest, snapshot,
)


def _candidate_for_ref(connection, ref):
    rows = _rows(connection, 'SELECT revision_id FROM main.skill_evolution_candidates WHERE skill_id=? AND skill_version=?',
                 (ref.skill_id, ref.skill_version))
    if len(rows) != 1:
        raise EvolutionError('No approved evolution candidate for this exact SkillRef')
    return _candidate(connection, rows[0][0])


def propose_skill_promotion(connection, evolution_case_id, candidate_skill_ref, trust_assessment_id,
                            gate_policy_id=GATE_POLICY_ID):
    _check_write_context(connection)
    candidate = _ref(candidate_skill_ref)
    with _read_snapshot(connection):
        _guard_schema(connection)
        record = _candidate_for_ref(connection, candidate)
        reference = _from_ref(record.data['parent_skill_ref'])
    histories = _prepare_histories(connection, reference, candidate)
    with _skill_transaction(connection):
        _guard_schema(connection)
        record = _candidate_for_ref(connection, candidate)
        case = _case(connection, evolution_case_id)
        if record.data['case_id'] != evolution_case_id:
            raise EvolutionError('Candidate belongs to another evolution case')
        gate = _gate_locked(connection, candidate, trust_assessment_id, gate_policy_id, histories)
        if not gate['eligible']:
            raise EvolutionError('Promotion gate rejected: ' + ','.join(gate['reasons']))
        fact = _insert(connection, 'skill_promotion_proposals', {
            'schema_version': 1, 'proposal_id': 'promotion_' + uuid4().hex,
            'revision_id': record.data['revision_id'], 'case_id': evolution_case_id,
            'case_sha256': case.fact_sha256, 'candidate_sha256': record.fact_sha256,
            'candidate_skill_ref': candidate.to_dict(), 'target_state': 'TRUSTED',
            'gate': gate, 'created_at': utc_now()})
        _promotion(connection, fact.data['proposal_id'])
    return fact


def _promotion(connection, proposal_id):
    """Validate the approved historical gate, not a replacement latest report."""
    fact = _load(connection, 'skill_promotion_proposals', proposal_id)
    d = fact.data
    _keys(d, ('schema_version', 'proposal_id', 'revision_id', 'case_id', 'case_sha256',
              'candidate_sha256', 'candidate_skill_ref', 'target_state', 'gate', 'created_at'))
    record = _candidate(connection, d['revision_id'])
    case = _case(connection, d['case_id'])
    candidate = SkillRef(record.data['skill_id'], record.data['skill_version'])
    if (d['candidate_skill_ref'] != candidate.to_dict() or record.data['case_id'] != d['case_id']
            or d['case_sha256'] != case.fact_sha256 or d['candidate_sha256'] != record.fact_sha256
            or d['target_state'] != 'TRUSTED'):
        raise EvolutionIntegrityError('Promotion proposal identity/case/candidate mismatch')
    g = d['gate']
    _keys(g, ('eligible', 'status', 'reasons', 'manifest', 'manifest_sha256'))
    manifest = g['manifest']
    verified = _gate_locked(connection, candidate, manifest['assessment_id'], manifest['policy']['policy_id'], historical=manifest)
    if type(g['eligible']) is not bool or not verified['eligible'] or verified != g:
        raise EvolutionIntegrityError('Promotion gate is invalid or its pinned evidence disagrees')
    _text(d['created_at'])
    return fact


def approve_skill_promotion(connection, promotion_proposal_id, approved_promotion_sha256):
    return _approve(connection, 'skill_promotion_approvals', promotion_proposal_id,
                    approved_promotion_sha256, _promotion)


def _prepare_authorization(connection, authorization):
    """Public Inspector reads finish before SkillManager takes its write lock."""
    if authorization is None:
        return None
    _check_write_context(connection)
    a = snapshot(authorization)
    _keys(a, ('proposal_id', 'approved_promotion_sha256'))
    _hash(a['approved_promotion_sha256'])
    with _read_snapshot(connection):
        _guard_schema(connection)
        proposal = _promotion(connection, a['proposal_id'])
        candidate = _from_ref(proposal.data['candidate_skill_ref'])
        record = _candidate(connection, proposal.data['revision_id'])
        reference = _from_ref(record.data['parent_skill_ref'])
    return _prepare_histories(connection, reference, candidate)


def _preflight_promotion(connection, ref, target_state, authorization, prepared):
    """Fixed hook under the ORIGINAL SkillManager BEGIN IMMEDIATE."""
    governance = _governance(connection)
    if target_state != 'TRUSTED':
        if authorization is not None:
            raise EvolutionError('Promotion authorization is only for a TRUSTED transition')
        return None
    if governance is None:
        if authorization is not None:
            raise EvolutionError('Evolution authorization requires EVIDENCE_GATED governance')
        return None
    if authorization is None:
        raise EvolutionError('EVIDENCE_GATED: exact persisted promotion approval is required')
    _keys(authorization, ('proposal_id', 'approved_promotion_sha256'))
    _hash(authorization['approved_promotion_sha256'])
    proposal = _promotion(connection, authorization['proposal_id'])
    d = proposal.data
    if d['candidate_skill_ref'] != ref.to_dict() or authorization['approved_promotion_sha256'] != proposal.fact_sha256:
        raise EvolutionError('Promotion authorization belongs to another candidate or digest')
    _approval(connection, 'skill_promotion_approvals', d['proposal_id'], proposal)
    if _present(connection, 'skill_promotion_receipts', d['proposal_id']) or _rows(connection,
            'SELECT 1 FROM main.skill_promotion_receipts WHERE skill_id=? AND skill_version=?', (ref.skill_id, ref.skill_version)):
        raise EvolutionError('Promotion approval/candidate already consumed')
    manifest = d['gate']['manifest']
    gate = _gate_locked(connection, ref, manifest['assessment_id'], manifest['policy']['policy_id'], prepared)
    if not gate['eligible'] or gate != d['gate']:
        raise EvolutionError('STALE: promotion evidence changed after proposal; a new proposal is required')
    return proposal


def _record_promotion(connection, proposal, event):
    d = proposal.data
    approval = _approval(connection, 'skill_promotion_approvals', d['proposal_id'], proposal)
    record = _candidate(connection, d['revision_id'])
    fact = _insert(connection, 'skill_promotion_receipts', {
        'schema_version': 1, 'proposal_id': d['proposal_id'], 'revision_id': d['revision_id'],
        **event.ref.to_dict(), 'transition_seq': event.transition_seq,
        'transition_occurred_at': event.occurred_at, 'target_state': event.state,
        'card_sha256': record.data['card_sha256'], 'proposal_sha256': proposal.fact_sha256,
        'approval_sha256': approval.fact_sha256, 'gate_manifest_sha256': d['gate']['manifest_sha256'],
        'created_at': event.occurred_at})
    _receipt(connection, d['proposal_id'])
    return fact


def _receipt(connection, proposal_id):
    fact = _load(connection, 'skill_promotion_receipts', proposal_id)
    d = fact.data
    _keys(d, ('schema_version', 'proposal_id', 'revision_id', 'skill_id', 'skill_version', 'transition_seq',
              'transition_occurred_at', 'target_state', 'card_sha256', 'proposal_sha256', 'approval_sha256',
              'gate_manifest_sha256', 'created_at'))
    proposal = _promotion(connection, proposal_id)
    p = proposal.data
    approval = _approval(connection, 'skill_promotion_approvals', proposal_id, proposal)
    candidate = _candidate(connection, d['revision_id'])
    c = candidate.data
    event = SkillManager(connection).get_state_history(d['skill_id'], d['skill_version'])[-1]
    if (d['revision_id'] != p['revision_id'] or p['candidate_skill_ref'] != event.ref.to_dict()
            or (c['skill_id'], c['skill_version']) != (d['skill_id'], d['skill_version'])
            or d['target_state'] != 'TRUSTED' or event.state != 'TRUSTED' or d['transition_seq'] != event.transition_seq
            or d['transition_occurred_at'] != event.occurred_at or d['created_at'] != event.occurred_at
            or d['card_sha256'] != c['card_sha256'] or d['proposal_sha256'] != proposal.fact_sha256
            or d['approval_sha256'] != approval.fact_sha256 or d['gate_manifest_sha256'] != p['gate']['manifest_sha256']):
        raise EvolutionIntegrityError('Promotion receipt/lifecycle/approval mismatch')
    return fact


def promote_evaluated_skill(connection, promotion_proposal_id, approved_promotion_sha256):
    _check_write_context(connection)
    _hash(approved_promotion_sha256)
    with _read_snapshot(connection):
        _guard_schema(connection)
        proposal = _promotion(connection, promotion_proposal_id)
        ref = _from_ref(proposal.data['candidate_skill_ref'])
    return SkillManager(connection).promote(ref.skill_id, ref.skill_version, 'TRUSTED',
        evolution_authorization={'proposal_id': promotion_proposal_id,
                                 'approved_promotion_sha256': approved_promotion_sha256})

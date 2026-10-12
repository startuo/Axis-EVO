"""Explicit append-only preferred-version selection; no lifecycle rollback."""

from uuid import uuid4

from .events import utc_now
from .skill_binding import _read_snapshot, _rows
from .skill_card import SkillRef
from .skill_manager import SkillManager
from .skill_storage import _check_write_context, _skill_transaction
from .skill_revision import _ref
from .skill_evolution_policy import _governance
from .skill_evolution_promotion import _receipt
from .skill_evolution_storage import (
    EvolutionError, EvolutionIntegrityError, _guard_schema, _load, _insert,
    _keys, _text, _hash, _approval, _approve, _present, digest,
)


def _eligibility(connection, ref):
    governance = _governance(connection)
    if governance is None:
        raise EvolutionError('Activation requires explicit EVIDENCE_GATED governance')
    manager = SkillManager(connection)
    card = manager.get_version(ref.skill_id, ref.skill_version)
    if manager.get_current_state(ref.skill_id, ref.skill_version) != 'TRUSTED':
        raise EvolutionError('Only an exact TRUSTED version can be activated')
    rows = _rows(connection, 'SELECT proposal_id FROM main.skill_promotion_receipts WHERE skill_id=? AND skill_version=?',
                 (ref.skill_id, ref.skill_version))
    if rows:
        receipt = _receipt(connection, rows[0][0])
        return {'kind': 'GATED_PROMOTION', 'identity': rows[0][0], 'sha256': receipt.fact_sha256,
                'card_sha256': digest(card.to_dict())}
    for anchor in governance.data['baseline_trusted']:
        if (anchor[0]['card']['skill_id'], anchor[0]['card']['skill_version']) == (ref.skill_id, ref.skill_version):
            if anchor[0]['card']['card_sha256'] != digest(card.to_dict()):
                raise EvolutionIntegrityError('Bootstrap Card bytes changed')
            return {'kind': 'BOOTSTRAP_TRUSTED', 'identity': 'enabled', 'sha256': governance.fact_sha256,
                    'card_sha256': digest(card.to_dict())}
    raise EvolutionError('TRUSTED version has neither bootstrap anchor nor gated promotion receipt')


def _activation_proposal(connection, activation_id):
    fact = _load(connection, 'skill_activation_proposals', activation_id)
    d = fact.data
    _keys(d, ('schema_version', 'activation_id', 'skill_id', 'skill_version', 'eligibility',
              'previous_event_id', 'previous_event_sha256', 'previous_activation_seq', 'reason', 'created_at'))
    ref = SkillRef(d['skill_id'], d['skill_version'])
    if d['eligibility'] != _eligibility(connection, ref):
        raise EvolutionIntegrityError('Activation eligibility proof mismatch')
    if type(d['previous_activation_seq']) is not int or d['previous_activation_seq'] < 0:
        raise EvolutionIntegrityError('Invalid previous activation sequence')
    if d['previous_event_id'] is None:
        if d['previous_event_sha256'] is not None or d['previous_activation_seq'] != 0:
            raise EvolutionIntegrityError('Initial activation must pin an explicit empty prefix')
    else:
        previous = _load(connection, 'skill_activation_events', d['previous_event_id'])
        if (previous.fact_sha256 != d['previous_event_sha256'] or previous.data['skill_id'] != ref.skill_id
                or previous.data['activation_seq'] != d['previous_activation_seq']):
            raise EvolutionIntegrityError('Activation prior-event identity/hash mismatch')
    _text(d['reason'])
    _text(d['created_at'])
    return fact


def _activation_event(connection, activation_id):
    fact = _load(connection, 'skill_activation_events', activation_id)
    d = fact.data
    _keys(d, ('schema_version', 'activation_id', 'skill_id', 'skill_version', 'activation_seq',
              'proposal_sha256', 'approval_sha256', 'previous_event_id', 'previous_event_sha256', 'created_at'))
    proposal = _activation_proposal(connection, activation_id)
    p = proposal.data
    approval = _approval(connection, 'skill_activation_approvals', activation_id, proposal)
    if (d['proposal_sha256'] != proposal.fact_sha256 or d['approval_sha256'] != approval.fact_sha256
            or (d['skill_id'], d['skill_version']) != (p['skill_id'], p['skill_version'])
            or d['activation_seq'] != p['previous_activation_seq'] + 1
            or d['previous_event_id'] != p['previous_event_id'] or d['previous_event_sha256'] != p['previous_event_sha256']):
        raise EvolutionIntegrityError('Activation event/approval/sequence mismatch')
    _text(d['created_at'])
    return fact


def _activation_history(connection, skill_id):
    SkillRef(skill_id, 1)
    rows = _rows(connection, 'SELECT activation_id FROM main.skill_activation_events WHERE skill_id=? ORDER BY activation_seq', (skill_id,))
    history = []
    for seq, row in enumerate(rows, 1):
        fact = _activation_event(connection, row[0])
        d = fact.data
        previous = history[-1] if history else None
        if (d['activation_seq'] != seq or d['previous_event_id'] != (previous.data['activation_id'] if previous else None)
                or d['previous_event_sha256'] != (previous.fact_sha256 if previous else None)):
            raise EvolutionIntegrityError('Activation history is not an exact contiguous prefix')
        history.append(fact)
    return history


def propose_skill_activation(connection, skill_ref, *, expected_previous_event_id=None, reason='explicit selection'):
    _check_write_context(connection)
    ref = _ref(skill_ref)
    reason = _text(reason)
    with _skill_transaction(connection):
        _guard_schema(connection)
        eligibility = _eligibility(connection, ref)
        history = _activation_history(connection, ref.skill_id)
        previous = history[-1] if history else None
        if expected_previous_event_id != (previous.data['activation_id'] if previous else None):
            raise EvolutionError('STALE: expected activation prefix does not match')
        fact = _insert(connection, 'skill_activation_proposals', {
            'schema_version': 1, 'activation_id': 'activation_' + uuid4().hex, **ref.to_dict(),
            'eligibility': eligibility, 'previous_event_id': expected_previous_event_id,
            'previous_event_sha256': previous.fact_sha256 if previous else None,
            'previous_activation_seq': len(history), 'reason': reason, 'created_at': utc_now()})
        _activation_proposal(connection, fact.data['activation_id'])
    return fact


def approve_skill_activation(connection, activation_id, approved_activation_sha256):
    return _approve(connection, 'skill_activation_approvals', activation_id, approved_activation_sha256, _activation_proposal)


def activate_approved_skill(connection, activation_id, approved_activation_sha256):
    _check_write_context(connection)
    _hash(approved_activation_sha256)
    with _skill_transaction(connection):
        _guard_schema(connection)
        proposal = _activation_proposal(connection, activation_id)
        p = proposal.data
        if approved_activation_sha256 != proposal.fact_sha256:
            raise EvolutionError('Activation digest does not match the exact proposal')
        approval = _approval(connection, 'skill_activation_approvals', activation_id, proposal)
        if _present(connection, 'skill_activation_events', activation_id):
            raise EvolutionError('Activation approval already consumed')
        history = _activation_history(connection, p['skill_id'])
        previous = history[-1] if history else None
        if (p['previous_activation_seq'] != len(history)
                or p['previous_event_id'] != (previous.data['activation_id'] if previous else None)
                or p['previous_event_sha256'] != (previous.fact_sha256 if previous else None)):
            raise EvolutionError('STALE: activation prefix changed, including possible ABA')
        fact = _insert(connection, 'skill_activation_events', {
            'schema_version': 1, 'activation_id': activation_id, 'skill_id': p['skill_id'], 'skill_version': p['skill_version'],
            'activation_seq': len(history) + 1, 'proposal_sha256': proposal.fact_sha256,
            'approval_sha256': approval.fact_sha256, 'previous_event_id': p['previous_event_id'],
            'previous_event_sha256': p['previous_event_sha256'], 'created_at': utc_now()})
        _activation_history(connection, p['skill_id'])
    return fact


def resolve_preferred_skill(connection, skill_id):
    """Resolve only explicit committed activation. Never choose latest version."""
    with _read_snapshot(connection):
        _guard_schema(connection)
        history = _activation_history(connection, skill_id)
        if not history:
            return None
        d = history[-1].data
        return SkillRef(d['skill_id'], d['skill_version'])

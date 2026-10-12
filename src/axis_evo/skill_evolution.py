"""Public evidence-gated evolution API and logically read-only inspection."""

from .skill_card import SkillRef
from .skill_binding import _read_snapshot, _rows
from .skill_manager import SkillManager
from .skill_evidence import inspect_skill_evidence, _collect
from .skill_trust import _assessment_fact
from .shadow_evaluation import _suite
from .skill_revision import (
    create_evolution_case, reserve_revision_intent, record_revision_proposal,
    create_revision_proposal, get_revision_proposal, approve_skill_revision,
    materialize_skill_candidate, _case, _intent, _revision, _candidate,
)
from .skill_evolution_storage import (
    EvolutionError, EvolutionIntegrityError, EvolutionFact,
    initialize_skill_evolution_schema, _guard_schema, _load, _approval, _present,
)
from .skill_evolution_policy import enable_evolution_governance, evaluate_evolution_gate, _governance, _census
from .skill_evolution_promotion import (
    propose_skill_promotion, approve_skill_promotion, promote_evaluated_skill,
    _promotion, _receipt,
)
from .skill_evolution_activation import (
    propose_skill_activation, approve_skill_activation, activate_approved_skill,
    resolve_preferred_skill, _activation_history,
)


LIMITATIONS = [
    'Local digest approval is a trusted caller action, not human identity authentication.',
    'Gate coverage is limited to a trusted closed benchmark; it does not prove generalization or Skill causality.',
    'CALLER drafting is supported; model-assisted revision drafting and live-provider claims are absent.',
    'Supported application APIs are gated; arbitrary SQLite owner SQL or replaced runtime code is outside the boundary.',
    'UNKNOWN remains factual uncertainty; no retry, compensation or new Recovery decision is inferred.',
]


def _report_locked(connection, case_id):
    _guard_schema(connection)
    case = _case(connection, case_id)
    c = case.data
    source = SkillRef(c['skill_id'], c['skill_version'])
    source_assessment = _assessment_fact(connection, c['source_assessment_id'])
    governance = _governance(connection)
    revisions, unresolved, refs = [], [], {source}
    for row in _rows(connection, 'SELECT revision_id FROM main.skill_revision_intents WHERE case_id=? ORDER BY revision_id', (case_id,)):
        rid = row[0]
        intent = _intent(connection, rid)
        item = {'revision_id': rid, 'intent_sha256': intent.fact_sha256, 'draft_origin': intent.data['draft_origin'],
                'revision_sha256': None, 'approval_sha256': None, 'candidate_skill_ref': None,
                'candidate_card_sha256': None, 'revision_proposal': None, 'candidate_approval': None,
                'candidate_lifecycle': [], 'current_lifecycle_state': None,
                'trial_summary': [], 'promotion_proposals': []}
        if not _present(connection, 'skill_revision_proposals', rid):
            unresolved.append({'revision_id': rid, 'observation': 'REVISION_RESULT_MISSING'})
            revisions.append(item)
            continue
        revision = _revision(connection, rid)
        item.update(revision_sha256=revision.fact_sha256, revision_proposal=revision.data,
                    capability_status=revision.data['capability_status'])
        if _present(connection, 'skill_revision_approvals', rid):
            approval = _approval(connection, 'skill_revision_approvals', rid, revision)
            item.update(approval_sha256=approval.fact_sha256, candidate_approval=approval.data)
        if _present(connection, 'skill_evolution_candidates', rid):
            candidate = _candidate(connection, rid)
            d = candidate.data
            ref = SkillRef(d['skill_id'], d['skill_version'])
            refs.add(ref)
            history = SkillManager(connection).get_state_history(ref.skill_id, ref.skill_version)
            item.update(candidate_skill_ref=ref.to_dict(), candidate_card_sha256=d['card_sha256'],
                        candidate_receipt_sha256=candidate.fact_sha256,
                        candidate_lifecycle=[{'transition_seq': e.transition_seq, 'state': e.state, 'occurred_at': e.occurred_at} for e in history],
                        current_lifecycle_state=history[-1].state)
            if governance:
                item['trial_summary'] = _census(connection, source, ref, governance.data['policy']['suite_id'])
            for p in _rows(connection, 'SELECT proposal_id FROM main.skill_promotion_proposals WHERE revision_id=? ORDER BY proposal_id', (rid,)):
                proposal = _promotion(connection, p[0])
                pd = proposal.data
                assessment = _assessment_fact(connection, pd['gate']['manifest']['assessment_id'])
                record = {'proposal_id': p[0], 'proposal_sha256': proposal.fact_sha256,
                          'promotion_proposal': pd, 'trust_assessment': assessment.data,
                          'gate_decision': {k: pd['gate'][k] for k in ('eligible', 'status', 'reasons', 'manifest_sha256')},
                          'approval_sha256': None, 'approval': None,
                          'receipt_sha256': None, 'promotion_receipt': None}
                if _present(connection, 'skill_promotion_approvals', p[0]):
                    approval = _approval(connection, 'skill_promotion_approvals', p[0], proposal)
                    record.update(approval_sha256=approval.fact_sha256, approval=approval.data)
                if _present(connection, 'skill_promotion_receipts', p[0]):
                    receipt = _receipt(connection, p[0])
                    record.update(receipt_sha256=receipt.fact_sha256, promotion_receipt=receipt.data)
                else:
                    unresolved.append({'proposal_id': p[0], 'observation': 'PROMOTION_NOT_RECORDED'})
                item['promotion_proposals'].append(record)
            if history[-1].state == 'TRUSTED' and not any(p['receipt_sha256'] for p in item['promotion_proposals']):
                raise EvolutionIntegrityError('Evolution candidate is TRUSTED without a governed receipt')
        else:
            unresolved.append({'revision_id': rid, 'observation': 'CANDIDATE_NOT_RECORDED'})
        revisions.append(item)
    activations = _activation_history(connection, source.skill_id)
    preferred = activations[-1].data if activations else None
    report = {'schema_version': 1, 'case_id': case_id, 'case_sha256': case.fact_sha256,
              'governance_mode': 'EVIDENCE_GATED' if governance else 'LEGACY_UNGOVERNED',
              'source_skill_ref': source.to_dict(), 'source_card_sha256': c['parent_card_sha256'],
              'source_assessment_id': c['source_assessment_id'], 'source_assessment_sha256': c['source_assessment_sha256'],
              'source_evidence_sha256': c['source_evidence_sha256'], 'evolution_objective': c['objective'],
              'historical_evidence': source_assessment.data['history'],
              'historical_freshness': 'CURRENT' if source_assessment.data['history']['source_snapshot'] == _collect(connection, source, None)
                                      else 'NEW_EVIDENCE_AVAILABLE',
              'shadow_suite': {'suite_id': governance.data['policy']['suite_id'],
                               'suite_sha256': governance.data['policy']['suite_sha256'],
                               'case_manifest': _suite(connection, governance.data['policy']['suite_id']).data['cases']} if governance else None,
              'attribution': 'INDETERMINATE', 'revisions': revisions,
              'activation_history': [{'activation_id': f.data['activation_id'], 'activation_seq': f.data['activation_seq'],
                               'skill_ref': {k: f.data[k] for k in ('skill_id', 'skill_version')}, 'event_sha256': f.fact_sha256}
                              for f in activations],
              'preferred_skill_ref': {k: preferred[k] for k in ('skill_id', 'skill_version')} if preferred else None,
              'unresolved_states': unresolved, 'integrity_issues': [], 'limitations': list(LIMITATIONS)}
    return report, sorted(refs, key=lambda r: (r.skill_id, r.skill_version))


def inspect_skill_evolution(connection, evolution_case_id):
    """Bracket full execution inspection with identical committed fact reports.

    Works with query_only=ON, never migrates or repairs, and rejects a caller
    transaction. SQLite may coordinate WAL sidecars under the frozen boundary.
    """
    if connection.in_transaction:
        raise EvolutionError('Evolution inspection rejects an active caller transaction')
    try:
        with _read_snapshot(connection):
            before, refs = _report_locked(connection, evolution_case_id)
            snapshots = [_collect(connection, ref, None) for ref in refs]
        verified = [inspect_skill_evidence(connection, ref) for ref in refs]
        if any(h['integrity_issues'] for h in verified):
            raise EvolutionIntegrityError('Historical execution inspection reports inconsistent evidence')
        with _read_snapshot(connection):
            after, actual_refs = _report_locked(connection, evolution_case_id)
            actual_snapshots = [_collect(connection, ref, None) for ref in actual_refs]
            if (before != after or refs != actual_refs or actual_snapshots != snapshots
                    or [h['source_snapshot'] for h in verified] != snapshots):
                raise EvolutionError('STALE: evidence changed during read-only inspection')
        return after
    except (ValueError, KeyError, TypeError, IndexError) as error:
        return {'schema_version': 1, 'case_id': evolution_case_id, 'integrity_issues': [str(error)],
                'unresolved_states': [], 'limitations': list(LIMITATIONS)}


inspect_evolution_case = inspect_skill_evolution

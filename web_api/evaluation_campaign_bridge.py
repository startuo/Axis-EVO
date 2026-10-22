"""Opt-in Web projection of prospective Core campaigns; no new approval authority."""
from uuid import uuid4

from axis_evo.evaluation_campaign import (POLICY_ID, _scope, _campaign,
    create_evaluation_campaign, execute_evaluation_campaign, inspect_evaluation_campaign)
from axis_evo.evaluation_campaign_adapter import bind_campaign_adapter, describe_campaign_transport
from axis_evo.evaluation_campaign_storage import _guard_schema, TABLES
from axis_evo.skill_binding import _read_snapshot
from axis_evo.skill_trust import _comparison, _assessment_fact
from axis_evo.skill_evolution_policy import evaluate_evolution_gate


def campaign_policy_enabled(connection):
    names = tuple(TABLES)
    marks = ','.join('?' for _ in names)
    objects = connection.execute(f'SELECT 1 FROM main.sqlite_master WHERE tbl_name IN ({marks})', names).fetchall()
    shadows = connection.execute(f'SELECT 1 FROM temp.sqlite_master WHERE name IN ({marks})', names).fetchall()
    if not objects and not shadows:
        return False
    _guard_schema(connection)
    if not connection.execute('SELECT 1 FROM main.evaluation_policy_scopes').fetchone():
        return False
    _scope(connection)
    return True


def prepare_campaign(service, connection, profile, card):
    attempt = 'campaign-' + uuid4().hex
    adapter = service._adapter_factory(profile, attempt)
    configuration = {'adapter_name': adapter.adapter_name, 'model_id': adapter.model_id,
        'profile_id': profile['id'], 'profile_revision': profile['revision'], 'config_sha256': profile['configSha256'],
        'effective_parameters': {'model': profile['modelId'], 'stream': False, 'n': 1},
        'transport': describe_campaign_transport(adapter)}
    # ProfileStore already verified the immutable profile/configuration. Bind
    # its nonsecret actual transport projection as well, before any model I/O.
    bind_campaign_adapter(adapter, configuration)
    campaign = create_evaluation_campaign(connection, card.ref, configuration)
    return {'policyId': POLICY_ID, 'policySha256': campaign.data['policy_sha256'],
        'campaignId': campaign.data['campaign_id'], 'campaignSha256': campaign.fact_sha256,
        'adapterAttemptId': attempt}


def verify_campaign(connection, operation_body, card):
    with _read_snapshot(connection):
        _guard_schema(connection)
        campaign = _campaign(connection, operation_body['campaignId'])
        d = campaign.data
        p = operation_body['provider']
        if (operation_body['policyId'] != POLICY_ID or operation_body['policySha256'] != d['policy_sha256']
                or operation_body['campaignSha256'] != campaign.fact_sha256
                or {k: d[k] for k in ('skill_id', 'skill_version')} != card.ref.to_dict()
                or d['suite_id'] != operation_body['suiteId'] or d['suite_sha256'] != operation_body['suiteSha256']
                or (d['profile']['profile_id'], d['profile']['profile_revision'], d['profile']['config_sha256'])
                    != (p['id'], p['revision'], p['configSha256'])):
            raise ValueError('Web operation and exact Core campaign identity mismatch')
    return campaign


def run_campaign(connection, body, card, adapter):
    campaign = verify_campaign(connection, body, card)
    receipt = execute_evaluation_campaign(connection, body['campaignId'],
        bind_campaign_adapter(adapter, campaign.data['profile']))
    comparison = _comparison(connection, receipt.data['comparison_id'])
    assessment = _assessment_fact(connection, receipt.data['assessment_id'])
    gate = evaluate_evolution_gate(connection, card.ref, assessment.data['assessment_id'], POLICY_ID)
    pairs = comparison.data['trial_pairs']
    outcomes = [{'caseId': pair['case_id'], 'reference': pair['reference']['outcome'],
                 'candidate': pair['candidate']['outcome']} for pair in comparison.data['evaluation']['pairs']]
    return {'policyId': POLICY_ID, 'campaignId': body['campaignId'], 'campaignSha256': campaign.fact_sha256,
        'campaignReceiptSha256': receipt.fact_sha256, 'candidateSkillRef': card.ref.to_dict(),
        'comparisonId': comparison.data['comparison_id'], 'comparisonSha256': comparison.fact_sha256,
        'assessmentId': assessment.data['assessment_id'], 'assessmentSha256': assessment.fact_sha256,
        'recommendation': assessment.data['recommendation'], 'metrics': comparison.data['evaluation']['metrics'],
        'pairs': pairs, 'outcomes': outcomes,
        'gate': {k: gate[k] for k in ('eligible', 'status', 'reasons', 'manifest_sha256')},
        'limitation': 'Prospective Shadow evaluation is not production success or independent heldout improvement.'}


def promotion_policy(service, project, case_id, connection, card, receipt_id, assessment_id):
    if not campaign_policy_enabled(connection):
        return 'evolution-gate-v1'
    rows = connection.execute('SELECT campaign_id FROM main.evaluation_campaigns WHERE skill_id=? AND skill_version=?',
                              (card.skill_id, card.skill_version)).fetchall()
    if not rows:
        return 'evolution-gate-v1'  # An old v1 operation stays v1 after opt-in.
    operations = [f for f in service._children(project, case_id, 'OP_INTENT')
                  if f['body']['action'] == 'evaluate' and f['body'].get('candidateReceiptId') == receipt_id]
    if len(rows) != 1 or len(operations) != 1:
        raise ValueError('A campaign without its exact Web bridge cannot be silently rebound')
    op = operations[0]
    if op['body'].get('campaignId') != rows[0][0]:
        raise ValueError('Campaign cannot fall back to legacy evaluation policy')
    verify_campaign(connection, op['body'], card)
    results = service._children(project, op['id'], 'OP_RESULT')
    if (len(results) != 1 or results[0]['body'].get('assessmentId') != assessment_id
            or results[0]['body'].get('campaignId') != rows[0][0]
            or results[0]['body'].get('operationSha256') != op['sha256']):
        raise ValueError('An exact completed campaign bridge Assessment is required')
    return POLICY_ID


def family_evidence(connection, skill_id):
    """Read actual generations even when a Web receipt was lost after Core COMMIT."""
    from axis_evo.skill_manager import SkillManager
    from axis_evo.skill_evolution_storage import _load, digest
    from axis_evo.skill_evolution_promotion import _candidate_for_ref, _receipt
    from axis_evo.skill_evolution_activation import _activation_history
    manager = SkillManager(connection)
    lineage, campaigns = [], []
    for card in manager.list_versions(skill_id):
        if len(lineage) >= 100:
            raise ValueError('Generation history exceeds the bounded Web scope')
        created = connection.execute('SELECT 1 FROM main.skill_evolution_candidates WHERE skill_id=? AND skill_version=?',
                                     (card.skill_id, card.skill_version)).fetchone()
        candidate = _candidate_for_ref(connection, card.ref) if created else None
        promoted = connection.execute('SELECT proposal_id FROM main.skill_promotion_receipts WHERE skill_id=? AND skill_version=?',
                                     (card.skill_id, card.skill_version)).fetchall()
        if len(promoted) > 1:
            raise ValueError('Generation has ambiguous promotion receipts')
        promotion = _receipt(connection, promoted[0][0]) if promoted else None
        proposal = _load(connection, 'skill_promotion_proposals', promoted[0][0]) if promoted else None
        lineage.append({'skillRef': card.ref.to_dict(), 'parentSkillRef': card.source.ref.to_dict() if card.source.ref else None,
            'cardSha256': digest(card.to_dict()), 'state': manager.get_current_state(card.skill_id, card.skill_version),
            'candidateReceiptSha256': candidate.fact_sha256 if candidate else None,
            'evolutionCaseId': candidate.data['case_id'] if candidate else None,
            'promotionReceiptSha256': promotion.fact_sha256 if promotion else None,
            'promotionProposalSha256': proposal.fact_sha256 if proposal else None,
            'policyId': proposal.data['gate']['manifest']['policy']['policy_id'] if proposal else None,
            'heldoutImprovement': 'NOT_MEASURED'})
    if campaign_policy_enabled(connection):
        ids = connection.execute('SELECT campaign_id FROM main.evaluation_campaigns WHERE skill_id=? ORDER BY skill_version LIMIT 9',
                                 (skill_id,)).fetchall()
        if len(ids) > 8:
            raise ValueError('Campaign history exceeds its declared generation scope')
        campaigns = [inspect_evaluation_campaign(connection, row[0]) for row in ids]
    activations = [{'activationId': f.data['activation_id'], 'sha256': f.fact_sha256,
                    'sequence': f.data['activation_seq'], 'skillRef': {'skill_id': f.data['skill_id'],
                    'skill_version': f.data['skill_version']}} for f in _activation_history(connection, skill_id)]
    return {'lineage': lineage, 'campaigns': campaigns, 'activations': activations,
            'campaignPolicyEnabled': bool(campaigns) or campaign_policy_enabled(connection)}

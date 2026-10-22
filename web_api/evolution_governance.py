"""Web authorization and evaluation orchestration, not a replacement Core gate."""
from axis_evo.skill_card import SkillRef
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_revision import _candidate, _revision
from axis_evo.skill_trust import create_skill_comparison, create_trust_assessment
from axis_evo.skill_evolution_policy import _governance, evaluate_evolution_gate
from axis_evo.skill_evolution_promotion import (propose_skill_promotion,
    approve_skill_promotion, promote_evaluated_skill)
from axis_evo.skill_evolution_activation import (propose_skill_activation,
    approve_skill_activation, activate_approved_skill)
from axis_evo.shadow_evaluation import _suite, _intent, create_shadow_trial
from axis_evo.skill_trust_storage import get_shadow_trial

from .revision_protocol import digest
from .schemas import ApiError

MAX_WEB_PAIRED_CASES = 5


def _bounded_suite(connection, suite_id):
    suite = _suite(connection, suite_id)
    if len(suite.data['cases']) > MAX_WEB_PAIRED_CASES:
        raise ValueError('Web pairing supports at most five complete suite cases; no case subset is selected')
    return suite


class EvolutionGovernance:
    def __init__(self, service):
        self.s = service

    def belongs(self, project, case, identity):
        fact = self.s._load(project, identity)
        for _ in range(12):
            if fact['id'] == case:
                return
            if not fact['parentId']:
                break
            fact = self.s._load(project, fact['parentId'])
        raise ValueError('This fact belongs to another evolution case')

    def candidate(self, project, case, identity):
        self.belongs(project, case, identity)
        receipt = self.s._load(project, identity)
        if receipt['kind'] == 'TRACE_CANDIDATE':
            from .trace_skill import TraceSkill
            return TraceSkill(self.s).verify_candidate(project, receipt)
        if receipt['kind'] != 'CANDIDATE_RECEIPT':
            raise ValueError('An exact candidate receipt is required')
        authorization = self.s._load(project, receipt['parentId'], 'CANDIDATE_AUTH')
        link = self.s._load(project, authorization['parentId'], 'CORE_REVISION_LINK')
        operation = self.s._load(project, link['parentId'], 'CORE_REVISION_INTENT')
        draft = self.s._load(project, operation['parentId'], 'DRAFT')
        generation = self.s.generation(project, draft['parentId'])
        _, _, core_case, _ = self.s._case(project, case)
        if (generation['intent']['parentId'] != case or generation['status'] != 'VALID'
                or draft['body']['generationResultSha256'] != generation['result']['sha256']
                or digest(draft['body']['draft']) != draft['body']['draftSha256']
                or any(f['body']['draftSha256'] != draft['body']['draftSha256'] for f in (link, operation))
                or operation['body']['caseId'] != core_case.data['case_id']
                or link['body']['caseId'] != core_case.data['case_id']
                or authorization['body']['linkSha256'] != link['sha256']
                or authorization['body']['approvedRevisionSha256'] != link['body']['revisionSha256']
                or authorization['body']['revisionId'] != link['body']['revisionId']
                or receipt['body']['revisionId'] != link['body']['revisionId']
                or receipt['body']['stateAtCreation'] != 'CANDIDATE'):
            raise ValueError('Candidate Web authorization and generation chain mismatch')
        with self.s.core(project) as c:
            fact = _candidate(c, receipt['body']['revisionId'])
            revision = _revision(c, receipt['body']['revisionId'])
            card = SkillManager(c).get_version(**receipt['body']['skillRef'])
            if (fact.fact_sha256 != receipt['body']['coreReceiptSha256']
                    or revision.fact_sha256 != link['body']['revisionSha256']
                    or revision.data['draft_origin'] != 'CALLER'
                    or revision.data['draft'] != draft['body']['draft']
                    or fact.data['case_id'] != core_case.data['case_id']
                    or fact.data['revision_sha256'] != link['body']['revisionSha256']
                    or {key: fact.data[key] for key in ('skill_id', 'skill_version')} != card.ref.to_dict()
                    or fact.data['card_sha256'] != receipt['body']['cardSha256']
                    or digest(card.to_dict()) != receipt['body']['cardSha256']
                    or any(getattr(card, key) != draft['body']['draft'][key]
                           for key in ('name', 'description', 'instructions'))
                    or list(card.allowed_tools) != draft['body']['draft']['allowed_tools']):
                raise ValueError('Candidate receipt no longer verifies')
        return card

    def prepare_evaluation(self, project, case, body, *, start):
        from .evolution_service import exact
        exact(body, ('candidateReceiptId',))
        card = self.candidate(project, case, body['candidateReceiptId'])
        origin, _, _, _ = self.s._case(project, case)
        profile = origin['body']['provider']
        campaign = {}
        with self.s.core(project) as c:
            if SkillManager(c).get_current_state(card.skill_id, card.skill_version) != 'SHADOW':
                raise ValueError('Evaluation requires the exact SHADOW candidate')
            governance = _governance(c)
            if governance is None:
                raise ValueError('A backend-provisioned closed governance suite is required')
            _bounded_suite(c, governance.data['policy']['suite_id'])
            from .evaluation_campaign_bridge import campaign_policy_enabled, prepare_campaign
            if self.s._load(project, body['candidateReceiptId'])['kind'] == 'CANDIDATE_RECEIPT' and campaign_policy_enabled(c):
                campaign = prepare_campaign(self.s, c, profile, card)
        operation = self.s._insert(project, 'OP_INTENT', {'action': 'evaluate', **body,
            'provider': profile, 'suiteId': governance.data['policy']['suite_id'],
            'suiteSha256': governance.data['policy']['suite_sha256'], **campaign}, parent=case,
            slot='evaluate-' + body['candidateReceiptId'])
        if start:
            if self.s._supervisor is None:
                raise ApiError('EVALUATION_NOT_DISPATCHED', 'The injected service requires an explicit worker call.', 409)
            self.s._supervisor.submit(project, operation['id'], 'evaluation')
        return operation

    def evaluate(self, project, operation_id):
        operation = self.s._load(project, operation_id, 'OP_INTENT')
        d, case_id = operation['body'], operation['parentId']
        if d['action'] != 'evaluate':
            raise ValueError('An evaluation reservation is required')
        card = self.candidate(project, case_id, d['candidateReceiptId'])
        _, _, _, reference = self.s._case(project, case_id)
        # Identical adapter identity/configuration is a frozen paired-comparison
        # requirement. Unlike task adapters this identity names evaluation
        # conditions, not a claim of exactly one network call.
        condition_id = d.get('adapterAttemptId') or 'shadow-' + digest([d['suiteId'], reference.ref.to_dict()])[:32]
        adapter = self.s._adapter_factory(d['provider'], condition_id)
        self.s._insert(project, 'OP_CLAIM', {'operationSha256': operation['sha256'],
            'adapterName': adapter.adapter_name, 'modelId': adapter.model_id}, parent=operation_id)
        if 'campaignId' in d:
            from .evaluation_campaign_bridge import run_campaign
            with self.s.core(project) as c:
                result = run_campaign(c, d, card, adapter)
            return self.s._insert(project, 'OP_RESULT', {'action': 'evaluate',
                'operationSha256': operation['sha256'], **result}, parent=operation_id)
        parameters = {'providerConfigSha256': d['provider']['configSha256'],
                      'model': d['provider']['modelId'], 'stream': False, 'n': 1}
        pairs, outcomes = [], []
        with self.s.core(project) as c:
            governance = _governance(c)
            if (governance is None or governance.data['policy']['suite_sha256'] != d['suiteSha256']
                    or governance.data['policy']['suite_id'] != d['suiteId']):
                raise ValueError('Governance suite changed')
            suite = _bounded_suite(c, d['suiteId'])
            if c.execute('SELECT 1 FROM main.shadow_trial_intents WHERE skill_id=? AND skill_version=?',
                         (card.skill_id, card.skill_version)).fetchone():
                raise ValueError('A candidate evaluation cannot be replayed or cherry-picked')
            references = {}
            for case in suite.data['cases']:
                rows = c.execute('SELECT trial_id FROM main.shadow_trial_intents WHERE case_key=? '
                    'AND skill_id=? AND skill_version=?',
                    (case['case_key'], reference.skill_id, reference.skill_version)).fetchall()
                if len(rows) > 1:
                    raise ValueError('Reference trial census is ambiguous; no trials are discarded')
                if rows:
                    intent = _intent(c, rows[0][0]).data
                    if (intent['adapter_name'] != adapter.adapter_name or intent['model_id'] != adapter.model_id
                            or intent['planning_parameters'] != parameters
                            or intent['skill_anchor'][0]['history'][-1]['state'] != 'TRUSTED'):
                        raise ValueError('Existing reference trials use incompatible conditions or lifecycle')
                    references[case['case_id']] = get_shadow_trial(c, rows[0][0])
            for case in suite.data['cases']:
                reference_trial = references.get(case['case_id'])
                if reference_trial is None:
                    reference_trial = create_shadow_trial(c, d['suiteId'], case['case_id'], reference.ref,
                                                          adapter, planning_parameters=parameters)
                candidate_trial = create_shadow_trial(c, d['suiteId'], case['case_id'], card.ref,
                                                      adapter, planning_parameters=parameters)
                pairs.append({'case_id': case['case_id'], 'reference_trial_id': reference_trial['trial_id'],
                              'candidate_trial_id': candidate_trial['trial_id']})
                outcomes.append({'caseId': case['case_id'], 'reference': reference_trial['outcome'],
                                 'candidate': candidate_trial['outcome']})
            comparison = create_skill_comparison(c, reference.ref, card.ref, d['suiteId'], trial_pairs=pairs)
            assessment = create_trust_assessment(c, card.ref, comparison_id=comparison.data['comparison_id'])
            receipt = self.s._load(project, d['candidateReceiptId'])
            gate = (evaluate_evolution_gate(c, card.ref, assessment.data['assessment_id'])
                if receipt['kind'] == 'CANDIDATE_RECEIPT' else
                {'eligible': False, 'status': 'UNSUPPORTED_NEW_FAMILY_PROMOTION',
                 'reasons': ['TRACE_CANDIDATE_HAS_NO_CORE_EVOLUTION_REVISION_RECEIPT'], 'manifest_sha256': None})
        return self.s._insert(project, 'OP_RESULT', {'action': 'evaluate',
            'operationSha256': operation['sha256'], 'candidateSkillRef': card.ref.to_dict(),
            'comparisonId': comparison.data['comparison_id'], 'comparisonSha256': comparison.fact_sha256,
            'assessmentId': assessment.data['assessment_id'], 'assessmentSha256': assessment.fact_sha256,
            'recommendation': assessment.data['recommendation'], 'metrics': comparison.data['evaluation']['metrics'],
            'pairs': pairs, 'outcomes': outcomes,
            'gate': {k: gate[k] for k in ('eligible', 'status', 'reasons', 'manifest_sha256')},
            'limitation': 'Closed in-memory Shadow evaluation is not production task success or causal improvement.'},
            parent=operation_id)

    def _own_proposal(self, project, case, action, field, identity):
        from .evolution_service import one
        for op in self.s._children(project, case, 'OP_INTENT'):
            if op['body']['action'] == action:
                results = self.s._children(project, op['id'], 'OP_RESULT')
                if results:
                    result = one(results)
                    if (result['body']['operationSha256'] != op['sha256']
                            or result['body']['action'] != action):
                        raise ValueError('Governance result belongs to another operation')
                    if result['body'].get(field) == identity:
                        return result
        raise ValueError('The proposal is not part of this case')

    def action(self, project, case_id, action, body):
        from .evolution_service import exact
        fields = {
            'shadow': ('candidateReceiptId', 'approvedCardSha256'),
            'promotion-proposal': ('candidateReceiptId', 'assessmentId'),
            'promotion-approve': ('proposalId', 'approvedPromotionSha256'),
            'activation-proposal': ('skillRef', 'expectedPreviousEventId', 'reason'),
            'activation-approve': ('activationId', 'approvedActivationSha256')}
        if action not in fields:
            raise ValueError('Unsupported evolution action')
        exact(body, fields[action])
        _, _, case, source = self.s._case(project, case_id)
        card = None
        if 'candidateReceiptId' in body:
            card = self.candidate(project, case_id, body['candidateReceiptId'])
        if action == 'shadow' and body['approvedCardSha256'] != digest(card.to_dict()):
            raise ValueError('Exact SHADOW transition digest mismatch')
        if action == 'promotion-approve':
            record = self._own_proposal(project, case_id, 'promotion-proposal', 'proposalId', body['proposalId'])
            if record['body']['proposalSha256'] != body['approvedPromotionSha256']:
                raise ValueError('Promotion approval digest mismatch')
        if action == 'activation-approve':
            record = self._own_proposal(project, case_id, 'activation-proposal', 'activationId', body['activationId'])
            if record['body']['proposalSha256'] != body['approvedActivationSha256']:
                raise ValueError('Activation approval digest mismatch')
        operation = self.s._insert(project, 'OP_INTENT', {'action': action, 'parameters': body},
            parent=case_id, slot=action + '-' + digest(body))
        with self.s.core(project) as c:
            if action == 'shadow':
                event = SkillManager(c).promote(card.skill_id, card.skill_version, 'SHADOW')
                result = {'skillRef': event.ref.to_dict(), 'state': event.state, 'transitionSeq': event.transition_seq}
            elif action == 'promotion-proposal':
                from .evaluation_campaign_bridge import promotion_policy
                policy = promotion_policy(self.s, project, case_id, c, card, body['candidateReceiptId'], body['assessmentId'])
                proposal = propose_skill_promotion(c, case.data['case_id'], card.ref, body['assessmentId'], gate_policy_id=policy)
                result = {'proposalId': proposal.data['proposal_id'], 'proposalSha256': proposal.fact_sha256,
                          'candidateSkillRef': card.ref.to_dict(),
                          'gate': {key: proposal.data['gate'][key] for key in ('eligible', 'status', 'reasons', 'manifest_sha256')}}
            elif action == 'promotion-approve':
                approve_skill_promotion(c, body['proposalId'], body['approvedPromotionSha256'])
                event = promote_evaluated_skill(c, body['proposalId'], body['approvedPromotionSha256'])
                result = {'skillRef': event.ref.to_dict(), 'state': event.state, 'transitionSeq': event.transition_seq}
            elif action == 'activation-proposal':
                ref = self.s._ref(project, body['skillRef'])
                # Both source routing rollback and this case's exact candidate
                # may be selected. No unrelated TRUSTED version is admitted.
                allowed = [source.ref.to_dict()]
                # Authorization needs this case's verified receipt identities,
                # not the expensive full-family UI/Shadow evidence projection.
                for fact in self.s._case_facts(project, case_id):
                    if fact['kind'] == 'CANDIDATE_RECEIPT':
                        allowed.append(fact['body']['skillRef'])
                # Multi-generation rollback selects an exact verified ancestor;
                # it appends routing evidence and never changes lifecycle/history.
                manager, cursor, depth = SkillManager(c), source, 0
                while cursor.source.ref is not None:
                    depth += 1
                    if depth > 8:
                        raise ValueError('Activation lineage exceeds the bounded generation scope')
                    cursor = manager.get_version(cursor.source.ref.skill_id, cursor.source.ref.skill_version)
                    allowed.append(cursor.ref.to_dict())
                if ref.to_dict() not in allowed:
                    raise ValueError('Activation is outside this case lineage')
                proposal = propose_skill_activation(c, ref,
                    expected_previous_event_id=body['expectedPreviousEventId'], reason=body['reason'])
                result = {'activationId': proposal.data['activation_id'], 'proposalSha256': proposal.fact_sha256,
                          'proposal': proposal.data}
            else:
                approve_skill_activation(c, body['activationId'], body['approvedActivationSha256'])
                event = activate_approved_skill(c, body['activationId'], body['approvedActivationSha256'])
                result = {'activationId': event.data['activation_id'], 'activationSha256': event.fact_sha256,
                          'skillRef': {k: event.data[k] for k in ('skill_id', 'skill_version')}}
        return self.s._insert(project, 'OP_RESULT', {'action': action, 'operationSha256': operation['sha256'],
                                                   **result}, parent=operation['id'])

"""Optional success-trace drafting with an external, immutable source link.

New Skill families stop at CANDIDATE/SHADOW. They do not acquire a fabricated
Core revision receipt, governed promotion or Runtime admission.
"""
from uuid import uuid4

from axis_evo.skill_card import SkillRef, SkillCard, SkillSource
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_evidence import inspect_skill_evidence

from .revision_protocol import digest, validate_draft
from .schemas import strict_json


class TraceSkill:
    def __init__(self, service):
        self.s = service

    def create_case(self, project, body):
        from .evolution_service import exact
        exact(body, ('sourceSkillRef', 'sourceCardSha256', 'evidenceSha256', 'sourceRunId',
                     'objective', 'profileId', 'profileRevision'))
        ref = self.s._ref(project, body['sourceSkillRef'])
        with self.s.core(project) as c:
            history = inspect_skill_evidence(c, ref)
            runs = [r for r in history['runs'] if r['run_id'] == body['sourceRunId']]
            if (history['integrity_issues'] or len(runs) != 1
                    or runs[0]['observed_outcome'] != 'VERIFIED_TASK_SUCCESS'
                    or runs[0]['integrity_status'] != 'VERIFIED'):
                raise ValueError('Trace drafting requires independently verified task success')
            validation = c.execute("SELECT event_id,seq,payload_json FROM main.events WHERE run_id=? "
                "AND event_type='VALIDATION_PASSED' ORDER BY seq", (body['sourceRunId'],)).fetchall()
            if len(validation) != 1:
                raise ValueError('Trace source has no unique independent Acceptance fact')
            trace = {'sourceRunId': body['sourceRunId'], 'sourceRunSha256': runs[0]['source_evidence_sha256'],
                'acceptanceEventId': validation[0]['event_id'], 'acceptanceSeq': validation[0]['seq'],
                'acceptanceSha256': digest(dict(validation[0])), 'sourceSkillRef': ref.to_dict(),
                'sourceCardSha256': history['card_sha256'], 'workflow': 'TRACE_TO_SKILL',
                'newSkillId': 'trace.' + uuid4().hex,
                'limitation': 'One successful task does not prove reuse or authorize TRUSTED admission.'}
        case = self.s.create_case(project, {'sourceSkillRef': ref.to_dict(),
            'sourceCardSha256': body['sourceCardSha256'], 'evidenceSha256': body['evidenceSha256'],
            'selectedRunIds': [body['sourceRunId']], 'objective': body['objective'], 'origin': 'TRACE_TO_SKILL',
            'observedProblem': 'Reusable candidate request from verified success; no Skill defect is claimed.',
            'profileId': body['profileId'], 'profileRevision': body['profileRevision']}, _trace=trace)
        self.s._insert(project, 'TRACE_SOURCE', trace, parent=case['id'])
        return case

    def _source(self, project, case_id):
        from .evolution_service import one
        case, _, _, card = self.s._case(project, case_id)
        source = one(self.s._children(project, case_id, 'TRACE_SOURCE'))
        if source['body'] != case['body'].get('traceSource'):
            raise ValueError('Trace source link differs from its reserved source')
        with self.s.core(project) as c:
            history = inspect_skill_evidence(c, card.ref)
            run = next((r for r in history['runs'] if r['run_id'] == source['body']['sourceRunId']), None)
            if (run is None or run['observed_outcome'] != 'VERIFIED_TASK_SUCCESS'
                    or run['source_evidence_sha256'] != source['body']['sourceRunSha256']):
                raise ValueError('Trace source no longer verifies')
        return source, card

    def prepare(self, project, draft_id):
        draft = self.s._load(project, draft_id, 'DRAFT')
        generation = self.s.generation(project, draft['parentId'])
        source, parent = self._source(project, generation['intent']['parentId'])
        request = strict_json(generation['intent']['body']['requestJson'], 128 * 1024)
        validated = validate_draft(draft['body']['draft'], parent, request['supporting_evidence_ids'])
        if (digest(validated) != draft['body']['draftSha256']
                or draft['body']['generationResultSha256'] != generation['result']['sha256']):
            raise ValueError('Trace draft differs from the selected model/user evidence')
        card = SkillCard(source['body']['newSkillId'], 1,
            **{key: validated[key] for key in ('name', 'description', 'instructions', 'allowed_tools')},
            source=SkillSource('DERIVED', parent.ref))
        return self.s._insert(project, 'TRACE_CANDIDATE', {'stage': 'PROPOSAL',
            'card': card.to_dict(), 'cardSha256': digest(card.to_dict()),
            'draftSha256': draft['body']['draftSha256'], 'sourceFactId': source['id'],
            'sourceFactSha256': source['sha256'], 'sourceRunId': source['body']['sourceRunId']}, parent=draft_id)

    def approve(self, project, proposal_id, body):
        from .evolution_service import exact
        exact(body, ('approvedCandidateSha256',))
        proposal = self.s._load(project, proposal_id, 'TRACE_CANDIDATE')
        if proposal['body']['stage'] != 'PROPOSAL' or body['approvedCandidateSha256'] != proposal['sha256']:
            raise ValueError('Trace candidate requires its exact external proposal digest')
        source = self.s._load(project, proposal['body']['sourceFactId'], 'TRACE_SOURCE')
        verified, _ = self._source(project, source['parentId'])
        if verified['sha256'] != proposal['body']['sourceFactSha256']:
            raise ValueError('Trace candidate source identity changed')
        data = proposal['body']['card']
        ref = SkillRef(data['skill_id'], data['skill_version'])
        with self.s.core(project) as c:
            if c.execute('SELECT 1 FROM main.skills WHERE skill_id=?', (ref.skill_id,)).fetchone():
                raise ValueError('A new Trace Skill family already exists; no duplicate allocation is allowed')
        authorization = self.s._insert(project, 'OP_INTENT', {'action': 'trace-candidate-approve',
            'approvedCandidateSha256': body['approvedCandidateSha256'], 'proposalId': proposal_id,
            'newSkillId': ref.skill_id}, parent=proposal_id, slot='trace-family-' + ref.skill_id)
        with self.s.core(project) as c:
            # Core owns version allocation and its transaction. A connection-
            # local guard enforces the exact approved v1 INSIDE that original
            # transaction, including a competing supported Core writer that
            # wins after our earlier existence check. No persistent schema or
            # frozen Core code changes, and no post-COMMIT cleanup of facts.
            family_sql, card_hash_sql = c.execute('SELECT quote(?),quote(?)',
                (ref.skill_id, proposal['body']['cardSha256'])).fetchone()
            c.execute(f"CREATE TEMP TRIGGER web_trace_exact_candidate BEFORE INSERT ON main.skill_versions "
                f"WHEN NEW.skill_id={family_sql} AND (NEW.skill_version IS NOT 1 OR NEW.card_sha256 IS NOT {card_hash_sql}) "
                "BEGIN SELECT RAISE(ABORT,'Trace candidate differs from the exact approved v1'); END")
            try:
                card = SkillManager(c).create_version(ref.skill_id,
                    **{key: data[key] for key in ('name', 'description', 'instructions', 'allowed_tools')},
                    source=SkillSource('DERIVED', SkillRef(**source['body']['sourceSkillRef'])))
            finally:
                c.execute('DROP TRIGGER temp.web_trace_exact_candidate')
            if card.ref != ref or digest(card.to_dict()) != proposal['body']['cardSha256']:
                raise ValueError('Concurrent Core ownership interference; no Trace receipt can be claimed')
        return self.s._insert(project, 'TRACE_CANDIDATE', {'stage': 'RECEIPT',
            'skillRef': card.ref.to_dict(), 'cardSha256': digest(card.to_dict()),
            'sourceRunId': source['body']['sourceRunId'], 'sourceFactId': source['id'],
            'sourceFactSha256': source['sha256'], 'proposalId': proposal_id,
            'proposalSha256': proposal['sha256'], 'stateAtCreation': 'CANDIDATE'}, parent=authorization['id'])

    def verify_candidate(self, project, receipt):
        if self.s._load(project, receipt['id'], 'TRACE_CANDIDATE') != receipt:
            raise ValueError('Trace receipt differs from the committed fact')
        body = receipt['body']
        if body.get('stage') != 'RECEIPT' or body.get('stateAtCreation') != 'CANDIDATE':
            raise ValueError('A committed Trace candidate receipt is required')
        authorization = self.s._load(project, receipt['parentId'], 'OP_INTENT')
        proposal = self.s._load(project, body['proposalId'], 'TRACE_CANDIDATE')
        auth = authorization['body']
        if (proposal['body'].get('stage') != 'PROPOSAL'
                or proposal['sha256'] != body['proposalSha256']
                or authorization['parentId'] != proposal['id']
                or auth.get('action') != 'trace-candidate-approve'
                or auth.get('proposalId') != proposal['id']
                or auth.get('approvedCandidateSha256') != proposal['sha256']
                or auth.get('newSkillId') != body['skillRef']['skill_id']):
            raise ValueError('Trace candidate has no matching exact approval')
        draft = self.s._load(project, proposal['parentId'], 'DRAFT')
        generation = self.s.generation(project, draft['parentId'])
        source, parent = self._source(project, generation['intent']['parentId'])
        request = strict_json(generation['intent']['body']['requestJson'], 128 * 1024)
        validated = validate_draft(draft['body']['draft'], parent, request['supporting_evidence_ids'])
        expected = SkillCard(source['body']['newSkillId'], 1,
            **{key: validated[key] for key in ('name', 'description', 'instructions', 'allowed_tools')},
            source=SkillSource('DERIVED', parent.ref))
        if (generation['status'] != 'VALID' or generation['result'] is None
                or draft['body']['generationResultSha256'] != generation['result']['sha256']
                or digest(validated) != draft['body']['draftSha256']
                or proposal['body']['draftSha256'] != draft['body']['draftSha256']
                or proposal['body']['card'] != expected.to_dict()
                or proposal['body']['cardSha256'] != digest(expected.to_dict())
                or body['skillRef'] != expected.ref.to_dict()):
            raise ValueError('Trace candidate differs from its selected generation and draft')
        for fact_body in (body, proposal['body']):
            if (fact_body['sourceFactId'] != source['id']
                    or fact_body['sourceFactSha256'] != source['sha256']
                    or fact_body['sourceRunId'] != source['body']['sourceRunId']):
                raise ValueError('Trace candidate source evidence linkage mismatch')
        with self.s.core(project) as c:
            card = SkillManager(c).get_version(**body['skillRef'])
        if digest(card.to_dict()) != body['cardSha256'] or card.to_dict() != proposal['body']['card']:
            raise ValueError('Trace candidate Card differs from the approved draft')
        return card

    def receipts(self, project):
        from . import evolution_store as store
        with self.s.runtime._web() as c:
            rows = c.execute("SELECT id FROM main.web_evolution_facts WHERE project_id=? "
                "AND kind='TRACE_CANDIDATE' AND json_extract(body_json,'$.stage')='RECEIPT' ORDER BY rowid LIMIT 65", (project,)).fetchall()
            if len(rows) > 64:
                raise ValueError('Trace library exceeds its bounded Web scope')
            return [store.load(c, project, row[0], kind='TRACE_CANDIDATE') for row in rows]

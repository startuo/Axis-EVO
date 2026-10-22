"""Authorized Web evolution actions around the unchanged Core governance APIs.

Web intent -> Core commit -> Web receipt is deliberately not advertised as
one transaction. Missing bridge receipts are unresolved, never retry permits.
"""
from contextlib import contextmanager
import sqlite3
from uuid import uuid4

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import PlanningTransportError
from axis_evo.skill_card import SkillRef
from axis_evo.skill_manager import SkillManager
from axis_evo.sandbox import Sandbox
from axis_evo.skill_evidence import inspect_skill_evidence
from axis_evo.skill_trust import create_trust_assessment
from axis_evo.skill_evolution import (create_evolution_case, create_revision_proposal,
    approve_skill_revision, materialize_skill_candidate)
from axis_evo.skill_revision import _case, _revision, _candidate

from . import evolution_store as store
from .read_facade import _budget_and_schema, _require_bound_workspaces
from .revision_protocol import (RevisionAdapter, build_revision_request, parse_revision,
    validate_draft, sha256, digest, REVISION_POLICY)
from .schemas import ApiError, strict_json, public_identity


@contextmanager
def boundary():
    try:
        yield
    except ApiError:
        raise
    except (ValueError, TypeError, KeyError, IndexError, OSError, sqlite3.Error):
        # Core errors can contain task text; never reflect them into HTTP/logs.
        raise ApiError('EVOLUTION_REJECTED',
            'Evolution facts, authorization or the requested transition are invalid. No automatic retry is permitted.', 409) from None


def exact(body, fields):
    if type(body) is not dict or body.keys() != set(fields):
        raise ApiError('INVALID_EVOLUTION_INPUT', 'Only the documented exact fields are accepted.')


def one(values):
    if len(values) != 1:
        raise ValueError('Missing or ambiguous bridge fact')
    return values[0]


def summary(history):
    return {'skillRef': history['skill_ref'], 'cardSha256': history['card_sha256'],
        'evidenceSha256': history['source_evidence_sha256'], 'attribution': history['attribution'],
        'integrityIssues': [{'code': v.get('code', 'INTEGRITY_FAILURE')} for v in history['integrity_issues']],
        'runs': [{key: run[key] for key in ('run_id', 'source_evidence_sha256', 'task_spec_sha256',
                    'observed_outcome', 'integrity_status', 'attribution', 'checkpoint_ids', 'recovery_case_ids')}
                 for run in history['runs']],
        'recoveryLineages': history['recovery_lineages'], 'denominators': history['denominators'],
        'limitations': history['limitations']}


def _preflight_pending_observations(c):
    """Bound known pending targets before frozen Inspector reads raw bytes.

    Configured workspace confinement is checked separately. This stat preflight
    does not claim an atomic filesystem snapshot or an OS sandbox against a
    concurrent host attacker changing the file after the check.
    """
    rows = c.execute("SELECT r.workspace_path,e.payload_json FROM main.events e JOIN main.runs r ON r.run_id=e.run_id "
        "WHERE e.event_type='TOOL_INTENT' AND NOT EXISTS(SELECT 1 FROM main.events x WHERE "
        "x.run_id=e.run_id AND x.tool_call_id=e.tool_call_id AND x.event_type='TOOL_RESULT') LIMIT 257").fetchall()
    count = 0
    for row in rows:
        payload = strict_json(row['payload_json'])
        targets = payload.get('targets', []) if type(payload) is dict else []
        if type(targets) is not list:
            raise ValueError('Malformed observation target list')
        count += len(targets)
        if len(rows) > 256 or count > 256:
            raise ApiError('EVOLUTION_OBSERVATION_LIMIT', 'Pending observation evidence exceeds the bounded Web inspection scope.', 413)
        if not targets:
            continue
        try:
            sandbox = Sandbox(row['workspace_path'])
        except (FileNotFoundError, NotADirectoryError):
            # Missing/archived state is not made into confirmed non-execution;
            # the original Inspector reports the observation as unavailable.
            continue
        for target in targets:
            try:
                path = sandbox.resolve(target['path'])
                if path.exists() and path.stat().st_size > 65536:
                    raise ApiError('EVOLUTION_OBSERVATION_LIMIT', 'A pending target exceeds the bounded Web observation budget.', 413)
            except FileNotFoundError:
                # Missing parents are not turned into successful assertions;
                # Inspector retains its own observation-unavailable semantics.
                continue


class EvolutionService:
    def __init__(self, runtime, *, adapter_factory=None, worker_mode=False):
        self.runtime = runtime
        self.providers = runtime.providers
        self._adapter_factory = adapter_factory or self.providers.adapter
        self._injected = adapter_factory is not None
        self._supervisor = None
        with runtime._web() as c:
            store.initialize(c)
        if not worker_mode and not self._injected:
            from .evolution_worker import EvolutionSupervisor
            self._supervisor = EvolutionSupervisor(self)

    @contextmanager
    def core(self, project_id):
        project, _ = self.runtime._project(project_id)
        with self.runtime._core(project) as c:
            _budget_and_schema(c)
            _require_bound_workspaces(c, project)
            _preflight_pending_observations(c)
            yield c

    def _ref(self, project_id, value, *, allow_trace=False):
        _, config = self.runtime._project(project_id)
        exact(value, ('skill_id', 'skill_version'))
        ref = SkillRef(**value)
        if ref.skill_id not in {r.skill_id for r in config.skill_refs}:
            if allow_trace:
                from .trace_skill import TraceSkill
                trace = TraceSkill(self)
                receipts = [v for v in trace.receipts(project_id) if v['body']['skillRef'] == ref.to_dict()]
                if len(receipts) == 1 and trace.verify_candidate(project_id, receipts[0]).ref == ref:
                    return ref
            raise ApiError('SKILL_NOT_ENABLED', 'This Skill family is not configured for the project.', 403)
        return ref

    def _load(self, project_id, identity, kind=None):
        self.runtime._project(project_id)
        with self.runtime._web() as c:
            return store.load(c, project_id, identity, kind=kind)

    def _children(self, project_id, identity, kind=None):
        with self.runtime._web() as c:
            return store.children(c, project_id, identity, kind)

    def _case_facts(self, project_id, case_id):
        self._load(project_id, case_id, 'CASE_INTENT')
        with self.runtime._web() as c:
            c.execute('BEGIN')
            rows = c.execute('WITH RECURSIVE tree(id) AS (SELECT ? UNION '
                'SELECT f.id FROM main.web_evolution_facts f JOIN tree t ON f.parent_id=t.id '
                'WHERE f.project_id=?) SELECT f.id FROM main.web_evolution_facts f '
                'JOIN tree t ON f.id=t.id ORDER BY f.rowid LIMIT 257', (case_id, project_id)).fetchall()
            if len(rows) > 256:
                raise ValueError('Case history exceeds the Web report budget')
            facts = [store.load(c, project_id, row[0]) for row in rows]
            c.commit()
        return facts

    def _insert(self, project_id, kind, body, **kwargs):
        self.runtime._project(project_id)
        self.providers.check_text(canonical_json_bytes(body).decode('utf-8'))
        with self.runtime._web() as c, store.transaction(c):
            return store.insert(c, project_id, kind, body, **kwargs)

    def _case(self, project_id, identity):
        intent = self._load(project_id, identity, 'CASE_INTENT')
        result = one(self._children(project_id, identity, 'CASE_RESULT'))
        with self.core(project_id) as c:
            case = _case(c, result['body']['caseId'])
            if (case.fact_sha256 != result['body']['caseSha256']
                    or case.data['parent_card_sha256'] != intent['body']['sourceCardSha256']
                    or {k: case.data[k] for k in ('skill_id', 'skill_version')} != intent['body']['sourceSkillRef']
                    or case.data['objective'] != intent['body']['objective']):
                raise ValueError('Core/Web case identity mismatch')
            card = SkillManager(c).get_version(case.data['skill_id'], case.data['skill_version'])
        return intent, result, case, card

    def preview(self, project_id, source_ref):
        with boundary():
            ref = self._ref(project_id, source_ref, allow_trace=True)
            with self.core(project_id) as c:
                card = SkillManager(c).get_version(ref.skill_id, ref.skill_version)
                state = SkillManager(c).get_current_state(ref.skill_id, ref.skill_version)
                history = inspect_skill_evidence(c, ref)
            result = {'sourceCard': card.to_dict(), 'state': state, **summary(history)}
            self.providers.check_text(canonical_json_bytes(result).decode('utf-8'))
            return result

    def list_cases(self, project_id):
        with boundary():
            self.runtime._project(project_id)
            with self.runtime._web() as c:
                result = []
                for value in store.roots(c, project_id, 'CASE_INTENT'):
                    bridge = store.children(c, project_id, value['id'], 'CASE_RESULT')
                    if len(bridge) > 1:
                        raise ValueError('Case bridge is ambiguous')
                    result.append({'id': value['id'], 'sha256': value['sha256'], 'createdAt': value['createdAt'],
                        'coreCaseId': bridge[0]['body']['caseId'] if bridge else None,
                        **{key: value['body'][key] for key in ('sourceSkillRef', 'objective', 'origin')}})
                return result

    def research_readiness(self, project_id):
        from .research_read_facade import research_readiness
        with boundary():
            return research_readiness(self, project_id)

    def library(self, project_id):
        from axis_evo.skill_evolution_activation import _activation_history
        from axis_evo.skill_evolution_storage import _guard_schema
        from axis_evo.skill_binding import _read_snapshot
        with boundary():
            _, configured = self.runtime._project(project_id)
            from .trace_skill import TraceSkill
            traces = TraceSkill(self)
            trace_cards = [traces.verify_candidate(project_id, receipt) for receipt in traces.receipts(project_id)]
            rows = []
            with self.core(project_id) as c:
                c.execute('PRAGMA query_only=ON')
                with _read_snapshot(c):
                    manager = SkillManager(c)
                    available = bool(c.execute("SELECT 1 FROM main.sqlite_master WHERE name='evolution_governance'").fetchone())
                    if available:
                        _guard_schema(c)
                    for skill_id in sorted({r.skill_id for r in configured.skill_refs} | {card.skill_id for card in trace_cards}):
                        # Verify the complete history once in this owned read
                        # snapshot, then derive both exact route and head ID.
                        activation_history = _activation_history(c, skill_id) if available else []
                        head = activation_history[-1].data if activation_history else None
                        preferred = SkillRef(head['skill_id'], head['skill_version']) if head else None
                        for card in manager.list_versions(skill_id):
                            rows.append({'skillRef': card.ref.to_dict(), 'name': card.name, 'description': card.description,
                                'state': manager.get_current_state(card.skill_id, card.skill_version),
                                'allowedTools': list(card.allowed_tools), 'source': card.source.to_dict(),
                                'cardSha256': sha256(card.canonical_bytes()), 'preferred': preferred == card.ref,
                                'activationHeadId': head['activation_id'] if head else None,
                                'transitionCount': len(manager.get_state_history(card.skill_id, card.skill_version)),
                                'isConfiguredAnchor': card.ref in configured.skill_refs})
                if len(rows) > 100:
                    raise ValueError('Skill library exceeds the current Web budget')
            result = {'skills': rows, 'evolutionSchemaAvailable': available,
                      'allowEvolvedSkills': configured.allow_evolved_skills,
                      'capability': 'MODEL_SUGGESTION_REQUIRES_EXACT_CALLER_APPROVAL',
                      'cases': self.list_cases(project_id)}
            self.providers.check_text(canonical_json_bytes(result).decode('utf-8'))
            return result

    def create_case(self, project_id, body, *, _trace=None):
        with boundary():
            exact(body, ('sourceSkillRef', 'sourceCardSha256', 'evidenceSha256', 'selectedRunIds',
                         'objective', 'origin', 'observedProblem', 'profileId', 'profileRevision'))
            ref = self._ref(project_id, body['sourceSkillRef'])
            if (body['origin'] not in (('USER_REQUESTED', 'EVIDENCE_DRIVEN', 'TRACE_TO_SKILL') if _trace else ('USER_REQUESTED', 'EVIDENCE_DRIVEN'))
                    or type(body['objective']) is not str or not body['objective'].strip()
                    or len(body['objective'].encode('utf-8')) > 4096
                    or type(body['observedProblem']) is not str or len(body['observedProblem'].encode('utf-8')) > 4096
                    or type(body['selectedRunIds']) is not list or len(body['selectedRunIds']) > 32
                    or any(type(r) is not str for r in body['selectedRunIds'])
                    or len(set(body['selectedRunIds'])) != len(body['selectedRunIds'])):
                raise ValueError('Invalid bounded improvement request')
            profile = self.providers.get(body['profileId'], body['profileRevision'])
            preview = self.preview(project_id, body['sourceSkillRef'])
            if (preview['state'] != 'TRUSTED' or preview['integrityIssues']
                    or preview['cardSha256'] != body['sourceCardSha256']
                    or preview['evidenceSha256'] != body['evidenceSha256']
                    or not set(body['selectedRunIds']) <= {r['run_id'] for r in preview['runs']}
                    or body['origin'] == 'EVIDENCE_DRIVEN' and not body['selectedRunIds']):
                raise ValueError('Stale, foreign, ineligible or fabricated evidence selection')
            selected = [r for r in preview['runs'] if r['run_id'] in body['selectedRunIds']]
            intent = self._insert(project_id, 'CASE_INTENT', {**body,
                'provider': profile, 'selectedEvidence': selected, 'attribution': 'INDETERMINATE',
                'revisionPolicy': REVISION_POLICY, **({'traceSource': _trace} if _trace else {})}, identity='case_' + uuid4().hex)
            # The first Web COMMIT is the non-replayable bridge identity.
            with self.core(project_id) as c:
                assessment = create_trust_assessment(c, ref)
                if assessment.data['history']['source_evidence_sha256'] != body['evidenceSha256']:
                    raise ValueError('History changed after preview')
                case = create_evolution_case(c, ref, {'assessment_id': assessment.data['assessment_id']}, body['objective'])
            self._insert(project_id, 'CASE_RESULT', {'caseId': case.data['case_id'],
                'caseSha256': case.fact_sha256, 'assessmentId': assessment.data['assessment_id'],
                'assessmentSha256': assessment.fact_sha256}, parent=intent['id'])
            return intent

    def request_generation(self, project_id, case_id, *, start=True):
        with boundary():
            intent, result, case, card = self._case(project_id, case_id)
            profile = intent['body']['provider']
            # ProviderStore verifies immutable config fields. Presentation
            # status (last connection test / credential presence) may change
            # without changing a revision and is not an identity comparison.
            self.providers.adapter(profile, 'revision-preflight')
            evidence = {'selected_runs': intent['body']['selectedEvidence'],
                        'assessment_id': result['body']['assessmentId'],
                        'assessment_sha256': result['body']['assessmentSha256'],
                        'full_history_sha256': case.data['source_evidence_sha256'],
                        'attribution': 'INDETERMINATE'}
            evidence_ids = [result['body']['assessmentId'], *intent['body']['selectedRunIds']]
            improvement = {key: intent['body'][key] for key in ('objective', 'origin', 'observedProblem')}
            if 'traceSource' in intent['body']:
                from .trace_skill import TraceSkill
                source, _ = TraceSkill(self)._source(project_id, case_id)
                improvement.update(workflow='TRACE_TO_SKILL', source_run_id=source['body']['sourceRunId'],
                    new_skill_id=source['body']['newSkillId'],
                    constraint='Draft reusable instructions as an untrusted new candidate. One success does not prove reusability.')
            request = build_revision_request(card, evidence_ids, evidence,
                improvement, profile)
            generation = self._insert(project_id, 'GENERATION_INTENT', {
                'caseId': case.data['case_id'], 'caseSha256': case.fact_sha256,
                'sourceSkillRef': card.ref.to_dict(), 'sourceCardSha256': sha256(card.canonical_bytes()),
                'evidenceManifestSha256': digest(evidence), 'provider': profile,
                'effectiveWireParameters': {'model': profile['modelId'], 'stream': False, 'n': 1},
                'requestJson': request, 'requestSha256': sha256(request.encode('utf-8')),
                'revisionPolicy': REVISION_POLICY}, identity='generation_' + uuid4().hex,
                parent=case_id, slot='generation_' + uuid4().hex)
            if start:
                if self._supervisor is None:
                    raise ApiError('GENERATION_NOT_DISPATCHED', 'This injected test service requires an explicit worker call.', 409)
                self._supervisor.submit(project_id, generation['id'])
            return generation

    def generate_once(self, project_id, generation_id):
        with boundary():
            generation = self._load(project_id, generation_id, 'GENERATION_INTENT')
            _, _, case, card = self._case(project_id, generation['parentId'])
            body = generation['body']
            request = strict_json(body['requestJson'], 128 * 1024)
            if (sha256(body['requestJson'].encode('utf-8')) != body['requestSha256']
                    or body['sourceCardSha256'] != sha256(card.canonical_bytes())
                    or body['caseSha256'] != case.fact_sha256
                    or request['source_skill_card'] != card.to_dict()
                    or not set(request['supporting_evidence_ids']) <= set(case.data['supporting_evidence_ids'])):
                raise ValueError('Generation request identity mismatch')
            transport = self._adapter_factory(body['provider'], generation_id)
            adapter = RevisionAdapter(transport)
            self._insert(project_id, 'GENERATION_CLAIM', {'adapterName': adapter.adapter_name,
                'modelId': adapter.model_id, 'generationSha256': generation['sha256']}, parent=generation_id)
            # All Core and Web connections have closed before external I/O.
            result = {'outcome': 'INVALID_RESPONSE', 'rawScope': 'ASSISTANT_CONTENT',
                      'responseText': None, 'responseSha256': None, 'draft': None, 'draftSha256': None,
                      'adapterName': adapter.adapter_name, 'modelId': adapter.model_id,
                      'generationSha256': generation['sha256'], 'errorCategory': None}
            try:
                response = adapter.generate(body['requestJson'])
                self.providers.check_text(response.text)
                result.update(responseText=response.text, responseSha256=sha256(response.text.encode('utf-8')))
                draft = parse_revision(response.text, card, request['supporting_evidence_ids'])
                result.update(outcome='VALID', draft=draft, draftSha256=digest(draft))
            except PlanningTransportError as error:
                result.update(outcome='TRANSPORT_FAILURE', errorCategory=error.category)
            except ApiError:
                result.update(outcome='RESPONSE_WITHHELD', errorCategory='SENSITIVE_CONTENT')
            except (ValueError, TypeError, UnicodeError, RecursionError):
                result['errorCategory'] = 'STRICT_REVISION_VALIDATION'
            return self._insert(project_id, 'GENERATION_RESULT', result, parent=generation_id)

    def generation(self, project_id, generation_id):
        with boundary():
            intent = self._load(project_id, generation_id, 'GENERATION_INTENT')
            request_text = intent['body']['requestJson']
            request = strict_json(request_text, 128 * 1024)
            if (canonical_json_bytes(request).decode('utf-8') != request_text
                    or sha256(request_text.encode('utf-8')) != intent['body']['requestSha256']):
                raise ValueError('Stored generation request digest mismatch')
            results = self._children(project_id, generation_id, 'GENERATION_RESULT')
            result = one(results) if results else None
            if result:
                body = result['body']
                claim = one(self._children(project_id, generation_id, 'GENERATION_CLAIM'))['body']
                if (body['generationSha256'] != intent['sha256']
                        or claim['generationSha256'] != intent['sha256']
                        or any(body[key] != claim[key] for key in ('adapterName', 'modelId'))
                        or body['modelId'] != intent['body']['provider']['modelId']
                        or body['rawScope'] != 'ASSISTANT_CONTENT'
                        or body['outcome'] not in ('VALID', 'INVALID_RESPONSE', 'TRANSPORT_FAILURE', 'RESPONSE_WITHHELD')):
                    raise ValueError('Result belongs to another request or adapter')
                response = body['responseText']
                if response is None:
                    if body['responseSha256'] is not None:
                        raise ValueError('Missing response cannot have a retained content digest')
                elif (type(response) is not str or len(response.encode('utf-8')) > 64 * 1024
                        or sha256(response.encode('utf-8')) != body['responseSha256']):
                    raise ValueError('Stored assistant content digest mismatch')
                if body['outcome'] == 'VALID':
                    _, _, _, card = self._case(project_id, intent['parentId'])
                    if (request['source_skill_card'] != card.to_dict()
                            or parse_revision(response, card, request['supporting_evidence_ids']) != body['draft']
                            or digest(body['draft']) != body['draftSha256']):
                        raise ValueError('Stored draft differs from the exact assistant response')
                elif body['draft'] is not None or body['draftSha256'] is not None:
                    raise ValueError('Rejected generation cannot contain an accepted draft')
            return {'intent': intent, 'result': result,
                    'status': result['body']['outcome'] if result else 'UNKNOWN',
                    'workerActive': bool(self._supervisor and self._supervisor.running(generation_id)),
                    'drafts': self._children(project_id, generation_id, 'DRAFT')}

    def edit_draft(self, project_id, generation_id, body):
        with boundary():
            exact(body, ('draft',))
            generation = self.generation(project_id, generation_id)
            if generation['status'] != 'VALID':
                raise ValueError('No valid model suggestion exists')
            _, _, case, card = self._case(project_id, generation['intent']['parentId'])
            request = strict_json(generation['intent']['body']['requestJson'], 128 * 1024)
            draft = validate_draft(body['draft'], card, request['supporting_evidence_ids'])
            value = {'draft': draft, 'draftSha256': digest(draft),
                'generationResultSha256': generation['result']['sha256'],
                'origin': 'MODEL_SELECTED' if digest(draft) == generation['result']['body']['draftSha256'] else 'HUMAN_EDITED'}
            self.providers.check_text(canonical_json_bytes(value).decode('utf-8'))
            with self.runtime._web() as c, store.transaction(c):
                if store.children(c, project_id, generation_id, 'OP_INTENT'):
                    raise ValueError('A rejected suggestion cannot be accepted later')
                return store.insert(c, project_id, 'DRAFT', value, parent=generation_id, slot='draft_' + uuid4().hex)

    def reject_suggestion(self, project_id, generation_id, body):
        with boundary():
            exact(body, ('reason',))
            self._load(project_id, generation_id, 'GENERATION_INTENT')
            if type(body['reason']) is not str or not body['reason'].strip() or len(body['reason'].encode('utf-8')) > 4096:
                raise ValueError('A bounded rejection reason is required')
            self.providers.check_text(body['reason'])
            with self.runtime._web() as c, store.transaction(c):
                if store.children(c, project_id, generation_id, 'DRAFT'):
                    raise ValueError('An already selected suggestion cannot be retroactively rejected')
                return store.insert(c, project_id, 'OP_INTENT', {'action': 'reject-suggestion', **body}, parent=generation_id)

    def prepare_candidate(self, project_id, draft_id):
        with boundary():
            draft = self._load(project_id, draft_id, 'DRAFT')
            generation = self.generation(project_id, draft['parentId'])
            _, _, case, card = self._case(project_id, generation['intent']['parentId'])
            origin = self._load(project_id, generation['intent']['parentId'], 'CASE_INTENT')
            if 'traceSource' in origin['body']:
                raise ValueError('Trace drafting uses its separate new-family candidate authorization')
            request = strict_json(generation['intent']['body']['requestJson'], 128 * 1024)
            validated = validate_draft(draft['body']['draft'], card, request['supporting_evidence_ids'])
            if (digest(validated) != draft['body']['draftSha256']
                    or draft['body']['generationResultSha256'] != generation['result']['sha256']):
                raise ValueError('Draft provenance changed')
            operation = self._insert(project_id, 'CORE_REVISION_INTENT', {'draftSha256': digest(validated),
                'caseId': case.data['case_id'], 'generationId': generation['intent']['id']}, parent=draft_id)
            with self.core(project_id) as c:
                revision = create_revision_proposal(c, case.data['case_id'], validated)
                if revision.data['draft_origin'] != 'CALLER' or revision.data['draft'] != validated:
                    raise ValueError('Core caller proposal differs from reviewed draft')
            return self._insert(project_id, 'CORE_REVISION_LINK', {'revisionId': revision.data['revision_id'],
                'revisionSha256': revision.fact_sha256, 'draftSha256': digest(validated),
                'caseId': case.data['case_id'], 'sourceSkillRef': card.ref.to_dict(),
                'capabilityStatus': revision.data['capability_status'], 'draftOrigin': 'CALLER'}, parent=operation['id'])

    def approve_candidate(self, project_id, link_id, body):
        with boundary():
            exact(body, ('approvedRevisionSha256',))
            link = self._load(project_id, link_id, 'CORE_REVISION_LINK')
            if body['approvedRevisionSha256'] != link['body']['revisionSha256']:
                raise ValueError('Exact candidate creation digest is required')
            with self.core(project_id) as c:
                revision = _revision(c, link['body']['revisionId'])
                if (revision.fact_sha256 != body['approvedRevisionSha256']
                        or digest(revision.data['draft']) != link['body']['draftSha256']):
                    raise ValueError('Core/Web revision identity mismatch')
            authorization = self._insert(project_id, 'CANDIDATE_AUTH', {
                'approvedRevisionSha256': body['approvedRevisionSha256'], 'revisionId': link['body']['revisionId'],
                'linkSha256': link['sha256']}, parent=link_id)
            with self.core(project_id) as c:
                approve_skill_revision(c, link['body']['revisionId'], body['approvedRevisionSha256'])
                card = materialize_skill_candidate(c, link['body']['revisionId'])
                receipt = _candidate(c, link['body']['revisionId'])
            return self._insert(project_id, 'CANDIDATE_RECEIPT', {'skillRef': card.ref.to_dict(),
                'cardSha256': sha256(card.canonical_bytes()), 'coreReceiptSha256': receipt.fact_sha256,
                'revisionId': link['body']['revisionId'], 'stateAtCreation': 'CANDIDATE'}, parent=authorization['id'])

    def report(self, project_id, case_id):
        with boundary():
            intent = self._load(project_id, case_id, 'CASE_INTENT')
            # A single coherent Web snapshot; no migration, provider or writes.
            facts = self._case_facts(project_id, case_id)
            # Full request/assistant content remains available in the exact
            # generation read API, not repeated in every polling report.
            projected = [{**fact, 'body': {key: value for key, value in fact['body'].items()
                                         if key not in ('requestJson', 'responseText')}} for fact in facts]
            report = {'case': intent, 'facts': projected, 'attribution': 'INDETERMINATE',
                    'limitations': ['Web and Core commits are separate; a missing bridge result is unresolved.',
                        'Model suggestions do not prove Skill improvement, semantic obedience or fault attribution.',
                        'Gate v1 is preserved; prospective Gate v2 requires separate administrator opt-in.',
                        'Final heldout improvement has not been measured in this engineering milestone.']}
            from .evaluation_campaign_bridge import family_evidence
            with self.core(project_id) as c:
                c.execute('PRAGMA query_only=ON')
                report.update(family_evidence(c, intent['body']['sourceSkillRef']['skill_id']))
            self.providers.check_text(canonical_json_bytes(report).decode('utf-8'))
            if len(canonical_json_bytes(report)) > 768 * 1024:
                raise ValueError('Case report exceeds the Web response budget')
            return report

    def action(self, project_id, case_id, action, body):
        from .evolution_governance import EvolutionGovernance
        with boundary():
            return EvolutionGovernance(self).action(project_id, case_id, action, body)

    def request_evaluation(self, project_id, case_id, body, *, start=True):
        from .evolution_governance import EvolutionGovernance
        with boundary():
            return EvolutionGovernance(self).prepare_evaluation(project_id, case_id, body, start=start)

    def evaluate_once(self, project_id, operation_id):
        from .evolution_governance import EvolutionGovernance
        with boundary():
            return EvolutionGovernance(self).evaluate(project_id, operation_id)

    def create_trace_case(self, project_id, body):
        from .trace_skill import TraceSkill
        with boundary():
            return TraceSkill(self).create_case(project_id, body)

    def prepare_trace_candidate(self, project_id, draft_id):
        from .trace_skill import TraceSkill
        with boundary():
            return TraceSkill(self).prepare(project_id, draft_id)

    def approve_trace_candidate(self, project_id, proposal_id, body):
        from .trace_skill import TraceSkill
        with boundary():
            return TraceSkill(self).approve(project_id, proposal_id, body)

    def close(self):
        if self._supervisor:
            self._supervisor.close()

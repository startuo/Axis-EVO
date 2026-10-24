"""Sequential conversations compose existing Runtime jobs; they never execute tools."""
from dataclasses import asdict
import hashlib
import logging
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from axis_evo.agent_feedback import extract_verified_feedback, _evidence, _sha
from axis_evo.events import utc_now
from axis_evo.hashing import canonical_json_bytes
from . import conversation_store as store
from .conversation_context import PreparedTurn, build_context, capture_seed
from .runtime_policy import load_template, MAX_PROMPT_CHARS, verify_snapshot
from .schemas import ApiError, no_redirected_parents, strict_json


def _error(code='CONVERSATION_INTEGRITY',message='Conversation evidence cannot be verified.',status=409):
    raise ApiError(code,message,status)


def _template(service,project_id,template_id):
    _,project=service._project(project_id)
    path=project.template(template_id)
    task,seed,manifest=load_template(path,service.providers.check_text)
    return task,seed,manifest,store.digest(asdict(task))


def _normal_manifest(value):
    files={os.path.normcase(path):meta for path,meta in value['files'].items()}
    dirs=sorted(os.path.normcase(path) for path in value['directories'])
    if len(files)!=len(value['files']) or len(set(dirs))!=len(dirs):_error('SOURCE_WORKSPACE_AMBIGUOUS')
    return {'files':files,'directories':dirs}


def _verified_source(service,row):
    """Keep normal terminal proof distinct from post-terminal filesystem observation."""
    project,_=service._project(row['project_id'])
    with service._core(project) as c:
        try:feedback=extract_verified_feedback(c,row['reserved_run_id'])
        except (ValueError,sqlite3.Error):_error('SOURCE_EVIDENCE_UNVERIFIED')
        raw=_evidence(c,row['reserved_run_id'])
    if _sha(raw)!=feedback['evidence_sha256']:_error('SOURCE_EVIDENCE_CHANGED')
    run=raw['runs'][0]
    expected=service._directory(row['id'])/'workspace'
    no_redirected_parents(expected)
    stored=Path(run['workspace_path'])
    if not stored.is_absolute() or stored.resolve(strict=True)!=expected.resolve(strict=True):_error('SOURCE_WORKSPACE_MISMATCH')
    manifest=strict_json(row['manifest_json'])['seed']
    _normal_manifest(manifest)
    expected_files={os.path.normcase(path):dict(meta) for path,meta in manifest['files'].items()}
    for event in raw['events']:
        if event['event_type']!='FILE_OBSERVED':continue
        observation=strict_json(event['payload_json'])
        if observation.get('reason') not in ('POST_TOOL','VALIDATION'):continue
        path=os.path.normcase(observation['path'])
        if observation['exists']:
            expected_files[path]={'sha256':observation['sha256'],'size':observation['size_bytes']}
        else:expected_files.pop(path,None)
    captured=capture_seed(expected,service.providers.check_text)
    expected_manifest={'files':expected_files,'directories':sorted(os.path.normcase(p) for p in manifest['directories'])}
    if _normal_manifest(captured.manifest())!=expected_manifest:_error('SOURCE_WORKSPACE_CHANGED')
    with service._core(project) as c:
        if _sha(_evidence(c,row['reserved_run_id']))!=feedback['evidence_sha256']:_error('SOURCE_EVIDENCE_CHANGED')
    source={'kind':'PREVIOUS_VERIFIED_RUN_SNAPSHOT','thread_id':row['id'],
        'run_id':row['reserved_run_id'],'proposal_id':feedback['previous_proposal_id'],
        'plan_sha256':feedback['previous_plan_sha256'],'evidence_sha256':feedback['evidence_sha256'],
        'run_status':feedback['run_status'],'terminal_event_id':feedback['terminal_event_id'],
        'terminal_seq':feedback['terminal_seq'],'validation':feedback['validation'],
        'workspace_manifest_sha256':store.digest(captured.manifest()),
        'observation_semantics':'Current captured bytes matching inherited seed and latest recorded file facts; no atomic snapshot or causal claim.'}
    return captured,source


def _recheck_source(service,project_id,source):
    kind=source.get('kind')
    if kind=='PROJECT_TEMPLATE_SEED':return
    previous=service._row(project_id,source['thread_id'])
    if kind=='PLANNING_FAILED_PRIVATE_SEED':
        if previous['status']!='FAILED' or previous['approved_digest'] is not None:_error('SOURCE_EVIDENCE_CHANGED')
        if store.digest(strict_json(previous['manifest_json']))!=source['thread_manifest_sha256']:_error('SOURCE_EVIDENCE_CHANGED')
        with service._web() as web:
            if web.execute('SELECT 1 FROM main.runtime_dispatches WHERE job_id=?',(previous['id'],)).fetchone():_error('SOURCE_EVIDENCE_CHANGED')
        project,_=service._project(project_id)
        with service._core(project) as core:
            if core.execute('SELECT 1 FROM main.runs WHERE run_id=?',(previous['reserved_run_id'],)).fetchone():_error('SOURCE_EVIDENCE_CHANGED')
        return
    if kind!='PREVIOUS_VERIFIED_RUN_SNAPSHOT' or source['run_id']!=previous['reserved_run_id']:_error()
    project,_=service._project(project_id)
    with service._core(project) as c:
        if _sha(_evidence(c,source['run_id']))!=source['evidence_sha256']:_error('SOURCE_EVIDENCE_CHANGED')


def record_admission(service,c,prepared,thread_id,run_id,prompt):
    """Called in the existing thread/job owned transaction, never a second commit."""
    store.guard(c)
    ctx=strict_json(prepared.context_json,store.MAX_CONTEXT_BYTES)
    project_id=ctx['project_id']
    if c.execute('SELECT 1 FROM main.runtime_messages WHERE message_id=?',(prepared.message_id,)).fetchone():
        _error('DUPLICATE_MESSAGE','This message identity has already been admitted.')
    previous=c.execute('SELECT max(turn_number) FROM main.runtime_turns WHERE conversation_id=?',(prepared.conversation_id,)).fetchone()[0]
    if (previous or 0)+1!=prepared.turn_number or prepared.turn_number>store.MAX_TURNS:
        _error('CONVERSATION_CHANGED','Another request already advanced this conversation.')
    if prepared.new_conversation:
        if c.execute('SELECT count(*) FROM main.runtime_conversations').fetchone()[0]>=100:_error('CONVERSATION_LIMIT')
        store.one(c,'INSERT INTO main.runtime_conversations VALUES(?,?,?,?)',
            (prepared.conversation_id,project_id,prompt.strip().splitlines()[0][:80],utc_now()))
    else:
        found=c.execute('SELECT project_id FROM main.runtime_conversations WHERE conversation_id=?',(prepared.conversation_id,)).fetchone()
        if found is None or found[0]!=project_id:_error('CONVERSATION_NOT_FOUND',status=404)
    _recheck_source(service,project_id,ctx['source'])
    store.one(c,'INSERT INTO main.runtime_turns VALUES(?,?,?,?,?,?,?,?)',
        (prepared.turn_id,prepared.conversation_id,prepared.turn_number,thread_id,prepared.message_id,run_id,prepared.template_id,utc_now()))
    store.one(c,'INSERT INTO main.runtime_messages VALUES(?,?,?,?,?,?)',
        (prepared.message_id,prepared.conversation_id,prepared.turn_id,'USER_MESSAGE',canonical_json_bytes({'text':prompt}).decode(),utc_now()))
    store.one(c,'INSERT INTO main.runtime_contexts VALUES(?,?,?,?)',
        (prepared.turn_id,prepared.context_json,prepared.context_sha,utc_now()))
    store.observe(c,prepared.turn_id,'SYSTEM_ACTIVITY',{'state':'TURN_ADMITTED','thread_id':thread_id,'reserved_run_id':run_id})


def verify_binding(service,row,job_identity):
    """Pure optional preflight; never initializes schema or contacts the provider."""
    with service._web() as c:
        exists=c.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='runtime_turns'").fetchone()
        if not exists:
            if 'conversationId' in job_identity:_error('CONVERSATION_INTEGRITY')
            return {}
        with store.snapshot(c):
            turn=c.execute('SELECT * FROM main.runtime_turns WHERE thread_id=?',(row['id'],)).fetchone()
            if turn is None:
                if 'conversationId' in job_identity:_error()
                return {}
            turn=dict(turn)
            ctx,sha,_=store.context(c,turn['turn_id'])
            message=c.execute('SELECT * FROM main.runtime_messages WHERE message_id=?',(turn['user_message_id'],)).fetchone()
            conversation=c.execute('SELECT project_id FROM main.runtime_conversations WHERE conversation_id=?',(turn['conversation_id'],)).fetchone()
            if (message is None or message['kind']!='USER_MESSAGE' or message['turn_id']!=turn['turn_id']
                    or message['conversation_id']!=turn['conversation_id'] or strict_json(message['payload_json'])!={'text':row['prompt']}
                    or conversation is None or conversation[0]!=row['project_id']
                    or turn['reserved_run_id']!=row['reserved_run_id'] or ctx['conversation_id']!=turn['conversation_id']
                    or ctx['turn_id']!=turn['turn_id'] or ctx['turn_number']!=turn['turn_number'] or ctx['user_message']!=row['prompt']):_error()
    # The admitted snapshot may not exist yet while the coordinator copies it.
    directory=service._directory(row['id'])
    task_path=directory/'task.json'
    if task_path.exists():
        task=verify_snapshot(directory,strict_json(row['manifest_json']),service.providers.check_text)
        if task.goal!=canonical_json_bytes(ctx).decode():_error('CONTEXT_TASK_MISMATCH')
    if ctx['workspace']['manifest']!=strict_json(row['manifest_json'])['seed']:_error('CONTEXT_SEED_MISMATCH')
    _recheck_source(service,row['project_id'],ctx['source'])
    return {'conversationId':turn['conversation_id'],'turnId':turn['turn_id'],'contextSha256':sha}


def record_state(service,thread_id):
    # Auxiliary projection failure cannot undo/redirect a committed dispatch or
    # change the truth of a terminal Core Run. Reads still verify Core separately.
    try:_record_state(service,thread_id)
    except Exception as error:
        logging.getLogger(__name__).warning('Conversation observation unavailable: %s',type(error).__name__)


def _record_state(service,thread_id):
    """Append Web observations of committed facts; never rewrite a Core Run."""
    with service._web() as c:
        if not c.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='runtime_turns'").fetchone():return
        store.guard(c)
        turn=c.execute('SELECT turn_id FROM main.runtime_turns WHERE thread_id=?',(thread_id,)).fetchone()
    if turn is None:return
    row=service._row_unscoped(thread_id)
    payload={'web_status':row['status'],'proposal_id':row['proposal_id'],'approved_digest':row['approved_digest'],
        'reserved_run_id':row['reserved_run_id'],'error_code':row['error_code'],'core_outcome':None,'evidence_sha256':None}
    project,_=service._project(row['project_id'])
    with service._core(project) as core:
        run=core.execute('SELECT status FROM main.runs WHERE run_id=?',(row['reserved_run_id'],)).fetchone()
        if run and run[0] in ('COMPLETED','FAILED'):
            try:
                feedback=extract_verified_feedback(core,row['reserved_run_id'])
                payload.update(core_outcome=feedback['run_status'],evidence_sha256=feedback['evidence_sha256'])
            except (ValueError,sqlite3.Error):
                payload['integrity_unverified']=True
    with service._web() as c:
        if c.in_transaction:raise ValueError('conversation observation owns transaction')
        c.execute('BEGIN IMMEDIATE')
        try:store.observe(c,turn[0],'OBSERVED_RUNTIME_STATE',payload);c.commit()
        except BaseException:c.rollback();raise


class ConversationService:
    def __init__(self,runtime):
        self.runtime=runtime
        with runtime._web() as c:
            if getattr(runtime.providers, 'initialize_storage', True):store.initialize(c)
            else:store.guard(c)

    def _rows(self,project_id,conversation_id):
        self.runtime._project(project_id)
        store.identity(conversation_id,'conversation')
        with self.runtime._web() as c,store.snapshot(c):
            conversation=c.execute('SELECT * FROM main.runtime_conversations WHERE conversation_id=? AND project_id=?',(conversation_id,project_id)).fetchone()
            if conversation is None:_error('CONVERSATION_NOT_FOUND',status=404)
            turns=[dict(row) for row in c.execute('SELECT * FROM main.runtime_turns WHERE conversation_id=? ORDER BY turn_number',(conversation_id,))]
        return dict(conversation),turns

    def _prepare(self,project_id,body,conversation_id=None):
        required={'prompt','messageId','profileId','profileRevision','skillRef'}
        if type(body) is not dict or not required<=body.keys()<=required|{'taskTemplateId'}:_error('INVALID_TURN',status=400)
        store.identity(body['messageId'],'msg')
        prompt=body['prompt']
        if type(prompt) is not str or not prompt.strip() or len(prompt)>MAX_PROMPT_CHARS:_error('INVALID_PROMPT',status=400)
        try:
            if len(prompt.encode('utf-8',errors='strict'))>store.MAX_MESSAGE_BYTES:_error('INVALID_PROMPT',status=400)
        except UnicodeError:_error('INVALID_PROMPT',status=400)
        self.runtime.providers.check_text(prompt)
        template_id=body.get('taskTemplateId','default')
        if type(template_id) is not str:_error('TASK_TEMPLATE_UNAVAILABLE',status=400)
        template,root,manifest,template_sha=_template(self.runtime,project_id,template_id)
        new=conversation_id is None
        conversation_id=conversation_id or 'conversation_'+uuid4().hex
        turns=[] if new else self._rows(project_id,conversation_id)[1]
        if len(turns)>=store.MAX_TURNS:_error('CONVERSATION_LIMIT')
        history=[]
        for turn in turns:
            row=self.runtime._row(project_id,turn['thread_id'])
            self.runtime._verify_job(row)
            with self.runtime._web() as c:
                ctx,_,_=store.context(c,turn['turn_id'])
            entry={'turn_id':turn['turn_id'],'turn_number':turn['turn_number'],
                'user_message':row['prompt'],'task_spec_sha256':strict_json(row['manifest_json'])['taskSha256'],
                'proposal_id':row['proposal_id'],'approved_plan_sha256':row['approved_digest'],
                'run_id':row['reserved_run_id'] if row['approved_digest'] else None,
                'skill_ref':strict_json(row['skill_json']),'provider_revision':strict_json(row['profile_json'])['revision'],
                'provider_profile_id':strict_json(row['profile_json'])['id'],'web_status':row['status'],
                'context_sha256':hashlib.sha256(canonical_json_bytes(ctx)).hexdigest(),
                'verified_core_outcome':None,'evidence':[]}
            if turn in turns[-store.MAX_HISTORY_TURNS:] and row['approved_digest']:
                project,_=self.runtime._project(project_id)
                with self.runtime._core(project) as core:
                    try:feedback=extract_verified_feedback(core,row['reserved_run_id'])
                    except (ValueError,sqlite3.Error):_error('SOURCE_EVIDENCE_UNVERIFIED')
                entry.update(verified_core_outcome=feedback['run_status'],
                    evidence=[{'kind':'NORMAL_TERMINAL','event_id':feedback['terminal_event_id'],
                               'seq':feedback['terminal_seq'],'evidence_sha256':feedback['evidence_sha256']},
                              {'kind':'INDEPENDENT_ACCEPTANCE','validation':feedback['validation']}])
            history.append(entry)
        source={'kind':'PROJECT_TEMPLATE_SEED','template_sha256':template_sha}
        if turns:
            last=self.runtime._row(project_id,turns[-1]['thread_id'])
            if last['status'] not in ('FINISHED','FAILED'):_error('TURN_UNRESOLVED','The prior turn is active or UNKNOWN; no automatic continuation.')
            project,_=self.runtime._project(project_id)
            with self.runtime._core(project) as c:
                run=c.execute('SELECT 1 FROM main.runs WHERE run_id=?',(last['reserved_run_id'],)).fetchone()
            if run:
                captured,source=_verified_source(self.runtime,last)
            elif last['status']=='FAILED' and last['approved_digest'] is None:
                with self.runtime._web() as c:
                    if c.execute('SELECT 1 FROM main.runtime_dispatches WHERE job_id=?',(last['id'],)).fetchone():_error('TURN_UNRESOLVED')
                facts=strict_json(last['manifest_json'])
                verify_snapshot(self.runtime._directory(last['id']),facts,self.runtime.providers.check_text)
                captured=capture_seed(self.runtime._directory(last['id'])/'seed',self.runtime.providers.check_text,facts['seed'])
                source={'kind':'PLANNING_FAILED_PRIVATE_SEED','thread_id':last['id'],'thread_manifest_sha256':store.digest(facts)}
            else:_error('TURN_UNRESOLVED')
        else:captured=capture_seed(root,self.runtime.providers.check_text,manifest)
        turn_id='turn_'+uuid4().hex
        context_json=build_context(conversation_id,turn_id,len(turns)+1,prompt,history,source,captured,template_id,template_sha)
        value=strict_json(context_json);value['project_id']=project_id
        context_json=canonical_json_bytes(value).decode()
        if len(context_json.encode())>store.MAX_CONTEXT_BYTES:_error('CONTEXT_LIMIT')
        self.runtime.providers.check_text(context_json)
        return PreparedTurn(conversation_id,turn_id,len(turns)+1,body['messageId'],template_id,
            canonical_json_bytes(asdict(template)).decode(),context_json,captured,new)

    def _admit(self,project_id,body,conversation_id=None):
        prepared=self._prepare(project_id,body,conversation_id)
        input_body={k:body[k] for k in ('prompt','profileId','profileRevision','skillRef')}
        self.runtime.create_thread(project_id,input_body,_turn=prepared)
        return self.get(project_id,prepared.conversation_id)

    def start(self,project_id,body):return self._admit(project_id,body)
    def append(self,project_id,conversation_id,body):return self._admit(project_id,body,conversation_id)

    def list(self,project_id):
        self.runtime._project(project_id)
        with self.runtime._web() as c,store.snapshot(c):
            rows=[dict(row) for row in c.execute('SELECT * FROM main.runtime_conversations WHERE project_id=? ORDER BY created_at DESC LIMIT 100',(project_id,))]
        result=[]
        for row in rows:
            _,turns=self._rows(project_id,row['conversation_id'])
            last=self.runtime._row(project_id,turns[-1]['thread_id'])
            result.append({'id':row['conversation_id'],'projectId':project_id,'title':row['title'],
                'createdAt':row['created_at'],'updatedAt':last['updated_at'],'status':last['status'],
                'turnCount':len(turns),'threadIds':[t['thread_id'] for t in turns]})
        return result

    def get(self,project_id,conversation_id):
        conversation,rows=self._rows(project_id,conversation_id)
        turns=[]
        for turn in rows:
            row=self.runtime._row(project_id,turn['thread_id'])
            with self.runtime._web() as c,store.snapshot(c):
                _,sha,_=store.context(c,turn['turn_id'])
                dispatch=c.execute('SELECT dispatch_id FROM main.runtime_dispatches WHERE job_id=?',(turn['thread_id'],)).fetchone()
            core_outcome=None;ended_at=None
            if row['status'] in ('FINISHED','FAILED') and row['approved_digest']:
                project,_=self.runtime._project(project_id)
                with self.runtime._core(project) as core:
                    try:
                        feedback=extract_verified_feedback(core,row['reserved_run_id'])
                        core_outcome=feedback['run_status']
                        ended_at=core.execute('SELECT ended_at FROM main.runs WHERE run_id=?',(row['reserved_run_id'],)).fetchone()[0]
                    except (ValueError,sqlite3.Error):pass
            turns.append({'id':turn['turn_id'],'number':turn['turn_number'],'threadId':turn['thread_id'],
                'reservedRunId':turn['reserved_run_id'],'prompt':row['prompt'],'webStatus':row['status'],
                'coreOutcome':core_outcome,'outcomeObservedAt':ended_at,
                'proposalId':row['proposal_id'],'approvalIdentity':dispatch[0] if dispatch else None,
                'contextSha256':sha,'taskTemplateId':turn['task_template_id'],
                'profileSnapshot':strict_json(row['profile_json']),'skillRef':strict_json(row['skill_json'])})
        can_continue=not rows or (len(rows)<store.MAX_TURNS and turns[-1]['webStatus'] in ('FINISHED','FAILED')
            and (turns[-1]['coreOutcome'] in ('COMPLETED','FAILED') or turns[-1]['approvalIdentity'] is None and turns[-1]['webStatus']=='FAILED'))
        return {'id':conversation_id,'projectId':project_id,'title':conversation['title'],'createdAt':conversation['created_at'],
            'turns':turns,'sequential':True,'maximumTurns':store.MAX_TURNS,
            'canContinue':can_continue,
            'continuationPolicy':'Reverify normal Core evidence and captured bytes; UNKNOWN is blocked. Each new turn requires new approval.'}

    def get_turn(self,project_id,conversation_id,turn_id):
        store.identity(turn_id,'turn')
        _,rows=self._rows(project_id,conversation_id)
        turn=next((row for row in rows if row['turn_id']==turn_id),None)
        if turn is None:_error('TURN_NOT_FOUND',status=404)
        thread=self.runtime.get_thread(project_id,turn['thread_id'])
        with self.runtime._web() as c,store.snapshot(c):
            _,sha,raw=store.context(c,turn_id)
            observations=[dict(row) for row in c.execute('SELECT * FROM main.runtime_turn_observations WHERE turn_id=? ORDER BY observation_id',(turn_id,))]
        messages=[{'id':turn['user_message_id'],'type':'USER_MESSAGE','source':'IMMUTABLE_WEB_MESSAGE','text':thread['prompt']}]
        if thread['proposal']:
            messages.append({'id':thread['proposalId'],'type':'MODEL_PLANNING_RESULT','source':'CORE_PLAN_PROPOSAL','planSha256':thread['proposal']['planSha256']})
        for event in thread['run']['events'] if thread['run'] else []:
            kind='VALIDATION_RESULT' if event['type'] in ('VALIDATION_PASSED','VALIDATION_FAILED') else 'TOOL_EVIDENCE' if event['type'] in ('TOOL_INTENT','TOOL_RESULT','FILE_OBSERVED','STEP_CONFIRMED') else 'SYSTEM_ACTIVITY'
            messages.append({'id':event['id'],'type':kind,'source':'PERSISTED_CORE_EVENT','runId':thread['runId'],'seq':event['seq'],'eventType':event['type']})
        messages.append({'id':'presentation_'+turn_id,'type':'ASSISTANT_PRESENTATION','source':'DERIVED_FROM_PERSISTED_FACTS',
            'text':'执行结果尚不确定，不自动继续。' if thread['status']=='UNKNOWN' else '本轮状态由已记录的计划、工具与验收事实呈现；不是模型原话。'})
        return {'id':turn_id,'conversationId':conversation_id,'number':turn['turn_number'],'thread':thread,
            'contextSha256':sha,'messages':messages,'observations':[{'kind':o['kind'],'payload':strict_json(o['payload_json']),'observedAt':o['observed_at']} for o in observations]}

    def context(self,project_id,conversation_id,turn_id):
        self.get_turn(project_id,conversation_id,turn_id)
        with self.runtime._web() as c,store.snapshot(c):
            value,sha,raw=store.context(c,turn_id)
        return {'turnId':turn_id,'conversationId':conversation_id,'sha256':sha,'canonicalJson':raw,
                'manifest':value,'semanticLocation':'Core planning request.task_spec.goal'}

    def approve(self,project_id,conversation_id,turn_id,body):
        detail=self.get_turn(project_id,conversation_id,turn_id)
        self.runtime.approve(project_id,detail['thread']['id'],body)
        return self.get_turn(project_id,conversation_id,turn_id)

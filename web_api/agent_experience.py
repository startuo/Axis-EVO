"""Frozen development cases and bounded diagnostics, never self-authored oracles."""
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from .agent_store import digest
from .agent_workspace import fail
from .schemas import no_redirected_parents


def capture(service, wid, feedback):
    from .agent_evaluation_runner import capture_inputs
    if len(service.store.records('task_experience',workspace_id=wid,limit=201))>=200:
        fail('EXPERIENCE_INPUT_LIMIT','已保留200个历史任务；本次没有自动删除或替换旧证据。',409)
    materials,sources,history,source=capture_inputs(service,wid,feedback['parentId'])
    if len(materials)>256:
        fail('EXPERIENCE_INPUT_LIMIT','历史反例最多保留256份完整文本。',409)
    directory=service.store.directory/'agent-experience'/('case_'+uuid4().hex)
    no_redirected_parents(directory)
    directory.mkdir(parents=True)
    files=[]
    for index,row in enumerate(materials):
        filename=str(index)+'.bin'
        with (directory/filename).open('xb') as stream:
            stream.write(row['data'])
        files.append({k:v for k,v in row.items() if k!='data'}|{'blob':filename,'sizeBytes':len(row['data'])})
    value={'directory':str(directory),'files':files,'sources':sources,'history':history,
        'sourceTurnId':source['id'],'feedbackId':feedback['id'],'feedbackSha256':digest(feedback['payload']),
        'executionPolicyId':service.execution.policy(wid)['id'],'role':'FROZEN_DEVELOPMENT_CASE_NOT_HOLDOUT'}
    return service.store.append('task_experience',value,wid,feedback['id'])


def load_inputs(service, wid, experience_id):
    row=service.store.get(experience_id,'task_experience')
    if row['workspaceId']!=wid:
        fail('EXPERIENCE_SCOPE','历史任务不属于当前工作区。',403)
    value=row['payload']
    if value['executionPolicyId']!=service.execution.policy(wid)['id']:
        fail('EXPERIENCE_POLICY_CHANGED','历史任务的固定验证授权已改变，不能混用评价依据。',409)
    feedback=service.store.get(value['feedbackId'],'agent_feedback')
    if digest(feedback['payload'])!=value['feedbackSha256']:
        fail('EXPERIENCE_INTEGRITY','历史反馈依据无法核对。',409)
    for origin in value['sources']:
        service.workspaces.source(wid,origin['id'])
    directory=Path(value['directory'])
    if not directory.is_relative_to(service.store.directory/'agent-experience'):
        fail('EXPERIENCE_INTEGRITY','历史副本位置无法核对。',409)
    materials=[]
    for item in value['files']:
        if Path(item['blob']).name!=item['blob']:
            fail('EXPERIENCE_INTEGRITY','历史副本路径无效。',409)
        path=directory/item['blob']
        no_redirected_parents(path)
        with path.open('rb') as stream:
            raw=stream.read(128*1024+1)
        if len(raw)!=item['sizeBytes'] or hashlib.sha256(raw).hexdigest()!=item['sha256']:
            fail('EXPERIENCE_INTEGRITY','历史副本字节无法核对。',409)
        materials.append({k:item[k] for k in ('sourceId','path','sha256')}|{'data':raw})
    return materials,value['sources'],value['history'],service.store.get(value['sourceTurnId'],'turn')


def tool_incidents(task):
    """A corrected pre-dispatch argument rejection is not an unknown operation."""
    events=task.get('events',[])
    calls={}
    for event in events:
        if event['kind']=='assistant':
            for call in event['payload'].get('message',{}).get('tool_calls',[]):
                try:
                    args=json.loads(call['function']['arguments'])
                except (ValueError,KeyError):
                    args={}
                name=call['function']['name']
                calls[call['id']]=('file-write' if name in ('write_file','patch_file') else name,args.get('path') if type(args) is dict else None)
    results=[event for event in events if event['kind']=='tool_result']
    incidents=[]
    for index,event in enumerate(results):
        row=event['payload']
        if row.get('status')=='SUCCESS':
            continue
        target=calls.get(row.get('callId'))
        recovered=(target is not None and row.get('status')=='REJECTED'
            and row.get('code') in ('AGENT_TOOL_ARGUMENTS','EXECUTION_TIMEOUT','PATCH_AMBIGUOUS')
            and any(later['payload'].get('status')=='SUCCESS' and calls.get(later['payload'].get('callId'))==target
                for later in results[index+1:]))
        incidents.append({'id':event['id'],'status':row.get('status'),'code':row.get('code'),
            'recoveredAdmission':recovered,'recoveryBasis':'LATER_CONFIRMED_SAME_TOOL_TARGET' if recovered else None})
    return incidents


def diagnose(task, feedback):
    incidents=tool_incidents(task)
    failures=[row for row in incidents if not row['recoveredAdmission']]
    if feedback['scope']=='TASK_ONLY':
        category,action='ONE_TASK_PREFERENCE','RETAIN_FEEDBACK'
    elif task['status'] in ('UNKNOWN','INTERRUPTED'):
        category,action='EXECUTION_UNKNOWN','STOP'
    elif failures or task['status']!='COMPLETED':
        category,action='TOOL_OR_ENVIRONMENT_UNCONFIRMED','OBSERVE'
    elif feedback['evaluation']=='UNABLE_TO_ASSESS':
        category,action='ROOT_CAUSE_UNCERTAIN','OBSERVE'
    elif not feedback['skillId']:
        category,action='NO_UNAMBIGUOUS_SKILL','OBSERVE'
    elif feedback['evaluation']=='MET_EXPECTATIONS':
        category,action='CONFIRMED_USER_PREFERENCE','RETAIN_REGRESSION_CASE'
    else:
        category,action='REUSABLE_IMPROVEMENT_HYPOTHESIS','COMPARE_CANDIDATE'
    return {'category':category,'recommendedAction':action,'rootCauseProven':False,
        'basis':'TASK_STATUS_TOOL_RECEIPTS_AND_EXPLICIT_FEEDBACK','toolFailures':len(failures),
        'resolvedAdmissionErrors':[row for row in incidents if row['recoveredAdmission']],
        'possibleStrategies':['instruction_or_workflow_revision','fixed_regression_case','tool_or_environment_repair'],
        'automatedStrategy':'instruction_or_workflow_revision_with_fixed_checks' if action=='COMPARE_CANDIDATE' else None}


def cost(task):
    events=task.get('events',[])
    return {'modelRequests':sum(e['kind']=='model_request' for e in events),
        'toolCalls':sum(e['kind']=='tool_intent' for e in events),
        'commandDurationMs':sum((e['payload'].get('data') or {}).get('durationMs',0)
            for e in events if e['kind']=='tool_result')+sum(e['payload']['result'].get('durationMs',0)
                for e in events if e['kind']=='verification_result')}

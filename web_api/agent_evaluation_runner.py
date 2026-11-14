"""Execute baseline and candidate instructions on identical isolated inputs.

No original task action, browser operation or output write is replayed. This is a
new development comparison, not an unseen research experiment.
"""
import hashlib
import os
from pathlib import Path
from uuid import uuid4

from .agent_store import digest
from .agent_workspace import root_identity, relative_path, MAX_FILE_BYTES
from .schemas import ApiError, no_redirected_parents


MAX_SNAPSHOT_BYTES=2*1024*1024


def _file_key(source_id, path):
    # Windows aliases cannot become different evidence identities.
    return source_id, path.casefold() if os.name == 'nt' else path


def evaluate_candidate(service, request):
    check_current=lambda: service.evolution.assert_cycle_current(request['workspaceId'],request['cycleId'])
    check_current()
    source=service.store.get(request['sourceTurnId'],'turn')
    workspace=service.workspaces.get(request['workspaceId'])
    if source['workspaceId']!=workspace['id']:
        raise ApiError('EVALUATION_SCOPE','原任务与工作区不一致。',409)
    history=source['payload'].get('contextMessages')
    if history is None and len(service.store.records('turn',parent_id=source['parentId'],limit=2))>1:
        raise ApiError('EVALUATION_CONTEXT_UNAVAILABLE','此旧任务没有保留完整对话输入，不能自动重建对照。',409)
    history=history or []
    # Snapshot approved text with the same path fence used by live tools.
    materials=[]
    total=0
    sources=[{'id':'workspace','name':workspace['name'],'kind':'workspace'}]+[
        s for s in workspace['sources'] if s['enabled'] and s['kind']=='knowledge']
    for origin in sources:
        check_current()
        listing=service.workspaces.files(workspace['id'],origin['id'])
        if listing['truncated']:
            raise ApiError('EVALUATION_INPUT_LIMIT','材料过多，无法建立完整的有界对照副本。',409)
        for item in listing['files']:
            check_current()
            material=service.workspaces.read(workspace['id'],origin['id'],item['path'],max_chars=MAX_FILE_BYTES)
            data=material['content'].encode('utf-8')
            # BOM/encoding changes cannot silently become original byte evidence.
            if hashlib.sha256(data).hexdigest()!=material['sha256']:
                raise ApiError('EVALUATION_ENCODING','此材料需要保持原始编码后再评价。',409)
            total+=len(data)
            if total>MAX_SNAPSHOT_BYTES:
                raise ApiError('EVALUATION_INPUT_LIMIT','对照材料超过2MiB。',409)
            materials.append({'sourceId':origin['id'],'path':item['path'],'data':data,'sha256':material['sha256']})
    # Restore the pre-task content of files that this source task changed. A new
    # output is omitted, so neither evaluator can copy the already-solved answer.
    restored=set()
    source_events=service.store.records(parent_id=source['id'],limit=1000)
    for artifact in (event for event in source_events if event['kind']=='artifact'):
        payload=artifact['payload']
        key=_file_key('workspace',payload['path'])
        if key in restored:
            continue
        restored.add(key)
        materials=[m for m in materials if _file_key(m['sourceId'],m['path'])!=key]
        if payload['previousSha256']:
            directory=Path(payload['directory'])
            if not directory.is_relative_to(service.store.directory/'agent-files'):
                raise ApiError('EVALUATION_INPUT_INTEGRITY','原文件版本来源无法核对。',409)
            backup=directory/'before.bin'
            no_redirected_parents(backup)
            data=backup.read_bytes()
            if len(data)>MAX_FILE_BYTES or hashlib.sha256(data).hexdigest()!=payload['previousSha256']:
                raise ApiError('EVALUATION_INPUT_INTEGRITY','原文件版本摘要不一致。',409)
            materials.append({'sourceId':'workspace','path':payload['path'],'data':data,'sha256':payload['previousSha256']})
    # Direct read facts catch input drift since the source task. Never call that
    # a like-for-like evaluation if the underlying material changed meanwhile.
    material_hashes={_file_key(m['sourceId'],m['path']):m['sha256'] for m in materials}
    for result in source_events:
        if result['kind']=='artifact':
            data=result['payload']
            material_hashes[_file_key('workspace',data['path'])]=data['sha256']
            continue
        if result['kind']!='tool_result':
            continue
        data=result['payload'].get('data') or {}
        if {'sourceId','path','sha256','content'}<=data.keys():
            if material_hashes.get(_file_key(data['sourceId'],data['path']))!=data['sha256']:
                raise ApiError('EVALUATION_INPUT_CHANGED','原任务输入已改变，停止自动对照。',409)
    if sum(len(m['data']) for m in materials)>MAX_SNAPSHOT_BYTES:
        raise ApiError('EVALUATION_INPUT_LIMIT','原始对照材料超过2MiB。',409)
    snapshot_manifest=[{k:v for k,v in m.items() if k!='data'} for m in materials]
    service.store.append('evaluation_snapshot',{'cycleId':request['cycleId'],'inputs':snapshot_manifest,
        'manifestSha256':digest(snapshot_manifest),'contextSha256':digest(history),
        'scope':'ISOLATED_DEVELOPMENT_REPLAY'},workspace['id'],request['cycleId'])
    result={}
    for role,skill,key in (('REFERENCE',request['referenceSkill'],'referenceTurnId'),('CANDIDATE',request['candidateSkill'],'candidateTurnId')):
        check_current()
        directory=service.store.directory/'agent-evaluations'/('eval_'+uuid4().hex)
        no_redirected_parents(directory)
        root=directory/'workspace'
        root.mkdir(parents=True,exist_ok=False)
        wid=service.store.append('workspace',{'name':'Skill comparison '+role,'path':str(root),
            'rootIdentity':root_identity(root),'policy':{'writeMode':'write','evolutionMode':'off','style':workspace['policy']['style']},
            'shareWithProvider':True,'internalEvaluation':True})['id']
        mapped={'workspace':root}
        for origin in sources[1:]:
            material_root=directory/('source_'+uuid4().hex)
            material_root.mkdir()
            service.store.append('source',{'name':origin['name'],'kind':'knowledge','path':str(material_root),
                'rootIdentity':root_identity(material_root),'shareWithProvider':True},wid)
            mapped[origin['id']]=material_root
        for material in materials:
            check_current()
            target=mapped[material['sourceId']]/relative_path(material['path'])
            target.parent.mkdir(parents=True,exist_ok=True)
            no_redirected_parents(target)
            with target.open('xb') as stream:
                stream.write(material['data'])
        profile=request['profile']
        conversation=service.submit({'workspaceId':wid,'requestId':uuid4().hex,'prompt':request['prompt'],
            'profileId':profile['id'],'profileRevision':profile['revision']},
            evaluation={'cycleId':request['cycleId'],'role':role,'sourceTurnId':source['id']},forced_skill=skill,inline=True,
            context_messages=history)
        result[key]=conversation['turns'][0]['id']
        check_current()
    return result

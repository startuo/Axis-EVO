"""Reuse completed isolated reference executions, never ordinary task guesses."""
import hashlib
from pathlib import Path
import platform

from .agent_store import digest
from .agent_experience import cost, tool_incidents
from .agent_skill_gate import task_summary


def harness_identity():
    root=Path(__file__).resolve().parent.parent
    files=sorted((root/'web_api').glob('agent_*.py'))+sorted((root/'src/axis_evo').glob('*.py'))
    return digest({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files})


def fingerprint(service, request, materials, sources, history, execution, workspace):
    return digest({'schema':'isolated-reference-cache-v1','harness':harness_identity(),
        'python':platform.python_version(),'platform':platform.system(),
        'workspaceId':workspace['id'],'authorityRevision':workspace['revision'],
        'style':workspace['policy']['style'],'sourceTurnId':request['sourceTurnId'],
        'prompt':request['prompt'],'checks':request['checks'],'history':history,'sources':sources,
        'materials':[{k:v for k,v in m.items() if k!='data'} for m in materials],
        'profile':request['profile'],'skill':request['referenceSkill'],'execution':execution,
        'toolCatalog':service.tools.catalog()})


def evidence(service, tid):
    task=service.turn(tid)
    latest={a['path']:a for a in task['artifacts']}
    if (task['status']!='COMPLETED' or not task.get('evaluation')
            or task['evaluation']['role']!='REFERENCE' or len(task['skillUses'])!=1
            or any(not row['recoveredAdmission'] for row in tool_incidents(task))
            or not latest or any(not a['verified'] for a in latest.values())
            or any(e['kind']=='file_operation' for e in task['events'])):
        return None
    verifications=service.store.records('evaluation_verification',parent_id=tid,limit=1)
    if any(c['result'].get('status')!='SUCCESS' for row in verifications for c in row['payload']['checks']):
        return None
    return {'task':task_summary(task),'eventsSha256':digest(task['events']),
        'verificationSha256':digest(verifications),'cost':cost(task)}


def lookup(service, wid, key):
    for row in reversed(service.store.records('reference_cache',workspace_id=wid,limit=200)):
        value=row['payload']
        if value['fingerprint']!=key:
            continue
        try:
            current=evidence(service,value['turnId'])
        except (OSError,ValueError):
            current=None
        if current is not None and current==value['evidence']:
            return row
    return None


def remember(service, wid, cycle, key, tid):
    observed=evidence(service,tid)
    if observed is not None:
        return service.store.append('reference_cache',{'fingerprint':key,'turnId':tid,'evidence':observed},wid,cycle)
    return None

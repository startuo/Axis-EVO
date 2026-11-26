"""Conservative adopted-instruction monitoring; no semantic truth by model vote."""
from .agent_store import digest
from .agent_skill_gate import check_document
from .agent_experience import tool_incidents


def monitor(service, task):
    if task.get('evaluation') or task['status']!='COMPLETED':
        return
    wid=task['workspaceId']
    latest={a['path']:a for a in task['artifacts']}
    for skill in task['skillUses']:
        adopted=[r for r in service.store.records('skill_adoption',workspace_id=wid,limit=1000)
            if r['payload']['skillId']==skill['skillId'] and r['payload']['version']==skill['version']]
        if not adopted:
            continue
        adoption=adopted[-1]
        gate=service.store.get(adoption['payload']['gateId'],'evolution_gate')['payload']
        failed=[]
        for row in gate['checks']:
            for document in row['documents']:
                path=document['path']
                artifact=latest.get(path)
                if (document['candidatePassed'] and artifact and artifact['verified']
                        and isinstance(artifact['content'],str) and not check_document(artifact['content'],row['check'])):
                    failed.append({'path':path,'check':row['check']})
        payload={'skillId':skill['skillId'],'version':skill['version'],'adoptionId':adoption['id'],
            'failedChecks':failed,'status':'REGRESSION_SIGNAL' if failed else 'NO_OBSERVED_LITERAL_REGRESSION',
            'semanticQuality':'NOT_ASSESSED','coverage':'OBSERVED_DELIVERY_PATHS_ONLY','automaticRollback':False}
        if failed and service.evolution.get_policy(wid)['mode']=='AUTO' and not any(not r['recoveredAdmission'] for r in tool_incidents(task)):
            from .agent_evaluation_runner import capture_inputs
            from .agent_evaluation_cache import harness_identity
            try:
                materials,sources,history,_=capture_inputs(service,wid,task['id'])
                snapshots=service.store.records('evaluation_snapshot',workspace_id=wid,parent_id=adoption['parentId'],limit=100)
                inputs=[{k:v for k,v in m.items() if k!='data'} for m in materials]
                source=service.store.get(gate['reference']['turnId'],'turn')
                current=service.store.get(task['id'],'turn')
                conditions=(bool(snapshots) and snapshots[0]['payload']['inputs']==inputs
                    and snapshots[0]['payload'].get('harnessSha256')==harness_identity()
                    and snapshots[0]['payload']['contextSha256']==digest(history)
                    and source['payload']['prompt']==current['payload']['prompt']
                    and source['payload']['profile']==current['payload']['profile']
                    and service.store.get(adoption['parentId'],'evolution_cycle')['payload']['authority']['executionPolicyId']
                        ==current['payload'].get('executionPolicyId'))
                if conditions and service.evolution.use_skill(wid,skill['skillId'])['version']==skill['version']:
                    service.evolution.rollback(wid,{'skillId':skill['skillId'],'version':adoption['payload']['previousVersion'],
                        'reason':'Same frozen input/model/check conditions: adopted literal requirement failed.'},automatic=True)
                    payload['automaticRollback']=True
                    payload['status']='ROLLED_BACK_FIXED_CHECK_REGRESSION'
            except Exception:
                payload['comparison']='UNCONFIRMED_NO_AUTOMATIC_ROLLBACK'
        service.store.append('skill_monitor',payload,wid,task['id'])

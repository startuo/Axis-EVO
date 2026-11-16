"""Agent routes run behind Runtime's existing Origin/session/CSRF boundary."""
from .schemas import ApiError


def read(service,tail):
    if tail==['state']:
        return service.state()
    if len(tail)==2 and tail[0]=='conversations':
        return service.conversation(tail[1])
    if len(tail)==2 and tail[0]=='turns':
        return service.turn(tail[1])
    if len(tail)==3 and tail[0]=='turns' and tail[2]=='changes':
        from .agent_project import changes
        return changes(service,tail[1])
    if len(tail)>=3 and tail[0]=='workspaces':
        wid=tail[1]
        service.workspaces.get(wid)
        if tail[2:]==['conversations']:
            return service.conversations(wid)
        if tail[2:]==['skills']:
            return {'skills':service.evolution.list_skills(wid)}
        if tail[2:]==['execution']:
            return {'policy':service.execution.public_policy(wid),'environment':service.execution.runner.status()}
        if tail[2:]==['evolution']:
            return {'policy':service.evolution.get_policy(wid),'cycles':service.evolution.list_cycles(wid)}
    raise ApiError('ROUTE_NOT_FOUND','Agent 查询不存在。',404)


def mutate(service,tail,body):
    if tail==['workspaces']:
        return service.create_workspace(body)
    if tail==['turns']:
        return service.submit(body)
    if len(tail)==3 and tail[0]=='turns':
        if tail[2]=='feedback':
            return service.feedback(tail[1],body)
        if tail[2]=='cancel':
            return service.cancel(tail[1],body)
    if len(tail)>=3 and tail[0]=='workspaces':
        wid=tail[1]
        service.workspaces.get(wid)
        if tail[2:]==['settings']:
            return service.settings(wid,body)
        if tail[2:]==['execution']:
            return service.execution.configure(wid,body)
        if tail[2:]==['evolution','rollback']:
            return service.evolution.rollback(wid,body)
        if tail[2:]==['sources']:
            with service._lock:
                return service.workspaces.add_source(wid,body)
        if len(tail)==5 and tail[2]=='sources' and tail[4]=='revoke' and body=={}:
            with service._lock:
                return service.workspaces.revoke_source(wid,tail[3])
        if tail[2:]==['evolution','policy']:
            with service._lock:
                result=service.evolution.set_policy(wid,body)
                current=service.workspaces.get(wid)['policy']
                service.workspaces.settings(wid,{**current,'evolutionMode':body['mode'].lower()})
                return result
    raise ApiError('ROUTE_NOT_FOUND','Agent 操作不存在。',404)

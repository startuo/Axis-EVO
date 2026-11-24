"""Agent routes run behind Runtime's existing Origin/session/CSRF boundary."""
from .app import WorkbenchHandler
from .schemas import ApiError


def _read_fields(tail):
    if len(tail) == 3 and tail[0] == 'conversations' and tail[2] == 'summary':
        return {'sinceSeq'}
    if len(tail) >= 3 and tail[0] == 'workspaces':
        suffix = tail[2:]
        if suffix == ['files']:
            return {'path'}
        if suffix == ['files', 'read']:
            return {'path', 'maxBytes'}
        if suffix == ['git', 'diff']:
            return {'path', 'staged'}
        if suffix == ['git', 'compare']:
            return {'base'}
        if suffix == ['git', 'log']:
            return {'limit'}
    if tail == ['browser', 'tabs']:
        return {'instanceId'}
    return set()


def read(service,tail,raw_query=''):
    values = WorkbenchHandler._query(raw_query, _read_fields(tail))
    params = {key: field[0] for key, field in values.items()}
    if tail==['state']:
        return service.state()
    if len(tail)==2 and tail[0]=='conversations':
        return service.conversation(tail[1])
    if len(tail)==3 and tail[0]=='conversations' and tail[2]=='summary':
        cursor = WorkbenchHandler._integer(values, 'sinceSeq', 0, 0, 999_999_999)
        return service.conversation_summary(tail[1], cursor)
    if len(tail)==2 and tail[0]=='artifacts':
        return service.artifact_by_id(tail[1])
    if len(tail)==2 and tail[0]=='events':
        return service.event_by_id(tail[1])
    if tail==['browser','status']:
        return service.browser.status()
    if tail==['browser','tabs']:
        if not params.get('instanceId'):
            raise ApiError('EDGE_REQUEST_REJECTED', '请明确选择 Edge 实例。')
        return service.browser.tabs(params)
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
            evolution = service.evolution
            return {'skills': evolution.list_skills(wid), 'cycles': evolution.list_cycles(wid),
                    'policy': evolution.get_policy(wid)}
        if len(tail) == 5 and tail[2] == 'skills' and tail[4] == 'versions':
            return service.evolution.list_versions(wid, tail[3])
        if tail[2:]==['files']:
            from .agent_project import list_directory
            return list_directory(service.workspaces, wid, params.get('path', ''))
        if tail[2:]==['files','read']:
            from .agent_project import preview_file
            maximum = WorkbenchHandler._integer(values, 'maxBytes', 262_144, 1, 2_000_000)
            return preview_file(service.workspaces, wid, params.get('path', ''), maximum)
        if len(tail) == 4 and tail[2] == 'git' and tail[3] in ('status', 'diff', 'branch', 'compare', 'log'):
            from .agent_git import user_git
            if 'staged' in params:
                if params['staged'] not in ('true', 'false'):
                    raise ApiError('INVALID_QUERY', '暂存区参数需为 true 或 false。')
                params['staged'] = params['staged'] == 'true'
            if tail[3] == 'log':
                params['limit'] = WorkbenchHandler._integer(values, 'limit', 20, 1, 100)
            return user_git(service, wid, tail[3], params)
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
        if tail[2:]==['skills','import'] and body.keys() <= {'sourceId', 'path'} and 'path' in body:
            source_id = body.get('sourceId', 'workspace')
            material = service.workspaces.read(wid, source_id, body['path'], max_chars=128*1024)
            if material['truncated']:
                raise ApiError('AGENT_SKILL_LIMIT', 'Skill 来源超过允许的完整读取范围。', 413)
            return service.evolution.import_skill(wid, source_id, material['path'],
                                                   material['content'], material['sha256'])
        if len(tail) == 4 and tail[2] == 'git' and tail[3] in ('stage', 'unstage', 'revert', 'commit'):
            from .agent_git import user_git
            return user_git(service, wid, tail[3], body)
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

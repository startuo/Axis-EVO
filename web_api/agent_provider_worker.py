"""Credential-scoped model subprocess. It receives no executable tool plugin."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

from axis_evo.process_limits import managed_popen, terminate_tree, close_process_job
from .process_environment import child_environment
from axis_evo.planning_adapter import PlanningTransportError
from .agent_metrics import usage
from .agent_store import canonical
from .agent_provider import AgentProvider, MAX_RESPONSE_BYTES
from .schemas import strict_json, no_redirected_parents


def complete_isolated(providers, profile, messages, tools, cancelled, *, cache_key=None):
    """A killed/late model reply is never dispatched to a tool. No retries."""
    config=providers.config
    env_name=config.credentials[profile['credentialRef']]
    ref=profile['credentialRef']
    attempt='agent_'+uuid4().hex
    descriptor={'data_dir':str(config.data_dir),'credentials':{ref:env_name},
        'endpoints':list(config.endpoints),'local_gateways':[{'endpoint':g.endpoint,'model_ids':list(g.model_ids)} for g in config.local_gateways],
        'provider_routes':[r.to_dict() for r in config.provider_routes],
        'profile':profile,'messages':messages,'tools':tools,'attempt':attempt}
    if cache_key is not None:
        descriptor['cache_key'] = cache_key
    path=config.data_dir/(attempt+'-model.json')
    no_redirected_parents(path)
    root=Path(__file__).resolve().parent.parent
    env=child_environment()
    env['PYTHONPATH']=str(root/'src')+os.pathsep+str(root)
    if os.environ.get(env_name):
        env[env_name]=os.environ[env_name]
    process=None
    reader=None
    result=bytearray()
    overflow=threading.Event()
    try:
        with path.open('x',encoding='utf-8') as stream:
            stream.write(canonical(descriptor))
        process=managed_popen([sys.executable,'-m','web_api.agent_provider_worker',str(path)],cwd=root,env=env,
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=os.name!='nt')
        def drain():
            try:
                while chunk:=process.stdout.read(4096):
                    if len(result)+len(chunk)>MAX_RESPONSE_BYTES+8192:
                        overflow.set()
                        break
                    result.extend(chunk)
            except (OSError,ValueError):
                overflow.set()
            finally:
                process.stdout.close()
        reader=threading.Thread(target=drain,daemon=True)
        reader.start()
        deadline=time.monotonic()+profile['timeout']+10
        while process.poll() is None or reader.is_alive():
            if cancelled() or overflow.is_set() or time.monotonic()>deadline:
                terminate_tree(process)
                raise PlanningTransportError('cancelled' if cancelled() else 'deadline')
            time.sleep(.05)
        if process.returncode!=0:
            raise PlanningTransportError('worker_failed')
        value=strict_json(bytes(result),MAX_RESPONSE_BYTES+8192)
        if type(value) is not dict or value.keys() not in ({'message'},{'error'},{'error','reportedUsage','replyShape'}):
            raise PlanningTransportError('invalid_response')
        providers.check_text(canonical(value))
        if 'error' in value:
            error=PlanningTransportError(value['error'])
            if 'replyShape' in value:
                error.reported_usage=usage({'usage':value['reportedUsage']})
                error.reply_shape=value['replyShape']
            raise error
        return value['message']
    finally:
        if process is not None:
            if process.poll() is None:
                terminate_tree(process)
            process.wait(timeout=5)
            close_process_job(process)
        if reader is not None:
            reader.join(timeout=1)
        path.unlink(missing_ok=True)


def main(path):
    from .runtime_config import RuntimeConfig, parse_local_gateways, parse_provider_routes
    from .provider_store import ProviderStore
    path=Path(path).absolute()
    no_redirected_parents(path)
    with path.open('rb') as stream:
        value=strict_json(stream.read(512*1024+1),512*1024)
    config=RuntimeConfig(Path(value['data_dir']),(),value['credentials'],tuple(value['endpoints']),
        parse_local_gateways(value['local_gateways']),parse_provider_routes(value['provider_routes'],tuple(value['endpoints'])))
    if path.parent!=config.data_dir or path.name!=value['attempt']+'-model.json':
        raise ValueError('Unbound model descriptor')
    try:
        message=AgentProvider(ProviderStore(config,initialize=False),value['profile'],value['attempt']).complete(
            value['messages'], value['tools'], cache_key=value.get('cache_key'))
        result={'message':message}
    except PlanningTransportError as error:
        result={'error':error.category}
        if hasattr(error,'reply_shape'):
            result.update(reportedUsage=error.reported_usage,replyShape=error.reply_shape)
    sys.stdout.buffer.write(canonical(result).encode('utf-8'))
    sys.stdout.buffer.flush()


if __name__=='__main__':
    main(sys.argv[1])

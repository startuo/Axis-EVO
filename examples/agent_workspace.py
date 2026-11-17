"""Launch the product without research projects, seed templates or demo databases.

python -m examples.agent_workspace --data-dir <absolute-local-directory>
Provider enrollment and workspace grants then happen in the ordinary UI.
"""
import argparse
from pathlib import Path
import socket
import sys
import threading

from web_api.schemas import WorkbenchConfig, no_redirected_parents, strict_json, public_text
from web_api.runtime_config import RuntimeConfig, DEFAULT_ENDPOINTS, parse_local_gateways, parse_provider_routes, validate_endpoint, _ALIAS, _ENV
from web_api.provider_credentials import BackendCredentials
from web_api.provider_store import ProviderStore
from web_api.runtime_storage import initialize_runtime_storage, require_existing_runtime, require_frontend
from web_api.runtime_service import RuntimeService
from web_api.read_facade import ReadFacade
from web_api.runtime_http import RuntimeServer


def product_config(data_dir, network_config=None):
    root=Path(data_dir)
    if not root.is_absolute() or root==Path(root.anchor) or root==Path.home():
        raise ValueError('Choose an explicit scoped absolute data directory')
    no_redirected_parents(root)
    value={}
    if network_config:
        no_redirected_parents(network_config)
        with Path(network_config).open('rb') as stream:
            value=strict_json(stream.read(65537))
        if type(value) is not dict or not value.keys()<={'credentials','endpoints','local_gateways','provider_routes'}:
            raise ValueError('Only explicit network configuration is accepted')
    credentials=value.get('credentials',{})
    if type(credentials) is not dict or len(credentials)>16:
        raise ValueError('Invalid credential aliases')
    for alias,env in credentials.items():
        if (type(alias) is not str or not _ALIAS.fullmatch(alias) or public_text(alias,64)!=alias
                or type(env) is not str or not _ENV.fullmatch(env)):
            raise ValueError('Invalid credential environment reference')
    endpoints=value.get('endpoints',list(DEFAULT_ENDPOINTS))
    if type(endpoints) is not list or not 1<=len(endpoints)<=16:
        raise ValueError('Invalid endpoint allowlist')
    endpoints=tuple(validate_endpoint(endpoint) for endpoint in endpoints)
    if len(set(endpoints))!=len(endpoints):
        raise ValueError('Duplicate endpoint authority')
    return RuntimeConfig(root,(),credentials,endpoints,
        parse_local_gateways(value.get('local_gateways',[])),parse_provider_routes(value.get('provider_routes',[]),endpoints))


def serve(data_dir, network_config, port, web_root, *, open_browser=False, desktop=False):
    bound=runtime=credentials=server=None
    try:
        web_root=require_frontend(web_root) if web_root is not None else None
        config=product_config(data_dir,network_config)
        # Reserve the real socket before initializing or reconciling any facts.
        bound=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        bound.setsockopt(socket.SOL_SOCKET,getattr(socket,'SO_EXCLUSIVEADDRUSE',socket.SO_REUSEADDR),1)
        bound.bind(('127.0.0.1',port))
        workbench=WorkbenchConfig()
        credentials=BackendCredentials(config)
        config=credentials.config
        if not (config.data_dir/'runtime.sqlite3').exists():
            initialize_runtime_storage(config,workbench)
        require_existing_runtime(config,workbench)
        runtime=RuntimeService(config,workbench,ProviderStore(config,initialize=False))
        server=RuntimeServer(('127.0.0.1',port),ReadFacade(workbench),runtime,
            web_root=web_root,bound_socket=bound,credential_manager=credentials)
        bound=None
        if desktop:
            def stop_on_host_exit():
                # The launcher alone owns the write end. Closing it also
                # stops this runtime if the launcher exits unexpectedly.
                sys.stdin.buffer.read(1)
                server.shutdown()

            print(f'AXIS_READY {server.origin}/#/agent',flush=True)
            threading.Thread(target=stop_on_host_exit,daemon=True).start()
        else:
            print(f'Axis-Evo 0.1.0 Preview: {server.origin}/#/agent',flush=True)
        if open_browser and web_root is not None:
            import webbrowser
            webbrowser.open(server.origin+'/#/agent',new=2)
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None:
            server.server_close()
        elif runtime is not None:
            runtime.close(wait=False)
        if bound is not None:
            bound.close()
        if credentials is not None:
            credentials.close()


def main(argv=None):
    parser=argparse.ArgumentParser(description='Axis-Evo Agent-Native Workspace · 0.1.0 Preview')
    parser.add_argument('--data-dir',type=Path,required=True)
    parser.add_argument('--network-config',type=Path,help='Optional backend-owned provider/network allowlist; no plaintext keys')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--web-root',type=Path,default=Path('web/dist'))
    parser.add_argument('--api-only',action='store_true')
    parser.add_argument('--open-browser',action='store_true')
    args=parser.parse_args(argv)
    if not 1<=args.port<=65535:
        parser.error('port must be between 1 and 65535')
    serve(args.data_dir,args.network_config,args.port,None if args.api_only else args.web_root,
          open_browser=args.open_browser)


if __name__=='__main__':
    main()

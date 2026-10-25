"""Conversation-only process boundary. No Core database or workspace descriptor."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from axis_evo.process_limits import child_environment, managed_popen, terminate_tree, close_process_job
from .conversation_replies import (_request, _canonical, produce_reply, interrupt,
    commit_reply_candidate, MAX_FACT_BYTES)
from .provider_store import ProviderStore
from .runtime_config import RuntimeConfig, parse_local_gateways, parse_provider_routes
from .schemas import no_redirected_parents, strict_json


def supervise_reply(service, request_id, worker_id):
    providers = service.providers
    c = providers.connect()
    try:
        _, profile, _ = _request(c, request_id, providers)
    finally:
        c.close()
    config = providers.config
    ref = profile['credentialRef']
    env_name = config.credentials[ref]
    # Only selected network authority, no project roots, TaskSpec, Skill or Core DB.
    descriptor = {'schema_version': 1, 'data_dir': str(config.data_dir),
        'credentials': {ref: env_name}, 'endpoints': list(config.endpoints),
        'local_gateways': [{'endpoint': g.endpoint, 'model_ids': list(g.model_ids)} for g in config.local_gateways],
        'provider_routes': [r.to_dict() for r in config.provider_routes]}
    path = config.data_dir/(request_id + '-reply-worker.json')
    no_redirected_parents(path)
    root = Path(__file__).resolve().parent.parent
    env = child_environment()
    env['PYTHONPATH'] = str(root/'src') + os.pathsep + str(root)
    secret = os.environ.get(env_name)
    if secret:
        env[env_name] = secret
    process = None
    reader = None
    candidate = bytearray()
    overflow = threading.Event()
    stopped = False
    try:
        with path.open('x', encoding='utf-8') as stream:
            stream.write(_canonical(descriptor))
        process = managed_popen([sys.executable, '-m', 'web_api.reply_worker', str(path), request_id, worker_id],
            env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, start_new_session=os.name != 'nt')
        def drain():
            try:
                while chunk := process.stdout.read(1024):
                    if len(candidate) + len(chunk) > MAX_FACT_BYTES + 1024:
                        overflow.set()
                        return
                    candidate.extend(chunk)
            except (OSError, ValueError):
                overflow.set()
            finally:
                process.stdout.close()
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        deadline = time.monotonic() + profile['timeout'] + 10
        while process.poll() is None or reader.is_alive():
            if service._closed or time.monotonic() >= deadline or overflow.is_set():
                stopped = True
                reason = 'REPLY_SHUTDOWN' if service._closed else 'REPLY_OUTPUT_LIMIT' if overflow.is_set() else 'REPLY_DEADLINE'
                # Terminal interruption wins before killing or draining a late
                # exit-0 candidate. A stopped attempt can never become a reply.
                interrupt(providers, request_id, reason)
                terminate_tree(process)
                break
            time.sleep(0.05)
        process.wait(timeout=5)
        reader.join(timeout=1)
        if not stopped and process.returncode == 0 and not reader.is_alive() and not overflow.is_set():
            value = strict_json(bytes(candidate), MAX_FACT_BYTES + 1024)
            if type(value) is not dict or value.keys() != {'kind','payload'}:
                raise ValueError('Invalid reply worker candidate')
            # Candidate bytes are not logs, not an accepted message and never
            # written to a file. Parent owns full credential checks and COMMIT.
            commit_reply_candidate(providers, request_id, value['kind'], value['payload'])
    finally:
        if process is not None:
            if process.poll() is None:
                terminate_tree(process)
            close_process_job(process)
            process.wait(timeout=5)
        if reader is not None:
            reader.join(timeout=1)
        path.unlink(missing_ok=True)
        # Exit 0 is not a reply. The committed response row is the only success.
        interrupt(providers, request_id, 'REPLY_WORKER_EXIT_UNCONFIRMED')


def run_reply_worker(descriptor_path, request_id, worker_id):
    from .conversation_store import identity
    identity(request_id, 'chat')
    identity(worker_id, 'replyworker')
    path = Path(descriptor_path).absolute()
    no_redirected_parents(path)
    with path.open('rb') as stream:
        value = strict_json(stream.read(64 * 1024 + 1))
    if value.keys() != {'schema_version', 'data_dir', 'credentials', 'endpoints', 'local_gateways', 'provider_routes'} or type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError('Invalid reply worker descriptor')
    config = RuntimeConfig(Path(value['data_dir']), (), value['credentials'], tuple(value['endpoints']),
        parse_local_gateways(value['local_gateways']), parse_provider_routes(value['provider_routes'], tuple(value['endpoints'])))
    if path.parent != config.data_dir or path.name != request_id + '-reply-worker.json':
        raise ValueError('Unbound reply worker descriptor')
    def emit_candidate(value):
        raw = _canonical(value).encode('utf-8')
        if len(raw) > MAX_FACT_BYTES + 1024:
            raise ValueError('Reply candidate exceeds its pipe budget')
        sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()
    produce_reply(ProviderStore(config, initialize=False), request_id, worker_id, candidate_sink=emit_candidate)


if __name__ == '__main__':
    run_reply_worker(*sys.argv[1:])

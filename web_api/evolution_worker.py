"""Scoped provider worker; a committed model-call identity is claimed once."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from uuid import uuid4

from axis_evo.process_limits import child_environment, managed_popen, terminate_tree, close_process_job
from .schemas import ApiError


class EvolutionSupervisor:
    def __init__(self, service):
        self.service = service
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='axis-evolution-supervisor')
        self.slots = threading.BoundedSemaphore(8)
        self.active = {}
        self.lock = threading.Lock()
        self.closed = False

    def running(self, identity):
        with self.lock:
            process = self.active.get(identity)
        return bool(process and process.poll() is None)

    def submit(self, project, identity, phase='generation'):
        if self.closed or not self.slots.acquire(blocking=False):
            raise ApiError('EVOLUTION_BUSY', 'The bounded evolution worker queue is full; no model call was retried.', 429)
        return self.pool.submit(self._watch, project, identity, phase)

    def _watch(self, project, identity, phase):
        service, process = self.service, None
        worker = 'evolution-worker-' + uuid4().hex
        try:
            fact = service._load(project, identity)
            profile = fact['body']['provider']
            runtime = service.runtime
            if runtime._supervisor is None:
                raise ValueError('Process-isolated runtime is required')
            env = child_environment()
            name = runtime.config.credentials[profile['credentialRef']]
            value = os.environ.get(name)
            if value:
                env[name] = value
            root = Path(__file__).resolve().parent.parent
            env['PYTHONPATH'] = str(root / 'src') + os.pathsep + str(root)
            command = [sys.executable, '-m', 'web_api.evolution_worker',
                       str(runtime._supervisor.descriptor), project, identity, phase]
            process = managed_popen(command, cwd=root, env=env, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != 'nt')
            with self.lock:
                self.active[identity] = process
            service._insert(project, 'PROCESS_OBSERVATION', {'event': 'START_OBSERVED', 'pid': process.pid,
                'worker': worker, 'phase': phase}, parent=identity, slot=worker + '-start')
            # A five-case paired Shadow request can require ten bounded calls.
            deadline = time.monotonic() + (profile['timeout'] + 10) * (10 if phase == 'evaluation' else 1)
            while process.poll() is None:
                if self.closed or time.monotonic() >= deadline:
                    terminate_tree(process)
                    break
                time.sleep(0.05)
            process.wait(timeout=5)
            service._insert(project, 'PROCESS_OBSERVATION', {'event': 'EXIT_OBSERVED',
                'exitCode': process.returncode, 'worker': worker, 'phase': phase},
                parent=identity, slot=worker + '-exit')
        except Exception:
            # No error body or environment snapshot; absence of a result remains UNKNOWN.
            if process is not None and process.poll() is None:
                terminate_tree(process)
        finally:
            if process is not None:
                close_process_job(process)
            with self.lock:
                self.active.pop(identity, None)
            self.slots.release()

    def close(self):
        self.closed = True
        self.pool.shutdown(wait=True, cancel_futures=True)


def main(descriptor, project, identity, phase):
    if (not re.fullmatch(r'(generation|evo)_[0-9a-f]{32}', identity)
            or phase not in ('generation', 'evaluation')):
        raise ValueError('Invalid evolution worker identity')
    from .runtime_worker import load_service
    from .evolution_service import EvolutionService
    runtime = load_service(descriptor)
    service = EvolutionService(runtime, worker_mode=True)
    try:
        if phase == 'generation':
            service.generate_once(project, identity)
        else:
            service.evaluate_once(project, identity)
    finally:
        service.close()
        runtime.close()


if __name__ == '__main__':
    main(*sys.argv[1:])

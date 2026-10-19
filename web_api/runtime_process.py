"""Supervise actual processes. Scheduling threads never execute task tools."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

from axis_evo.process_limits import child_environment, terminate_tree, managed_popen, close_process_job
from . import runtime_jobs
from .schemas import ApiError, strict_json

EXECUTION_DEADLINE_SECONDS = 90
MAX_WORKER_EVENTS = 256


class CoordinatorLock:
    def __init__(self, directory):
        self.stream = (directory / 'coordinator.lock').open('a+b')
        self.stream.seek(0)
        if not self.stream.read(1):
            self.stream.write(b'0')
            self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            raise ApiError('COORDINATOR_BUSY', 'A coordinator already owns this runtime.', 409) from None

    def close(self):
        if self.stream.closed:
            return
        self.stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
        self.stream.close()


class ProcessSupervisor:
    def __init__(self, service, launcher=None):
        self.service = service
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='axis-supervisor')
        self.active = {}
        self.lock = threading.Lock()
        self.launcher = launcher or managed_popen
        # A secret-free descriptor, never a command or browser-supplied path.
        config, workbench = service.config, service.workbench
        descriptor = {'runtime': {'data_dir': str(config.data_dir),
            'projects': [{'id': p.id, 'task_spec_path': str(p.task_spec_path), 'skill_refs': [r.to_dict() for r in p.skill_refs],
                          'task_templates': {name: str(path) for name, path in p.task_templates},
                          'allow_evolved_skills': p.allow_evolved_skills} for p in config.projects],
            'credentials': dict(config.credentials), 'endpoints': list(config.endpoints),
            'local_gateways': [{'endpoint': item.endpoint, 'model_ids': list(item.model_ids)} for item in config.local_gateways]},
            'workbench': {'projects': [{'id': p.id, 'name': p.name, 'database': str(p.database), 'workspace_roots': [str(r) for r in p.workspace_roots]} for p in workbench.projects],
                          'allowed_origins': list(workbench.allowed_origins)}}
        self.descriptor = config.data_dir / ('worker-config-' + uuid4().hex + '.json')
        with self.descriptor.open('x', encoding='utf-8') as stream:
            json.dump(descriptor, stream, ensure_ascii=False)

    def submit(self, thread_id, phase, dispatch=None, worker=None):
        worker = worker or 'worker_' + uuid4().hex
        return self.pool.submit(self._watch, thread_id, phase, dispatch, worker)

    def running(self, thread_id, expected_worker):
        with self.lock:
            active = self.active.get(thread_id)
        return bool(active and active[1] == expected_worker and active[0].poll() is None)

    def _watch(self, thread_id, phase, dispatch, worker):
        service = self.service
        process = None
        readers = []
        try:
            row = service._row_unscoped(thread_id)
            profile = strict_json(row['profile_json'])
            env = child_environment()
            root = Path(__file__).resolve().parent.parent
            env['PYTHONPATH'] = str(root / 'src') + os.pathsep + str(root) + os.pathsep + env.get('PYTHONPATH', '')
            if phase == 'planning':
                name = service.config.credentials[profile['credentialRef']]
                value = os.environ.get(name)
                if value:
                    env[name] = value
            command = [sys.executable, '-m', 'web_api.runtime_worker', str(self.descriptor), phase, thread_id, worker, dispatch or '-']
            # Reservation is committed before this call. Execution gets no provider key.
            process = self.launcher(command, env=env, cwd=root, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=os.name != 'nt')
            overflow = threading.Event()
            def drain(stream):
                total = 0
                try:
                    while chunk := stream.read(1024):
                        total += len(chunk)
                        if total > 4096:
                            overflow.set()
                            break
                except (OSError, ValueError):
                    pass
                finally:
                    stream.close()
            readers = [threading.Thread(target=drain, args=(stream,), daemon=True) for stream in (process.stdout, process.stderr)]
            for reader in readers:
                reader.start()
            with self.lock:
                self.active[thread_id] = (process, worker)
            with service._web() as c, runtime_jobs.transaction(c):
                runtime_jobs.observation(c, thread_id, worker, 'START_OBSERVED', {'phase': phase, 'pid': process.pid})
            deadline = time.monotonic() + (profile['timeout'] + 10 if phase == 'planning' else EXECUTION_DEADLINE_SECONDS)
            while process.poll() is None or any(reader.is_alive() for reader in readers):
                if time.monotonic() >= deadline or service._closed or overflow.is_set():
                    terminate_tree(process)
                    with service._web() as c, runtime_jobs.transaction(c):
                        runtime_jobs.observation(c, thread_id, worker, 'TERMINATION_REQUESTED', {'reason': 'OUTPUT_LIMIT_EXCEEDED' if overflow.is_set() else 'SHUTDOWN' if service._closed else 'DEADLINE'})
                    break
                project, _ = service._project(row['project_id'])
                with service._core(project) as c:
                    count = c.execute('SELECT count(*) FROM events WHERE run_id=?', (row['reserved_run_id'],)).fetchone()[0]
                if count > MAX_WORKER_EVENTS:
                    terminate_tree(process)
                    break
                time.sleep(0.05)
            process.wait(timeout=5)
            with service._web() as c, runtime_jobs.transaction(c):
                if overflow.is_set():
                    runtime_jobs.observation(c, thread_id, worker, 'OUTPUT_LIMIT_EXCEEDED', {'reason': 'OUTPUT_LIMIT_EXCEEDED'})
                runtime_jobs.observation(c, thread_id, worker, 'EXIT_OBSERVED', {'phase': phase, 'exitCode': process.returncode})
        except Exception:
            if process is not None and process.poll() is None:
                terminate_tree(process)
            with service._web() as c, runtime_jobs.transaction(c):
                runtime_jobs.observation(c, thread_id, worker, 'SUPERVISION_LOST', {'phase': phase})
        finally:
            try:
                if process is not None:
                    if process.poll() is None:
                        terminate_tree(process)
                    close_process_job(process)
                    process.wait(timeout=5)
                for reader in readers:
                    if reader.ident is not None:
                        reader.join(timeout=1)
                with self.lock:
                    self.active.pop(thread_id, None)
                service._reconcile(thread_id, phase)
            finally:
                service._slots.release()

    def close(self, wait):
        self.pool.shutdown(wait=wait, cancel_futures=True)
        if wait:
            self.descriptor.unlink(missing_ok=True)

"""One explicit local dev entry point; Vite HMR, stable backend, no auto setup.

python -m examples.workbench_dev [--config ... --runtime-config ...]
The default backend is read-only. Runtime requires existing owner configuration.
Stopping this launcher terminates its own process trees; active work can become
UNKNOWN and must be inspected. Backend hot reload is deliberately unsupported.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time

from axis_evo.process_limits import child_environment, terminate_tree, close_process_job
from web_api.schemas import WorkbenchConfig, ApiError
from web_api.runtime_config import RuntimeConfig

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_PORT = 5173
STARTUP_TIMEOUT_SECONDS = 30


def development_commands(port, config, runtime_config):
    if type(port) is not int or not 1 <= port <= 65535 or port == FRONTEND_PORT:
        raise ValueError('Choose a backend port different from 5173')
    if runtime_config and not config:
        raise ValueError('Runtime requires an explicit existing Workbench config')
    node = shutil.which('node')
    vite = ROOT / 'web/node_modules/vite/bin/vite.js'
    if not node or not vite.is_file():
        raise ValueError('Node.js and installed web dependencies are required; run npm ci in web')
    backend = [sys.executable, '-u', '-m', 'web_api.app', '--port', str(port)]
    if config:
        path = Path(config).absolute()
        workbench = WorkbenchConfig.from_file(path)
        backend += ['--config', str(path)]
        if runtime_config:
            runtime_path = Path(runtime_config).absolute()
            RuntimeConfig.from_file(runtime_path, workbench)  # Validation only, no migrations.
            backend += ['--runtime-config', str(runtime_path)]
    frontend = [node, str(vite), '--host', '127.0.0.1', '--port', str(FRONTEND_PORT)]
    env = child_environment()
    env['AXIS_DEV_API_TARGET'] = f'http://127.0.0.1:{port}'
    return backend, frontend, env


def preflight(port):
    if type(port) is not int or not 1 <= port <= 65535 or port == FRONTEND_PORT:
        raise ValueError('Invalid backend port')
    for candidate in (port, FRONTEND_PORT):
        with socket.socket() as probe:
            try:
                if os.name == 'nt':
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                probe.bind(('127.0.0.1', candidate))
            except OSError:
                raise ValueError(f'Loopback port {candidate} is occupied; no existing process was stopped') from None
    node = shutil.which('node')
    if not node:
        raise ValueError('Install Node.js >=22.12, then run npm ci in web')
    version = subprocess.run([node, '--version'], env=child_environment(), capture_output=True,
        text=True, timeout=5, check=True).stdout.strip()
    parts = version.removeprefix('v').split('.')
    if len(parts) != 3 or tuple(int(p) for p in parts[:2]) < (22, 12):
        raise ValueError('Node.js >=22.12 is required')
    return {'python': sys.version.split()[0], 'sqlite': sqlite3.sqlite_version, 'node': version,
        'host': '127.0.0.1', 'frontendPort': FRONTEND_PORT, 'backendPort': port, 'backendAutoReload': False}


def _healthy(port, path):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=0.5)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        response.read(1024)
        return response.status == 200
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def shutdown_owned(processes):
    failed = False
    for process in reversed(processes):
        try:
            terminate_tree(process)
            process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            failed = True
        finally:
            try:
                close_process_job(process)
                if getattr(process, 'stdin', None) is not None:
                    process.stdin.close()
            except OSError:
                failed = True
    if failed:
        raise ValueError('Some owned processes did not confirm shutdown; inspect active work before restarting')


def development_popen(command, **kwargs):
    """Own trusted dev services without applying task-worker resource budgets."""
    job, process = None, None
    try:
        if os.name == 'nt':
            import ctypes
            from axis_evo.windows_job import WindowsJob, _Extended
            job = WindowsJob()
            limits = _Extended()
            limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE; Vite is not a task worker.
            if not job.kernel.SetInformationJobObject(job.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            kwargs['creationflags'] = kwargs.get('creationflags', 0) | 4  # CREATE_SUSPENDED
        process = subprocess.Popen(command, **kwargs)
        if job:
            job.attach_and_resume(process)
            process._axis_job = job
        return process
    except BaseException:
        try:
            if process is not None:
                process.kill()
                process.wait(timeout=5)
        finally:
            if job:
                job.close()
        raise


def serve(port, commands):
    backend, frontend, frontend_env = commands
    processes = []
    try:
        flags = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP}
        # Backend owns credentials; Node/Vite receives only the minimal dev env.
        processes.append(development_popen(backend, cwd=ROOT, **flags))
        # Vite exits on stdin EOF. Keep an owned pipe open for IDE/CI launchers
        # that have no terminal; interactive terminals retain Vite shortcuts.
        processes.append(development_popen(frontend, cwd=ROOT / 'web', env=frontend_env,
            stdin=None if sys.stdin.isatty() else subprocess.PIPE, **flags))
        deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
        while not (_healthy(port, '/api/health') and _healthy(FRONTEND_PORT, '/')):
            if any(p.poll() is not None for p in processes):
                raise ValueError('A development service exited; review its terminal diagnostic')
            if time.monotonic() >= deadline:
                raise ValueError('Development startup timed out; inspect ports and dependency installation')
            time.sleep(0.1)
        print(f'Axis-Evo HMR: http://127.0.0.1:{FRONTEND_PORT}/#/runtime', flush=True)
        print('Backend reload is disabled. Ctrl+C stops only these owned processes; inspect any interrupted Run.', flush=True)
        while all(p.poll() is None for p in processes):
            time.sleep(0.2)
        raise ValueError('A development service stopped; both owned process trees were shut down')
    finally:
        shutdown_owned(processes)


def main():
    parser = argparse.ArgumentParser(description='Axis-Evo loopback development: Vite HMR + stable local backend')
    parser.add_argument('--config', type=Path)
    parser.add_argument('--runtime-config', type=Path)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--check', action='store_true', help='Validate local dependencies/configuration without starting services or creating data')
    args = parser.parse_args()
    try:
        info = preflight(args.port)
        commands = development_commands(args.port, args.config, args.runtime_config)
        if args.check:
            print(json.dumps({**info, 'runtimeEnabled': bool(args.runtime_config)}))
            return
        serve(args.port, commands)
    except KeyboardInterrupt:
        pass
    except (ApiError, OSError, ValueError, subprocess.SubprocessError) as error:
        message = error.message if isinstance(error, ApiError) else str(error)
        parser.exit(1, 'Axis-Evo development unavailable: ' + message + '\n')


if __name__ == '__main__':
    main()

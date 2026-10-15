"""Bounded child capture and minimal environments; not an OS security sandbox."""
import os
import signal
import subprocess
import threading
import time
from math import isfinite

OUTPUT_STREAM_BYTES = 4096


def child_environment():
    # Python is invoked by absolute path. PATH, HOME, PYTHONPATH, proxy and
    # arbitrary application variables are deliberately not inherited.
    env = {}
    for name in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"):
        value = os.environ.get(name)
        if value and "\x00" not in value and os.path.isabs(value):
            env[name] = value
    if os.name == "nt" and "SYSTEMROOT" not in env:
        raise ValueError("a valid SYSTEMROOT is required for Windows children")
    if os.name == "nt":
        drive = os.path.splitdrive(env['SYSTEMROOT'])[0]
        if len(drive) != 2 or drive[1] != ':' or drive[0] not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz':
            raise ValueError('SYSTEMROOT must use a local Windows drive')
        # Store Python expands this OS path while starting. Never inherit an
        # independently injected SYSTEMDRIVE or create a literal relative path.
        env['SYSTEMDRIVE'] = drive
    # Store Python requires its scoped user package location to find pytest.
    # These are path metadata, not a claim that host Python packages are isolated.
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
               PYTEST_ADDOPTS="", PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    return env


def terminate_tree(process):
    """Best effort process-tree termination; caller owns this Popen handle."""
    if getattr(process, '_axis_job', None):
        process._axis_job.terminate()
    elif os.name == "nt":
        system_root = os.environ.get("SYSTEMROOT", "C:\\Windows")
        try:
            subprocess.run([os.path.join(system_root, "System32", "taskkill.exe"),
                "/PID", str(process.pid), "/T", "/F"], env=child_environment(),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.kill()


def managed_popen(command, **kwargs):
    job = None
    if os.name == 'nt':
        from .windows_job import WindowsJob
        job = WindowsJob()
        kwargs['creationflags'] = kwargs.get('creationflags', 0) | 4  # CREATE_SUSPENDED
    process = None
    try:
        process = subprocess.Popen(command, **kwargs)
        if job:
            job.attach_and_resume(process)
            process._axis_job = job
        return process
    except BaseException:
        if process is not None:
            process.kill()
            process.wait(timeout=5)
        if job:
            job.close()
        raise


def close_process_job(process):
    if getattr(process, '_axis_job', None):
        process._axis_job.close()


class OutputLimitExceeded(RuntimeError):
    def __init__(self, stdout, stderr):
        super().__init__("OUTPUT_LIMIT_EXCEEDED")
        self.stdout, self.stderr = stdout, stderr


def bounded_run(command, *, cwd, env, shell=False, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=60, check=False):
    """Small run-compatible API: drain pipes while enforcing byte/time limits.

    At most two 4 KiB prefixes are retained, including on timeout. This also
    keeps worst-case JSON escaping under the 64 KiB feedback envelope budget.
    """
    if shell or not capture_output or not text or check or encoding != "utf-8" or errors != "replace":
        raise ValueError("unsupported bounded subprocess mode")
    if type(timeout) not in (int, float) or not isfinite(timeout) or timeout <= 0:
        raise ValueError('timeout must be finite and positive')
    buffers = [bytearray(), bytearray()]
    overflow = threading.Event()

    def drain(stream, index):
        try:
            while chunk := stream.read(1024):
                remaining = OUTPUT_STREAM_BYTES - len(buffers[index])
                buffers[index].extend(chunk[:remaining])
                if len(chunk) > remaining:
                    overflow.set()
                    return
        except (OSError, ValueError):
            overflow.set()
        finally:
            stream.close()

    deadline, timed_out = time.monotonic() + timeout, False
    process, readers = None, []
    try:
        process = managed_popen(command, cwd=cwd, env=env, shell=False,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=os.name != "nt")
        readers = [threading.Thread(target=drain, args=(stream, i), daemon=True)
                   for i, stream in enumerate((process.stdout, process.stderr))]
        for reader in readers:
            reader.start()
        while process.poll() is None or any(reader.is_alive() for reader in readers):
            if overflow.is_set() or time.monotonic() >= deadline:
                timed_out = not overflow.is_set()
                terminate_tree(process)
                break
            time.sleep(0.01)
        process.wait(timeout=5)
    finally:
        if process is not None:
            if process.poll() is None:
                terminate_tree(process)
            close_process_job(process)
            process.wait(timeout=5)
        for reader in readers:
            if reader.ident is not None:
                reader.join(timeout=1)
    stdout, stderr = (bytes(value).decode("utf-8", errors="replace") for value in buffers)
    if overflow.is_set():
        raise OutputLimitExceeded(stdout, stderr)
    if timed_out:
        raise subprocess.TimeoutExpired(command, timeout, output=stdout, stderr=stderr)
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


class BoundedSubprocess:
    """Module-local instrumentation surface; never monkeypatch stdlib globals."""
    run = staticmethod(bounded_run)
    TimeoutExpired = subprocess.TimeoutExpired

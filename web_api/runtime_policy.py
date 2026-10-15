"""Fail-closed Web admission for the frozen file-only execution path.

This is not an OS sandbox. Only backend configured, bounded text seeds are
admitted. No subprocess-capable tool or pytest Acceptance enters this path.
"""
from dataclasses import asdict
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import stat

from axis_evo.hashing import canonical_json_bytes
from axis_evo.sandbox import Sandbox, WorkspacePathResolver, _identity, _pin_windows_parents
from axis_evo.seed_copy import _create_directory, cleanup_created_tree
from axis_evo.task_spec import task_spec_from_dict
from axis_evo.validators import preflight_acceptance

from .schemas import ApiError, no_redirected_parents, strict_json

MAX_SEED_FILES = 128
MAX_SEED_BYTES = 1024 * 1024
MAX_FILE_BYTES = 64 * 1024
MAX_DIRECTORIES = 128
MAX_PROMPT_CHARS = 8192
FILE_TOOLS = ("read_file", "write_file", "patch_file")
_BLOCKED = {".git", ".env", ".ssh", ".aws", ".azure", ".config", "credentials",
            "id_rsa", "id_ed25519", "node_modules", ".venv", "venv", "__pycache__"}


def fail(code, message="The task does not satisfy the file-only runtime safety gate."):
    raise ApiError(code, message, 422)


def _safe_name(relative):
    parts = relative.replace("\\", "/").split("/")
    if any(p.casefold() in _BLOCKED or p.casefold().startswith(".env.")
           or Path(p).suffix.casefold() in {".pem", ".key", ".p12", ".pfx", ".keystore"}
           or p.endswith((" ", ".")) for p in parts):
        fail("PROTECTED_PATH")


def _regular(path, *, directory=False):
    info = path.lstat()
    no_redirected_parents(path)
    if (stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or not directory and info.st_nlink != 1):
        fail("REDIRECTED_PATH")
    return info


def _bounded_bytes(path, expected=None):
    with path.open("rb") as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        fail("FILE_LIMIT")
    if expected is not None and (len(raw) != expected["size"]
            or hashlib.sha256(raw).hexdigest() != expected["sha256"]):
        fail("SEED_CHANGED")
    return raw


def seed_manifest(root, check_text):
    """Read bounded bytes through the existing Core resolver; never follow links."""
    root = Path(root).absolute()
    _regular(root, directory=True)
    sandbox = Sandbox(root)
    files, directories, total = {}, [], 0
    pending = [(root, 0)]
    while pending:
        parent, depth = pending.pop()
        if depth > 8:
            fail("SEED_LIMIT")
        _regular(parent, directory=True)
        # Enumeration is bounded before reading any child contents.
        children = []
        for child in parent.iterdir():
            children.append(child)
            if len(children) > MAX_SEED_FILES + MAX_DIRECTORIES:
                fail("SEED_LIMIT")
        for child in sorted(children):
            relative = child.relative_to(root).as_posix()
            _safe_name(relative)
            info = child.lstat()
            if stat.S_ISDIR(info.st_mode):
                _regular(child, directory=True)
                directories.append(relative)
                if len(directories) > MAX_DIRECTORIES:
                    fail("SEED_LIMIT")
                pending.append((child, depth + 1))
                continue
            before = _regular(child)
            if before.st_size > MAX_FILE_BYTES or len(files) >= MAX_SEED_FILES:
                fail("SEED_LIMIT")
            with sandbox.resolve(relative).open("rb") as stream:
                raw = stream.read(MAX_FILE_BYTES + 1)
            if len(raw) > MAX_FILE_BYTES:
                fail("SEED_LIMIT")
            after = _regular(child)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                fail("SEED_CHANGED")
            try:
                content = raw.decode("utf-8", errors="strict")
            except UnicodeError:
                fail("TEXT_SEED_REQUIRED")
            check_text(content)
            total += len(raw)
            if total > MAX_SEED_BYTES:
                fail("SEED_LIMIT")
            files[relative] = {"sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}
    return {"files": files, "directories": sorted(directories)}


def load_template(task_path, check_text):
    path = Path(task_path).absolute()
    _regular(path)
    with path.open("rb") as stream:
        raw = stream.read(MAX_FILE_BYTES + 1)
    value = strict_json(raw, MAX_FILE_BYTES)
    check_text(raw.decode("utf-8"))
    task = task_spec_from_dict(value)
    if task.acceptance["pytest"]["enabled"] or task.acceptance["pytest"]["args"]:
        fail("SUBPROCESS_DISABLED", "pytest Acceptance and run_tests are disabled in this runtime.")
    if not task.acceptance["file_assertions"]:
        fail("ACCEPTANCE_REQUIRED", "At least one independent file assertion is required.")
    preflight_acceptance(task)
    # Check the supplied chain BEFORE resolving the configured relative seed.
    seed = path.parent / task.workspace["seed_dir"]
    no_redirected_parents(seed)
    seed = seed.resolve(strict=True)
    if not seed.is_relative_to(path.parent.resolve(strict=True)):
        fail("SEED_ESCAPE")
    manifest = seed_manifest(seed, check_text)
    sandbox = Sandbox(seed)
    for assertion in task.acceptance["file_assertions"]:
        _safe_name(assertion["path"])
        target = sandbox.resolve(assertion["path"])
        if target.exists() and not target.is_file():
            fail("FILE_TARGET_REQUIRED")
    return task, seed, manifest


@contextmanager
def _snapshot_destination(destination):
    no_redirected_parents(destination)
    parents = WorkspacePathResolver._directories(destination.parent)
    close, handles, identity = None, [], None
    files, directories = [], []
    try:
        if os.name == 'nt':
            close, handles = _pin_windows_parents(parents)
        destination.mkdir(parents=False, exist_ok=False)
        chain = WorkspacePathResolver._directories(destination)
        identity = _identity(destination.lstat())
        if os.name == 'nt':
            _, root_handles = _pin_windows_parents(chain)
            handles.extend(root_handles)
        resolver = WorkspacePathResolver(destination)
        if resolver._root_chain != chain:
            fail('SEED_CHANGED')
        yield resolver, handles, files, directories
    except BaseException:
        if close:
            for handle in reversed(handles):
                close(handle)
            handles = []
        cleanup_created_tree(destination, identity, files, directories)
        raise
    finally:
        if close:
            for handle in reversed(handles):
                close(handle)


def snapshot_task(task_path, destination, prompt, thread_id, check_text):
    task, seed, manifest = load_template(task_path, check_text)
    destination = Path(destination).absolute()
    with _snapshot_destination(destination) as (target_root, pinned_handles, created_files, created_directories):
        private_seed = destination / "seed"
        created_directories.append((private_seed, _create_directory(target_root, "seed", pinned_handles)))
        for directory in sorted(manifest["directories"], key=lambda p: (len(Path(p).parts), p)):
            created_directories.append((private_seed / directory, _create_directory(target_root, Path("seed") / directory, pinned_handles)))
        source = Sandbox(seed)
        for relative, expected in manifest["files"].items():
            raw = _bounded_bytes(source.resolve(relative), expected)
            target = target_root.resolve("seed/" + relative)
            with target.open("xb") as stream:
                created_files.append((Path(target), _identity(os.fstat(stream.fileno()))))
                stream.write(raw)
        value = asdict(task)
        value.update(task_id=thread_id, title=prompt.strip().splitlines()[0][:80], goal=prompt)
        value["workspace"] = {"seed_dir": "seed"}
        encoded = canonical_json_bytes(value)
        if len(encoded) > MAX_FILE_BYTES:
            fail("TASK_LIMIT")
        check_text(encoded.decode("utf-8"))
        private_task = target_root.resolve("task.json")
        with private_task.open("xb") as stream:
            created_files.append((Path(private_task), _identity(os.fstat(stream.fileno()))))
            stream.write(encoded)
        return {"seed": manifest, "taskSha256": hashlib.sha256(encoded).hexdigest()}

def verify_snapshot(directory, expected, check_text):
    directory = Path(directory)
    path = directory / "task.json"
    _regular(path)
    raw = _bounded_bytes(Sandbox(directory).resolve("task.json"))
    if hashlib.sha256(raw).hexdigest() != expected["taskSha256"]:
        fail("TASK_CHANGED")
    if seed_manifest(directory / "seed", check_text) != expected["seed"]:
        fail("SEED_CHANGED")
    return task_spec_from_dict(strict_json(raw))


def preflight_plan(directory, proposal, expected, check_text):
    """Pure admission; never invoke Tool callbacks or mutate the private seed."""
    task = verify_snapshot(directory, expected, check_text)
    check_text(proposal.plan_json)
    sandbox = Sandbox(Path(directory) / "seed")
    virtual = {}
    for relative, recorded in expected["seed"]["files"].items():
        virtual[os.path.normcase(relative)] = _bounded_bytes(sandbox.resolve(relative), recorded).decode("utf-8")
    for step in proposal.plan:
        if step.tool_name not in FILE_TOOLS:
            fail("SUBPROCESS_DISABLED")
        relative = step.arguments["path"]
        _safe_name(relative)
        target = sandbox.resolve(relative)
        if target.exists() and not target.is_file():
            fail("FILE_TARGET_REQUIRED")
        key = os.path.normcase(target.relative_to(sandbox.root).as_posix())
        if step.tool_name == "write_file":
            virtual[key] = step.arguments["content"]
        elif step.tool_name == "patch_file" and key in virtual:
            old, new = step.arguments["old"], step.arguments["new"]
            if virtual[key].count(old) == 1:
                virtual[key] = virtual[key].replace(old, new, 1)
        if any(len(value.encode("utf-8")) > MAX_FILE_BYTES for value in virtual.values()):
            fail("FILE_LIMIT")
        if len(virtual) > MAX_SEED_FILES or sum(len(s.encode("utf-8")) for s in virtual.values()) > MAX_SEED_BYTES:
            fail("SEED_LIMIT")
    preflight_acceptance(task, sandbox)

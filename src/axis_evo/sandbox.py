"""Workspace path containment and Core observations, without lifecycle management."""

import hashlib
import io
import os
from pathlib import Path, PureWindowsPath
import shutil
import stat

from .models import FileObservation


_OPEN_SUPPORTS_DIR_FD = os.open in os.supports_dir_fd


class _ContainedPath(type(Path())):
    """Keep Path's byte/text APIs, but bind their open to the checked resolver.

    Derived Path objects intentionally have no authority to open a file. This
    is a Core access boundary, not protection against arbitrary Python code.
    """

    def open(self, mode="r", buffering=-1, encoding=None, errors=None, newline=None):
        resolver = getattr(self, "_resolver", None)
        if resolver is None:
            raise ValueError("derived workspace paths cannot open files")
        return resolver._open(Path(self), mode, buffering, encoding, errors, newline)


def _identity(info):
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)


def _regular(info):
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("workspace target is not a regular file")
    if info.st_nlink != 1:
        raise ValueError("hard-linked workspace files are not supported")
    if getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("redirected workspace files are not supported")


def _pin_windows_parents(parents):
    """Deny directory rename/delete while opening a Windows child path.

    These handles constrain ordinary parent replacement. They do not provide
    process isolation or prevent hard links being added after the final check.
    """
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    create.restype = wintypes.HANDLE
    close = kernel.CloseHandle
    close.argtypes, close.restype = (wintypes.HANDLE,), wintypes.BOOL
    handles = []
    try:
        for path, _ in parents:
            # LIST_DIRECTORY; SHARE_READ|WRITE, deliberately no SHARE_DELETE;
            # OPEN_EXISTING; BACKUP_SEMANTICS|OPEN_REPARSE_POINT.
            handle = create(path, 1, 3, None, 3, 0x02200000, None)
            if handle == wintypes.HANDLE(-1).value:
                raise ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
        return close, handles
    except BaseException:
        for handle in reversed(handles):
            close(handle)
        raise


class WorkspacePathResolver:
    def __init__(self, workspace_root: str | Path) -> None:
        self.root = Path(workspace_root).resolve(strict=True)
        if not self.root.is_dir():
            raise NotADirectoryError(self.root)
        self._root_chain = self._directories(self.root)

    @staticmethod
    def _directories(parent):
        result = []
        for directory in (*reversed(parent.parents), parent):
            info = directory.lstat()
            if (not stat.S_ISDIR(info.st_mode)
                    or getattr(info, "st_file_attributes", 0) & 0x400):
                raise ValueError("workspace parent directory is redirected")
            result.append((str(directory), _identity(info)))
        return tuple(result)

    def _fence(self, target):
        if (not target.is_relative_to(self.root)
                or self._directories(self.root) != self._root_chain):
            raise ValueError("workspace root identity changed")
        if target.resolve() != target:
            raise ValueError("workspace target was redirected")
        return self._directories(target.parent)

    def _open(self, target, mode, buffering, encoding, errors, newline):
        if mode not in {"r", "rb", "w", "wb", "r+", "r+b", "rb+", "w+", "w+b", "wb+", "x", "xb"}:
            raise ValueError("unsupported workspace file open mode")
        parents = self._fence(target)
        try:
            before = target.lstat()
        except FileNotFoundError:
            before = None
        if before is not None:
            _regular(before)
        writing = mode[0] in {"w", "x"} or "+" in mode
        flags = os.O_RDWR if "+" in mode else os.O_WRONLY if writing else os.O_RDONLY
        flags |= getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        if mode[0] == "x" or (mode[0] == "w" and before is None):
            flags |= os.O_CREAT | os.O_EXCL
        descriptors = []
        close_windows, windows_handles = None, []
        fd = None
        try:
            if os.name == "nt":
                close_windows, windows_handles = _pin_windows_parents(parents)
                if self._fence(target) != parents:
                    raise ValueError("workspace parent identity changed during open")
            if _OPEN_SUPPORTS_DIR_FD:
                directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                parent_fd = os.open(self.root, directory_flags)
                descriptors.append(parent_fd)
                if _identity(os.fstat(parent_fd)) != self._root_chain[-1][1]:
                    raise ValueError("workspace root identity changed during open")
                relative = target.relative_to(self.root)
                for component in relative.parts[:-1]:
                    parent_fd = os.open(component, directory_flags, dir_fd=parent_fd)
                    descriptors.append(parent_fd)
                fd = os.open(relative.name, flags, 0o666, dir_fd=parent_fd)
            else:
                # Windows has no stdlib dir_fd / O_NOFOLLOW. Open without
                # truncation, then verify handle identity before any byte I/O.
                fd = os.open(target, flags, 0o666)
            actual = os.fstat(fd)
            _regular(actual)
            current = target.lstat()
            _regular(current)
            if (_identity(actual) != _identity(current)
                    or before is not None and _identity(actual) != _identity(before)
                    or self._fence(target) != parents):
                raise ValueError("workspace file identity changed during open")
            if mode[0] == "w":
                os.ftruncate(fd, 0)
            stream = io.open(fd, mode, buffering, encoding, errors, newline, closefd=True)
            fd = None
            return stream
        finally:
            if fd is not None:
                os.close(fd)
            for descriptor in reversed(descriptors):
                os.close(descriptor)
            for handle in reversed(windows_handles):
                close_windows(handle)

    def resolve(self, relative_path: str) -> Path:
        if type(relative_path) is not str or not relative_path.strip():
            raise ValueError("workspace path must be a nonempty relative string")
        windows_path = PureWindowsPath(relative_path)
        if windows_path.drive or windows_path.root or ":" in relative_path or "\x00" in relative_path:
            raise ValueError("absolute, drive-qualified, or stream paths are not allowed")
        if any(PureWindowsPath(part).is_reserved() for part in windows_path.parts):
            raise ValueError("Windows device paths are not workspace files")
        # Apply the same separator interpretation on Windows and POSIX.
        target = (self.root / relative_path.replace("\\", "/")).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("workspace path escapes root")
        if not target.parent.is_dir():
            raise FileNotFoundError(f"parent directory does not exist: {relative_path}")
        self._fence(target)
        if target.exists() and target.is_file():
            _regular(target.lstat())
        checked = _ContainedPath(target)
        checked._resolver = self
        return checked


class Sandbox:
    def __init__(self, workspace_root: str | Path) -> None:
        self.resolver = WorkspacePathResolver(workspace_root)
        self.root = self.resolver.root

    @classmethod
    def from_seed(cls, seed_dir: str | Path, workspace_dir: str | Path) -> "Sandbox":
        seed = Path(seed_dir).resolve(strict=True)
        if not seed.is_dir():
            raise NotADirectoryError(seed)
        supplied_destination = Path(workspace_dir).absolute()
        destination = supplied_destination.resolve()
        if supplied_destination.is_symlink() or destination.exists():
            raise FileExistsError(f"workspace already exists: {workspace_dir}")
        if destination.is_relative_to(seed):
            raise ValueError("new workspace must not be inside the seed directory")
        if not destination.parent.is_dir():
            raise FileNotFoundError("workspace parent directory must already exist")
        shutil.copytree(seed, destination, symlinks=True)
        return cls(destination)

    def resolve(self, relative_path: str) -> Path:
        return self.resolver.resolve(relative_path)

    def observe_file(self, relative_path: str) -> FileObservation:
        """Observe one declared file from raw bytes; never use ToolResult as truth."""
        target = self.resolve(relative_path)
        if not target.exists():
            return FileObservation(path=relative_path, exists=False)
        if not target.is_file():
            raise ValueError(f"observation target is not a regular file: {relative_path}")
        data = target.read_bytes()
        return FileObservation(
            path=relative_path,
            exists=True,
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
        )

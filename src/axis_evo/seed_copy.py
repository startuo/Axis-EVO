"""Budgeted seed copy through the existing contained file-open boundary."""
import os
from pathlib import Path
import stat

from .sandbox import WorkspacePathResolver, _identity, _regular, _pin_windows_parents

MAX_SEED_FILES = 4096
MAX_SEED_DIRECTORIES = 1024
MAX_SEED_BYTES = 64 * 1024 * 1024
MAX_SEED_FILE_BYTES = 16 * 1024 * 1024


def _entries(parent):
    with os.scandir(parent) as entries:
        for entry in entries:
            yield Path(entry.path)


def _create_directory(resolver, relative, handles):
    """Create one child with an existing checked parent; pin it on Windows."""
    root, relative = resolver.root, Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('invalid destination directory')
    if os.name == 'nt':
        resolver._fence(root / relative)
        directory = root / relative
        directory.mkdir()
        chain = WorkspacePathResolver._directories(directory)
        _, pinned = _pin_windows_parents(chain)
        handles.extend(pinned)
        if WorkspacePathResolver._directories(directory) != chain:
            raise ValueError('destination directory changed')
    else:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if _identity(os.fstat(fd)) != resolver._root_chain[-1][1]:
                raise ValueError('destination identity changed')
            for part in relative.parts[:-1]:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            os.mkdir(relative.name, dir_fd=fd)
        finally:
            os.close(fd)
    return _identity((root / relative).lstat())


def cleanup_created_tree(root, identity, files, directories):
    """Delete only known created identities, never recursively delete by path.

    Windows deletion is by verified, non-redirected DELETE handles. On POSIX,
    retain partial files rather than claiming an inode-conditional unlink that
    the stdlib cannot provide. Empty-directory cleanup never removes file bytes.
    A failed ownership check deliberately leaves bounded private artifacts.
    """
    if identity is None:
        return False
    if os.name != 'nt':
        try:
            WorkspacePathResolver._directories(root)
            if _identity(root.lstat()) != identity or files:
                return False
            for path, expected in reversed(directories):
                if _identity(path.lstat()) == expected:
                    path.rmdir()
            if _identity(root.lstat()) == identity:
                root.rmdir()
            return not root.exists()
        except (OSError, ValueError):
            return False
    import ctypes
    from ctypes import wintypes as w
    class Info(ctypes.Structure):
        _fields_ = [('attributes', w.DWORD), ('created', w.FILETIME), ('accessed', w.FILETIME),
            ('written', w.FILETIME), ('volume', w.DWORD), ('size_hi', w.DWORD), ('size_lo', w.DWORD),
            ('links', w.DWORD), ('index_hi', w.DWORD), ('index_lo', w.DWORD)]
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateFileW.argtypes, k.CreateFileW.restype = (w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD, w.DWORD, w.HANDLE), w.HANDLE
    k.GetFileInformationByHandle.argtypes, k.GetFileInformationByHandle.restype = (w.HANDLE, ctypes.POINTER(Info)), w.BOOL
    k.SetFileInformationByHandle.argtypes, k.SetFileInformationByHandle.restype = (w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD), w.BOOL
    k.CloseHandle.argtypes, k.CloseHandle.restype = (w.HANDLE,), w.BOOL
    def owned(path, expected):
        WorkspacePathResolver._directories(path.parent)
        handle = k.CreateFileW(str(path), 0x10080, 3, None, 3, 0x02200000, None)
        if handle == w.HANDLE(-1).value:
            raise OSError('cleanup handle unavailable')
        info = Info()
        if (not k.GetFileInformationByHandle(handle, ctypes.byref(info))
                or info.attributes & 0x400 or ((info.index_hi << 32) | info.index_lo) != expected[1]
                or _identity(path.lstat()) != expected):
            k.CloseHandle(handle)
            raise ValueError('cleanup identity changed')
        return handle
    def mark_deleted(handle):
        delete = w.BOOL(True)
        if not k.SetFileInformationByHandle(handle, 4, ctypes.byref(delete), ctypes.sizeof(delete)):
            raise OSError('owned entry cannot be safely removed')
    guard = None
    try:
        guard = owned(root, identity)
        for path, expected in (*files, *reversed(directories)):
            handle = owned(path, expected)
            try:
                mark_deleted(handle)
            finally:
                k.CloseHandle(handle)
        mark_deleted(guard)  # Kernel rejects a nonempty directory; no recursion.
        return True
    except (OSError, ValueError):
        return False
    finally:
        if guard:
            k.CloseHandle(guard)


def copy_seed(seed_dir, destination):
    # Check the supplied chain before resolve(), which would erase redirection.
    seed, destination = Path(seed_dir).absolute(), Path(destination).absolute()
    WorkspacePathResolver._directories(seed)
    destination_parents = WorkspacePathResolver._directories(destination.parent)
    source = WorkspacePathResolver(seed)
    files, links, directories, total = [], [], [], 0
    pending = [seed]
    while pending:
        parent = pending.pop()
        WorkspacePathResolver._directories(parent)
        for child in _entries(parent):
            info = child.lstat()
            if stat.S_ISLNK(info.st_mode):
                # Historical safe contract: preserve opaque links, never read
                # their targets. Web admission separately rejects all links.
                links.append((child, _identity(info), os.readlink(child), bool(getattr(info, 'st_file_attributes', 0) & 0x10)))
            elif getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("redirected seed entries are unsupported")
            elif stat.S_ISDIR(info.st_mode):
                directories.append((child, _identity(info)))
                pending.append(child)
            else:
                _regular(info)
                if info.st_size > MAX_SEED_FILE_BYTES:
                    raise ValueError("seed file byte budget exceeded")
                total += info.st_size
                files.append((child, _identity(info), info.st_size, info.st_mtime_ns))
            if len(files) + len(links) > MAX_SEED_FILES or len(directories) > MAX_SEED_DIRECTORIES or total > MAX_SEED_BYTES:
                raise ValueError("seed copy budget exceeded")
    close_handles, handles, created_identity = None, [], None
    created_files, created_directories = [], []
    try:
        if os.name == "nt":
            parents = list(source._root_chain) + [(str(p), identity) for p, identity in directories] + list(destination_parents)
            close_handles, handles = _pin_windows_parents(parents)
            if WorkspacePathResolver._directories(seed) != source._root_chain:
                raise ValueError("seed identity changed")
        for directory, identity in directories:
            if _identity(directory.lstat()) != identity:
                raise ValueError("seed directory changed")
            WorkspacePathResolver._directories(directory)
        if WorkspacePathResolver._directories(destination.parent) != destination_parents:
            raise ValueError("destination parent changed")
        destination.mkdir(exist_ok=False)
        target_chain = WorkspacePathResolver._directories(destination)
        created_identity = _identity(destination.lstat())
        if os.name == 'nt':
            close_target, target_handles = _pin_windows_parents(target_chain)
            close_handles = close_target
            handles.extend(target_handles)
            if WorkspacePathResolver._directories(destination) != target_chain:
                raise ValueError('destination identity changed')
        target = WorkspacePathResolver(destination)
        for directory, _ in sorted(directories, key=lambda item: len(item[0].parts)):
            path = destination / directory.relative_to(seed)
            created_directories.append((path, _create_directory(target, directory.relative_to(seed), handles)))
        for child, identity, size, modified in files:
            relative = child.relative_to(seed).as_posix()
            with source.resolve(relative).open("rb") as reader, target.resolve(relative).open("xb") as writer:
                created_files.append((destination / relative, _identity(os.fstat(writer.fileno()))))
                actual = os.fstat(reader.fileno())
                if (_identity(actual), actual.st_size, actual.st_mtime_ns) != (identity, size, modified):
                    raise ValueError("seed file changed before copying")
                remaining = size
                while remaining:
                    data = reader.read(min(65536, remaining))
                    if not data:
                        raise ValueError("seed file changed during copying")
                    writer.write(data)
                    remaining -= len(data)
                after = os.fstat(reader.fileno())
                if reader.read(1) or (after.st_size, after.st_mtime_ns) != (size, modified):
                    raise ValueError("seed file changed during copying")
        for link, identity, value, is_directory in links:
            if _identity(link.lstat()) != identity or os.readlink(link) != value:
                raise ValueError("seed link changed")
            os.symlink(value, destination / link.relative_to(seed), target_is_directory=is_directory)
    except BaseException:
        # Only remove the directory created by this call, never a replacement.
        if close_handles:
            for handle in reversed(handles):
                close_handles(handle)
            handles = []
        cleanup_created_tree(destination, created_identity, created_files, created_directories)
        raise
    finally:
        if close_handles:
            for handle in reversed(handles):
                close_handles(handle)

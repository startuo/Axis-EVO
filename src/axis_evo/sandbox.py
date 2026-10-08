"""Workspace path containment and Core observations, without lifecycle management."""

import hashlib
from pathlib import Path, PureWindowsPath
import shutil

from .models import FileObservation


class WorkspacePathResolver:
    def __init__(self, workspace_root: str | Path) -> None:
        self.root = Path(workspace_root).resolve(strict=True)
        if not self.root.is_dir():
            raise NotADirectoryError(self.root)

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
        return target


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

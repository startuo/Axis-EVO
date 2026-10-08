import errno
import hashlib
import os

import pytest

from axis_evo.sandbox import Sandbox, WorkspacePathResolver
from axis_evo.tools import WriteFileTool


@pytest.fixture
def sandbox(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return Sandbox(root)


def _symlink_or_skip(link, target, *, directory=False):
    try:
        link.symlink_to(target, target_is_directory=directory)
    except (OSError, NotImplementedError) as error:
        if isinstance(error, NotImplementedError) or getattr(error, "winerror", None) in {1314, 50} or getattr(error, "errno", None) in {errno.EPERM, errno.EACCES, errno.ENOTSUP}:
            pytest.skip(f"OS cannot create the symlink required by this subcase: {error}")
        raise


@pytest.mark.parametrize(
    "path",
    ["../outside.txt", "..\\outside.txt", "/outside.txt", r"C:\outside.txt", "C:/outside.txt", r"C:outside.txt", r"\outside.txt", r"\\server\share\outside.txt", "file.txt:stream", "NUL", "CON.txt", "COM1", "nested/NUL/file.txt"],
)
def test_workspace_path_cannot_escape_root(sandbox, path):
    with pytest.raises(ValueError):
        sandbox.resolve(path)


def test_absolute_host_path_is_rejected(sandbox, tmp_path):
    with pytest.raises(ValueError):
        sandbox.resolve(str(tmp_path / "outside.txt"))


def test_existing_file_and_new_target_under_existing_parent(sandbox):
    parent = sandbox.root / "nested"
    parent.mkdir()
    file = parent / "existing.txt"
    file.write_bytes(b"data")
    assert sandbox.resolve("nested/existing.txt") == file.resolve()
    assert sandbox.resolve("nested/new.txt") == (parent / "new.txt").resolve()
    assert sandbox.resolve(r"nested\new.txt") == (parent / "new.txt").resolve()


def test_missing_parent_is_not_created(sandbox):
    with pytest.raises(FileNotFoundError):
        sandbox.resolve("new/subdir/file.txt")
    assert not (sandbox.root / "new").exists()


@pytest.mark.parametrize("path", ["", " ", 123, "bad\x00path"])
def test_invalid_path_is_rejected(sandbox, path):
    with pytest.raises(ValueError):
        sandbox.resolve(path)


def test_core_observation_uses_raw_bytes_and_exact_size(sandbox):
    data = "中文\r\nnext\n".encode("utf-8") + b"\x00\xff"
    (sandbox.root / "file.bin").write_bytes(data)
    observation = sandbox.observe_file("file.bin")
    assert observation.path == "file.bin"
    assert observation.exists is True
    assert observation.sha256 == hashlib.sha256(data).hexdigest()
    assert observation.size_bytes == len(data)


def test_core_observation_of_missing_valid_file(sandbox):
    observation = sandbox.observe_file("missing.txt")
    assert observation.exists is False
    assert observation.sha256 is None
    assert observation.size_bytes is None
    assert not (sandbox.root / "missing.txt").exists()


def test_directory_is_not_a_regular_file_observation(sandbox):
    (sandbox.root / "folder").mkdir()
    with pytest.raises(ValueError, match="not a regular file"):
        sandbox.observe_file("folder")


def test_core_observation_rejects_unsafe_path(sandbox):
    with pytest.raises(ValueError):
        sandbox.observe_file("../outside.txt")


def test_external_symlink_target_is_rejected(sandbox, tmp_path):
    outside = tmp_path / "secret.txt"
    outside.write_bytes(b"secret")
    _symlink_or_skip(sandbox.root / "link.txt", outside)
    with pytest.raises(ValueError):
        sandbox.resolve("link.txt")
    with pytest.raises(ValueError):
        sandbox.observe_file("link.txt")


def test_external_symlink_parent_blocks_existing_and_new_files(sandbox, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_bytes(b"secret")
    _symlink_or_skip(sandbox.root / "link", outside, directory=True)
    for path in ("link/secret.txt", "link/new.txt"):
        with pytest.raises(ValueError):
            sandbox.resolve(path)
        with pytest.raises(ValueError):
            sandbox.observe_file(path)
        with pytest.raises(ValueError):
            WriteFileTool().execute(sandbox, {"path": path, "content": "changed"})
    assert (outside / "secret.txt").read_bytes() == b"secret"
    assert not (outside / "new.txt").exists()


def test_internal_symlink_is_allowed(sandbox):
    (sandbox.root / "target.txt").write_bytes(b"inside")
    _symlink_or_skip(sandbox.root / "link.txt", sandbox.root / "target.txt")
    assert sandbox.observe_file("link.txt").sha256 == hashlib.sha256(b"inside").hexdigest()


def test_seed_copy_and_workspace_writes_preserve_original(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    original = "原始\r\n".encode("utf-8")
    (seed / "config.txt").write_bytes(original)
    sandbox = Sandbox.from_seed(seed, tmp_path / "workspace")
    assert (sandbox.root / "config.txt").read_bytes() == original
    result = WriteFileTool().execute(sandbox, {"path": "config.txt", "content": "changed\n"})
    assert result.status == "SUCCESS"
    assert (sandbox.root / "config.txt").read_bytes() == b"changed\n"
    assert (seed / "config.txt").read_bytes() == original
    with pytest.raises(FileExistsError):
        Sandbox.from_seed(seed, sandbox.root)


def test_seed_copy_preserves_external_symlink_without_copying_target(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_bytes(b"secret")
    _symlink_or_skip(seed / "link", outside, directory=True)
    sandbox = Sandbox.from_seed(seed, tmp_path / "workspace")
    assert (sandbox.root / "link").is_symlink()
    assert os.readlink(sandbox.root / "link") == os.readlink(seed / "link")
    with pytest.raises(ValueError):
        sandbox.observe_file("link/secret.txt")
    assert (outside / "secret.txt").read_bytes() == b"secret"


def test_seed_copy_rejects_destination_inside_seed(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    with pytest.raises(ValueError):
        Sandbox.from_seed(seed, seed / "workspace")
    assert not (seed / "workspace").exists()


def test_seed_copy_requires_existing_destination_parent(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    with pytest.raises(FileNotFoundError):
        Sandbox.from_seed(seed, tmp_path / "missing" / "workspace")
    assert not (tmp_path / "missing").exists()


def test_opening_nonexistent_or_non_directory_workspace_fails(tmp_path):
    with pytest.raises(FileNotFoundError):
        Sandbox(tmp_path / "missing")
    file = tmp_path / "file.txt"
    file.write_bytes(b"file")
    with pytest.raises(NotADirectoryError):
        WorkspacePathResolver(file)

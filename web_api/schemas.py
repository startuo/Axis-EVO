"""Small public DTO boundary and explicit local project configuration."""

from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit


MAX_CONFIG_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_DATABASE_BYTES = 64 * 1024 * 1024
MAX_DATABASE_ROWS = 20_000
MAX_EVENTS_PER_RUN = 5_000
MAX_LIST_ITEMS = 100
MAX_EVENT_ITEMS = 500
SNAPSHOT_TIMEOUT_SECONDS = 5.0
QUERY_TIMEOUT_SECONDS = 10.0

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_SECRET = re.compile(
    r"(?i)(?:bearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|"
    r"(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[:=]\s*\S+)"
)


class ApiError(Exception):
    """Only fixed, nonsecret boundary errors are serialized to the browser."""

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def strict_json(raw, limit=MAX_CONFIG_BYTES):
    if type(raw) is bytes:
        if len(raw) > limit:
            raise ValueError("JSON size limit")
        raw = raw.decode("utf-8", errors="strict")
    if type(raw) is not str or len(raw.encode("utf-8", errors="strict")) > limit:
        raise ValueError("JSON size limit")

    def invalid_constant(_):
        raise ValueError("nonfinite JSON")

    value = json.loads(raw, object_pairs_hook=_object, parse_constant=invalid_constant)
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > 32:
            raise ValueError("JSON nesting limit")
        if type(item) is dict:
            for key in item:
                key.encode("utf-8", errors="strict")
            stack.extend((v, depth + 1) for v in item.values())
        elif type(item) is list:
            stack.extend((v, depth + 1) for v in item)
        elif type(item) is str:
            item.encode("utf-8", errors="strict")
        elif type(item) is float and not math.isfinite(item):
            raise ValueError("nonfinite JSON")
    return value


def public_text(value, limit=1024):
    """Presentation filter, not a claim of comprehensive secret discovery."""
    if type(value) is not str:
        return None
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError:
        return None
    value = "".join(c for c in value if c in "\n\t" or ord(c) >= 32)
    value = _SECRET.sub("[redacted]", value)
    return value if len(value) <= limit else value[:limit] + "…"


def identifier(value):
    if type(value) is not str or not value.strip() or len(value) > 256 or "\x00" in value:
        raise ApiError("INVALID_ID", "A bounded record identity is required.")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError:
        raise ApiError("INVALID_ID", "A bounded record identity is required.") from None
    return value


def public_identity(value):
    """Withhold sensitive identities instead of inventing a redacted reference."""
    identifier(value)
    if public_text(value, 256) != value:
        raise ApiError("SENSITIVE_METADATA", "The record contains identity metadata unavailable for Web display.", 422)
    return value


def _absolute(value):
    if type(value) is not str or not value or not Path(value).is_absolute():
        raise ValueError("Project paths must be explicit absolute paths")
    return Path(value)


def no_redirected_parents(path):
    """Reject existing symlink/reparse components without following them."""
    for part in [*reversed(path.parents), path]:
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if (stat.S_ISLNK(info.st_mode)
                or getattr(info, "st_file_attributes", 0) & 0x400):
            raise ValueError("Redirected configured paths are unavailable")


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    database: Path
    workspace_roots: tuple[Path, ...]

    @classmethod
    def from_dict(cls, value):
        if type(value) is not dict or value.keys() != {"id", "name", "database", "workspace_roots"}:
            raise ValueError("Unexpected project configuration fields")
        if type(value["id"]) is not str or not _ID.fullmatch(value["id"]):
            raise ValueError("Invalid project identity")
        public_identity(value["id"])
        if type(value["name"]) is not str or not value["name"].strip() or len(value["name"]) > 128:
            raise ValueError("Invalid project name")
        database = _absolute(value["database"])
        no_redirected_parents(database)
        database = database.resolve(strict=False)
        roots = value["workspace_roots"]
        if type(roots) is not list or not 1 <= len(roots) <= 16:
            raise ValueError("At least one explicit workspace root is required")
        resolved = []
        for root in roots:
            path = _absolute(root)
            no_redirected_parents(path)
            path = path.resolve(strict=True)
            if not path.is_dir() or path == Path(path.anchor):
                raise ValueError("A scoped workspace directory is required")
            resolved.append(path)
        return cls(value["id"], value["name"], database, tuple(resolved))


@dataclass(frozen=True)
class WorkbenchConfig:
    projects: tuple[Project, ...] = ()
    allowed_origins: tuple[str, ...] = ()

    @classmethod
    def from_file(cls, path):
        try:
            with Path(path).open("rb") as stream:
                value = strict_json(stream.read(MAX_CONFIG_BYTES + 1))
            if type(value) is not dict or not {"projects"} <= value.keys() <= {"projects", "allowed_origins"}:
                raise ValueError("Unexpected configuration fields")
            if type(value["projects"]) is not list or len(value["projects"]) > 16:
                raise ValueError("Invalid project count")
            projects = tuple(Project.from_dict(p) for p in value["projects"])
            if len({p.id for p in projects}) != len(projects):
                raise ValueError("Duplicate project identity")
            origins = value.get("allowed_origins", [])
            if type(origins) is not list or len(origins) > 8:
                raise ValueError("Invalid origin configuration")
            for origin in origins:
                url = urlsplit(origin)
                if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.username
                        or url.password or not url.port or url.path or url.query or url.fragment):
                    raise ValueError("Only explicit loopback development origins are supported")
            return cls(projects, tuple(origins))
        except (OSError, ValueError, TypeError, RecursionError, UnicodeError):
            raise ApiError("INVALID_CONFIG", "The local project configuration is invalid.") from None

    def project(self, project_id):
        for project in self.projects:
            if project.id == project_id:
                return project
        raise ApiError("PROJECT_NOT_FOUND", "The project is not configured.", 404)


def envelope(data):
    return {"schema_version": 1, "mode": "connected-read-only", "data": data}

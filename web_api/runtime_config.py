"""Backend-only runtime admission policy; browser input cannot create authority."""

from dataclasses import dataclass
import ipaddress
from pathlib import Path
import re
import time
from types import MappingProxyType
from urllib.parse import urlsplit

from axis_evo.skill_card import SkillRef

from .schemas import ApiError, MAX_CONFIG_BYTES, no_redirected_parents, public_text, strict_json


DEFAULT_ENDPOINTS = ("https://api.openai.com/v1/chat/completions",
                     "https://api.deepseek.com/chat/completions")
_ALIAS = re.compile(r"[A-Za-z][A-Za-z0-9._-]{0,63}\Z")
_ENV = re.compile(r"(?:AXIS_EVO_[A-Z0-9_]{1,80}|[A-Z][A-Z0-9_]{0,60}_API_KEY)\Z")
_HOST = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\Z")
_GATEWAY = re.compile(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})/v1/chat/completions\Z")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./:@-]{0,127}\Z")


def validate_gateway_endpoint(value):
    """Separate, literal loopback authority; never relax public HTTPS policy."""
    match = _GATEWAY.fullmatch(value) if type(value) is str else None
    if match is None or not 1 <= int(match[1]) <= 65535:
        raise ValueError('An exact http://127.0.0.1:<port>/v1/chat/completions is required')
    return value


def validate_gateway_model(value):
    if (type(value) is not str or not _MODEL.fullmatch(value)
            or public_text(value, 128) != value):
        raise ValueError('Invalid configured gateway model identity')
    return value


@dataclass(frozen=True)
class LocalGateway:
    endpoint: str
    model_ids: tuple[str, ...]

    def __post_init__(self):
        validate_gateway_endpoint(self.endpoint)
        if type(self.model_ids) not in (tuple, list) or not 1 <= len(self.model_ids) <= 64:
            raise ValueError('An explicit bounded gateway model allowlist is required')
        models = tuple(validate_gateway_model(value) for value in self.model_ids)
        if len(set(models)) != len(models):
            raise ValueError('Duplicate gateway model identity')
        object.__setattr__(self, 'model_ids', models)


def parse_local_gateways(value):
    if type(value) is not list or len(value) > 8:
        raise ValueError('Invalid local gateway allowlist')
    result = []
    for item in value:
        if type(item) is not dict or item.keys() != {'endpoint', 'model_ids'}:
            raise ValueError('Unexpected local gateway configuration')
        result.append(LocalGateway(item['endpoint'], item['model_ids']))
    if len({item.endpoint for item in result}) != len(result):
        raise ValueError('Duplicate local gateway endpoint')
    return tuple(result)


def validate_endpoint(value):
    """Validate a complete configured endpoint, never guess or normalize it."""
    if (type(value) is not str or not 1 <= len(value) <= 512
            or public_text(value, 512) != value
            or any(c.isspace() or ord(c) < 32 for c in value)):
        raise ValueError("Invalid endpoint")
    parsed = urlsplit(value)
    host = parsed.hostname
    if (parsed.scheme != "https" or not host or host != host.lower()
            or not _HOST.fullmatch(host) or "." not in host or host.endswith(".")
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.query or parsed.fragment or "%" in value or "\\" in value
            or parsed.path not in ("/chat/completions", "/v1/chat/completions")
            or parsed.netloc != host and parsed.netloc != host + ":443"):
        raise ValueError("Invalid endpoint")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("IP endpoints are unsupported")
    return value


def _path(value, *, existing=False, directory=False):
    if type(value) is not str or not value or not Path(value).is_absolute():
        raise ValueError("An explicit absolute local path is required")
    path = Path(value)
    no_redirected_parents(path)
    path = path.resolve(strict=existing)
    if path == Path(path.anchor):
        raise ValueError("A scoped local path is required")
    if existing and (not path.is_dir() if directory else not path.is_file()):
        raise ValueError("The configured local path is unavailable")
    if not existing and path.exists() and not path.is_dir():
        raise ValueError("A local data directory is required")
    return path


@dataclass(frozen=True)
class ProviderRoute:
    """Explicit administrator CONNECT target, never inferred from proxy env."""
    endpoint: str
    proxy: str
    address: str
    expires_at: int

    def __post_init__(self):
        validate_endpoint(self.endpoint)
        match = re.fullmatch(r'http://127\.0\.0\.1:([1-9][0-9]{0,4})', self.proxy) if type(self.proxy) is str else None
        if not match or int(match[1]) > 65535:
            raise ValueError('An explicit literal loopback HTTP proxy is required')
        try:
            address = ipaddress.ip_address(self.address)
        except (ValueError, TypeError):
            raise ValueError('A canonical public IPv4 CONNECT target is required') from None
        if (type(self.address) is not str or type(address) is not ipaddress.IPv4Address
                or str(address) != self.address or not address.is_global
                or address.is_reserved or address.is_multicast):
            raise ValueError('A canonical public IPv4 CONNECT target is required')
        # Expired facts remain readable; current authorization is checked only
        # when attempting network I/O. A new route cannot be pinned indefinitely.
        if type(self.expires_at) is not int or not 0 < self.expires_at <= time.time() + 86400:
            raise ValueError('A bounded route expiration is required')

    def to_dict(self):
        return {'endpoint': self.endpoint, 'proxy': self.proxy,
                'address': self.address, 'expires_at': self.expires_at}

    @classmethod
    def from_dict(cls, value):
        if type(value) is not dict or value.keys() != {'endpoint', 'proxy', 'address', 'expires_at'}:
            raise ValueError('Unexpected provider route authority')
        return cls(**value)


def parse_provider_routes(value, endpoints):
    if type(value) is not list or len(value) > 8:
        raise ValueError('A bounded explicit provider route allowlist is required')
    routes = tuple(ProviderRoute.from_dict(item) for item in value)
    if len({r.endpoint for r in routes}) != len(routes) or any(r.endpoint not in endpoints for r in routes):
        raise ValueError('Provider routes must bind unique authorized endpoints')
    return routes


@dataclass(frozen=True)
class ReadPolicy:
    task_template_id: str
    allowed_paths: tuple[str, ...]

    def __post_init__(self):
        from pathlib import PurePosixPath
        from axis_evo.skill_planner import _static_path
        from .runtime_policy import _safe_name
        if (type(self.task_template_id) is not str or self.task_template_id == 'default'
                or not _ALIAS.fullmatch(self.task_template_id)
                or type(self.allowed_paths) not in (tuple, list) or not 1 <= len(self.allowed_paths) <= 32):
            raise ValueError('A named template and bounded exact read scope are required')
        paths = tuple(self.allowed_paths)
        for path in paths:
            if (type(path) is not str or len(path.encode('utf-8', errors='strict')) > 512
                    or '\\' in path or str(PurePosixPath(path)) != path):
                raise ValueError('Read scope requires exact portable relative paths')
            _static_path(path)
            _safe_name(path)
        if len({path.casefold() for path in paths}) != len(paths):
            raise ValueError('Duplicate read scope path')
        object.__setattr__(self, 'allowed_paths', paths)

    def to_dict(self):
        return {'task_template_id': self.task_template_id, 'allowed_paths': list(self.allowed_paths)}

    @classmethod
    def from_dict(cls, value):
        if type(value) is not dict or value.keys() != {'task_template_id', 'allowed_paths'}:
            raise ValueError('Unexpected read policy configuration')
        return cls(**value)


@dataclass(frozen=True)
class RuntimeProject:
    id: str
    task_spec_path: Path
    skill_refs: tuple[SkillRef, ...]
    task_templates: tuple[tuple[str, Path], ...] = ()
    allow_evolved_skills: bool = False
    read_policy: ReadPolicy | None = None

    def __post_init__(self):
        if type(self.allow_evolved_skills) is not bool:
            raise ValueError('allow_evolved_skills requires an explicit boolean')
        if self.read_policy is not None and (type(self.read_policy) is not ReadPolicy
                or self.read_policy.task_template_id not in dict(self.task_templates)):
            raise ValueError('Read policy must bind a configured named task template')

    def template(self, template_id='default'):
        if template_id == 'default':
            return self.task_spec_path
        for name, path in self.task_templates:
            if name == template_id:
                return path
        raise ApiError('TASK_TEMPLATE_UNAVAILABLE', 'Select a backend-configured acceptance template.', 403)


@dataclass(frozen=True)
class RuntimeConfig:
    data_dir: Path
    projects: tuple[RuntimeProject, ...]
    credentials: dict[str, str]
    endpoints: tuple[str, ...] = DEFAULT_ENDPOINTS
    local_gateways: tuple[LocalGateway, ...] = ()
    provider_routes: tuple[ProviderRoute, ...] = ()

    def __post_init__(self):
        # A frozen dataclass alone does not freeze nested configuration objects.
        object.__setattr__(self, "credentials", MappingProxyType(dict(self.credentials)))
        object.__setattr__(self, "projects", tuple(self.projects))
        object.__setattr__(self, "endpoints", tuple(self.endpoints))
        if (type(self.local_gateways) not in (tuple, list) or len(self.local_gateways) > 8
                or any(type(item) is not LocalGateway for item in self.local_gateways)
                or len({item.endpoint for item in self.local_gateways}) != len(self.local_gateways)):
            raise ValueError('Invalid local gateway authority')
        object.__setattr__(self, 'local_gateways', tuple(self.local_gateways))
        routes = tuple(self.provider_routes)
        if (len(routes) > 8 or any(type(item) is not ProviderRoute for item in routes)
                or len({item.endpoint for item in routes}) != len(routes)
                or any(item.endpoint not in self.endpoints for item in routes)):
            raise ValueError('Invalid administrator provider routes')
        object.__setattr__(self, 'provider_routes', routes)

    @classmethod
    def from_file(cls, path, workbench_config):
        try:
            source = Path(path).absolute()
            no_redirected_parents(source)
            with source.open("rb") as stream:
                value = strict_json(stream.read(MAX_CONFIG_BYTES + 1))
            required = {"data_dir", "projects", "credentials"}
            if type(value) is not dict or not required <= value.keys() <= required | {"endpoints", "local_gateways", "provider_routes"}:
                raise ValueError("Unexpected runtime configuration")
            data_dir = _path(value["data_dir"])
            if type(value["projects"]) is not list or not 1 <= len(value["projects"]) <= 16:
                raise ValueError("Invalid runtime project count")
            projects, seen = [], set()
            for item in value["projects"]:
                required_project = {"id", "task_spec_path", "skill_refs"}
                if type(item) is not dict or not required_project <= item.keys() <= required_project | {"task_templates", "allow_evolved_skills", "read_policy"}:
                    raise ValueError("Unexpected runtime project fields")
                project = workbench_config.project(item["id"])
                if project.id in seen:
                    raise ValueError("Duplicate runtime project")
                seen.add(project.id)
                # Workbench workspace_roots are admission containers, not
                # actual Sandbox roots. RuntimeService checks its generated
                # thread/workspace directory against the configured container;
                # metadata may be a sibling outside that actual Sandbox root.
                refs = item["skill_refs"]
                if type(refs) is not list or not 1 <= len(refs) <= 16:
                    raise ValueError("Invalid configured Skill references")
                parsed_refs = []
                for ref in refs:
                    if type(ref) is not dict or ref.keys() != {"skill_id", "skill_version"}:
                        raise ValueError("Invalid configured Skill reference")
                    parsed_refs.append(SkillRef(ref["skill_id"], ref["skill_version"]))
                if len(set(parsed_refs)) != len(parsed_refs):
                    raise ValueError("Duplicate configured Skill reference")
                templates = item.get('task_templates', {})
                if type(templates) is not dict or len(templates) > 8:
                    raise ValueError('Invalid task template allowlist')
                for name in templates:
                    if type(name) is not str or name == 'default' or not _ALIAS.fullmatch(name):
                        raise ValueError('Invalid task template identity')
                projects.append(RuntimeProject(project.id, _path(item["task_spec_path"], existing=True),
                    tuple(parsed_refs), tuple((name, _path(path, existing=True)) for name, path in templates.items()),
                    item.get('allow_evolved_skills', False),
                    ReadPolicy.from_dict(item['read_policy']) if 'read_policy' in item else None))
            credentials = value["credentials"]
            if type(credentials) is not dict or not 1 <= len(credentials) <= 16:
                raise ValueError("Explicit credential aliases are required")
            for alias, env in credentials.items():
                if (type(alias) is not str or not _ALIAS.fullmatch(alias)
                        or public_text(alias, 64) != alias or type(env) is not str or not _ENV.fullmatch(env)):
                    raise ValueError("Invalid credential reference")
            endpoints = value.get("endpoints", list(DEFAULT_ENDPOINTS))
            if type(endpoints) is not list or not 1 <= len(endpoints) <= 16:
                raise ValueError("Invalid endpoint allowlist")
            endpoints = tuple(validate_endpoint(endpoint) for endpoint in endpoints)
            if len(set(endpoints)) != len(endpoints):
                raise ValueError("Duplicate configured endpoint")
            gateways = parse_local_gateways(value.get('local_gateways', []))
            routes = parse_provider_routes(value.get('provider_routes', []), endpoints)
            return cls(data_dir, tuple(projects), dict(credentials), endpoints, gateways, routes)
        except (ApiError, OSError, ValueError, TypeError, KeyError, RuntimeError, UnicodeError):
            raise ApiError("INVALID_RUNTIME_CONFIG", "The backend runtime configuration is invalid.") from None

    def project(self, project_id):
        for project in self.projects:
            if project.id == project_id:
                return project
        raise ApiError("RUNTIME_PROJECT_UNAVAILABLE", "Runtime is unavailable for this configured project.", 403)

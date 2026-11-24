"""Immutable nonsecret provider revisions and restricted Core adapter reuse."""

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import ipaddress
import os
import re
import socket
import sqlite3
import time
from urllib.parse import urlsplit
from uuid import uuid4

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import (OpenAICompatiblePlanningAdapter, PlanningResponse,
                                       PlanningTransportError)

from .runtime_config import provider_route_from_dict, validate_endpoint, validate_gateway_endpoint, validate_gateway_model
from .local_gateway import LocalGatewayPlanningAdapter
from .provider_network import RoutedPlanningAdapter, connection_diagnostic, request_provider_json
from .schemas import ApiError, no_redirected_parents, public_text
from .provider_credentials import validate_credential_recipient


MAX_PROFILES = 32
MAX_ARCHIVED_PROFILES = 128
MAX_PROFILE_REVISIONS = 100
_FIELDS = {"name", "protocol", "endpoint", "modelId", "credentialRef", "timeout"}
_PROFILE_OPTIONS = {"contextWindow", "reasoningEffort", "maxOutputTokens", "proxy"}
_PROXY = re.compile(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})\Z")
_FAKE_IP = ipaddress.IPv4Network("198.18.0.0/15")
_ANTHROPIC_PATH = "/apps/anthropic/v1/messages"
_ARCHIVE_SCHEMA = """CREATE TABLE provider_archived_profiles(
    profile_id TEXT PRIMARY KEY NOT NULL REFERENCES provider_profiles(id),
    archived_at TEXT NOT NULL
)"""
_IDENTITY = re.compile(r"provider_[0-9a-f]{32}\Z")
_ATTEMPT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SENSITIVE = re.compile(r"(?i)(?:\bbearer\s+\S+|\b(?:sk|gsk|ghp)-[A-Za-z0-9_-]{8,}|"
                        r"(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)"
                        r"[\"']?\s*[:=]\s*[\"']?[^\s\"'}]{3,})")
_PRIVATE_KEY = re.compile(r"-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----|"
                          r"-----BEGIN PGP PRIVATE KEY BLOCK-----", re.IGNORECASE)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_profile_revisions (
    profile_id TEXT NOT NULL REFERENCES provider_profiles(id),
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
    config_json TEXT NOT NULL,
    config_sha256 TEXT NOT NULL CHECK(length(config_sha256)=64),
    created_at TEXT NOT NULL,
    PRIMARY KEY(profile_id,revision)
);
CREATE TABLE IF NOT EXISTS provider_active_profile (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    profile_id TEXT NOT NULL REFERENCES provider_profiles(id)
);
CREATE TABLE IF NOT EXISTS provider_connection_tests (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    tested_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('CONNECTED','FAILED')),
    category TEXT NOT NULL,
    http_status INTEGER,
    FOREIGN KEY(profile_id,revision) REFERENCES provider_profile_revisions(profile_id,revision)
);
"""
for _table, _keys in (("provider_profiles", ("id",)),
                       ("provider_profile_revisions", ("profile_id", "revision")),
                       ("provider_connection_tests", ("id",))):
    _same = " AND ".join(f"{key}=NEW.{key}" for key in _keys)
    _SCHEMA += f"""
CREATE TRIGGER IF NOT EXISTS {_table}_no_update BEFORE UPDATE ON {_table}
BEGIN SELECT RAISE(ABORT,'Immutable Web provider fact'); END;
CREATE TRIGGER IF NOT EXISTS {_table}_no_delete BEFORE DELETE ON {_table}
BEGIN SELECT RAISE(ABORT,'Immutable Web provider fact'); END;
CREATE TRIGGER IF NOT EXISTS {_table}_no_replace BEFORE INSERT ON {_table}
WHEN EXISTS(SELECT 1 FROM {_table} WHERE {_same})
BEGIN SELECT RAISE(ABORT,'Immutable Web provider identity'); END;
"""


def _schema_objects(connection):
    return tuple(tuple(row) for row in connection.execute("""SELECT type,name,tbl_name,sql FROM sqlite_master
        WHERE tbl_name IN ('provider_profiles','provider_profile_revisions',
                           'provider_active_profile','provider_connection_tests')
        AND name NOT LIKE 'sqlite_%' ORDER BY type,name"""))


@lru_cache(maxsize=1)
def _expected_schema():
    reference = sqlite3.connect(":memory:")
    try:
        reference.executescript(_SCHEMA)
        return _schema_objects(reference)
    finally:
        reference.close()


def _insert_one(connection, statement, values):
    if connection.execute(statement, values).rowcount != 1:
        raise ApiError("PROVIDER_WRITE_REJECTED", "The provider fact was not committed.", 409)


def _archive_catalog(connection, *, create=False):
    objects = [tuple(row) for row in connection.execute("""SELECT type,name,sql FROM sqlite_master
        WHERE tbl_name='provider_archived_profiles' AND name NOT LIKE 'sqlite_%' ORDER BY type,name""")]
    if not objects:
        if create:
            connection.execute(_ARCHIVE_SCHEMA)
        return create
    if objects != [('table', 'provider_archived_profiles', _ARCHIVE_SCHEMA)]:
        raise ApiError("PROVIDER_INTEGRITY", "The local provider archive cannot be verified.", 409)
    return True


def _available_profiles_query(connection):
    if _archive_catalog(connection):
        return """SELECT id FROM provider_profiles
            WHERE id NOT IN (SELECT profile_id FROM provider_archived_profiles)"""
    return 'SELECT id FROM provider_profiles'


def _is_archived(connection, profile_id):
    return _archive_catalog(connection) and connection.execute(
        'SELECT 1 FROM provider_archived_profiles WHERE profile_id=?', (profile_id,),
    ).fetchone() is not None


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _configured(env):
    value = os.environ.get(env)
    return bool(value and value.strip() and all(33 <= ord(c) <= 126 for c in value))


def _sensitive_input(text, credential_envs):
    if type(text) is not str:
        return True
    try:
        text.encode("utf-8", errors="strict")
    except UnicodeError:
        return True
    if _SENSITIVE.search(text) or _PRIVATE_KEY.search(text):
        return True
    return any(value and value in text for value in (os.environ.get(env) for env in credential_envs))


def _safe_text(value, limit):
    if (type(value) is not str or not value.strip() or len(value) > limit
            or public_text(value, limit) != value or _SENSITIVE.search(value)
            or any(ord(c) < 32 for c in value)):
        raise ValueError("Invalid profile text")
    value.encode("utf-8", errors="strict")
    return value


def _configuration(body, config, *, stored=False):
    permitted = _FIELDS | _PROFILE_OPTIONS | ({'networkRoute'} if stored else set())
    if type(body) is not dict or not _FIELDS <= body.keys() <= permitted:
        raise ValueError("Unexpected provider profile fields")
    protocol = body["protocol"]
    validate_credential_recipient(body['credentialRef'], config, protocol, body['endpoint'], stored=stored)
    name, model = _safe_text(body["name"], 80), _safe_text(body["modelId"], 128)
    if protocol not in ("openai-compatible", "deepseek-compatible", "anthropic-compatible", "local-gateway"):
        raise ValueError("Unsupported planning protocol")
    if protocol == 'local-gateway':
        endpoint = validate_gateway_endpoint(body['endpoint'])
        gateway = next((item for item in config.local_gateways if item.endpoint == endpoint), None)
        validate_gateway_model(model)
        if not stored and (gateway is None or model not in gateway.model_ids):
            raise ValueError('Unconfigured local gateway or model')
    else:
        endpoint = validate_endpoint(body["endpoint"])
        if (urlsplit(endpoint).path == _ANTHROPIC_PATH) != (protocol == "anthropic-compatible"):
            raise ValueError('Endpoint path does not match the selected protocol')
        if not stored and endpoint not in config.endpoints:
            raise ValueError("Unconfigured provider endpoint")
    alias = body["credentialRef"]
    if (type(alias) is not str or not re.fullmatch(r'[A-Za-z][A-Za-z0-9._-]{0,63}', alias)
            or not stored and alias not in config.credentials):
        raise ValueError("Unconfigured credential alias")
    timeout = body["timeout"]
    if type(timeout) is not int or not 1 <= timeout <= 300:
        raise ValueError("Invalid provider timeout")
    value = {"name": name, "protocol": protocol, "endpoint": endpoint,
             "modelId": model, "credentialRef": alias, "timeout": timeout}
    for field, minimum, maximum in (("contextWindow", 256, 16_000_000), ("maxOutputTokens", 1, 1_000_000)):
        if field in body:
            number = body[field]
            if type(number) is not int or not minimum <= number <= maximum:
                raise ValueError("Invalid model token limit")
            value[field] = number
    if "contextWindow" in value and "maxOutputTokens" in value and value["maxOutputTokens"] >= value["contextWindow"]:
        raise ValueError("Output must leave room in the model context")
    if "reasoningEffort" in body:
        if body["reasoningEffort"] not in ("off", "low", "medium", "high"):
            raise ValueError("Invalid reasoning effort")
        value["reasoningEffort"] = body["reasoningEffort"]
    if "proxy" in body:
        proxy = body["proxy"]
        if proxy is not None:
            match = _PROXY.fullmatch(proxy) if type(proxy) is str else None
            if not match or int(match[1]) > 65535 or protocol == "local-gateway":
                raise ValueError("An explicit literal loopback HTTP proxy is required")
        value["proxy"] = proxy
    if stored and 'networkRoute' in body:
        route = provider_route_from_dict(body['networkRoute'])
        if route.endpoint != endpoint or protocol == 'local-gateway' or body.get('proxy', route.proxy) != route.proxy:
            raise ValueError('Provider route identity mismatch')
        value['networkRoute'] = route.to_dict()
    elif not stored and protocol != 'local-gateway':
        route = next((r for r in config.provider_routes
                      if r.endpoint == endpoint and body.get('proxy', r.proxy) == r.proxy), None)
        if body.get("proxy") is not None and route is None:
            raise ValueError("An exact administrator proxy grant is required")
        if route is not None:
            if time.time() >= route.expires_at:
                raise ValueError('Configured provider route expired')
            value['networkRoute'] = route.to_dict()
    if value.get("proxy") is not None and "networkRoute" not in value:
        raise ValueError("Invalid stored proxy authority")
    return value


def _public_addresses(endpoint):
    try:
        parsed = urlsplit(endpoint)
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        if not addresses:
            raise PlanningTransportError("dns_error")
        resolved = [ipaddress.ip_address(result[4][0]) for result in addresses]
        if any((getattr(address, "ipv4_mapped", None) or address) in _FAKE_IP for address in resolved):
            raise PlanningTransportError("fake_ip_tun_blocked")
        for address in resolved:
            mapped = getattr(address, "ipv4_mapped", None)
            if (getattr(address, "scope_id", None) is not None or not address.is_global or
                    address.is_multicast or address.is_reserved
                    or mapped is not None and not mapped.is_global):
                raise PlanningTransportError("endpoint_policy")
    except PlanningTransportError:
        raise
    except socket.gaierror:
        raise PlanningTransportError("dns_error") from None
    except TimeoutError:
        raise PlanningTransportError("timeout") from None
    except (OSError, ValueError, TypeError, IndexError):
        raise PlanningTransportError("connection") from None


def _provider_headers(adapter):
    key = os.environ.get(adapter.credential_env)
    if not key or any(not 33 <= ord(char) <= 126 for char in key):
        raise PlanningTransportError("credentials")
    if type(adapter.delegate) is not RoutedPlanningAdapter:
        _public_addresses(adapter.delegate.endpoint)
    if adapter.protocol == 'anthropic-compatible':
        return {'x-api-key': key, 'anthropic-version': '2023-06-01'}
    return {'Authorization': 'Bearer ' + key}


def _model_metadata(model):
    info = {'id': validate_gateway_model(model['id'])}
    for remote, local, lower, upper in (
        ('context_window', 'contextWindow', 256, 16_000_000),
        ('max_output_tokens', 'maxOutputTokens', 1, 1_000_000),
    ):
        value = model.get(remote)
        if type(value) is int and lower <= value <= upper:
            info[local] = value
    return info


_CONNECTION_PROMPT = 'This is a connectivity check. Return the text connection-ok. Do not execute any action.'


def _probe_provider(adapter, snapshot):
    if snapshot['protocol'] == 'local-gateway':
        adapter.plan(canonical_json_bytes({"schema_version": 1, "core_policy": _CONNECTION_PROMPT,
                                          "purpose": "connection-test"}).decode('utf-8'))
        return None
    anthropic = snapshot['protocol'] == 'anthropic-compatible'
    native_openai = urlsplit(snapshot['endpoint']).hostname == 'api.openai.com' and not anthropic
    cap_field = 'max_completion_tokens' if native_openai else 'max_tokens'
    body = {'model': snapshot['modelId'], 'stream': False, cap_field: 32,
            'messages': [{'role': 'user', 'content': _CONNECTION_PROMPT}]}
    if anthropic or snapshot['protocol'] == 'deepseek-compatible':
        body['thinking'] = {'type': 'disabled'}
    if native_openai:
        from .agent_provider import openai_effort
        if (effective := openai_effort(snapshot['modelId'], 'off')) is not None:
            body.update(reasoning_effort=effective, max_completion_tokens=256 if effective=='low' else 32)
    elif not anthropic:
        body['n'] = 1
    result = request_provider_json(
        adapter.delegate, 'POST', urlsplit(snapshot['endpoint']).path,
        {**_provider_headers(adapter), 'Content-Type': 'application/json'}, canonical_json_bytes(body),
    )
    try:
        if anthropic:
            if result['type'] != 'message' or result['role'] != 'assistant' or result['stop_reason'] != 'end_turn':
                raise ValueError
            blocks = result['content']
            valid = (type(blocks) is list and len(blocks) == 1 and blocks[0]['type'] == 'text'
                     and type(blocks[0]['text']) is str and blocks[0]['text'].strip())
        else:
            choices = result['choices']
            valid = type(choices) is list and len(choices) == 1
            if valid:
                choice, message = choices[0], choices[0]['message']
                valid = (choice['finish_reason'] == 'stop' and message['role'] == 'assistant'
                         and type(message['content']) is str and message['content'].strip()
                         and not message.get('tool_calls') and not message.get('function_call')
                         and not message.get('refusal'))
        if not valid:
            raise ValueError
    except (KeyError, TypeError, AttributeError, ValueError):
        raise PlanningTransportError('assistant_content') from None
    return result


@dataclass(frozen=True)
class AdapterIdentity:
    """Verified local identity only; this object cannot make a network request."""
    adapter_name: str
    model_id: str


@dataclass(frozen=True)
class _RestrictedAdapter:
    delegate: OpenAICompatiblePlanningAdapter | LocalGatewayPlanningAdapter
    credential_env: str
    credential_envs: tuple[str, ...]
    protocol: str = 'openai-compatible'

    @property
    def adapter_name(self):
        return self.delegate.adapter_name

    @property
    def model_id(self):
        return self.delegate.model_id

    def plan(self, request_json):
        if self.protocol == 'anthropic-compatible':
            # Native turns use AgentProvider. Legacy Core planning keeps its
            # existing compatibility contract and exact transport semantics.
            raise PlanningTransportError('endpoint_policy')
        key = os.environ.get(self.credential_env)
        if not _configured(self.credential_env):
            raise PlanningTransportError("credentials")
        if _sensitive_input(request_json, self.credential_envs):
            raise PlanningTransportError("sensitive_content")
        # Exact endpoint admission is backend-owned. This DNS precheck rejects
        # known private routes; the frozen transport resolves again, so it is
        # not a claim of pinned-IP/DNS-rebinding protection for hostile DNS.
        if type(self.delegate) not in (LocalGatewayPlanningAdapter, RoutedPlanningAdapter):
            _public_addresses(self.delegate.endpoint)
        response = self.delegate.plan(request_json)
        if (type(response) is not PlanningResponse or key in response.response_text
                or _sensitive_input(response.response_text, self.credential_envs)):
            raise PlanningTransportError("sensitive_content")
        return response


class ProviderStore:
    """Explicitly initialized Web-only database, with no Core schema changes."""

    def __init__(self, config, *, initialize=True):
        self.config = config
        self.initialize_storage = initialize
        self.path = config.data_dir / "runtime.sqlite3"
        try:
            no_redirected_parents(config.data_dir)
            if not initialize:
                from .runtime_storage import existing_database, require_provider_schema
                with existing_database(self.path) as connection:
                    require_provider_schema(connection)
                return
            config.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            no_redirected_parents(self.path)
            connection = self.connect()
            try:
                existing = _schema_objects(connection)
                if existing and existing != _expected_schema():
                    raise ValueError("Unexpected provider schema")
                connection.executescript("BEGIN IMMEDIATE;\n" + _SCHEMA)
                if _schema_objects(connection) != _expected_schema():
                    raise ValueError("Unexpected provider schema")
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
            finally:
                connection.close()
        except (OSError, ValueError, RuntimeError, sqlite3.Error):
            raise ApiError("PROVIDER_STORAGE_UNAVAILABLE", "The local provider store is unavailable.", 503) from None

    def connect(self):
        no_redirected_parents(self.path)
        if self.initialize_storage:
            connection = sqlite3.connect(self.path, isolation_level=None, timeout=5.0)
        else:
            connection = sqlite3.connect(self.path.absolute().as_uri()+'?mode=rw', uri=True,
                                         isolation_level=None, timeout=5.0)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            if self.initialize_storage:
                connection.execute("PRAGMA journal_mode=WAL")
            elif connection.execute('PRAGMA journal_mode').fetchone()[0] != 'wal':
                raise ValueError('Prepared Runtime WAL storage is required')
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA busy_timeout=5000")
            return connection
        except BaseException:
            connection.close()
            raise

    def _validated(self, body, *, stored=False):
        try:
            value = _configuration(body, self.config, stored=stored)
            for field in value.values():
                if type(field) is str:
                    self.check_text(field)
            raw = canonical_json_bytes(value).decode("utf-8")
            self.check_text(raw)
            return raw, hashlib.sha256(raw.encode("utf-8")).hexdigest()
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise ApiError("INVALID_PROVIDER_PROFILE", "The provider profile violates the backend policy.") from None

    @staticmethod
    def _identity(profile_id, revision=None):
        if (type(profile_id) is not str or not _IDENTITY.fullmatch(profile_id)
                or revision is not None and (type(revision) is not int or not 1 <= revision <= MAX_PROFILE_REVISIONS)):
            raise ApiError("PROVIDER_NOT_FOUND", "The provider profile revision does not exist.", 404)

    def _snapshot(self, connection, row):
        try:
            from .schemas import strict_json
            value = strict_json(row["config_json"])
            canonical, digest = self._validated(value, stored=True)
            if canonical != row["config_json"] or digest != row["config_sha256"] or not _HASH.fullmatch(digest):
                raise ValueError("Profile integrity")
            self._identity(row["profile_id"], row["revision"])
            test = connection.execute("""SELECT tested_at,status,category,http_status FROM provider_connection_tests
                WHERE profile_id=? AND revision=? ORDER BY rowid DESC LIMIT 1""",
                (row["profile_id"], row["revision"])).fetchone()
            diagnostic = {}
            if test:
                error = PlanningTransportError(test["category"], test["http_status"])
                diagnostic = {"diagnosticCode": 'response_received' if test["status"] == 'CONNECTED'
                              else connection_diagnostic(error), "httpStatus": test["http_status"]}
            return {"id": row["profile_id"], "revision": row["revision"], "configSha256": digest, **value, **diagnostic,
                "credentialConfigured": _configured(self.config.credentials.get(value["credentialRef"], '')),
                "testStatus": test["status"] if test else "NOT_TESTED", "testedAt": test["tested_at"] if test else None}
        except (ApiError, TypeError, ValueError, KeyError):
            raise ApiError("PROVIDER_INTEGRITY", "The stored provider revision cannot be verified.", 409) from None

    def _load(self, connection, profile_id, revision=None):
        self._identity(profile_id, revision)
        if revision is None:
            row = connection.execute("""SELECT * FROM provider_profile_revisions
                WHERE profile_id=? ORDER BY revision DESC LIMIT 1""", (profile_id,)).fetchone()
        else:
            row = connection.execute("SELECT * FROM provider_profile_revisions WHERE profile_id=? AND revision=?",
                                     (profile_id, revision)).fetchone()
        if row is None:
            raise ApiError("PROVIDER_NOT_FOUND", "The provider profile revision does not exist.", 404)
        snapshot = self._snapshot(connection, row)
        if _is_archived(connection, profile_id):
            snapshot["archived"] = True
        return snapshot

    @staticmethod
    def _require_available(snapshot):
        if snapshot.get("archived"):
            raise ApiError("PROVIDER_ARCHIVED", "Restore this provider profile before using it.", 409)

    def get(self, profile_id, revision=None):
        connection = self.connect()
        try:
            return self._load(connection, profile_id, revision)
        finally:
            connection.close()

    def list(self):
        connection = self.connect()
        try:
            ids = [row[0] for row in connection.execute(
                _available_profiles_query(connection) + " ORDER BY created_at,id LIMIT ?", (MAX_PROFILES + 1,))]
            if len(ids) > MAX_PROFILES:
                raise ApiError("PROVIDER_LIMIT", "The provider store exceeds its supported budget.", 409)
            active = connection.execute("SELECT profile_id FROM provider_active_profile WHERE singleton=1").fetchone()
            return {"profiles": [self._load(connection, profile_id) for profile_id in ids],
                "activeProfileId": active[0] if active and active[0] in ids else None,
                "endpoints": list(self.config.endpoints),
                "providerRoutes": [{"endpoint": route.endpoint, "proxy": route.proxy, "expiresAt": route.expires_at}
                                   for route in self.config.provider_routes if route.expires_at > time.time()],
                "localGateways": [{"endpoint": item.endpoint, "modelIds": list(item.model_ids)}
                                  for item in self.config.local_gateways],
                "credentialRefs": [{"id": alias, "configured": _configured(env)}
                                   for alias, env in self.config.credentials.items()],
                "nativeTurnOptions": ["contextWindow", "maxOutputTokens", "reasoningEffort"],
                "unsupportedOptions": ["reasoning", "retry"]}
        finally:
            connection.close()

    def history(self, profile_id):
        """Read all bounded immutable revisions; never return credentials."""
        self._identity(profile_id)
        connection = self.connect()
        try:
            revisions = connection.execute('SELECT revision FROM provider_profile_revisions WHERE profile_id=? ORDER BY revision LIMIT ?', (profile_id, MAX_PROFILE_REVISIONS + 1)).fetchall()
            if not revisions:
                raise ApiError('PROVIDER_NOT_FOUND', 'The provider profile does not exist.', 404)
            if len(revisions) > MAX_PROFILE_REVISIONS:
                raise ApiError('PROVIDER_LIMIT', 'The provider history exceeds its budget.', 409)
            return {'profileId': profile_id, 'revisions': [self._load(connection, profile_id, row[0]) for row in revisions],
                'wireParameters': {'stream': False, 'n': 1},
                'inactiveParameters': ['thinking', 'reasoning_effort', 'max_tokens', 'retry'],
                'providerDefaults': 'Parameters not sent use provider defaults; connection success is not Plan validation.'}
        finally:
            connection.close()

    def create(self, body):
        raw, digest = self._validated(body)
        profile_id, created_at = "provider_" + uuid4().hex, _now()
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            available = _available_profiles_query(connection)
            total = connection.execute("SELECT COUNT(*) FROM provider_profiles").fetchone()[0]
            if (total >= MAX_PROFILES + MAX_ARCHIVED_PROFILES
                    or connection.execute(f"SELECT COUNT(*) FROM ({available})").fetchone()[0] >= MAX_PROFILES):
                raise ApiError("PROVIDER_LIMIT", "The provider profile limit has been reached.", 409)
            _insert_one(connection, "INSERT INTO provider_profiles(id,created_at) VALUES (?,?)", (profile_id, created_at))
            _insert_one(connection, """INSERT INTO provider_profile_revisions
                (profile_id,revision,config_json,config_sha256,created_at) VALUES (?,1,?,?,?)""",
                (profile_id, raw, digest, created_at))
            result = self._load(connection, profile_id, 1)
            connection.commit()
            return result
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def edit(self, profile_id, body):
        self._identity(profile_id)
        raw, digest = self._validated(body)
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            previous = self._load(connection, profile_id)
            self._require_available(previous)
            revision = previous["revision"] + 1
            if revision > MAX_PROFILE_REVISIONS:
                raise ApiError("PROVIDER_LIMIT", "The provider revision limit has been reached.", 409)
            _insert_one(connection, """INSERT INTO provider_profile_revisions
                (profile_id,revision,config_json,config_sha256,created_at) VALUES (?,?,?,?,?)""",
                (profile_id, revision, raw, digest, _now()))
            result = self._load(connection, profile_id, revision)
            connection.commit()
            return result
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def activate(self, profile_id):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            result = self._load(connection, profile_id)
            self._require_available(result)
            _insert_one(connection, """INSERT INTO provider_active_profile(singleton,profile_id) VALUES (1,?)
                ON CONFLICT(singleton) DO UPDATE SET profile_id=excluded.profile_id""", (profile_id,))
            connection.commit()
            return result
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def delete(self, profile_id):
        """Archive the selectable profile while retaining every issued revision."""
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            profile = self._load(connection, profile_id)
            if not profile.get("archived"):
                _archive_catalog(connection, create=True)
                if connection.execute("SELECT COUNT(*) FROM provider_archived_profiles").fetchone()[0] >= MAX_ARCHIVED_PROFILES:
                    raise ApiError("PROVIDER_LIMIT", "The provider archive limit has been reached.", 409)
                _insert_one(connection, "INSERT INTO provider_archived_profiles(profile_id, archived_at) VALUES (?,?)",
                            (profile_id, _now()))
                connection.execute("DELETE FROM provider_active_profile WHERE profile_id=?", (profile_id,))
            connection.commit()
            return {"id": profile_id, "archived": True}
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def restore(self, profile_id):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            profile = self._load(connection, profile_id)
            if profile.get("archived"):
                available = _available_profiles_query(connection)
                if connection.execute(f"SELECT COUNT(*) FROM ({available})").fetchone()[0] >= MAX_PROFILES:
                    raise ApiError("PROVIDER_LIMIT", "The provider profile limit has been reached.", 409)
                connection.execute("DELETE FROM provider_archived_profiles WHERE profile_id=?", (profile_id,))
            connection.commit()
            return {"id": profile_id, "archived": False}
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def adapter_identity(self, snapshot, attempt_id):
        """Verify recorded identity independently of time-limited network grants."""
        try:
            if type(snapshot) is not dict or type(attempt_id) is not str or not _ATTEMPT.fullmatch(attempt_id):
                raise ValueError("Invalid adapter identity")
            pinned = self.get(snapshot["id"], snapshot["revision"])
            fields = _FIELDS | _PROFILE_OPTIONS | {"id", "revision", "configSha256", "networkRoute"}
            if {key: snapshot[key] for key in fields & snapshot.keys()} != {key: pinned[key] for key in fields & pinned.keys()}:
                raise ValueError("Changed profile snapshot")
            adapter_name = (f"axis-profile/{pinned['id']}/{pinned['revision']}/"
                            f"{pinned['configSha256']}/attempt/{attempt_id}")
            return AdapterIdentity(adapter_name, pinned['modelId'])
        except (ApiError, KeyError, TypeError, ValueError):
            raise ApiError("PROVIDER_INTEGRITY", "The selected provider revision cannot be verified.", 409) from None

    def adapter(self, snapshot, attempt_id):
        identity = self.adapter_identity(snapshot, attempt_id)
        pinned = self.get(snapshot['id'], snapshot['revision'])
        self._require_available(pinned)
        try:
            # Historical parsing does not grant current outbound authority.
            _configuration({key: pinned[key] for key in (_FIELDS | _PROFILE_OPTIONS) & pinned.keys()}, self.config)
            env = self.config.credentials[pinned["credentialRef"]]
            adapter_type = LocalGatewayPlanningAdapter if pinned['protocol'] == 'local-gateway' else OpenAICompatiblePlanningAdapter
            options = {}
            if 'networkRoute' in pinned:
                route = provider_route_from_dict(pinned['networkRoute'])
                if route not in self.config.provider_routes or time.time() >= route.expires_at:
                    raise ValueError('Exact administrator route is unavailable')
                adapter_type = RoutedPlanningAdapter
                options['route_json'] = canonical_json_bytes(route.to_dict()).decode('utf-8')
            delegate = adapter_type(endpoint=pinned["endpoint"], model_id=pinned["modelId"],
                api_key_env=env, adapter_name=identity.adapter_name, timeout_seconds=pinned["timeout"], **options)
            return _RestrictedAdapter(delegate, env, tuple(self.config.credentials.values()), pinned['protocol'])
        except (ApiError, KeyError, TypeError, ValueError):
            raise ApiError("PROVIDER_INTEGRITY", "The selected provider revision cannot be used.", 409) from None

    def check_text(self, text):
        """Reject known configured credentials and obvious secret-shaped input.

        Only approved credential environment names are inspected. This bounded
        admission check is not a comprehensive secret-discovery guarantee.
        """
        if _sensitive_input(text, tuple(self.config.credentials.values())):
            raise ApiError("SENSITIVE_INPUT", "Sensitive input is unavailable to the Web runtime.")

    def discover_models(self, profile_id, revision):
        """A directory response is neither authorization nor planning evidence."""
        snapshot = self.get(profile_id, revision)
        self._require_available(snapshot)
        adapter = self.adapter(snapshot, 'discovery_' + uuid4().hex)
        base = {'id': profile_id, 'revision': snapshot['revision'], 'configSha256': snapshot['configSha256'],
                'planningVerified': False, 'executionVerified': False}
        if snapshot['protocol'] == 'anthropic-compatible':
            # Model Studio's Messages endpoint deliberately provides no model
            # directory. Keep the configured ID without routing the key elsewhere.
            model = {'id': snapshot['modelId'], **{key: snapshot[key] for key in
                     ('contextWindow', 'maxOutputTokens') if key in snapshot}}
            return {**base, 'status': 'MANUAL_CONFIGURATION', 'modelIds': [model['id']],
                    'models': [model], 'excludedCount': 0}
        excluded = 0
        try:
            if snapshot['protocol'] == 'local-gateway':
                found = adapter.delegate.discover_models()
                allowed = next(item.model_ids for item in self.config.local_gateways
                               if item.endpoint == snapshot['endpoint'])
                models = [{'id': model} for model in found if model in allowed]
                excluded = sum(model not in allowed for model in found)
            else:
                endpoint_path = urlsplit(snapshot['endpoint']).path
                path = endpoint_path.removesuffix('/chat/completions') + '/models'
                response = request_provider_json(adapter.delegate, 'GET', path, _provider_headers(adapter))
                self.check_text(canonical_json_bytes(response).decode('utf-8'))
                data = response.get('data')
                if type(data) is not list or len(data) > 512:
                    raise PlanningTransportError('transport_json')
                models = [_model_metadata(model) for model in data]
            for model in models:
                self.check_text(model['id'])
        except (TypeError, KeyError, ValueError):
            raise ApiError('PROVIDER_RESPONSE', 'The model directory contains invalid entries.', 502) from None
        except PlanningTransportError as error:
            raise ApiError(connection_diagnostic(error), 'The model directory request did not succeed.', 502) from None
        by_id = {model['id']: model for model in models}
        ids = sorted(by_id)
        return {**base, 'status': 'DISCOVERED', 'modelIds': ids,
                'models': [by_id[model] for model in ids], 'excludedCount': excluded}

    def test(self, profile_id, revision):
        snapshot = self.get(profile_id, revision)
        self._require_available(snapshot)
        status, category, http_status = "CONNECTED", "response_received", None
        try:
            adapter = self.adapter(snapshot, "connection_" + uuid4().hex)
            response = _probe_provider(adapter, snapshot)
            if response is not None:
                self.check_text(canonical_json_bytes(response).decode('utf-8'))
        except PlanningTransportError as error:
            status, category, http_status = "FAILED", error.category, error.status_code
        except ApiError as error:
            status, category = "FAILED", ("endpoint_policy" if error.code == 'PROVIDER_INTEGRITY' else 'unavailable')
        except (OSError, ValueError):
            status, category = "FAILED", "unavailable"
        revision = snapshot['revision']
        tested_at = _now()
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            self._load(connection, profile_id, revision)
            _insert_one(connection, """INSERT INTO provider_connection_tests
                (id,profile_id,revision,tested_at,status,category,http_status) VALUES (?,?,?,?,?,?,?)""",
                ("connection_" + uuid4().hex, profile_id, revision, tested_at, status, category, http_status))
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
        return {"id": profile_id, "revision": revision, "configSha256": snapshot["configSha256"],
                "testStatus": status, "testedAt": tested_at, "category": category, "httpStatus": http_status,
                "diagnosticCode": "response_received" if status == "CONNECTED" else
                connection_diagnostic(PlanningTransportError(category, http_status))}

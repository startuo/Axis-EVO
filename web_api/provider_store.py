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

from .runtime_config import ProviderRoute, validate_endpoint, validate_gateway_endpoint, validate_gateway_model
from .local_gateway import LocalGatewayPlanningAdapter
from .provider_network import RoutedPlanningAdapter
from .schemas import ApiError, no_redirected_parents, public_text
from .provider_credentials import validate_credential_recipient


MAX_PROFILES = 32
MAX_PROFILE_REVISIONS = 100
_FIELDS = {"name", "protocol", "endpoint", "modelId", "credentialRef", "timeout"}
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
    permitted = (_FIELDS, _FIELDS | {'networkRoute'}) if stored else (_FIELDS,)
    if type(body) is not dict or body.keys() not in permitted:
        raise ValueError("Unexpected provider profile fields")
    validate_credential_recipient(body.get('credentialRef'),config,body.get('protocol'),body.get('endpoint'),stored=stored)
    name, model = _safe_text(body["name"], 80), _safe_text(body["modelId"], 128)
    if body["protocol"] not in ("openai-compatible", "deepseek-compatible", "local-gateway"):
        raise ValueError("Unsupported planning protocol")
    if body['protocol'] == 'local-gateway':
        endpoint = validate_gateway_endpoint(body['endpoint'])
        gateway = next((item for item in config.local_gateways if item.endpoint == endpoint), None)
        validate_gateway_model(model)
        if not stored and (gateway is None or model not in gateway.model_ids):
            raise ValueError('Unconfigured local gateway or model')
    else:
        endpoint = validate_endpoint(body["endpoint"])
        if not stored and endpoint not in config.endpoints:
            raise ValueError("Unconfigured provider endpoint")
    alias = body["credentialRef"]
    if (type(alias) is not str or not re.fullmatch(r'[A-Za-z][A-Za-z0-9._-]{0,63}', alias)
            or not stored and alias not in config.credentials):
        raise ValueError("Unconfigured credential alias")
    timeout = body["timeout"]
    if type(timeout) is not int or not 1 <= timeout <= 300:
        raise ValueError("Invalid provider timeout")
    value = {"name": name, "protocol": body["protocol"], "endpoint": endpoint,
             "modelId": model, "credentialRef": alias, "timeout": timeout}
    if stored and 'networkRoute' in body:
        route = ProviderRoute.from_dict(body['networkRoute'])
        if route.endpoint != endpoint or body['protocol'] == 'local-gateway':
            raise ValueError('Provider route identity mismatch')
        value['networkRoute'] = route.to_dict()
    elif not stored and body['protocol'] != 'local-gateway':
        route = next((r for r in config.provider_routes if r.endpoint == endpoint), None)
        if route is not None:
            if time.time() >= route.expires_at:
                raise ValueError('Configured provider route expired')
            value['networkRoute'] = route.to_dict()
    return value


def _public_addresses(endpoint):
    try:
        parsed = urlsplit(endpoint)
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        if not addresses:
            raise ValueError("No provider addresses")
        for result in addresses:
            raw = result[4][0]
            address = ipaddress.ip_address(raw)
            mapped = getattr(address, "ipv4_mapped", None)
            if ("%" in raw or not address.is_global or address.is_multicast or address.is_reserved
                    or mapped is not None and not mapped.is_global):
                raise PlanningTransportError("endpoint_policy")
    except PlanningTransportError:
        raise
    except (OSError, ValueError, TypeError, IndexError):
        raise PlanningTransportError("connection") from None


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

    @property
    def adapter_name(self):
        return self.delegate.adapter_name

    @property
    def model_id(self):
        return self.delegate.model_id

    def plan(self, request_json):
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
            return {"id": row["profile_id"], "revision": row["revision"], "configSha256": digest, **value,
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
        return self._snapshot(connection, row)

    def get(self, profile_id, revision=None):
        connection = self.connect()
        try:
            return self._load(connection, profile_id, revision)
        finally:
            connection.close()

    def list(self):
        connection = self.connect()
        try:
            ids = [row[0] for row in connection.execute("SELECT id FROM provider_profiles ORDER BY created_at,id LIMIT ?",
                                                       (MAX_PROFILES + 1,))]
            if len(ids) > MAX_PROFILES:
                raise ApiError("PROVIDER_LIMIT", "The provider store exceeds its supported budget.", 409)
            active = connection.execute("SELECT profile_id FROM provider_active_profile WHERE singleton=1").fetchone()
            return {"profiles": [self._load(connection, profile_id) for profile_id in ids],
                "activeProfileId": active[0] if active else None, "endpoints": list(self.config.endpoints),
                "localGateways": [{"endpoint": item.endpoint, "modelIds": list(item.model_ids)}
                                  for item in self.config.local_gateways],
                "credentialRefs": [{"id": alias, "configured": _configured(env)}
                                   for alias, env in self.config.credentials.items()],
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
            if connection.execute("SELECT COUNT(*) FROM provider_profiles").fetchone()[0] >= MAX_PROFILES:
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
            _insert_one(connection, """INSERT INTO provider_active_profile(singleton,profile_id) VALUES (1,?)
                ON CONFLICT(singleton) DO UPDATE SET profile_id=excluded.profile_id""", (profile_id,))
            connection.commit()
            return result
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
            if (any(snapshot.get(key) != pinned[key] for key in _FIELDS | {"id", "revision", "configSha256"})
                    or snapshot.get('networkRoute') != pinned.get('networkRoute')):
                raise ValueError("Changed profile snapshot")
            adapter_name = (f"axis-profile/{pinned['id']}/{pinned['revision']}/"
                            f"{pinned['configSha256']}/attempt/{attempt_id}")
            return AdapterIdentity(adapter_name, pinned['modelId'])
        except (ApiError, KeyError, TypeError, ValueError):
            raise ApiError("PROVIDER_INTEGRITY", "The selected provider revision cannot be verified.", 409) from None

    def adapter(self, snapshot, attempt_id):
        identity = self.adapter_identity(snapshot, attempt_id)
        try:
            pinned = self.get(snapshot['id'], snapshot['revision'])
            # Historical parsing does not grant current outbound authority.
            _configuration({key:pinned[key] for key in _FIELDS}, self.config)
            env = self.config.credentials[pinned["credentialRef"]]
            adapter_type = LocalGatewayPlanningAdapter if pinned['protocol'] == 'local-gateway' else OpenAICompatiblePlanningAdapter
            options = {}
            if 'networkRoute' in pinned:
                route = ProviderRoute.from_dict(pinned['networkRoute'])
                if route not in self.config.provider_routes or time.time() >= route.expires_at:
                    raise ValueError('Exact administrator route is unavailable')
                adapter_type = RoutedPlanningAdapter
                options['route_json'] = canonical_json_bytes(route.to_dict()).decode('utf-8')
            delegate = adapter_type(endpoint=pinned["endpoint"], model_id=pinned["modelId"],
                api_key_env=env, adapter_name=identity.adapter_name, timeout_seconds=pinned["timeout"], **options)
            return _RestrictedAdapter(delegate, env, tuple(self.config.credentials.values()))
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
        if snapshot['protocol'] != 'local-gateway':
            raise ApiError('MODEL_DISCOVERY_UNSUPPORTED', 'Discovery is available for an authorized local gateway only.', 422)
        adapter = self.adapter(snapshot, 'discovery_' + uuid4().hex)
        try:
            models = adapter.delegate.discover_models()
            for model in models:
                self.check_text(model)
        except PlanningTransportError as error:
            # Never reflect the gateway body, error message, URL or credential.
            raise ApiError('MODEL_DISCOVERY_FAILED',
                f'Model discovery failed: {error.category}' +
                (f' (HTTP {error.status_code})' if error.status_code else ''), 502) from None
        allowed = next(item.model_ids for item in self.config.local_gateways if item.endpoint == snapshot['endpoint'])
        return {'id': profile_id, 'revision': revision, 'configSha256': snapshot['configSha256'],
            'status': 'DISCOVERED', 'modelIds': sorted(model for model in models if model in allowed),
            'excludedCount': sum(model not in allowed for model in models),
            'planningVerified': False, 'executionVerified': False}

    def test(self, profile_id, revision):
        snapshot = self.get(profile_id, revision)
        adapter = self.adapter(snapshot, "connection_" + uuid4().hex)
        status, category, http_status = "CONNECTED", "response_received", None
        try:
            adapter.plan(canonical_json_bytes({"schema_version": 1, "core_policy":
                "This is a connectivity check. Return the text connection-ok. Do not execute any action.",
                "purpose": "connection-test"}).decode("utf-8"))
        except PlanningTransportError as error:
            status, category, http_status = "FAILED", error.category, error.status_code
        except Exception:
            status, category = "FAILED", "unavailable"
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
                "testStatus": status, "testedAt": tested_at, "category": category, "httpStatus": http_status}

"""Explicit coordinator-only Windows credential enrollment; never imported for hydration.

No automatic keyring backend, plaintext fallback or worker-side vault loading.
Environment references remain compatible with the frozen planning transport.
"""
from dataclasses import replace
import hashlib
import hmac
import os
import threading

from .schemas import ApiError, no_redirected_parents

MANAGED_REF = 'managed_deepseek'
MANAGED_ENV = 'AXIS_EVO_WEB_DEEPSEEK_API_KEY'
DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
_LOCK = threading.RLock()
_OWNERS = {}


def validate_credential_recipient(alias, config, protocol, endpoint, *, stored=False):
    if stored:
        # Immutable historical identity does not grant current network authority.
        if alias == MANAGED_REF and (protocol!='deepseek-compatible' or endpoint!=DEEPSEEK_ENDPOINT):
            raise ValueError('Invalid stored managed credential recipient')
        return
    # Bind the resolved environment too: another alias cannot bypass the rule.
    env=config.credentials.get(alias)
    if alias == MANAGED_REF or type(env) is str and env.upper() == MANAGED_ENV:
        if (alias != MANAGED_REF or config.credentials.get(alias) != MANAGED_ENV
                or protocol != 'deepseek-compatible' or endpoint != DEEPSEEK_ENDPOINT):
            raise ValueError('Managed credential recipient mismatch')


def _key(value):
    if type(value) is not str or not 8 <= len(value) <= 4096 or any(not 33 <= ord(c) <= 126 for c in value):
        raise ApiError('INVALID_API_KEY', 'A bounded nonblank API key is required.', 400)
    return value


def _windows_backend():
    if os.name != 'nt':return None
    try:
        from keyring.backends.Windows import WinVaultKeyring
        backend=WinVaultKeyring()
        if backend.priority<=0:return None
        return backend
    except Exception:return None


class BackendCredentials:
    """Only the trusted CLI owns an instance, including construction failure cleanup."""
    def __init__(self, config, *, backend=None):
        self.config=config;self._closed=False;self._owned_value=None;self._reserved=False
        self._backend=backend if backend is not None else _windows_backend()
        self._eligible=DEEPSEEK_ENDPOINT in config.endpoints
        if any(alias!=MANAGED_REF and env.upper()==MANAGED_ENV for alias,env in config.credentials.items()):
            raise ApiError('CREDENTIAL_SCOPE_CONFLICT','The managed credential reference conflicts with administrator configuration.',409)
        if MANAGED_REF in config.credentials and config.credentials[MANAGED_REF]!=MANAGED_ENV:
            raise ApiError('CREDENTIAL_SCOPE_CONFLICT','The managed credential reference is reserved.',409)
        if not self._eligible or len(config.credentials)>=16 and MANAGED_REF not in config.credentials:
            self._eligible=False;return
        no_redirected_parents(config.data_dir)
        scope=os.path.normcase(str(config.data_dir.resolve(strict=False)))
        self._service='Axis-Evo Web/'+hashlib.sha256(scope.encode('utf-8')).hexdigest()
        self.config=replace(config,credentials={**dict(config.credentials),MANAGED_REF:MANAGED_ENV})
        with _LOCK:
            if MANAGED_ENV in _OWNERS or MANAGED_ENV in os.environ:
                raise ApiError('CREDENTIAL_SCOPE_CONFLICT','Another credential owner already occupies this backend process.',409)
            _OWNERS[MANAGED_ENV]=self;self._reserved=True
            try:
                stored=self._read()
                if stored is not None:self._install(stored)
            except BaseException:
                self.close();raise

    def _read(self):
        if self._backend is None:return None
        try:
            value=self._backend.get_password(self._service,MANAGED_REF)
            return _key(value) if value is not None else None
        except Exception:
            raise ApiError('CREDENTIAL_STORE_UNAVAILABLE','The operating-system credential store is unavailable.',503) from None

    def _install(self,value):
        if MANAGED_ENV in os.environ and os.environ[MANAGED_ENV]!=self._owned_value:
            raise ApiError('CREDENTIAL_SCOPE_CONFLICT','The backend environment changed outside its credential owner.',409)
        os.environ[MANAGED_ENV]=value;self._owned_value=value

    def describe(self):
        with _LOCK:
            enabled=self._eligible and self._backend is not None and not self._closed
            return {'available':enabled,'storage':'WINDOWS_CREDENTIAL_MANAGER' if enabled else 'UNAVAILABLE',
                'presets':[{'id':'deepseek','name':'DeepSeek','protocol':'deepseek-compatible',
                    'endpoint':DEEPSEEK_ENDPOINT,'credentialRef':MANAGED_REF,
                    'models':['deepseek-flash','deepseek-v4-pro']} ] if self._eligible else []}

    def enroll(self,body):
        if type(body) is not dict or body.keys()!={'presetId','apiKey'} or body.get('presetId')!='deepseek':
            raise ApiError('INVALID_CREDENTIAL_ENROLLMENT','Choose an explicitly supported provider.',400)
        value=_key(body['apiKey'])
        with _LOCK:
            if self._closed or not self._eligible or self._backend is None:
                raise ApiError('CREDENTIAL_STORE_UNAVAILABLE','Secure credential enrollment is unavailable.',503)
            stored=self._read()
            if stored is not None and not hmac.compare_digest(stored,value):
                raise ApiError('CREDENTIAL_REPLACEMENT_REJECTED','A different key is already configured; no credential was replaced.',409)
            if self._owned_value is not None and not hmac.compare_digest(self._owned_value,value):
                raise ApiError('CREDENTIAL_REPLACEMENT_REJECTED','A different key is already configured.',409)
            try:
                if stored is None:self._backend.set_password(self._service,MANAGED_REF,value)
                verified=self._read()
                if verified is None or not hmac.compare_digest(verified,value):raise ValueError('Storage verification failed')
                self._install(value)
            except Exception:
                # OS storage and RAM are distinct resources, not a SQLite transaction.
                raise ApiError('CREDENTIAL_STORE_UNAVAILABLE','Credential storage could not be confirmed.',503) from None
            return {'presetId':'deepseek','configured':True,'storage':'WINDOWS_CREDENTIAL_MANAGER'}

    def close(self):
        with _LOCK:
            self._closed=True
            if self._reserved and _OWNERS.get(MANAGED_ENV) is self:
                if self._owned_value is not None and os.environ.get(MANAGED_ENV)==self._owned_value:
                    del os.environ[MANAGED_ENV]
                del _OWNERS[MANAGED_ENV]
            self._reserved=False;self._owned_value=None

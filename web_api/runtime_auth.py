"""Ephemeral first-party local sessions, separate from model credentials."""

import hmac
import hashlib
import re
import secrets
import threading
import time
from urllib.parse import urlsplit

from .schemas import ApiError


SESSION_COOKIE = "axis_evo_session"
BOOTSTRAP_TTL_SECONDS = 600
SESSION_TTL_SECONDS = 3600
BOOTSTRAP_ATTEMPT_WINDOW_SECONDS = 60
MAX_BOOTSTRAP_ATTEMPTS = 5
LAUNCH_TTL_SECONDS = 60
MAX_PENDING_LAUNCHES = 8
MAX_LOCAL_SESSIONS = 64
_TOKEN = re.compile(r"[A-Za-z0-9_-]{40,128}\Z")


def _origin(value):
    try:
        parsed = urlsplit(value)
        valid = (type(value) is str and parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
                 and parsed.port and not parsed.username and not parsed.password and not parsed.path
                 and not parsed.query and not parsed.fragment
                 and value == f"http://127.0.0.1:{parsed.port}")
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise ApiError("SESSION_ORIGIN_REJECTED", "The runtime session origin is invalid.", 403)
    return value


class RuntimeSessions:
    """Bounded origin-bound sessions for a single trusted OS user.

    The HTTP layer must additionally enforce its exact Host/Origin allowlist,
    Fetch Metadata and JSON/custom-header boundary. Browsers on the same origin
    share an ephemeral session. Same-user OS processes are outside this boundary.
    Code/capability methods remain for local API compatibility, not normal startup.
    """

    def __init__(self, bootstrap_code=None):
        code = secrets.token_urlsafe(32) if bootstrap_code is None else bootstrap_code
        if type(code) is not str or not 1 <= len(code) <= 128 or not code.isascii():
            raise ValueError("Invalid local bootstrap code")
        self._bootstrap_code = code
        self._bootstrap_deadline = time.monotonic() + BOOTSTRAP_TTL_SECONDS
        self._bootstrap_used = False
        self._attempts = []
        self._sessions = {}
        self._launches = {}
        self._launch_attempts = []
        self._lock = threading.Lock()

    @property
    def bootstrap_code(self):
        """Only the CLI's explicit one-time local display may use this value."""
        return self._bootstrap_code

    def create(self, code, origin):
        origin = _origin(origin)
        with self._lock:
            now = time.monotonic()
            self._attempts = [attempt for attempt in self._attempts
                              if now - attempt < BOOTSTRAP_ATTEMPT_WINDOW_SECONDS]
            if len(self._attempts) >= MAX_BOOTSTRAP_ATTEMPTS:
                raise ApiError("BOOTSTRAP_RATE_LIMIT", "Too many local authorization attempts.", 429)
            self._attempts.append(now)
            if (self._bootstrap_used or now >= self._bootstrap_deadline or type(code) is not str
                    or not code.isascii() or not hmac.compare_digest(code, self._bootstrap_code)):
                raise ApiError("BOOTSTRAP_REJECTED", "The local authorization code is invalid or expired.", 401)
            token, csrf = self._new_session(origin, now)
            self._bootstrap_used = True
            return token, csrf

    def _new_session(self, origin, now):
        # Caller holds _lock. Refresh/multitab reuse the existing HttpOnly cookie.
        self._sessions = {key:value for key,value in self._sessions.items() if now < value[2]}
        if len(self._sessions) >= MAX_LOCAL_SESSIONS:
            raise ApiError('SESSION_LIMIT', 'Local session capacity is full.', 429)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self._sessions[token] = (csrf, origin, now + SESSION_TTL_SECONDS)
        return token, csrf

    def initialize(self, origin):
        """Idempotent first-party POST bootstrap, including concurrent tabs.

        Sharing one live session per origin avoids cookie/CSRF response races
        when several tabs have no cookie yet. No token survives server restart.
        """
        origin = _origin(origin)
        with self._lock:
            now = time.monotonic()
            for token, (csrf, bound_origin, deadline) in self._sessions.items():
                if bound_origin == origin and now < deadline:
                    return token, csrf
            return self._new_session(origin, now)

    def issue_launch(self, origin):
        """Trusted local launcher only. There is deliberately no HTTP issuer."""
        origin = _origin(origin)
        with self._lock:
            now = time.monotonic()
            self._launches = {key:value for key,value in self._launches.items() if now < value[1]}
            if len(self._launches) >= MAX_PENDING_LAUNCHES:
                raise ApiError('LAUNCH_LIMIT', 'Local launch capacity is full.', 429)
            capability = secrets.token_urlsafe(32)
            self._launches[hashlib.sha256(capability.encode('ascii')).digest()] = (origin, now + LAUNCH_TTL_SECONDS)
        return origin + '/#/runtime?launch=' + capability

    def redeem_launch(self, capability, origin):
        origin = _origin(origin)
        with self._lock:
            now = time.monotonic()
            self._launch_attempts = [value for value in self._launch_attempts
                                     if now - value < BOOTSTRAP_ATTEMPT_WINDOW_SECONDS]
            if len(self._launch_attempts) >= MAX_BOOTSTRAP_ATTEMPTS:
                raise ApiError('LAUNCH_RATE_LIMIT', 'Too many local launch attempts.', 429)
            self._launch_attempts.append(now)
            if type(capability) is not str or not _TOKEN.fullmatch(capability):
                raise ApiError('LAUNCH_REJECTED', 'Local launch authorization is invalid or expired.', 401)
            digest = hashlib.sha256(capability.encode('ascii')).digest()
            issued = self._launches.get(digest)
            if issued is None or issued[0] != origin or now >= issued[1]:
                raise ApiError('LAUNCH_REJECTED', 'Local launch authorization is invalid or expired.', 401)
            result = self._new_session(origin, now)
            del self._launches[digest]
            return result

    def verify(self, cookie_header, csrf, origin, *, mutation):
        origin = _origin(origin)
        if type(mutation) is not bool or type(cookie_header) is not str or len(cookie_header) > 4096:
            raise ApiError("SESSION_REQUIRED", "A current local runtime session is required.", 401)
        matches = []
        for part in cookie_header.split(";"):
            name, separator, value = part.strip().partition("=")
            if name == SESSION_COOKIE:
                if not separator or not _TOKEN.fullmatch(value):
                    raise ApiError("SESSION_REQUIRED", "A current local runtime session is required.", 401)
                matches.append(value)
        if len(matches) != 1:
            raise ApiError("SESSION_REQUIRED", "A current local runtime session is required.", 401)
        token = matches[0]
        with self._lock:
            session = self._sessions.get(token)
            if session is None or time.monotonic() >= session[2]:
                self._sessions.pop(token, None)
                raise ApiError("SESSION_REQUIRED", "A current local runtime session is required.", 401)
            if origin != session[1]:
                raise ApiError("SESSION_ORIGIN_REJECTED", "The runtime session origin does not match.", 403)
            if mutation and (type(csrf) is not str or not csrf.isascii()
                             or not hmac.compare_digest(csrf, session[0])):
                raise ApiError("CSRF_REJECTED", "The runtime authorization header is invalid.", 403)
        return None

    def resume(self, cookie_header, origin):
        """Restore in-memory CSRF state after a first-party page refresh."""
        self.verify(cookie_header, None, origin, mutation=False)
        token = next(part.strip().partition("=")[2] for part in cookie_header.split(";")
                     if part.strip().partition("=")[0] == SESSION_COOKIE)
        with self._lock:
            session = self._sessions.get(token)
            if session is None or time.monotonic() >= session[2]:
                raise ApiError("SESSION_REQUIRED", "A current local runtime session is required.", 401)
            return session[0]

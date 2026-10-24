"""Planning-only transport: immutable request text in, untrusted response text out."""

from dataclasses import dataclass, field
import http.client
import json
from math import isfinite
import os
import re
from typing import Protocol
from urllib.parse import urlsplit

from .hashing import canonical_json_bytes


MAX_RESPONSE_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 128 * 1024


def _response_bytes(response):
    """Bound both body and framing; http.client tolerates some truncated EOFs."""
    # In-process adapter doubles may expose only read(). Real HTTPResponse
    # always exposes parsed headers, which are checked before reading bytes.
    headers = getattr(response, "headers", None)
    if headers is not None and headers.defects:
        raise PlanningTransportError("transport_framing")
    content_encodings = headers.get_all("Content-Encoding", []) if headers is not None else []
    if len(content_encodings) > 1 or content_encodings and content_encodings[0].lower() != "identity":
        raise PlanningTransportError("transport_framing")
    lengths = headers.get_all("Content-Length", []) if headers is not None else []
    encodings = headers.get_all("Transfer-Encoding", []) if headers is not None else []
    if (len(lengths) > 1 or lengths and encodings or len(encodings) > 1
            or encodings and encodings[0].lower() != "chunked"):
        raise PlanningTransportError("transport_framing")
    declared = None
    if lengths:
        if not lengths[0].isascii() or not lengths[0].isdecimal() or len(lengths[0]) > 10:
            raise PlanningTransportError("transport_framing")
        declared = int(lengths[0])
        if declared > MAX_RESPONSE_BYTES:
            raise PlanningTransportError("oversized_response")
    if encodings:
        raw = bytearray()
        for _ in range(1024):
            line = response.fp.readline(33)
            if not re.fullmatch(rb"[0-9a-fA-F]{1,16}\r\n", line):
                raise PlanningTransportError("transport_framing")
            size = int(line[:-2], 16)
            if len(raw) + size > MAX_RESPONSE_BYTES:
                raise PlanningTransportError("oversized_response")
            chunk = response.fp.read(size) if size else b""
            if len(chunk) != size or response.fp.read(2) != b"\r\n":
                raise PlanningTransportError("transport_framing")
            if not size:
                return bytes(raw)
            raw.extend(chunk)
        raise PlanningTransportError("transport_framing")
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise PlanningTransportError("oversized_response")
    if declared is not None and len(raw) != declared:
        raise PlanningTransportError("transport_framing")
    return raw


def _text(value, *, nonempty=True):
    if type(value) is not str or (nonempty and not value.strip()) or "\x00" in value:
        raise ValueError("Expected nonempty UTF-8 text without NUL")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError("Invalid UTF-8 text") from None
    return value


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _constant(value):
    raise ValueError("Nonfinite JSON number")


def _strict_json(text, limit):
    if type(text) is not str:
        raise ValueError("JSON input must be exact UTF-8 text")
    try:
        if len(text.encode("utf-8")) > limit:
            raise ValueError("JSON exceeds byte limit")
        value = json.loads(text, object_pairs_hook=_object, parse_constant=_constant)
        # Also rejects escaped surrogates and exponent overflow at any depth.
        canonical_json_bytes(value)
        return value
    except (UnicodeError, RecursionError):
        raise ValueError("Invalid UTF-8 or excessive JSON nesting") from None
    except ValueError:
        raise ValueError("Invalid or oversized strict JSON") from None


@dataclass(frozen=True)
class PlanningResponse:
    response_text: str
    adapter_name: str
    model_id: str


class PlanningAdapter(Protocol):
    adapter_name: str
    model_id: str

    def plan(self, request_json: str) -> PlanningResponse:
        """Receive canonical secret-free JSON, without execution capabilities."""
        ...


class PlanningTransportError(RuntimeError):
    """Only fixed categories and numeric status are exposed; no provider body."""

    def __init__(self, category: str, status_code: int | None = None):
        self.category = category
        self.status_code = status_code
        super().__init__(f"Planning transport {category}" +
                         (f" (HTTP {status_code})" if status_code is not None else ""))


@dataclass(frozen=True)
class StaticPlanningAdapter:
    """Offline deterministic double using exactly the real adapter contract."""

    response_text: str = field(repr=False)
    adapter_name: str = "offline_static"
    model_id: str = "offline"

    def plan(self, request_json: str) -> PlanningResponse:
        _strict_json(request_json, MAX_REQUEST_BYTES)
        return PlanningResponse(self.response_text, self.adapter_name, self.model_id)


@dataclass(frozen=True)
class OpenAICompatiblePlanningAdapter:
    """One HTTPS chat/completions POST; no redirects, tools, proxies or retries.

    Endpoint is the complete URL, model is explicit, key is read only at call
    time from the named environment variable. Timeout is a socket-operation
    timeout, not a guaranteed total deadline (including DNS). Local semantic
    request bytes differ from the documented provider-specific wire envelope.
    Sources: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
    https://docs.python.org/3.12/library/http.client.html
    """

    endpoint: str = field(repr=False)
    model_id: str
    api_key_env: str = "AXIS_EVO_API_KEY"
    adapter_name: str = "openai_compatible_chat"
    timeout_seconds: float = 30.0

    def __post_init__(self):
        _text(self.endpoint)
        for value in (self.model_id, self.api_key_env, self.adapter_name):
            _text(value)
        try:
            parsed = urlsplit(self.endpoint)
            valid = (parsed.scheme == "https" and parsed.hostname and not parsed.username
                     and not parsed.password and not parsed.query and not parsed.fragment
                     and not any(char.isspace() or ord(char) < 32 for char in self.endpoint))
            parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Planning endpoint must be an explicit HTTPS URL without credentials, query or fragment")
        if (type(self.timeout_seconds) not in (int, float) or not isfinite(self.timeout_seconds)
                or self.timeout_seconds <= 0):
            raise ValueError("Planning timeout must be finite and positive")

    def plan(self, request_json: str) -> PlanningResponse:
        request = _strict_json(request_json, MAX_REQUEST_BYTES)
        if type(request) is not dict or type(request.get("core_policy")) is not str:
            raise ValueError("Planning request requires Core policy")
        key = os.environ.get(self.api_key_env)
        if (not key or not key.strip() or any(ord(char) < 33 or ord(char) > 126 for char in key)):
            raise PlanningTransportError("credentials")
        wire = canonical_json_bytes({
            "model": self.model_id, "stream": False, "n": 1,
            "messages": [{"role": "system", "content": request["core_policy"]},
                         {"role": "user", "content": request_json}],
        })
        parsed = urlsplit(self.endpoint)
        connection = None
        response = None
        try:
            connection = self._connection(parsed)
            connection.request("POST", parsed.path or "/", body=wire, headers={
                "Authorization": "Bearer " + key, "Content-Type": "application/json",
                "Accept": "application/json", "Accept-Encoding": "identity",
            })
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise PlanningTransportError("http", response.status)
            raw = _response_bytes(response)
        except PlanningTransportError:
            raise
        except TimeoutError:
            raise PlanningTransportError("timeout") from None
        except (OSError, http.client.HTTPException, UnicodeError):
            raise PlanningTransportError("connection") from None
        finally:
            # A will-close HTTPResponse may already be detached from its
            # connection. Closing only the connection can retain its stream.
            close_response = getattr(response, "close", None)
            if close_response is not None:
                try:
                    close_response()
                except (OSError, http.client.HTTPException):
                    pass
            if connection is not None:
                try:
                    connection.close()
                except (OSError, http.client.HTTPException):
                    # Cleanup must not disclose low-level messages or replace
                    # the original failure/cancellation.
                    pass
        try:
            envelope = _strict_json(raw.decode("utf-8"), MAX_RESPONSE_BYTES)
        except (UnicodeError, ValueError):
            raise PlanningTransportError("transport_json") from None
        try:
            choices = envelope["choices"]
            if type(choices) is not list or len(choices) != 1:
                raise ValueError
            choice = choices[0]
            message = choice["message"]
            if (type(choice.get("index")) is not int or choice["index"] != 0
                    or choice.get("finish_reason") != "stop" or message.get("role") != "assistant"
                    or message.get("tool_calls") or message.get("function_call") or message.get("refusal")):
                raise ValueError
            content = _text(message["content"])
            if len(content.encode("utf-8")) > MAX_RESPONSE_BYTES:
                raise ValueError
        except (TypeError, KeyError, ValueError, AttributeError):
            raise PlanningTransportError("assistant_content") from None
        # Provider self-reported model/request metadata is not authentication.
        return PlanningResponse(content, self.adapter_name, self.model_id)

    def _connection(self, parsed):
        """Transport hook; the default remains a single direct verified HTTPS call."""
        return http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=self.timeout_seconds)

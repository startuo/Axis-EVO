"""Opt-in literal-loopback planning transport; no execution capabilities.

Only an administrator-authorized ProviderStore profile may use this adapter.
Direct http.client connections ignore proxy environment variables. No redirect,
retry, DSH account access, plugin import or provider-specific upstream headers.
"""
from dataclasses import dataclass, field
import http.client
import os
import re
import socket
import threading

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import (MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
    PlanningResponse, PlanningTransportError, _strict_json, _text)
from .runtime_config import validate_gateway_endpoint, validate_gateway_model

MAX_WIRE_REQUEST_BYTES = 256 * 1024
MAX_DISCOVERY_MODELS = 256
MAX_GATEWAY_TIMEOUT_SECONDS = 300
MAX_CHUNKS = 1024
MAX_CHUNK_LINE_BYTES = 32


def _chunked_body(response):
    """http.client accepts some truncated delimiters; validate raw framing here.

    Chunk extensions and trailers are unsupported. A zero chunk must have its
    complete empty trailer terminator. Body, metadata and chunk count are bounded.
    """
    raw = bytearray()
    for _ in range(MAX_CHUNKS):
        line = response.fp.readline(MAX_CHUNK_LINE_BYTES + 1)
        if not re.fullmatch(rb'[0-9a-fA-F]{1,16}\r\n', line):
            raise PlanningTransportError('transport_framing')
        size = int(line[:-2], 16)
        if len(raw) + size > MAX_RESPONSE_BYTES:
            raise PlanningTransportError('oversized_response')
        chunk = response.fp.read(size) if size else b''
        if len(chunk) != size or response.fp.read(2) != b'\r\n':
            raise PlanningTransportError('transport_framing')
        if not size:
            return bytes(raw)
        raw.extend(chunk)
    raise PlanningTransportError('transport_framing')


@dataclass(frozen=True)
class LocalGatewayPlanningAdapter:
    endpoint: str = field(repr=False)
    model_id: str
    api_key_env: str
    adapter_name: str
    timeout_seconds: float = 30

    def __post_init__(self):
        validate_gateway_endpoint(self.endpoint)
        validate_gateway_model(self.model_id)
        _text(self.api_key_env)
        _text(self.adapter_name)
        if (type(self.timeout_seconds) not in (int, float)
                or not 0 < self.timeout_seconds <= MAX_GATEWAY_TIMEOUT_SECONDS):
            raise ValueError('Invalid local gateway deadline')

    def _request(self, method, path, body=None):
        key = os.environ.get(self.api_key_env)
        if not key or not key.strip() or any(not 33 <= ord(c) <= 126 for c in key):
            raise PlanningTransportError('credentials')
        if body is not None and len(body) > MAX_WIRE_REQUEST_BYTES:
            raise PlanningTransportError('oversized_request')
        port = int(self.endpoint.split(':')[2].split('/')[0])
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=self.timeout_seconds)
        expired = threading.Event()
        sockets = []
        def expire():
            expired.set()
            for sock in sockets:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        timer = threading.Timer(self.timeout_seconds, expire)
        timer.daemon = True
        timer.start()
        try:
            connection.connect()
            sockets.append(connection.sock)
            if expired.is_set():
                raise PlanningTransportError('timeout')
            connection.request(method, path, body=body, headers={
                'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Connection': 'close'})
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise PlanningTransportError('http', response.status)
            if (len(response.headers.get_all('Content-Type', [])) != 1
                    or response.headers.get_content_type() != 'application/json'
                    or response.getheader('Content-Encoding', 'identity').lower() != 'identity'):
                raise PlanningTransportError('transport_json')
            lengths = response.headers.get_all('Content-Length', [])
            encodings = response.headers.get_all('Transfer-Encoding', [])
            if (len(lengths) > 1 or lengths and encodings or len(encodings) > 1
                    or encodings and encodings[0].lower() != 'chunked'):
                raise PlanningTransportError('transport_framing')
            declared = None
            if lengths:
                if not lengths[0].isascii() or not lengths[0].isdecimal() or len(lengths[0]) > 10:
                    raise PlanningTransportError('transport_framing')
                declared = int(lengths[0])
                if declared > MAX_RESPONSE_BYTES:
                    raise PlanningTransportError('oversized_response')
            raw = _chunked_body(response) if encodings else response.read(MAX_RESPONSE_BYTES + 1)
            if expired.is_set():
                raise PlanningTransportError('timeout')
            if len(raw) > MAX_RESPONSE_BYTES:
                raise PlanningTransportError('oversized_response')
            if declared is not None and len(raw) != declared:
                raise PlanningTransportError('transport_framing')
        except PlanningTransportError:
            raise
        except TimeoutError:
            raise PlanningTransportError('timeout') from None
        except (OSError, http.client.HTTPException, UnicodeError):
            raise PlanningTransportError('timeout' if expired.is_set() else 'connection') from None
        finally:
            timer.cancel()
            connection.close()
        try:
            value = _strict_json(raw.decode('utf-8', errors='strict'), MAX_RESPONSE_BYTES)
            if type(value) is not dict or 'error' in value:
                raise ValueError
            return value
        except (UnicodeError, ValueError):
            raise PlanningTransportError('transport_json') from None

    def plan(self, request_json):
        request = _strict_json(request_json, MAX_REQUEST_BYTES)
        if type(request) is not dict or type(request.get('core_policy')) is not str:
            raise ValueError('Planning request requires Core policy')
        wire = canonical_json_bytes({'model': self.model_id, 'stream': False, 'n': 1,
            'messages': [{'role': 'system', 'content': request['core_policy']},
                         {'role': 'user', 'content': request_json}]})
        envelope = self._request('POST', '/v1/chat/completions', wire)
        try:
            if (envelope.get('object') != 'chat.completion'
                    or len(_text(envelope['id'])) > 256
                    or type(envelope.get('created')) is not int or envelope['created'] < 0
                    or envelope.get('model') != self.model_id
                    or type(envelope.get('choices')) is not list or len(envelope['choices']) != 1):
                raise ValueError
            choice = envelope['choices'][0]
            message = choice['message']
            if (type(choice.get('index')) is not int or choice['index'] != 0
                    or choice.get('finish_reason') != 'stop' or 'delta' in choice
                    or message.get('role') != 'assistant'
                    or any(message.get(key) is not None for key in ('tool_calls', 'function_call', 'refusal'))):
                raise ValueError
            content = _text(message['content'])
        except (KeyError, TypeError, ValueError, AttributeError):
            raise PlanningTransportError('assistant_content') from None
        # The gateway's model metadata is consistency evidence, not authentication.
        return PlanningResponse(content, self.adapter_name, self.model_id)

    def discover_models(self):
        value = self._request('GET', '/v1/models')
        try:
            if value.get('object') != 'list' or type(value.get('data')) is not list or len(value['data']) > MAX_DISCOVERY_MODELS:
                raise ValueError
            ids = []
            for item in value['data']:
                if type(item) is not dict or item.get('object') != 'model':
                    raise ValueError
                ids.append(validate_gateway_model(item['id']))
            if len(set(ids)) != len(ids):
                raise ValueError
            return tuple(ids)
        except (KeyError, TypeError, ValueError):
            raise PlanningTransportError('model_discovery') from None

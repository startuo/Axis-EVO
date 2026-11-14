"""Product-only native tool calling over existing ProviderStore authority.

This adapter returns untrusted assistant messages; it never executes a tool or
interprets a provider's success claim as execution evidence. The frozen planning
adapter continues to reject native tool calls.

Wire contract: https://api-docs.deepseek.com/guides/tool_calls/
Thinking history: https://api-docs.deepseek.com/guides/thinking_mode/
"""
from copy import deepcopy
import http.client
import os
import re
from urllib.parse import urlsplit

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import (
    PlanningTransportError, _response_bytes, _strict_json, _text,
)
from .local_gateway import LocalGatewayPlanningAdapter
from .provider_network import RoutedPlanningAdapter
from .provider_store import _RestrictedAdapter, _configured, _public_addresses


MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_ARGUMENT_BYTES = 32 * 1024
MAX_MESSAGES = 128
MAX_TOOLS = 64
MAX_TOOL_CALLS = 8
_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_-]{0,63}\Z')
_CALL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')


def _tool_names(tools):
    if type(tools) is not list or len(tools) > MAX_TOOLS:
        raise ValueError('A bounded function tool list is required')
    names = set()
    for tool in tools:
        if type(tool) is not dict or tool.keys() != {'type', 'function'} or tool['type'] != 'function':
            raise ValueError('Only function tools are supported')
        function = tool['function']
        if (type(function) is not dict or not {'name', 'parameters'} <= function.keys()
                or not function.keys() <= {'name', 'description', 'parameters', 'strict'}
                or type(function['name']) is not str or not _NAME.fullmatch(function['name'])
                or function['name'] in names or type(function['parameters']) is not dict
                or function['parameters'].get('type') != 'object'):
            raise ValueError('Invalid or duplicate function definition')
        if 'description' in function:
            _text(function['description'], nonempty=False)
        if 'strict' in function and type(function['strict']) is not bool:
            raise ValueError('Invalid function strict setting')
        names.add(function['name'])
    return names


def _calls(value, names=None):
    if type(value) is not list or not 1 <= len(value) <= MAX_TOOL_CALLS:
        raise ValueError('Invalid number of tool calls')
    result, seen = [], set()
    for ordinal,call in enumerate(value):
        if (type(call) is not dict or not {'id', 'type', 'function'} <= call.keys() <= {'id', 'type', 'function', 'index'}
                or call['type'] != 'function' or type(call['id']) is not str
                or not _CALL_ID.fullmatch(call['id']) or call['id'] in seen
                or 'index' in call and (type(call['index']) is not int or call['index']!=ordinal)):
            raise ValueError('Invalid or repeated tool call identity')
        function = call['function']
        if (type(function) is not dict or function.keys() != {'name', 'arguments'}
                or type(function['name']) is not str or not _NAME.fullmatch(function['name'])
                or names is not None and function['name'] not in names):
            raise ValueError('Unadvertised function call')
        arguments = _strict_json(function['arguments'], MAX_ARGUMENT_BYTES)
        if type(arguments) is not dict:
            raise ValueError('Function arguments must be a JSON object')
        seen.add(call['id'])
        # Preserve the exact argument text for the subsequent provider turn.
        result.append({key:deepcopy(call[key]) for key in ('id','type','function')})
    return result


def _messages(value):
    if type(value) is not list or not 1 <= len(value) <= MAX_MESSAGES:
        raise ValueError('A bounded message history is required')
    result, pending, seen = [], set(), set()
    for item in value:
        if type(item) is not dict:
            raise ValueError('Invalid message')
        role = item.get('role')
        if role in ('system', 'user'):
            if item.keys() != {'role', 'content'} or pending:
                raise ValueError('Invalid message or incomplete tool history')
            _text(item['content'])
        elif role == 'tool':
            if (item.keys() != {'role', 'tool_call_id', 'content'}
                    or type(item['tool_call_id']) is not str or item['tool_call_id'] not in pending):
                raise ValueError('Tool result has no pending call')
            _text(item['content'], nonempty=False)
            pending.remove(item['tool_call_id'])
        elif role == 'assistant':
            if (not {'role', 'content'} <= item.keys()
                    or not item.keys() <= {'role', 'content', 'tool_calls', 'reasoning_content'} or pending):
                raise ValueError('Invalid assistant history')
            if item['content'] is not None:
                _text(item['content'], nonempty=False)
            if 'reasoning_content' in item:
                _text(item['reasoning_content'], nonempty=False)
            if item.get('tool_calls'):
                calls = _calls(item['tool_calls'])
                pending = {call['id'] for call in calls}
                if pending & seen:
                    raise ValueError('Repeated historical tool call identity')
                seen.update(pending)
            elif not item['content']:
                raise ValueError('Empty assistant message')
        else:
            raise ValueError('Unsupported message role')
        result.append(deepcopy(item))
    if pending:
        raise ValueError('Every tool call requires a result before continuation')
    return result


def _assistant(envelope, names):
    """Validate protocol completeness, never tool permissions or task success."""
    try:
        if type(envelope) is not dict or 'error' in envelope:
            raise ValueError
        choices = envelope['choices']
        if type(choices) is not list or len(choices) != 1:
            raise ValueError
        choice = choices[0]
        if (type(choice) is not dict or type(choice.get('index')) is not int
                or choice['index'] != 0 or 'delta' in choice):
            raise ValueError
        message = choice['message']
        if (type(message) is not dict or message.get('role') != 'assistant'
                or message.get('refusal') or message.get('function_call')):
            raise ValueError
        content = message.get('content')
        if content is not None:
            _text(content, nonempty=False)
        result = {'role': 'assistant', 'content': content}
        if message.get('tool_calls'):
            if choice.get('finish_reason') != 'tool_calls':
                raise ValueError
            result['tool_calls'] = _calls(message['tool_calls'], names)
        elif choice.get('finish_reason') != 'stop' or not content or not content.strip():
            raise ValueError
        if message.get('reasoning_content') is not None:
            # Protocol continuation only. Callers must not render this as an
            # execution trace, independent judgment, or verification evidence.
            result['reasoning_content'] = _text(message['reasoning_content'], nonempty=False)
        return result
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PlanningTransportError('assistant_content') from None


class AgentProvider:
    """One non-streaming request per complete(); no retries or tool execution.

    Each instance pins one authorized provider revision and caller-owned attempt
    identity. Instantiate a new instance for each model step so the surrounding
    durable journal can distinguish attempts. Configuration/grant checks are
    repeated immediately before each request; no credentials are copied to disk.
    """
    def __init__(self, providers, profile_snapshot, attempt_id):
        self.providers = providers
        self.profile = deepcopy(profile_snapshot)
        self.attempt_id = attempt_id
        identity = providers.adapter_identity(self.profile, attempt_id)
        self.adapter_name = identity.adapter_name
        self.model_id = identity.model_id

    def complete(self, messages: list, tools: list) -> dict:
        names = _tool_names(tools)
        history = _messages(messages)
        adapter = self.providers.adapter(self.profile, self.attempt_id)
        if type(adapter) is not _RestrictedAdapter:
            raise PlanningTransportError('endpoint_policy')
        delegate = adapter.delegate
        wire = {'model': self.model_id, 'stream': False, 'n': 1, 'messages': history}
        if tools:
            wire['tools'] = deepcopy(tools)
        # Use the documented non-thinking route without mutating the endpoint
        # or introducing beta authority. Other providers keep their own defaults.
        if urlsplit(delegate.endpoint).hostname == 'api.deepseek.com':
            wire['thinking'] = {'type': 'disabled'}
        raw = canonical_json_bytes(wire)
        if len(raw) > MAX_REQUEST_BYTES:
            raise PlanningTransportError('oversized_request')
        self.providers.check_text(raw.decode('utf-8'))
        if not _configured(adapter.credential_env):
            raise PlanningTransportError('credentials')
        if type(delegate) is LocalGatewayPlanningAdapter:
            envelope = delegate._request('POST', '/v1/chat/completions', raw)
            if envelope.get('model') != self.model_id:
                raise PlanningTransportError('assistant_content')
        else:
            if type(delegate) is not RoutedPlanningAdapter:
                _public_addresses(delegate.endpoint)
            envelope = self._https(delegate, raw)
        # Check the entire envelope, including reasoning and provider metadata,
        # before returning or persisting any part of it.
        self.providers.check_text(canonical_json_bytes(envelope).decode('utf-8'))
        return _assistant(envelope, names)

    @staticmethod
    def _https(delegate, wire):
        parsed = urlsplit(delegate.endpoint)
        connection = response = None
        key = os.environ.get(delegate.api_key_env)
        if not key or not key.strip() or any(not 33 <= ord(char) <= 126 for char in key):
            raise PlanningTransportError('credentials')
        try:
            # The selected delegate owns direct TLS versus explicitly granted
            # CONNECT routing. Redirects and environment proxies remain disabled.
            connection = delegate._connection(parsed)
            connection.request('POST', parsed.path or '/', body=wire, headers={
                'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                'Accept': 'application/json', 'Accept-Encoding': 'identity',
            })
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise PlanningTransportError('http', response.status)
            raw = _response_bytes(response)
        except PlanningTransportError:
            raise
        except TimeoutError:
            raise PlanningTransportError('timeout') from None
        except (OSError, http.client.HTTPException, UnicodeError):
            raise PlanningTransportError('connection') from None
        finally:
            for resource in (response, connection):
                if resource is not None:
                    try:
                        resource.close()
                    except (OSError, http.client.HTTPException):
                        pass
        try:
            return _strict_json(raw.decode('utf-8'), MAX_RESPONSE_BYTES)
        except (UnicodeError, ValueError):
            raise PlanningTransportError('transport_json') from None

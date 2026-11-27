"""Product-only native tool calling over existing ProviderStore authority.

This adapter returns untrusted assistant messages; it never executes a tool or
interprets a provider's success claim as execution evidence. The frozen planning
adapter continues to reject native tool calls.

Wire contract: https://api-docs.deepseek.com/guides/tool_calls/
Thinking history: https://api-docs.deepseek.com/guides/thinking_mode/
Anthropic Messages: https://help.aliyun.com/zh/model-studio/anthropic-api-messages
"""
from base64 import b64encode
from copy import deepcopy
import os
import re
from urllib.parse import urlsplit

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import (
    PlanningTransportError, _strict_json, _text,
)
from .local_gateway import LocalGatewayPlanningAdapter
from .provider_network import RoutedPlanningAdapter, request_provider_json
from .provider_store import _RestrictedAdapter, _configured, _public_addresses
from .agent_context import HOST_POLICY_PREFIX
from .agent_images import MAX_IMAGES, MAX_IMAGE_BASE64, image_capable, load_image
from .agent_metrics import output_token_limit, usage
from .schemas import ApiError


MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_ARGUMENT_BYTES = 32 * 1024
MAX_MESSAGES = 128
MAX_TOOLS = 64
MAX_TOOL_CALLS = 8
_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_-]{0,63}\Z')
_CALL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')
_OPENAI_EFFORT = re.compile(
    r'(gpt-5(?:\.\d)?(?:-mini|-nano)?|o3(?:-mini)?|o4-mini)(?:-\d{4}-\d{2}-\d{2})?\Z')


def openai_effort(model_id, effort):
    match = _OPENAI_EFFORT.fullmatch(model_id)
    if match is None or effort is None:
        return None
    if effort != 'off':
        return effort
    family = match[1]
    if family.startswith('o'):
        return 'low'
    return 'none' if family.startswith('gpt-5.') else 'minimal'


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


def _messages(value, *, local_gateway=False, anthropic=False):
    if type(value) is not list or not 1 <= len(value) <= MAX_MESSAGES:
        raise ValueError('A bounded message history is required')
    result, pending, seen = [], set(), set()
    has_images = False
    reasoning_fields = {'reasoning_content','reasoning'} if local_gateway else {'reasoning_content'}
    block_fields = {'_anthropicBlocks'} if anthropic else set()
    for item in value:
        if type(item) is not dict:
            raise ValueError('Invalid message')
        role = item.get('role')
        if role in ('system', 'user'):
            required = {'role', 'content'}
            allowed = required | {'_images'} if role == 'user' else required
            if not required <= item.keys() <= allowed or pending:
                raise ValueError('Invalid message or incomplete tool history')
            _text(item['content'])
            if '_images' in item:
                refs = item['_images']
                if has_images or type(refs) is not list or not 1 <= len(refs) <= MAX_IMAGES:
                    raise ValueError('Only one user message may attach images')
                has_images = True
        elif role == 'tool':
            if (item.keys() != {'role', 'tool_call_id', 'content'}
                    or type(item['tool_call_id']) is not str or item['tool_call_id'] not in pending):
                raise ValueError('Tool result has no pending call')
            _text(item['content'], nonempty=False)
            pending.remove(item['tool_call_id'])
        elif role == 'assistant':
            if (not {'role', 'content'} <= item.keys()
                    or not item.keys() <= {'role', 'content', 'tool_calls'} | reasoning_fields | block_fields or pending):
                raise ValueError('Invalid assistant history')
            if item['content'] is not None:
                _text(item['content'], nonempty=False)
            for field in item.keys() & reasoning_fields:
                _text(item[field], nonempty=False)
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


def _assistant(envelope, names, *, local_gateway=False):
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
        if local_gateway and result.get('tool_calls') and message.get('reasoning') is not None:
            # Ollama's OpenAI-compatible gateway expects this same field on
            # subsequent requests in the current native tool exchange.
            result['reasoning'] = _text(message['reasoning'], nonempty=False)
        elif message.get('reasoning_content') is not None:
            # Protocol continuation only. Callers must not render this as an
            # execution trace, independent judgment, or verification evidence.
            result['reasoning_content'] = _text(message['reasoning_content'], nonempty=False)
        return result
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PlanningTransportError('assistant_content') from None


def _rejected_reply_shape(envelope):
    choices = envelope.get('choices') if type(envelope) is dict else None
    facts = {'choiceCount':len(choices) if type(choices) is list else None}
    if type(choices) is list and len(choices) == 1 and type(choices[0]) is dict:
        choice = choices[0]
        finish = choice.get('finish_reason')
        facts['finishReason'] = finish if finish in ('stop','tool_calls','length','content_filter','insufficient_system_resource') else None
        message = choice.get('message')
        calls = message.get('tool_calls') if type(message) is dict else None
        facts['toolCallCount'] = len(calls) if type(calls) is list else None
    return facts


def _anthropic_blocks(blocks, names=None):
    """Validate and normalize only first-party text/thinking and client tool blocks."""
    if type(blocks) is not list or not 1 <= len(blocks) <= 32:
        raise ValueError('Invalid Messages content')
    text, calls = [], []
    for block in blocks:
        kind = block.get('type') if type(block) is dict else None
        if kind == 'text' and block.keys() == {'type','text'}:
            text.append(_text(block['text'], nonempty=False))
        elif kind == 'tool_use' and block.keys() == {'type','id','name','input'}:
            calls.append({'id':block['id'], 'type':'function', 'function':{'name':block['name'],
                'arguments':canonical_json_bytes(block['input']).decode('utf-8')}})
        elif kind == 'thinking' and block.keys() <= {'type','thinking','signature'} and 'thinking' in block:
            _text(block['thinking'], nonempty=False)
            if 'signature' in block:
                _text(block['signature'], nonempty=False)
        elif kind == 'redacted_thinking' and block.keys() == {'type','data'}:
            _text(block['data'])
        else:
            raise ValueError('Unsupported Messages content block')
    return ''.join(text) or None, _calls(calls, names) if calls else []


def _anthropic_assistant(envelope, names, historical_ids):
    try:
        if (type(envelope) is not dict or envelope.get('role') != 'assistant'
                or envelope.get('type') != 'message' or 'error' in envelope):
            raise ValueError
        blocks = envelope['content']
        text, calls = _anthropic_blocks(blocks, names)
        if calls:
            if envelope.get('stop_reason') != 'tool_use' or any(c['id'] in historical_ids for c in calls):
                raise ValueError
            return {'role':'assistant', 'content':text, 'tool_calls':calls, '_anthropicBlocks':deepcopy(blocks)}
        if envelope.get('stop_reason') != 'end_turn' or not text or not text.strip():
            raise ValueError
        return {'role':'assistant', 'content':text}
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PlanningTransportError('assistant_content') from None


def _dashscope_host(hostname):
    suffix = '.aliyuncs.com'
    return bool(hostname and hostname.endswith(suffix) and 'dashscope' in hostname.removesuffix(suffix))


def _message_breakpoint(messages):
    return next((block for message in reversed(messages) for block in reversed(message['content'])
        if block['type'] in ('tool_result', 'tool_use') or block['type'] == 'text' and block['text']), None)


def _anthropic_wire(model, history, tools, max_tokens, effort, hostname, image_sources=(), *, prompt_cache='auto'):
    supports_qwen4 = model == 'qwen4-max' or bool(re.fullmatch(r'qwen4-max-\d{4}-\d{2}-\d{2}', model))
    qwen_cache = model.lower().startswith(('qwen4-', 'qwen3.5-', 'qwen3-', 'qwen-max', 'qwen-plus', 'qwen-coder', 'qwq-'))
    supports_cache = prompt_cache != 'off' and (
        prompt_cache in ('ephemeral', 'ephemeral_1h') or hostname == 'api.anthropic.com'
        or model.lower().startswith('claude-') or _dashscope_host(hostname) and qwen_cache)
    system, messages = [], []
    pending = []
    for item in history:
        role = item['role']
        if role == 'tool':
            raw = _strict_json(item['content'], 512 * 1024)
            pending.append({'type':'tool_result', 'tool_use_id':item['tool_call_id'],
                'content':item['content'], 'is_error':raw.get('status') != 'SUCCESS'})
            continue
        if pending:
            messages.append({'role':'user', 'content':pending})
            pending = []
        if role == 'system':
            if messages:
                raise ValueError('Messages system blocks must precede user messages')
            system.append({'type':'text', 'text':item['content']})
        elif role == 'assistant':
            blocks = item.get('_anthropicBlocks')
            if blocks is not None:
                if type(blocks) is list:
                    # Cache markers belong to this request. Retain the exact
                    # thinking text/signature and leave the recorded blocks intact.
                    blocks = [{key:value for key,value in block.items() if key != 'cache_control'}
                        if type(block) is dict else block for block in blocks]
                text, calls = _anthropic_blocks(blocks)
                if text != item['content'] or calls != item.get('tool_calls', []):
                    raise ValueError('Messages assistant echo diverges from validated text and calls')
            else:
                blocks = [{'type':'text', 'text':item['content']}] if item['content'] else []
                blocks.extend({'type':'tool_use', 'id':call['id'], 'name':call['function']['name'],
                    'input':_strict_json(call['function']['arguments'], MAX_ARGUMENT_BYTES)}
                    for call in item.get('tool_calls', []))
            messages.append({'role':'assistant', 'content':blocks})
        else:
            blocks = [{'type':'image', 'source':source} for source in image_sources] if item.get('_images') else []
            messages.append({'role':'user', 'content':[*blocks, {'type':'text','text':item['content']}]})
    if pending:
        messages.append({'role':'user', 'content':pending})
    wire = {'model':model, 'max_tokens':max_tokens, 'messages':messages, 'stream':False}
    if system:
        wire['system'] = system
    if tools:
        wire['tools'] = [{'name':function['name'], 'input_schema':function['parameters'],
            **({'description':function['description']} if 'description' in function else {})}
            for function in sorted((tool['function'] for tool in tools), key=lambda fn: fn['name'])]
    if supports_cache:
        control = {'type':'ephemeral'}
        if hostname == 'api.anthropic.com' and prompt_cache == 'ephemeral_1h':
            control['ttl'] = '1h'
        static = system or wire.get('tools')
        if static:
            static[-1]['cache_control'] = dict(control)
        stable = _message_breakpoint(messages[:-1])
        if stable is not None:
            stable['cache_control'] = dict(control)
        # A fresh short text prompt can use the static cache without paying
        # for a separate cache write for this prompt.
        fresh_user_turn = (len(messages) in (1, 2) and all(message['role'] == 'user' for message in messages)
            and (len(messages) == 1 or messages[0]['content'][0].get('text', '').startswith(HOST_POLICY_PREFIX)))
        short_text_only = (fresh_user_turn and len(history[-1]['content'].encode('utf-8')) < 512
            and not any(item.get('_images') for item in history))
        if not short_text_only and (tail := _message_breakpoint(messages[-1:])) is not None:
            tail['cache_control'] = dict(control)
    if supports_qwen4:
        enabled = effort not in (None, 'off')
        wire['thinking'] = {'type':'enabled', 'display':'summarized'} if enabled else {'type':'disabled'}
        if enabled:
            wire['output_config'] = {'effort':{'low':'low','medium':'high','high':'xhigh'}[effort]}
    return wire


def _dashscope_breakpoints(messages):
    system = next((item for item in reversed(messages) if item['role'] == 'system' and item['content']), None)
    stable = next((item for item in reversed(messages[:-1]) if item['role'] != 'system' and item['content']), None)
    for anchor in (system, stable):
        if anchor is None:
            continue
        content = anchor['content']
        parts = [{'type':'text', 'text':content}] if isinstance(content, str) else [dict(part) for part in content]
        parts[-1]['cache_control'] = {'type':'ephemeral'}
        anchor['content'] = parts


def _openai_wire(model, history, tools, max_tokens, effort, hostname, *, prompt_cache='auto',
                 cache_key=None, image_sources=()):
    native_openai = hostname == 'api.openai.com'
    messages = [{key:value for key,value in item.items() if key != '_images'} for item in history]
    if image_sources:
        index = next(i for i, item in enumerate(history) if '_images' in item)
        messages[index]['content'] = [{'type':'text', 'text':history[index]['content']}, *[
            {'type':'image_url', 'image_url':{'url':f"data:{source['media_type']};base64,{source['data']}"}}
            for source in image_sources]]
    cap_field = 'max_completion_tokens' if native_openai else 'max_tokens'
    wire = {'model':model, 'stream':False, 'messages':messages, cap_field:max_tokens}
    if not native_openai:
        wire['n'] = 1
    if tools:
        wire['tools'] = deepcopy(sorted(tools, key=lambda tool: tool['function']['name']))
    if hostname == 'api.deepseek.com':
        enabled = effort not in (None, 'off')
        wire['thinking'] = {'type':'enabled' if enabled else 'disabled'}
        if enabled:
            wire['reasoning_effort'] = {'low':'low', 'medium':'high', 'high':'max'}[effort]
    elif native_openai:
        if (effective := openai_effort(model, effort)) is not None:
            wire['reasoning_effort'] = effective
        if prompt_cache != 'off' and cache_key:
            wire['prompt_cache_key'] = cache_key
    elif _dashscope_host(hostname) and prompt_cache == 'ephemeral':
        _dashscope_breakpoints(messages)
    return wire


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

    def complete(self, messages: list, tools: list, *, cache_key=None) -> dict:
        names = _tool_names(tools)
        adapter = self.providers.adapter(self.profile, self.attempt_id)
        if type(adapter) is not _RestrictedAdapter:
            raise PlanningTransportError('endpoint_policy')
        delegate = adapter.delegate
        local_gateway = type(delegate) is LocalGatewayPlanningAdapter
        anthropic = self.profile.get('protocol') == 'anthropic-compatible'
        history = _messages(messages, local_gateway=local_gateway, anthropic=anthropic)
        max_tokens = output_token_limit(self.profile)
        hostname = urlsplit(delegate.endpoint).hostname
        effort = self.profile.get('reasoningEffort')
        prompt_cache = ('off' if self.profile.get('protocol') == 'deepseek-compatible'
                        else self.profile.get('promptCache', 'auto'))
        def build_wire(image_sources=()):
            if anthropic:
                return _anthropic_wire(self.model_id, history, tools, max_tokens, effort, hostname,
                    image_sources, prompt_cache=prompt_cache)
            return _openai_wire(self.model_id, history, tools, max_tokens, effort, hostname,
                image_sources=image_sources, prompt_cache=prompt_cache, cache_key=cache_key)

        raw = canonical_json_bytes(build_wire())
        if len(raw) > MAX_REQUEST_BYTES:
            raise PlanningTransportError('oversized_request')
        self.providers.check_text(raw.decode('utf-8'))
        refs = next((item['_images'] for item in history if '_images' in item), None)
        if refs is not None:
            if local_gateway or not image_capable(self.profile):
                raise PlanningTransportError('vision_unsupported')
            self.providers.check_text(canonical_json_bytes(refs).decode('utf-8'))
            try:
                sources = [{'type':'base64', 'media_type':ref['mediaType'],
                    'data':b64encode(load_image(self.providers.config.data_dir,ref)).decode('ascii')} for ref in refs]
            except ApiError as error:
                raise PlanningTransportError('image_store_integrity') from error
            raw = canonical_json_bytes(build_wire(sources))
            if len(raw) > MAX_REQUEST_BYTES + MAX_IMAGES * (MAX_IMAGE_BASE64 + 256):
                raise PlanningTransportError('oversized_request')
        if not _configured(adapter.credential_env):
            raise PlanningTransportError('credentials')
        if local_gateway:
            envelope = delegate._request('POST', '/v1/chat/completions', raw)
            if envelope.get('model') != self.model_id:
                raise PlanningTransportError('assistant_content')
        else:
            if type(delegate) is not RoutedPlanningAdapter:
                _public_addresses(delegate.endpoint)
            envelope = self._https(delegate, raw, anthropic=True) if anthropic else self._https(delegate, raw)
        # Check the entire envelope, including reasoning and provider metadata,
        # before returning or persisting any part of it.
        self.providers.check_text(canonical_json_bytes(envelope).decode('utf-8'))
        observed = usage(envelope) if type(envelope) is dict else None
        try:
            if anthropic:
                historical_ids = {call['id'] for item in history for call in item.get('tool_calls', [])}
                message = _anthropic_assistant(envelope, names, historical_ids)
            else:
                message = _assistant(envelope, names, local_gateway=local_gateway)
        except PlanningTransportError as error:
            error.reported_usage = observed
            if anthropic:
                stop = envelope.get('stop_reason') if type(envelope) is dict else None
                error.reply_shape = {'finishReason': stop if stop in ('end_turn','tool_use',
                    'max_tokens','stop_sequence','refusal','pause_turn') else None}
            else:
                error.reply_shape = _rejected_reply_shape(envelope)
            raise
        if observed is not None:
            message['_usage'] = observed
        return message

    @staticmethod
    def _https(delegate, wire, *, anthropic=False):
        key = os.environ.get(delegate.api_key_env)
        if not key or not key.strip() or any(not 33 <= ord(char) <= 126 for char in key):
            raise PlanningTransportError('credentials')
        headers = {'x-api-key':key, 'anthropic-version':'2023-06-01'} if anthropic else {
            'Authorization':'Bearer ' + key}
        return request_provider_json(delegate, 'POST', urlsplit(delegate.endpoint).path or '/',
            {**headers, 'Content-Type':'application/json'}, wire)

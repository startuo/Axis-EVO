"""Deterministic runtime scenarios for request prefixes and cache contracts."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import pytest

from web_api.agent_context import HOST_POLICY_PREFIX, auto_compact_snapshot
from web_api.agent_metrics import ModelBudget, current_context, invoke_completion, summarize, usage
from web_api.agent_prefix import PrefixProbe, RequestPrefix
from web_api.agent_provider import _anthropic_wire, _openai_wire
from web_api.agent_service import AgentService
from web_api.agent_store import canonical, digest
from web_api.agent_tools import CATALOG
from web_api.provider_store import ProviderStore
from web_api.runtime_config import RuntimeConfig
from web_api.schemas import ApiError


PROFILE = {'id': 'fixture-profile', 'revision': 1, 'configSha256': 'a' * 64,
           'modelId': 'fixture-model'}
PROMPTS = (
    'Read the current calculation.',
    'Make two small, checked edits to the calculation.',
    '/plan Inspect the result and record the next steps.',
    '/review Check the saved calculation and report findings.',
    'Read the unchanged project notes.',
    '/goal Record the verification milestone.',
    'Explain the last saved value.',
    'Check the source and notes together.',
    'Describe the remaining work.',
    'Summarize the result and name the changed file.',
)


def open_service(root, *, completion=None, profile=PROFILE):
    workspace = root / 'workspace'
    workspace.mkdir()
    providers = SimpleNamespace(get=lambda *_: profile, adapter=lambda *_: None, check_text=lambda _: None)
    runtime = SimpleNamespace(config=SimpleNamespace(data_dir=root / 'data'), providers=providers)
    service = AgentService(runtime, SimpleNamespace(), completion=completion)
    wid = service.create_workspace({'name': 'Cache fixture', 'path': str(workspace),
        'writeMode': 'write', 'shareWithProvider': True})['id']
    return service, wid, workspace


def submit(service, wid, prompt, request_id, *, profile=PROFILE, **kwargs):
    return service.submit({'workspaceId': wid, 'requestId': request_id, 'prompt': prompt,
        'profileId': profile['id'], 'profileRevision': profile['revision'], **kwargs}, inline=True)


def call(identity, name, arguments):
    return {'id': identity, 'type': 'function', 'function': {
        'name': name, 'arguments': canonical(arguments)}}


def normalized_request(messages, tools):
    tool_json = canonical(sorted(tools, key=lambda tool: tool['function']['name'])).encode()
    return tool_json + b'\n' + b''.join(canonical(message).encode() + b'\n' for message in messages)


def prefix_bytes(previous, current):
    return next((i for i, (old, new) in enumerate(zip(previous, current)) if old != new),
                min(len(previous), len(current)))


def mixed_scenario(root):
    service, wid, workspace = open_service(root)
    source = workspace / 'calculation.py'
    source.write_bytes(b'count = 1\nlabel = "test"\n')
    (workspace / 'notes.md').write_text('The fixture changes only calculation.py.\n', encoding='utf-8')
    previous = None
    requests = []
    catalog_digests = []
    steps = []
    case = step = 0

    # Intentionally a five-argument replacement for the isolated Provider.
    def completion(_providers, _profile, messages, tools, _cancelled):
        nonlocal previous, step
        wire = normalized_request(messages, tools)
        if previous is None:
            matched = ratio = None
        else:
            matched = prefix_bytes(previous, wire)
            ratio = matched / len(previous)
        requests.append({'turn': case + 1, 'round': step + 1, 'previousBytes': len(previous or b''),
            'prefixMatchBytes': matched, 'prefixMatchRatio': ratio})
        catalog_digests.append(hashlib.sha256(canonical(tools).encode()).hexdigest())
        previous = wire

        def invoke(name, **arguments):
            return call(f'fixture-{case}-{step}-{len(actions)}-{name}', name, arguments)

        actions = []
        if case in (0, 1, 3, 4, 6, 7) and step == 0:
            target = 'notes.md' if case == 4 else source.name
            actions.append(invoke('read_file', path=target))
            if case == 7:
                actions.append(invoke('read_file', path='notes.md'))
        if case == 1 and step in (1, 2):
            actions.append(invoke('patch_file', path=source.name,
                expectedSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                replacements=[{'old': f'count = {step}', 'new': f'count = {step + 1}'}]))
        if case in (2, 5) and step == 0:
            actions.append(invoke('update_plan', steps=[{'title': 'Verify the recorded result', 'status': 'pending'}]))
        if case in (2, 3) and step == 0:
            actions.append(invoke('write_file', path='prohibited.txt', expectedSha256=None, content='must never be written'))
        step += 1
        if actions:
            return {'role': 'assistant', 'content': None, 'tool_calls': actions}
        return {'role': 'assistant', 'content': f'Fixture completed step {case + 1}.'}

    service._completion = completion
    conversation = None
    try:
        for case, prompt in enumerate(PROMPTS):
            step = 0
            options = {'conversationId': conversation['id']} if conversation else {}
            conversation = submit(service, wid, prompt, f'prefix-fixture-{case:02}', **options)
            turn = conversation['turns'][-1]
            assert turn['status'] == 'COMPLETED', (prompt, turn['status'], turn['code'])
            turn_id = turn['id']
            rows = service.store.records('model_request', parent_id=turn_id)
            recorded = [row['payload'] for row in rows]
            statuses = service.store.records('tool_result', parent_id=turn_id)
            rejected = [r['payload']['code'] for r in statuses if r['payload']['status'] == 'REJECTED']
            intents = [r['payload']['tool'] for r in service.store.records('tool_intent', parent_id=turn_id)]
            steps.append({'turn': case + 1, 'mode': turn.get('command'), 'rejected': rejected,
                'intents': intents, 'modelRequestPrefix': [{
                    key: p[key] for key in ('prefixMatchBytes', 'prefixMatchRatio', 'prefixDivergence')
                    if key in p} for p in recorded]})
        assert source.read_bytes() == b'count = 3\nlabel = "test"\n'
        assert not (workspace / 'prohibited.txt').exists()
        ratios = [entry['prefixMatchRatio'] for entry in requests if entry['prefixMatchRatio'] is not None]
        return {'turns': steps, 'requests': requests, 'catalogDigests': catalog_digests,
            'averagePrefixMatchRatio': sum(ratios) / len(ratios), 'providerRequests': 0}
    finally:
        service.close()



def test_ten_turn_cache_and_read_only_gates(tmp_path):
    report = mixed_scenario(tmp_path)
    assert len(report['requests']) == 20 and len(set(report['catalogDigests'])) == 1
    assert report['averagePrefixMatchRatio'] >= .90
    assert report['providerRequests'] == 0
    for turn in report['turns']:
        if turn['mode'] in ('plan', 'review'):
            assert turn['rejected'] == ['AGENT_COMMAND_READ_ONLY']
            assert 'write_file' not in turn['intents']
    facts = [row for turn in report['turns'] for row in turn['modelRequestPrefix']]
    assert facts[0] == {'prefixMatchBytes': 0, 'prefixMatchRatio': None, 'prefixDivergence': 'FIRST_REQUEST'}
    assert [fact['prefixMatchRatio'] for fact in facts] == [row['prefixMatchRatio'] for row in report['requests']]
    assert not {'TOOLS_CHANGED', 'HISTORY_MUTATED'} & {fact['prefixDivergence'] for fact in facts}


def test_host_policy_reuse_switch_and_authority_update(tmp_path):
    requests = []
    def completion(_providers, _profile, messages, _tools, _cancelled):
        requests.append(messages)
        if messages[-1]['content'].startswith('/plan'):
            return {'role': 'assistant', 'content': None, 'tool_calls': [
                call('cache-plan', 'update_plan', {'steps': [{'title': 'Inspect the baseline', 'status': 'pending'}]})]}
        return {'role': 'assistant', 'content': 'Read-only fixture answer.'}

    service, wid, _ = open_service(tmp_path, completion=completion)
    try:
        conversation = None
        for i in range(5):
            options = {'conversationId': conversation['id']} if conversation else {}
            conversation = submit(service, wid, f'Observe item {i}', f'policy-fixture-{i}', **options)
        cid = conversation['id']
        assert all(sum((m['content'] or '').startswith(HOST_POLICY_PREFIX) for m in request) == 1
                   for request in requests)
        records = [service.store.records('context_policy', parent_id=t['id'])[0]['payload']
                   for t in conversation['turns']]
        assert [r['reusedFromPrefix'] for r in records] == [False, True, True, True, True]
        prior = requests[-1]
        consumed = len(requests)
        plan = submit(service, wid, '/plan inspect safely', 'policy-plan-1', conversationId=cid)['turns'][-1]
        assert plan['status'] == 'COMPLETED'
        switched = requests[consumed]
        assert switched[:len(prior)] == prior
        assert [m['content'] for m in switched if (m['content'] or '').startswith(HOST_POLICY_PREFIX)][-1].count('supersedes') == 1
        assert len([m for m in switched if (m['content'] or '').startswith(HOST_POLICY_PREFIX)]) == 2

        current = service.workspaces.get(wid)['policy']
        service.workspaces.settings(wid, {**current, 'style': 'detailed'})
        submit(service, wid, 'Fresh authority check', 'policy-revoked-1', conversationId=cid)
        policies = [m['content'] for m in requests[-1] if (m['content'] or '').startswith(HOST_POLICY_PREFIX)]
        assert len(policies) == 1 and json.loads(policies[0][len(HOST_POLICY_PREFIX):])['policy']['style'] == 'detailed'
    finally:
        service.close()


def _markers(wire):
    return [block for section in (wire.get('system', []), wire.get('tools', []),
        *(message['content'] for message in wire['messages'])) for block in section if 'cache_control' in block]


CACHE_TOOLS = [CATALOG[-1], CATALOG[0]]
STABLE_MESSAGES = [
    {'role': 'system', 'content': 'Stable system prompt.'},
    {'role': 'user', 'content': 'Original task and authorized text.'},
    {'role': 'assistant', 'content': 'The prior answer.'},
    {'role': 'user', 'content': 'A follow-up.'},
]


@pytest.mark.parametrize('hostname,model,setting,expected', [
    ('api.anthropic.com', 'claude-sonnet', 'ephemeral_1h', {'type': 'ephemeral', 'ttl': '1h'}),
    ('dashscope.aliyuncs.com', 'qwen3.5-plus', 'auto', {'type': 'ephemeral'}),
    ('dashscope-intl.aliyuncs.com', 'qwen4-max', 'auto', {'type': 'ephemeral'}),
    ('dashscope.aliyuncs.com', 'claude-sonnet', 'ephemeral_1h', {'type': 'ephemeral'}),
    ('dashscope.aliyuncs.com', 'qwen3-coder-next', 'auto', {'type': 'ephemeral'}),
    ('dashscope.aliyuncs.com', 'qwq-plus', 'auto', {'type': 'ephemeral'}),
    ('edge.example.test', 'claude-sonnet', 'auto', {'type': 'ephemeral'}),
    ('edge.example.test', 'qwen-plus', 'ephemeral', {'type': 'ephemeral'}),
    ('dashscope.aliyuncs.com.example.test', 'qwen3.5-plus', 'auto', None),
    ('dashscope.aliyuncs.com', 'unlisted-model', 'auto', None),
    ('api.anthropic.com', 'claude-sonnet', 'off', None),
])
def test_messages_cache_breakpoints_are_capability_scoped(hostname, model, setting, expected):
    wire = _anthropic_wire(model, STABLE_MESSAGES, CACHE_TOOLS, 256, None, hostname, prompt_cache=setting)
    anchors = _markers(wire)
    assert len(anchors) == (3 if expected else 0)
    if expected:
        assert anchors == [wire['system'][-1], wire['messages'][-2]['content'][-1], wire['messages'][-1]['content'][-1]]
        assert all(item['cache_control'] == expected for item in anchors)
    assert canonical(wire) == canonical(_anthropic_wire(
        model, STABLE_MESSAGES, list(reversed(CACHE_TOOLS)), 256, None, hostname, prompt_cache=setting))


def test_messages_skip_only_fresh_short_text_without_images():
    tiny = [{'role': 'user', 'content': 'short request'}]
    assert len(_markers(_anthropic_wire('claude-sonnet', tiny, CACHE_TOOLS, 256, None, 'api.anthropic.com'))) == 1
    longer = [{'role': 'user', 'content': '字' * 171}]
    assert len(_markers(_anthropic_wire('claude-sonnet', longer, CACHE_TOOLS, 256, None, 'api.anthropic.com'))) == 2
    tiny[0]['_images'] = [{'sha256': '6' * 64}]
    source = {'type': 'base64', 'media_type': 'image/png', 'data': 'dGVzdA=='}
    first = _anthropic_wire('claude-sonnet', tiny, CACHE_TOOLS, 256, None, 'api.anthropic.com', (source,))
    assert len(_markers(first)) == 2
    assert first['messages'][0]['content'][0] == {'type': 'image', 'source': source}
    history = [*tiny, {'role': 'assistant', 'content': None, 'tool_calls': [call('use-a', 'read_file', {'path': 'a.txt'})]},
        {'role': 'tool', 'tool_call_id': 'use-a', 'content': '{"status":"SUCCESS"}'}]
    next_request = _anthropic_wire('claude-sonnet', history, CACHE_TOOLS, 256, None, 'api.anthropic.com', (source,))
    assert next_request['messages'][0]['content'][0] == first['messages'][0]['content'][0]
    anchors = _markers(next_request)
    assert anchors == [next_request['tools'][-1], next_request['messages'][1]['content'][0],
                      next_request['messages'][2]['content'][0]]
    assert [anchor['type'] for anchor in anchors[1:]] == ['tool_use', 'tool_result']


def test_openai_dashscope_and_deepseek_wire_keep_provider_boundaries():
    cache_key = 'axis_' + 'a' * 24
    def wire(hostname, setting, model='gpt-4o'):
        return _openai_wire(model, STABLE_MESSAGES, CACHE_TOOLS, 256, None, hostname,
                            prompt_cache=setting, cache_key=cache_key)
    native = wire('api.openai.com', 'auto')
    assert native['prompt_cache_key'] == cache_key and native['max_completion_tokens'] == 256
    assert 'prompt_cache_key' not in wire('api.openai.com', 'off')
    assert 'prompt_cache_key' not in wire('api.openai.com.example.test', 'ephemeral')
    dash_auto = wire('dashscope.aliyuncs.com', 'auto')
    assert dash_auto['messages'] == STABLE_MESSAGES and 'prompt_cache_key' not in dash_auto
    dash = wire('dashscope.aliyuncs.com', 'ephemeral')
    assert 'prompt_cache_key' not in dash
    assert dash['messages'][0]['content'] == [
        {'type': 'text', 'text': STABLE_MESSAGES[0]['content'], 'cache_control': {'type': 'ephemeral'}}]
    assert dash['messages'][2]['content'][0]['cache_control'] == {'type': 'ephemeral'}
    assert isinstance(dash['messages'][-1]['content'], str)
    assert STABLE_MESSAGES[0]['content'] == 'Stable system prompt.'
    deepseek = wire('api.deepseek.com', 'ephemeral', 'deepseek-chat')
    assert deepseek['messages'] == STABLE_MESSAGES and 'prompt_cache_key' not in deepseek
    assert 'cache_control' not in canonical(deepseek)
    for request in (native, dash, deepseek):
        assert [item['function']['name'] for item in request['tools']] == sorted(
            item['function']['name'] for item in CACHE_TOOLS)


def test_profile_cache_policy_omission_keeps_existing_revision_hash(tmp_path):
    config = RuntimeConfig(tmp_path, (), {'fixture': 'AXIS_EVO_CACHE_TEST_KEY'},
                           ('https://api.openai.com/v1/chat/completions',))
    store = ProviderStore(config)
    body = {'name': 'OpenAI fixture', 'protocol': 'openai-compatible',
        'endpoint': config.endpoints[0], 'modelId': 'gpt-4o', 'credentialRef': 'fixture', 'timeout': 10}
    created = store.create(body)
    assert 'promptCache' not in created and created['configSha256'] == digest(body)
    next_revision = store.edit(created['id'], {**body, 'promptCache': 'ephemeral_1h'})
    assert next_revision['promptCache'] == 'ephemeral_1h'
    assert store.get(created['id'], 1)['configSha256'] == created['configSha256']
    assert 'promptCache' in store.list()['nativeTurnOptions']
    with pytest.raises(ApiError):
        store.edit(created['id'], {**body, 'promptCache': 'permanent'})


def test_nested_cache_creation_is_counted_once_and_invalid_details_are_rejected():
    actual = {'input_tokens': 7, 'output_tokens': 9, 'cache_read_input_tokens': 60,
        'cache_creation': {'ephemeral_5m_input_tokens': 3, 'ephemeral_1h_input_tokens': 30}}
    value = usage({'usage': actual})
    assert (value['promptTokens'], value['cacheWriteTokens'], value['cacheHitRate']) == (100, 33, .60)
    assert usage({'usage': {**actual, 'cache_creation_input_tokens': 33}}) == value
    assert usage({'usage': {**actual, 'cache_creation_input_tokens': 32}}) is None
    assert usage({'usage': {**actual, 'cache_creation': {'ephemeral_1h_input_tokens': True}}}) is None
    dash = {'prompt_tokens': 100, 'completion_tokens': 9, 'total_tokens': 109,
        'prompt_tokens_details': {'cached_tokens': 60, 'cache_creation': actual['cache_creation']}}
    assert usage({'usage': dash})['cacheWriteTokens'] == 33


@pytest.mark.parametrize('change_authority', ['none', 'revoke_source', 'workspace_policy'])
def test_compacted_epoch_bridges_turns_but_authority_revocation_wins(tmp_path, change_authority):
    profile = {**PROFILE, 'contextWindow': 11500, 'maxOutputTokens': 256}
    service, wid, _ = open_service(tmp_path, profile=profile)
    root = tmp_path / 'granted-knowledge'
    root.mkdir()
    for name in ('first', 'middle', 'latest'):
        (root / (name + '.txt')).write_bytes((f'raw-source-{name} ' * 800).encode()[:7800])
    granted = service.workspaces.add_source(wid, {'name': 'Fixture material', 'path': str(root),
        'kind': 'knowledge', 'shareWithProvider': True})['sources'][0]['id']
    sent = []
    def completion(_providers, _profile, messages, tools, _cancelled):
        sent.append((messages, tools))
        if len(sent) <= 3:
            name = ('first', 'middle', 'latest')[len(sent) - 1] + '.txt'
            return {'role': 'assistant', 'content': None, 'tool_calls': [
                call(f'epoch-read-{len(sent)}', 'read_file', {'path': name, 'sourceId': granted})]}
        return {'role': 'assistant', 'content': 'Prior requirements retained.'}

    service._completion = completion
    try:
        first = submit(service, wid, 'Keep this original requirement verbatim.', 'epoch-fixture-1', profile=profile)
        first_id = first['turns'][-1]['id']
        assert first['turns'][-1]['status'] == 'COMPLETED', first['turns'][-1]['code']
        assert any(r['payload']['prefixDivergence'] == 'COMPACT_EPOCH'
                   for r in service.store.records('model_request', parent_id=first_id))
        saved, = service.store.records('auto_compact_snapshot', parent_id=first_id)
        material = saved['payload']
        assert material['reason'] == 'AUTO_EPOCH' and material['epoch'] >= 1
        assert material['messagesSha256'] == digest(material['messages'])
        assert all(m['role'] != 'system' and '_images' not in m for m in material['messages'])
        assert material['messages'][-1]['content'] == 'Prior requirements retained.'
        assert 'messages' not in next(r['payload'] for r in first['turns'][-1]['events']
                                      if r['kind'] == 'auto_compact_snapshot')
        assert any('raw-source-latest' in canonical(m) for m in material['messages'])
        last = len(sent)
        if change_authority == 'revoke_source':
            service.workspaces.revoke_source(wid, granted)
        elif change_authority == 'workspace_policy':
            current = service.workspaces.get(wid)['policy']
            service.workspaces.settings(wid, {**current, 'writeMode': 'read'})
        second = submit(service, wid, 'Report the status.', 'epoch-fixture-2',
                        profile=profile, conversationId=first['id'])
        next_turn = second['turns'][-1]
        assert next_turn['status'] == 'COMPLETED'
        messages, tools = sent[last]
        recorded = service.store.records('model_request', parent_id=next_turn['id'])[0]['payload']
        wire = normalized_request(messages, tools)
        old = normalized_request(*sent[last - 1])
        assert recorded['prefixMatchRatio'] == prefix_bytes(old, wire) / len(old)
        assert 'Keep this original requirement verbatim.' in canonical(messages)
        if change_authority == 'none':
            assert recorded['prefixMatchRatio'] >= .90
            assert recorded['prefixDivergence'] == 'NONE'
            assert messages[1:1+len(material['messages'])] == [
                {key: value for key, value in m.items() if key != '_contextPolicy'} for m in material['messages']]
        else:
            assert 'raw-source-latest' not in canonical(messages)
            assert recorded['prefixDivergence'] == 'HISTORY_MUTATED'
            assert sum((m['content'] or '').startswith(HOST_POLICY_PREFIX) for m in messages) == 1
    finally:
        service.close()


def test_cache_keys_are_conversation_scoped_and_optional_at_dispatch(tmp_path):
    keys = []
    def completion(_providers, _profile, _messages, _tools, _cancelled, *, cache_key=None):
        keys.append(cache_key)
        return {'role': 'assistant', 'content': 'ok'}

    service, wid, _ = open_service(tmp_path, completion=completion)
    try:
        first = submit(service, wid, 'First', 'cache-key-01')
        submit(service, wid, 'Second', 'cache-key-02', conversationId=first['id'])
        other = submit(service, wid, 'Another conversation', 'cache-key-03')
        def expected(cid):
            return 'axis_' + hashlib.sha256(f"{wid}:{cid}:{PROFILE['modelId']}".encode()).hexdigest()[:24]
        assert keys == [expected(first['id']), expected(first['id']), expected(other['id'])]
        summary = service.conversation_summary(first['id'], 0)
        assert summary['prefixMatchRatio'] == 1 and summary['averagePrefixMatchRatio'] == 1
        assert summary['cacheHitRate'] is None
    finally:
        service.close()


def test_denied_model_attempts_do_not_skew_latest_or_mean_prefix():
    events = [
        {'kind': 'model_request', 'parentId': 'turn-a', 'payload': {'round': 1, 'prefixMatchRatio': .99}},
        {'kind': 'model_request', 'parentId': 'turn-b', 'payload': {'round': 1, 'prefixMatchRatio': .01}},
        {'kind': 'model_not_dispatched', 'parentId': 'turn-b', 'payload': {'round': 1}},
    ]
    for info in (summarize(events), current_context(events, PROFILE)):
        assert info['prefixMatchRatio'] == .99 and info['averagePrefixMatchRatio'] == .99
        assert info['cacheHitRate'] is None


def test_prefix_probe_classifies_boundaries_and_evicts_old_conversations():
    probe = PrefixProbe(capacity=1)
    initial = RequestPrefix.from_request(PROFILE, CACHE_TOOLS, STABLE_MESSAGES)
    probe.remember('old', initial)
    for provider, tools, messages, compacted, reason in (
        ({**PROFILE, 'configSha256': 'b' * 64}, CACHE_TOOLS, STABLE_MESSAGES, False, 'PROFILE_CHANGED'),
        (PROFILE, CACHE_TOOLS[1:], STABLE_MESSAGES, False, 'TOOLS_CHANGED'),
        (PROFILE, CACHE_TOOLS, [{'role': 'system', 'content': 'New instruction'}, *STABLE_MESSAGES[1:]], False, 'SYSTEM_CHANGED'),
        (PROFILE, CACHE_TOOLS, STABLE_MESSAGES[:-2], False, 'HISTORY_MUTATED'),
        (PROFILE, CACHE_TOOLS, STABLE_MESSAGES[:-2], True, 'COMPACT_EPOCH'),
    ):
        current = RequestPrefix.from_request(provider, tools, messages)
        assert probe.compare('old', current, compacted=compacted)['prefixDivergence'] == reason
    probe.remember('new', initial)
    assert probe.compare('old', initial)['prefixMatchRatio'] is None


def test_budget_wrapper_relays_only_explicit_cache_keys():
    keys = []
    def completion(_providers, _profile, _messages, _tools, _cancelled, *, cache_key=None):
        keys.append(cache_key)
        return {'role': 'assistant', 'content': 'ok', '_usage': {
            'prompt_tokens': 2, 'completion_tokens': 1, 'total_tokens': 3}}
    receipts = []
    budget = ModelBudget(completion, requests=1, tokens=100_000, cost_cny=1,
        input_per_million=1, output_per_million=1, journal=receipts.append)
    invoke_completion(budget, None, PROFILE, STABLE_MESSAGES, [], lambda: False, cache_key='axis_fixture')
    assert keys == ['axis_fixture'] and [receipt['phase'] for receipt in receipts] == ['intent', 'result']
    def legacy_signature(_providers, _profile, _messages, _tools, _cancelled, **options):
        assert options == {}
    invoke_completion(legacy_signature, None, PROFILE, STABLE_MESSAGES, [], lambda: False, cache_key='axis_fixture')


def test_epoch_snapshot_keeps_historical_image_facts_without_image_references():
    reference = {'turnId': 'turn_old', 'name': 'sketch.png', 'sha256': 'a' * 64,
        'mediaType': 'image/png', 'width': 24, 'height': 24, 'sizeBytes': 800}
    user = {'role': 'user', 'content': 'Keep this exact caption.', '_images': [reference]}
    snapshot = auto_compact_snapshot({'number': 2, 'messages': [STABLE_MESSAGES[0], user]},
        {'role': 'assistant', 'content': 'I described the image.'})
    assert snapshot['messages'][0] == {'role': 'user', 'content': user['content']}
    assert reference['sha256'] in snapshot['messages'][1]['content']
    assert '_images' not in canonical(snapshot) and snapshot['messagesSha256'] == digest(snapshot['messages'])


if __name__ == '__main__':
    with TemporaryDirectory(dir=Path.cwd() / '.local/m8.6') as directory:
        report = mixed_scenario(Path(directory))
    print(json.dumps(report, ensure_ascii=False, indent=2))

"""Deterministic regressions for public, synthetic tools and context records."""
import pytest

from web_api.agent_context import bounded_context
from web_api.agent_metrics import ModelBudget
from web_api.agent_provider import _messages
from web_api.agent_store import canonical
from web_api.agent_tools import patch_text
from web_api.schemas import ApiError


def exchange(call_id, tool, data):
    return [
        {'role': 'assistant', 'content': None, 'tool_calls': [
            {'type': 'function', 'id': call_id, 'function': {'name': tool, 'arguments': '{}'}}]},
        {'role': 'tool', 'tool_call_id': call_id, 'content': canonical({'status': 'SUCCESS', 'data': data})},
    ]


def test_duplicate_read_keeps_newest_copy_before_soft_limit():
    source = {'sourceId': 'workspace', 'path': 'cli.py', 'sha256': 'a' * 64,
              'startChar': 0, 'endChar': 2400, 'content': 'source body\n' * 200}
    history = [
        {'role': 'user', 'content': 'Preserve original tests and compatibility.'},
        *exchange('initial', 'read_file', source), *exchange('again', 'read_file', source),
    ]
    messages, checkpoint = bounded_context(history, [])
    assert checkpoint['compactedCallIds'] == ['initial']
    assert checkpoint['sentBytes'] < checkpoint['originalBytes']
    assert 'source body' not in messages[2]['content']
    assert 'source body' in messages[4]['content']
    assert messages[0] == history[0]
    assert _messages(messages) == messages
    assert 'source body' in history[2]['content']


def test_pressure_compacts_search_before_active_source():
    source = {'sourceId': 'workspace', 'path': 'cli.py', 'sha256': 'a' * 64,
              'startChar': 0, 'endChar': 8140, 'content': 'active code\n' * 678}
    history = [
        {'role': 'user', 'content': 'Add the feature. Do not touch tests.'},
        *exchange('source', 'read_file', source),
        *exchange('search', 'search', {'excerpt': 'bulk search text\n' * 2100}),
        *exchange('recent', 'inspect_changes', {'files': [{'diff': 'diff' * 1300}]}),
    ]
    messages, checkpoint = bounded_context(history, [])
    assert 'search' in checkpoint['compactedCallIds']
    assert 'source' not in checkpoint['compactedCallIds']
    assert any('active code' in m.get('content', '') for m in messages if m.get('content'))
    assert messages[0] == history[0]
    assert _messages(messages) == messages


def test_range_and_anchor_use_source_newlines():
    original = 'alpha\r\nbeta\r\nalpha\r\n'
    with pytest.raises(ApiError, match='匹配 2 处'):
        patch_text(original, {'old': 'alpha', 'new': 'one'})
    assert patch_text(original, {'startLine': 3, 'endLine': 4, 'new': 'one\n'}) == 'alpha\r\nbeta\r\none\r\n'
    assert patch_text(original, {'old': 'beta', 'new': 'two\nthree'}) == 'alpha\r\ntwo\r\nthree\r\nalpha\r\n'
    with pytest.raises(ApiError, match='以换行结束'):
        patch_text(original, {'startLine': 1, 'endLine': 2, 'new': 'one'})


def test_request_reservation_can_block_before_token_exhaustion():
    def unexpected(*args):
        pytest.fail('A rejected reservation must not dispatch')

    budget = ModelBudget(unexpected, requests=2, tokens=4000, cost_cny=20,
                         input_per_million=3, output_per_million=12, journal=list().append)
    with pytest.raises(Exception, match='authorized_acceptance_budget') as stopped:
        budget(None, {'modelId':'local-test'}, [{'role':'user', 'content':'hello'}], [], lambda:False)
    assert stopped.value.budget_decision['reason'] == 'TOKEN_RESERVATION_EXCEEDS_REMAINING'
    assert budget.requests == 0 and budget.remaining_tokens() == 4000

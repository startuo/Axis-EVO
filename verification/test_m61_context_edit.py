"""Deterministic regressions for public, synthetic tools and context records."""
import hashlib
import json
from threading import RLock
from types import SimpleNamespace

import pytest

from web_api.agent_context import bounded_context, conversation_history
from web_api.agent_metrics import ModelBudget
from web_api.agent_provider import _messages
from web_api.agent_service import AgentService
from web_api.agent_store import AgentStore, canonical
from web_api.agent_tools import AgentTools, patch_text
from web_api.agent_workspace import AgentWorkspaces, WorkspacePathResolver
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


def test_newest_execution_keeps_verdict_and_diagnostics_without_flooding_context():
    raw = '\x1b[31mFAILED one.py::test_first\x1b[0m\n' + ('  ' + 'raw-test-line\n') * 2000 + 'E   ValueError: expected integer\n'
    report = {'validationStatus':'FAILED', 'status':'SUCCESS', 'checks':[
        {'name':'legacy', 'passed':False, 'result':{'exitCode':1, 'status':'SUCCESS', 'stdout':raw}}]}
    history = [{'role':'user', 'content':'Use fixed validations.'}, *exchange('fixed','run_checks',report)]
    messages, checkpoint = bounded_context(history, [])
    output = json.loads(messages[-1]['content'])['data']
    observed = output['checks'][0]['result']
    assert output['validationStatus'] == 'FAILED' and not output['checks'][0]['passed']
    assert observed['exitCode'] == 1 and 'FAILED one.py::test_first' in observed['stdout']
    assert 'ValueError: expected integer' in observed['stdout']
    assert observed['modelOutputProjection']['originalSha256'] == hashlib.sha256(raw.encode()).hexdigest()
    assert len(observed['stdout'].encode('utf-8')) < 4900
    assert checkpoint['sentBytes'] < 6500 and messages[0] == history[0]
    assert json.loads(history[-1]['content'])['data']['checks'][0]['result']['stdout'] == raw
    assert bounded_context(messages, [])[0] == messages


def test_new_read_does_not_erase_latest_fixed_check_failure():
    check = {'name':'acceptance', 'passed':False,
             'result':{'exitCode':1, 'stdout':'raw trace detail\n' * 200 + 'FAILED verify_insertion_order\n'}}
    report = {'validationStatus':'FAILED', 'checks':[check], 'snapshotSha256':'c' * 64}
    original = [{'role':'user', 'content':'Run fixed checks after changing source.'},
                *exchange('old-listing','list_files',{'files':[{'path':f'tests/file{i}.py','sha256':'b'*64} for i in range(500)]}),
                *exchange('fixed','run_checks',report),
                *exchange('source','read_file',{'sourceId':'workspace','path':'writer.py','content':'code\n'*300,
                                               'sha256':'a'*64,'startChar':0,'endChar':1500})]
    messages, checkpoint = bounded_context(original, [])
    assert checkpoint['sentBytes'] < 10000 and messages[0] == original[0]
    check_message = next(m for m in messages if m.get('tool_call_id') == 'fixed')
    current = json.loads(check_message['content'])['data']
    assert current['snapshotSha256'] == 'c' * 64
    assert current['validationStatus'] == 'FAILED' and not current['checks'][0]['passed']
    assert 'FAILED verify_insertion_order' in current['checks'][0]['result']['stdout']
    assert _messages(messages) == messages


def test_local_compaction_keeps_newest_read_and_fixed_check_under_pressure():
    def source(name):
        text = ('distinct implementation '+name+'\n') * 340
        return {'path':name, 'content':text, 'sourceId':'workspace', 'sha256':'a'*64,
                'startChar':0, 'endChar':len(text)}

    original = [{'role':'user', 'content':'Ship only if the fixed tests pass.'},
                *exchange('one','read_file',source('one.py')),
                *exchange('two','read_file',source('two.py')),
                *exchange('three','read_file',source('three.py')),
                *exchange('four','read_file',source('four.py')),
                *exchange('verify','run_checks',{'validationStatus':'FAILED','checks':[
                    {'name':'fixed','passed':False,'result':{'exitCode':1,'stdout':'FAILED test_case'}}]})]
    messages, checkpoint = bounded_context(original, [], local_gateway=True)
    assert checkpoint['sentBytes'] <= 36 * 1024
    assert checkpoint['compactedCallIds'] and 'four' not in checkpoint['compactedCallIds']
    assert 'FAILED test_case' in messages[-1]['content']
    assert 'distinct implementation four.py' in next(m for m in messages if m.get('tool_call_id')=='four')['content']
    assert messages[0] == original[0] and _messages(messages) == messages


def test_read_window_reports_partial_coverage_and_can_be_extended_explicitly(tmp_path, monkeypatch):
    project = tmp_path/'project'
    project.mkdir()
    source = '公开材料\n'*4000
    (project/'source.txt').write_bytes(source.encode())
    providers = SimpleNamespace(check_text=lambda text: None)
    workspaces = AgentWorkspaces(AgentStore(tmp_path/'state'), providers)
    # The test runner may use an OS-owned temporary directory. Inject the
    # resolved synthetic project; exercise the actual read and range checks.
    monkeypatch.setattr(workspaces, 'resolver', lambda workspace, source_id: WorkspacePathResolver(project))
    service = SimpleNamespace(workspaces=workspaces, runtime=SimpleNamespace(providers=providers))
    turn = {'workspaceId':'fixture'}
    tools = AgentTools(service)
    first = tools.execute(turn, 'first', 'read_file', {'path':'source.txt'})
    more = tools.execute(turn, 'more', 'read_file', {'path':'source.txt', 'startChar':first['nextStartChar'],
        'expectedSha256':first['sha256'], 'maxChars':24000})
    full = tools.execute(turn, 'full', 'read_file', {'path':'source.txt', 'maxChars':24000})
    assert first['coverage']=='PARTIAL' and first['nextStartChar']==8000
    assert first['content'] + more['content'] == source
    assert more['sha256']==full['sha256']==first['sha256']
    assert full['coverage']=='FULL' and full['content']==source


def test_linked_turn_carries_only_confirmed_parent_check_as_historical(tmp_path):
    store = AgentStore(tmp_path)
    store.prepare()
    workspace, cid = 'workspace_fixture', 'conversation_fixture'
    parent = store.append('turn', {'prompt':'Implement the feature and preserve test inputs.'}, workspace, cid)
    other = store.append('turn', {'prompt':'Run a separate check.'}, workspace, cid)

    def record(turn, *, status, verdict, output):
        return store.append('tool_result', {'status':status,'data':{'validationStatus':verdict,
            'snapshotSha256':'s'*64,'policySha256':'p'*64,'checks':[
                {'name':'acceptance','passed':False,'receiptId':'test_receipt',
                 'result':{'exitCode':1,'stdout':output}}]}}, workspace, turn['id'])

    evidence = record(parent,status='SUCCESS',verdict='FAILED',
                      output='large output\n'*1000+'FAILED fixed_case')
    record(parent,status='UNKNOWN',verdict='FAILED',output='unconfirmed outcome')
    record(other,status='SUCCESS',verdict='FAILED',output='other turn output')
    service = SimpleNamespace(store=store)
    assert len(conversation_history(service,cid)) == 2
    messages = conversation_history(service,cid,continued=parent['id'])
    assert 'preserve test inputs' in messages[0]['content']
    label, payload = messages[-1]['content'].split('\n',1)
    assert 'Historical' in label and 'rerun' in label
    observed = json.loads(payload)
    assert observed['turnId']==parent['id'] and observed['toolResultId']==evidence['id']
    assert observed['validationStatus']=='FAILED' and observed['snapshotSha256']=='s'*64
    assert observed['checks'][0]['result']['exitCode']==1 and 'FAILED fixed_case' in payload
    assert len(payload)<6300 and 'other turn output' not in payload and 'unconfirmed outcome' not in payload


def test_patch_selector_rejection_explains_recovery_before_write_admission():
    service = object.__new__(AgentService)
    service._lock = RLock()
    service._cancelled = lambda turn: False
    events = []
    service.store = SimpleNamespace(append=lambda *args: events.append(args))
    service.workspaces = SimpleNamespace(get=lambda wid: {'revision':1})
    service.tools = AgentTools(service)
    result = service._call({'workspaceId':'work', 'id':'turn', 'payload':{'workspaceRevision':1}},
                           'patch','patch_file',{'path':'writer.py','old':'a','new':'b',
                                                 'expectedSha256':'a'*64,'startLine':1,'endLine':2})
    assert result['status'] == 'REJECTED' and result['code'] == 'AGENT_TOOL_ARGUMENTS'
    assert '互斥' in result['hint'] and 'startLine 和 endLine' in result['hint']
    assert len(events) == 1 and events[0][0] == 'tool_result'
    assert events[0][1]['intentId'] is None and events[0][1]['executionId'] is None


def test_large_project_overview_keeps_paths_and_discloses_omissions():
    project_paths = ['pyproject.toml', 'src/writer.py']
    tests = [f'tests/fixtures/case_{n}/scenario_expected_output.toml' for n in range(200)]
    report = {'totalFiles':202, 'truncated':False,
              'files':[{'path':path, 'sha256':'b' * 64, 'sizeBytes':54} for path in tests + project_paths],
              'projectFiles':project_paths[:1], 'testFiles':tests, 'nextStep':'Read the files.'}
    history = [{'role':'user', 'content':'Follow the fixed test policy.'}, *exchange('project','project_overview',report)]
    messages, checkpoint = bounded_context(history, [])
    output = json.loads(messages[-1]['content'])['data']
    assert checkpoint['sentBytes'] < 5200
    assert output['totalFiles'] == 202 and output['projectFiles'] == project_paths[:1]
    assert {item['path'] for item in output['files']} >= set(project_paths)
    assert output['modelOverviewProjection']['originalListedFiles'] == 202
    assert 'read_file' in output['modelOverviewProjection']['nextStep']
    assert json.loads(history[-1]['content'])['data'] == report
    assert _messages(messages) == messages


def test_request_reservation_can_block_before_token_exhaustion():
    def unexpected(*args):
        pytest.fail('A rejected reservation must not dispatch')

    budget = ModelBudget(unexpected, requests=2, tokens=4000, cost_cny=20,
                         input_per_million=3, output_per_million=12, journal=list().append)
    with pytest.raises(Exception, match='authorized_acceptance_budget') as stopped:
        budget(None, {'modelId':'local-test'}, [{'role':'user', 'content':'hello'}], [], lambda:False)
    assert stopped.value.budget_decision['reason'] == 'TOKEN_RESERVATION_EXCEEDS_REMAINING'
    assert budget.requests == 0 and budget.remaining_tokens() == 4000

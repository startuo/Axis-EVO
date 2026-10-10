"""Controlled planning trials and a pure file simulator; no execution authority."""

import base64
import binascii
from dataclasses import asdict
import re
from time import monotonic
from uuid import uuid4

from .events import utc_now
from .hashing import canonical_json_bytes
from .planning_adapter import PlanningResponse, PlanningTransportError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, _strict_json, _text
from .skill_card import SkillRef
from .skill_manager import SkillManager
from .skill_planner import _build_request, _tool_schema, _static_path, _validated_plan
from .skill_storage import _check_write_context, _skill_transaction
from .skill_binding import _read_snapshot, _rows, _ref
from .task_spec import task_spec_from_dict
from .validators import preflight_acceptance
from .skill_trust_storage import POLICY_VERSION, TrustIntegrityError, _guard_schema, _insert, _load, digest, snapshot


MAX_FILES = 64
MAX_FILE_BYTES = 64 * 1024
MAX_STATE_BYTES = 256 * 1024
MAX_CASES = 32
FILE_TOOLS = ('read_file', 'write_file', 'patch_file')
LIMITATIONS = [
    'Simulated file outcomes are not real Tool execution.',
    'Configured adapter identity does not authenticate a remote provider.',
    'A static response demonstrates a constructed result, not Skill causality.',
    'Comparative regression is not proof of a causal Skill defect.',
]


class SimulationUnsupported(ValueError):
    """The bounded portable simulator cannot establish exact semantics."""


def _keys(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise TrustIntegrityError('Unexpected evaluation protocol fields')


def _path(value):
    _static_path(value)
    if any(c in '<>"|?*' or ord(c) < 32 for c in value):
        raise SimulationUnsupported('Nonportable filename character')
    parts = value.replace('\\', '/').split('/')
    if any(not p or p == '.' or p.rstrip(' .') != p for p in parts):
        raise SimulationUnsupported('Nonportable path alias')
    return '/'.join(parts)


def _decode_files(value):
    if type(value) is not dict or len(value) > MAX_FILES:
        raise SimulationUnsupported('File count limit')
    result = {}
    for name, encoded in value.items():
        if type(encoded) is not str or _path(name) != name:
            raise SimulationUnsupported('Seed paths must be canonical portable paths')
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise TrustIntegrityError('Invalid benchmark base64') from None
        if base64.b64encode(data).decode('ascii') != encoded:
            raise TrustIntegrityError('Noncanonical benchmark base64')
        if len(data) > MAX_FILE_BYTES:
            raise SimulationUnsupported('Per-file byte limit')
        result[name] = data
    _state_limits(result)
    return result


def _encoded(files):
    return {p: base64.b64encode(b).decode('ascii') for p, b in sorted(files.items())}


def _state_limits(files):
    if len(files) > MAX_FILES or sum(map(len, files.values())) > MAX_STATE_BYTES or any(len(b) > MAX_FILE_BYTES for b in files.values()):
        raise SimulationUnsupported('Simulated state byte/count limit')
    aliases = set()
    directories = {parent for p in files for parent in _parents(p)}
    if len({p.casefold() for p in directories}) != len(directories):
        raise SimulationUnsupported('Case-insensitive directory alias')
    for p in files:
        if p.casefold() in aliases:
            raise SimulationUnsupported('Case-insensitive file alias')
        aliases.add(p.casefold())
        if any(parent.casefold() in {n.casefold() for n in files} for parent in _parents(p)):
            raise SimulationUnsupported('File/directory alias')


def _parents(path):
    parts = path.split('/')
    return ['/'.join(parts[:i]) for i in range(1, len(parts))]


def _observation(files, path):
    from .checkpoint_manager import _sha
    data = files.get(path)
    return {'path': path, 'exists': data is not None, 'sha256': _sha(data) if data is not None else None,
            'size_bytes': len(data) if data is not None else None}


def simulate_file_plan(initial_files, steps):
    """Pure bounded simulation from canonical base64 files and strict Plan steps.

    Missing files/parents and UTF-8 failures stop the plan, like reported Tool
    failures. Portable path aliases or resource limits yield UNSUPPORTED.
    """
    files = _decode_files(snapshot(initial_files))
    dirs = {''} | {p for name in files for p in _parents(name)}
    facts = []
    for step in steps:
        if type(step) is not dict:
            step = asdict(step)
        _keys(step, ('step_id', 'tool_name', 'arguments'))
        name, args = step['tool_name'], step['arguments']
        if name not in FILE_TOOLS:
            raise SimulationUnsupported('Unsupported simulator tool')
        from .skill_planner import _arguments
        _arguments(name, args)
        path = _path(args['path'])
        # Case aliases cannot be represented faithfully on all supported hosts.
        if any(p.casefold() == path.casefold() and p != path for p in files.keys() | dirs):
            raise SimulationUnsupported('Case-insensitive target alias')
        if any(parent.casefold() == directory.casefold() and parent != directory
               for parent in _parents(path) for directory in dirs):
            raise SimulationUnsupported('Case-insensitive parent alias')
        before = _observation(files, path) if name != 'read_file' else None
        status, message = 'SUCCESS', None
        try:
            if '/'.join(path.split('/')[:-1]) not in dirs or path in dirs:
                raise FileNotFoundError
            if name == 'write_file':
                files[path] = args['content'].encode('utf-8')
            else:
                text = files[path].decode('utf-8', errors='strict')
                if name == 'patch_file':
                    if len(re.findall('(?=' + re.escape(args['old']) + ')', text)) != 1:
                        raise ValueError('Patch match count must be exactly one')
                    files[path] = text.replace(args['old'], args['new'], 1).encode('utf-8')
            _state_limits(files)
        except (KeyError, FileNotFoundError, UnicodeError, ValueError) as error:
            if isinstance(error, SimulationUnsupported):
                raise
            status, message = 'FAILED', 'Missing file/parent, invalid UTF-8 or patch match count'
        facts.append({'step_id': step['step_id'], 'tool_name': name, 'status': status, 'message': message,
                      'pre': before, 'post': _observation(files, path) if before is not None else None})
        if status != 'SUCCESS':
            break
    return {'final_files': _encoded(files), 'steps': facts,
            'status': 'SUCCESS' if all(f['status'] == 'SUCCESS' for f in facts) else 'FAILED'}


def evaluate_oracle(initial_files, final_files, oracle):
    """Data-only exact-byte Oracle; no code or model-authored predicates."""
    _keys(oracle, ('expected_files', 'forbid_extra_files', 'preserve_unmentioned'))
    if type(oracle['forbid_extra_files']) is not bool or type(oracle['preserve_unmentioned']) is not bool:
        raise TrustIntegrityError('Oracle flags must be exact bool')
    expected, initial, final = map(_decode_files, (oracle['expected_files'], initial_files, final_files))
    checks = [{'path': p, 'kind': 'EXACT_BYTES', 'passed': final.get(p) == b} for p, b in sorted(expected.items())]
    if oracle['forbid_extra_files']:
        checks.append({'path': None, 'kind': 'NO_EXTRA_FILES', 'passed': set(final) <= set(initial) | set(expected)})
    if oracle['preserve_unmentioned']:
        checks.extend({'path': p, 'kind': 'UNCHANGED', 'passed': final.get(p) == b}
                      for p, b in sorted(initial.items()) if p not in expected)
    if not expected:
        raise TrustIntegrityError('Oracle requires at least one independently expected file')
    return {'passed': all(c['passed'] for c in checks), 'checks': checks}


def _public_acceptance(case, final_files):
    acceptance = case['task_spec']['acceptance']
    if acceptance['pytest']['enabled']:
        raise SimulationUnsupported('Public pytest acceptance requires real execution')
    files = _decode_files(final_files)
    dirs = {''} | {p for name in case['initial_files'] for p in _parents(name)}
    details = []
    for assertion in acceptance['file_assertions']:
        path = _path(assertion['path'])
        if any(p.casefold() == path.casefold() and p != path for p in files.keys() | dirs):
            raise SimulationUnsupported('Acceptance path alias')
        parent_exists = '/'.join(path.split('/')[:-1]) in dirs and path not in dirs
        data, op = files.get(path), assertion['operator']
        passed = False
        if parent_exists:
            if op == 'exists':
                passed = data is not None
            elif op == 'not_exists':
                passed = data is None
            elif data is not None:
                try:
                    text = data.decode('utf-8', errors='strict')
                    passed = assertion['expected'] in text if op == 'contains' else assertion['expected'] == text
                except UnicodeError:
                    pass
        details.append({'path': path, 'operator': op, 'passed': passed})
    return {'passed': bool(details) and all(d['passed'] for d in details), 'file_assertions': details}


def _case_value(suite_id, definition):
    _keys(definition, ('case_id', 'case_version', 'task_spec', 'initial_files', 'oracle'))
    _text(definition['case_id'])
    if type(definition['case_version']) is not int or definition['case_version'] < 1:
        raise TrustIntegrityError('Invalid case version')
    task = task_spec_from_dict(definition['task_spec'])
    preflight_acceptance(task)
    for assertion in task.acceptance['file_assertions']:
        _path(assertion['path'])
    _decode_files(definition['initial_files'])
    evaluate_oracle(definition['initial_files'], definition['initial_files'], definition['oracle'])
    value = {'schema_version': 1, 'suite_id': suite_id, **definition,
             'case_key': digest([suite_id, definition['case_id']]), 'evaluation_policy_version': POLICY_VERSION}
    for field, source in (('task_spec_sha256', definition['task_spec']), ('initial_seed_manifest_sha256', definition['initial_files']),
                          ('public_acceptance_sha256', definition['task_spec']['acceptance']), ('hidden_oracle_sha256', definition['oracle']),
                          ('allowed_tool_catalog_sha256', {n: _tool_schema(n) for n in FILE_TOOLS})):
        value[field] = digest(source)
    return value


def _suite(connection, suite_id):
    fact = _load(connection, 'shadow_suites', suite_id)
    data = fact.data
    _keys(data, ('schema_version', 'suite_id', 'suite_version', 'cases', 'created_at', 'evaluation_policy_version'))
    if type(data['suite_version']) is not int or data['suite_version'] < 1 or data['evaluation_policy_version'] != POLICY_VERSION:
        raise TrustIntegrityError('Invalid suite version/policy')
    actual = []
    for row in _rows(connection, 'SELECT case_key FROM main.shadow_cases WHERE suite_id=? ORDER BY case_id', (suite_id,)):
        case = _load(connection, 'shadow_cases', row[0])
        c = case.data
        definition = {k: c[k] for k in ('case_id', 'case_version', 'task_spec', 'initial_files', 'oracle')}
        if _case_value(suite_id, definition) != c:
            raise TrustIntegrityError('Case identities or Oracle digest mismatch')
        actual.append({'case_id': c['case_id'], 'case_key': c['case_key'], 'case_sha256': case.fact_sha256})
    if not 1 <= len(actual) <= MAX_CASES or actual != data['cases']:
        raise TrustIntegrityError('Closed suite case manifest mismatch')
    return fact


def _case(connection, suite_id, case_id):
    _suite(connection, suite_id)
    return _load(connection, 'shadow_cases', digest([suite_id, case_id]))


def create_shadow_suite(connection, suite_definition):
    definition = snapshot(suite_definition)
    _keys(definition, ('suite_id', 'suite_version', 'cases'))
    _text(definition['suite_id'])
    if type(definition['suite_version']) is not int or definition['suite_version'] < 1:
        raise ValueError('Invalid suite version')
    if type(definition['cases']) is not list or not 1 <= len(definition['cases']) <= MAX_CASES:
        raise ValueError('Invalid suite case count')
    cases = sorted((_case_value(definition['suite_id'], d) for d in definition['cases']), key=lambda c: c['case_id'])
    if len({c['case_id'] for c in cases}) != len(cases):
        raise ValueError('Duplicate case identity')
    value = {'schema_version': 1, 'suite_id': definition['suite_id'], 'suite_version': definition['suite_version'],
             'cases': [{'case_id': c['case_id'], 'case_key': c['case_key'], 'case_sha256': digest(c)} for c in cases],
             'evaluation_policy_version': POLICY_VERSION, 'created_at': utc_now()}
    with _skill_transaction(connection):
        _guard_schema(connection)
        fact = _insert(connection, 'shadow_suites', value)
        for c in cases:
            _insert(connection, 'shadow_cases', c)
        _suite(connection, value['suite_id'])
    return fact


def _skill_anchor(connection, ref):
    ref = _ref(ref)
    manager, result = SkillManager(connection), []
    card = manager.get_version(ref.skill_id, ref.skill_version)
    cursor = card
    while cursor is not None:
        row = dict(_rows(connection, 'SELECT * FROM main.skill_versions WHERE skill_id=? AND skill_version=?',
                         (cursor.skill_id, cursor.skill_version))[0])
        history = [dict(r) for r in _rows(connection, 'SELECT * FROM main.skill_state_events WHERE skill_id=? AND skill_version=? ORDER BY transition_seq',
                                         (cursor.skill_id, cursor.skill_version))]
        result.append({'card': row, 'history': history})
        parent = cursor.source.ref
        cursor = manager.get_version(parent.skill_id, parent.skill_version) if parent else None
    return card, result


def _verify_anchor(connection, anchor):
    if type(anchor) is not list or not anchor:
        raise TrustIntegrityError('Missing exact Skill anchor')
    row = anchor[0]['card']
    card, current = _skill_anchor(connection, SkillRef(row['skill_id'], row['skill_version']))
    if len(current) != len(anchor) or any(a['card'] != b['card'] or not a['history'] or b['history'][:len(a['history'])] != a['history']
                                         for a, b in zip(anchor, current)):
        raise TrustIntegrityError('Skill Card or lifecycle prefix changed')
    return card


def _request(case, card, adapter_name, model_id, parameters):
    catalog = {n: _tool_schema(n) for n in FILE_TOOLS if n in card.allowed_tools}
    if not catalog:
        raise SimulationUnsupported('No supported file tool authorized')
    data = _strict_json(_build_request(task_spec_from_dict(case['task_spec']), card, catalog, adapter_name, model_id), MAX_REQUEST_BYTES)
    data['core_policy'] += ' This request is only for bounded in-memory shadow evaluation; it grants no production execution authority.'
    data['public_seed_files_base64'] = case['initial_files']
    data['planning_parameters'] = parameters
    data['evaluation_policy_version'] = POLICY_VERSION
    text = canonical_json_bytes(data).decode('utf-8')
    if len(text.encode('utf-8')) > MAX_REQUEST_BYTES:
        raise ValueError('Shadow planning request exceeds limit')
    return text


def _intent(connection, trial_id):
    fact = _load(connection, 'shadow_trial_intents', trial_id)
    d = fact.data
    _keys(d, ('schema_version', 'trial_id', 'case_key', 'suite_id', 'case_id', 'case_sha256', 'skill_id', 'skill_version',
              'skill_anchor', 'card_sha256', 'adapter_name', 'model_id', 'planning_parameters', 'request_json', 'request_sha256',
              'reserved_at', 'evaluation_policy_version'))
    case = _case(connection, d['suite_id'], d['case_id'])
    card = _verify_anchor(connection, d['skill_anchor'])
    _text(d['adapter_name']); _text(d['model_id'])
    if (card.ref.to_dict() != {k: d[k] for k in ('skill_id', 'skill_version')}
            or digest(card.to_dict()) != d['card_sha256'] or case.fact_sha256 != d['case_sha256']
            or case.data['case_key'] != d['case_key'] or d['evaluation_policy_version'] != POLICY_VERSION
            or d['skill_anchor'][0]['history'][-1]['state'] not in ('SHADOW', 'TRUSTED')
            or _request(case.data, card, d['adapter_name'], d['model_id'], d['planning_parameters']) != d['request_json']
            or digest(_strict_json(d['request_json'], MAX_REQUEST_BYTES)) != d['request_sha256']):
        raise TrustIntegrityError('Trial Intent does not match pinned case/Skill/request')
    return fact


def reserve_shadow_trial(connection, suite_id, case_id, skill_ref, adapter_name, model_id, *, planning_parameters=None, trial_id=None):
    """Commit a fresh Intent only; this does not invoke a model or resume an ID."""
    _check_write_context(connection)
    _text(adapter_name); _text(model_id)
    parameters = snapshot({} if planning_parameters is None else planning_parameters)
    if type(parameters) is not dict or len(canonical_json_bytes(parameters)) > 4096:
        raise ValueError('Planning parameters require a bounded JSON object')
    trial_id = 'trial_' + uuid4().hex if trial_id is None else trial_id
    _text(trial_id)
    with _skill_transaction(connection):
        _guard_schema(connection)
        case = _case(connection, suite_id, case_id)
        card, anchor = _skill_anchor(connection, skill_ref)
        if anchor[0]['history'][-1]['state'] not in ('SHADOW', 'TRUSTED'):
            raise ValueError('Trial requires exact SHADOW or TRUSTED Skill')
        request = _request(case.data, card, adapter_name, model_id, parameters)
        value = {'schema_version': 1, 'trial_id': trial_id, 'suite_id': suite_id, 'case_id': case_id,
                 'case_key': case.data['case_key'], 'case_sha256': case.fact_sha256,
                 **card.ref.to_dict(), 'skill_anchor': anchor, 'card_sha256': digest(card.to_dict()),
                 'adapter_name': adapter_name, 'model_id': model_id, 'planning_parameters': parameters,
                 'request_json': request, 'request_sha256': digest(_strict_json(request, MAX_REQUEST_BYTES)),
                 'reserved_at': utc_now(), 'evaluation_policy_version': POLICY_VERSION}
        fact = _insert(connection, 'shadow_trial_intents', value)
        _intent(connection, trial_id)
    return fact


TRANSPORT_CATEGORIES = ('timeout', 'connection', 'http', 'response_too_large', 'invalid_response', 'invalid_utf8', 'missing_content',
                        'credentials', 'transport_json', 'assistant_content')


def _evaluate(intent, case, response, transport_category, invalid_response):
    value = {'outcome': None, 'plan_valid': False, 'plan_json': None, 'plan_sha256': None,
             'simulation': None, 'oracle': None, 'public_acceptance': None,
             'failure_kind': None, 'attribution': 'INDETERMINATE'}
    if transport_category is not None:
        if transport_category not in TRANSPORT_CATEGORIES or response is not None or invalid_response is not None:
            raise TrustIntegrityError('Unsupported transport classification')
        value['outcome'] = 'PLANNING_TRANSPORT_FAILURE'
        value['failure_kind'] = transport_category
        return value
    if invalid_response is not None:
        if invalid_response not in ('ADAPTER_IDENTITY_FAILURE', 'INVALID_RESPONSE_TEXT') or response is not None:
            raise TrustIntegrityError('Invalid adapter failure evidence')
        value['outcome'] = 'PLANNING_INVALID'
        value['failure_kind'] = invalid_response
        return value
    _keys(response, ('response_text', 'adapter_name', 'model_id'))
    if response['adapter_name'] != intent['adapter_name'] or response['model_id'] != intent['model_id']:
        raise TrustIntegrityError('Response identity changed')
    catalog = _strict_json(intent['request_json'], MAX_REQUEST_BYTES)['tool_catalog']
    try:
        parsed = _strict_json(response['response_text'], MAX_RESPONSE_BYTES)
    except ValueError:
        value.update(outcome='PLANNING_INVALID', failure_kind='MALFORMED_JSON')
        return value
    try:
        plan_json, steps = _validated_plan(response['response_text'], catalog, registry=None)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        value['outcome'] = 'PLANNING_INVALID'
        steps = parsed.get('steps', []) if type(parsed) is dict else []
        unauthorized = type(steps) is list and any(type(s) is dict and type(s.get('tool_name')) is str and s['tool_name'] not in catalog for s in steps)
        value['failure_kind'] = 'UNAUTHORIZED_TOOL' if unauthorized else 'INVALID_PLAN_SCHEMA_OR_ARGUMENTS'
        return value
    value.update(plan_valid=True, plan_json=plan_json, plan_sha256=digest(_strict_json(plan_json, MAX_RESPONSE_BYTES)))
    try:
        simulation = simulate_file_plan(case['initial_files'], steps)
        oracle = evaluate_oracle(case['initial_files'], simulation['final_files'], case['oracle'])
        public_acceptance = _public_acceptance(case, simulation['final_files'])
    except SimulationUnsupported:
        value.update(outcome='UNSUPPORTED', attribution='EVALUATION_UNSUPPORTED')
        return value
    passed = oracle['passed'] and public_acceptance['passed'] and simulation['status'] == 'SUCCESS'
    value.update(simulation=simulation, oracle=oracle, public_acceptance=public_acceptance,
                 outcome='SIMULATED_PASS' if passed else 'SIMULATED_FAILURE',
                 attribution='NO_NEGATIVE_EVIDENCE' if passed else 'INDETERMINATE',
                 failure_kind=None if passed else 'SIMULATED_TOOL_FAILURE' if simulation['status'] != 'SUCCESS' else
                 'PUBLIC_ACCEPTANCE_FAILURE' if not public_acceptance['passed'] else 'ORACLE_FAILURE')
    return value


def _result(connection, trial_id, intent=None):
    intent = _intent(connection, trial_id) if intent is None else intent
    fact = _load(connection, 'shadow_trial_results', trial_id)
    d, i = fact.data, intent.data
    _keys(d, ('schema_version', 'trial_id', 'result_id', 'intent_sha256', 'response', 'response_sha256',
              'transport_category', 'invalid_response', 'evaluation', 'latency_ms', 'recorded_at', 'token_usage'))
    response = d['response']
    from .checkpoint_manager import _sha
    if (d['intent_sha256'] != intent.fact_sha256 or type(d['latency_ms']) is not int or d['latency_ms'] < 0 or d['token_usage'] is not None
            or d['response_sha256'] != (_sha(response['response_text'].encode('utf-8')) if response is not None else None)
            or _evaluate(i, _case(connection, i['suite_id'], i['case_id']).data, response, d['transport_category'], d['invalid_response']) != d['evaluation']):
        raise TrustIntegrityError('Trial Result semantic evidence mismatch')
    return fact


def record_shadow_trial_result(connection, trial_id, response=None, *, transport_category=None, latency_ms=0):
    """Core derives results; caller cannot submit pass/Oracle/final-state claims."""
    _check_write_context(connection)
    if type(latency_ms) is not int or latency_ms < 0:
        raise ValueError('latency_ms must be a nonnegative exact int')
    invalid, response_data = None, None
    if transport_category is None:
        if type(response) is not PlanningResponse:
            invalid = 'ADAPTER_IDENTITY_FAILURE'
        else:
            try:
                _text(response.adapter_name); _text(response.model_id)
                if type(response.response_text) is not str or len(response.response_text.encode('utf-8')) > MAX_RESPONSE_BYTES:
                    raise ValueError
                response_data = asdict(response)
            except (ValueError, TypeError, UnicodeError):
                invalid = 'INVALID_RESPONSE_TEXT'
    elif response is not None:
        raise ValueError('Transport failure cannot contain a response')
    with _skill_transaction(connection):
        _guard_schema(connection)
        intent = _intent(connection, trial_id)
        i = intent.data
        if response_data is not None and (response_data['adapter_name'] != i['adapter_name'] or response_data['model_id'] != i['model_id']):
            response_data, invalid = None, 'ADAPTER_IDENTITY_FAILURE'
        evaluation = _evaluate(i, _case(connection, i['suite_id'], i['case_id']).data, response_data, transport_category, invalid)
        from .checkpoint_manager import _sha
        value = {'schema_version': 1, 'trial_id': trial_id, 'result_id': 'result_' + uuid4().hex,
                 'intent_sha256': intent.fact_sha256, 'response': response_data,
                 'response_sha256': _sha(response_data['response_text'].encode('utf-8')) if response_data else None,
                 'transport_category': transport_category, 'invalid_response': invalid, 'evaluation': evaluation,
                 'latency_ms': latency_ms, 'recorded_at': utc_now(), 'token_usage': None}
        fact = _insert(connection, 'shadow_trial_results', value)
        _result(connection, trial_id, intent)
    return fact


def create_shadow_trial(connection, suite_id, case_id, skill_ref, model_adapter, *, planning_parameters=None):
    """One new Intent, at most one local adapter call, one independent Result."""
    adapter_name, model_id = model_adapter.adapter_name, model_adapter.model_id
    _text(adapter_name); _text(model_id)
    intent = reserve_shadow_trial(connection, suite_id, case_id, skill_ref, adapter_name, model_id, planning_parameters=planning_parameters)
    start, response, category = monotonic(), None, None
    try:
        response = model_adapter.plan(intent.data['request_json'])
    except PlanningTransportError as error:
        # Existing adapter uses fixed, nonsecret categories; never persist str(error).
        raw = error.category
        category = {'http_error': 'http', 'network': 'connection', 'oversized_response': 'response_too_large',
                    'invalid_json': 'invalid_response'}.get(raw, raw)
        if category not in TRANSPORT_CATEGORIES:
            category = 'invalid_response'
    except TimeoutError:
        category = 'timeout'
    record_shadow_trial_result(connection, intent.data['trial_id'], response, transport_category=category,
                               latency_ms=int((monotonic() - start) * 1000))
    from .skill_trust_storage import get_shadow_trial
    return get_shadow_trial(connection, intent.data['trial_id'])


def _trial_report(connection, trial_id):
    intent = _intent(connection, trial_id)
    rows = _rows(connection, 'SELECT 1 FROM main.shadow_trial_results WHERE trial_id=?', (trial_id,))
    result = _result(connection, trial_id, intent) if rows else None
    i, r = intent.data, result.data if result else None
    return {'schema_version': 1, 'trial_id': trial_id, 'intent_sha256': intent.fact_sha256,
            'suite_id': i['suite_id'], 'case_id': i['case_id'], 'skill_ref': {k: i[k] for k in ('skill_id', 'skill_version')},
            'card_sha256': i['card_sha256'], 'case_sha256': i['case_sha256'], 'request_sha256': i['request_sha256'],
            'result_id': r['result_id'] if r else None, 'result_sha256': result.fact_sha256 if result else None,
            'outcome': r['evaluation']['outcome'] if r else 'TRIAL_OUTCOME_UNKNOWN',
            'evaluation': r['evaluation'] if r else None, 'limitations': list(LIMITATIONS)}

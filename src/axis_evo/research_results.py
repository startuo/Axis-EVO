"""Read-only research evidence projection and public, whitelist-only exports."""
import csv
import io
import math
from pathlib import Path

from . import research_storage as journal
from .hashing import canonical_json_bytes
from .shadow_evaluation import _intent, _trial_report, _suite, _case, _case_value
from .skill_binding import _rows
from .skill_evolution_storage import _keys, digest


def _slot_evidence(connection, protocol, slot):
    sid, trial, d = slot['slot_id'], slot['trial_id'], protocol.data
    submitted = journal.load(connection, 'research_submissions', sid) if journal.present(connection, 'research_submissions', sid) else None
    observed = journal.load(connection, 'research_observations', sid) if journal.present(connection, 'research_observations', sid) else None
    exists = bool(_rows(connection, 'SELECT 1 FROM main.shadow_trial_intents WHERE trial_id=?', (trial,)))
    report = _trial_report(connection, trial) if exists else None
    if report:
        intent = _intent(connection, trial)
        i = intent.data
        if (i['suite_id'] != d['suite_definition']['suite_id'] or i['case_id'] != slot['case_id']
                or {k: i[k] for k in ('skill_id', 'skill_version')} != slot['skill_ref']
                or i['adapter_name'] != d['model_profile']['adapter_name'] or i['model_id'] != d['model_profile']['model_id']
                or i['planning_parameters'] != {'experiment_sha256': protocol.fact_sha256, 'profile': d['model_profile']}):
            raise ValueError('Research Core Intent differs from the frozen experiment slot')
    if submitted:
        s = submitted.data
        _keys(s, ('schema_version', 'slot_id', 'experiment_id', 'trial_id', 'protocol_sha256', 'intent_sha256', 'created_at'))
        if (not report or s['experiment_id'] != d['experiment_id'] or s['trial_id'] != trial
                or s['protocol_sha256'] != protocol.fact_sha256 or s['intent_sha256'] != report['intent_sha256']):
            raise ValueError('Research submission does not bind its exact Core Intent')
    elif report and report['result_sha256']:
        raise ValueError('Research Result has no prospective model submission')
    if observed:
        o = observed.data
        _keys(o, ('schema_version', 'slot_id', 'protocol_sha256', 'trial_id', 'intent_sha256', 'result_sha256', 'outcome', 'created_at'))
        if (not submitted or not report or not report['result_sha256']
                or o['protocol_sha256'] != protocol.fact_sha256 or o['trial_id'] != trial
                or any(o[k] != report[k] for k in ('intent_sha256', 'result_sha256', 'outcome'))):
            raise ValueError('Research observation differs from committed Core evidence')
    metadata = next(case for case in d['case_manifest'] if case['case_id'] == slot['case_id'])
    return {'slotId': sid, 'trialId': trial, 'caseIdSha256': digest(slot['case_id']),
        'taskFamilySha256': digest(metadata['task_family']),
        'submissionSha256': submitted.fact_sha256 if submitted else None,
        'observationSha256': observed.fact_sha256 if observed else None,
        'resultSha256': report['result_sha256'] if report else None,
        'outcome': report['outcome'] if submitted else 'NOT_SUBMITTED'}


def _wilson(passed, total):
    if not total:
        return None
    z, p = 1.959963984540054, passed / total
    center = (p + z * z / (2 * total)) / (1 + z * z / total)
    radius = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total)
    return [max(0.0, center - radius), min(1.0, center + radius)]


def _counts(selected):
    total = len(selected)
    passed = sum(s['outcome'] == 'SIMULATED_PASS' for s in selected)
    unknown = sum(s['outcome'] == 'TRIAL_OUTCOME_UNKNOWN' for s in selected)
    unsubmitted = sum(s['outcome'] == 'NOT_SUBMITTED' for s in selected)
    return {'total': total, 'passed': passed, 'recordedNonpass': total - passed - unknown - unsubmitted,
        'unknown': unknown, 'notSubmitted': unsubmitted,
        'outcomeCounts': {name: sum(s['outcome'] == name for s in selected) for name in sorted({s['outcome'] for s in selected})},
        'trialIds': [s['trialId'] for s in selected],
        'cases': [{k: row[k] for k in ('caseIdSha256', 'taskFamilySha256', 'trialId', 'outcome')} for row in selected],
        'passFractionAllDeclared': passed / total if total else None,
        'possibleFinalPassFractionBounds': [passed / total, (passed + unknown + unsubmitted) / total] if total else None,
        'descriptiveRecordedPassWilson95': _wilson(passed, total)}


def report_research_results(connection, protocol):
    d = protocol.data
    suite = _suite(connection, d['suite_definition']['suite_id'])
    expected = {c['case_id'] for c in d['suite_definition']['cases']}
    if {c['case_id'] for c in suite.data['cases']} != expected:
        raise ValueError('Research Suite census differs from the approved protocol')
    for definition in d['suite_definition']['cases']:
        if _case(connection, suite.data['suite_id'], definition['case_id']).data != _case_value(suite.data['suite_id'], definition):
            raise ValueError('Core Suite TaskSpec, seed or Oracle differs from the frozen private protocol')
    declared_trials = {s['trial_id'] for s in d['slots']}
    actual_trials = _rows(connection, 'SELECT t.trial_id FROM main.shadow_trial_intents t '
                         'JOIN main.shadow_cases c ON c.case_key=t.case_key WHERE c.suite_id=? LIMIT 65',
                         (suite.data['suite_id'],))
    if len(actual_trials) > 64 or any(row[0] not in declared_trials for row in actual_trials):
        raise ValueError('Undeclared Core Trials cannot be omitted from research evidence')
    slots = [_slot_evidence(connection, protocol, slot) for slot in d['slots']]
    known = {s['slot_id'] for s in d['slots']}
    for table in ('research_submissions', 'research_observations'):
        if any(r[0] not in known for r in _rows(connection, f'SELECT slot_id FROM main.{table}')):
            raise ValueError('An undeclared research attempt cannot be excluded from the denominator')
    seal = journal.load(connection, 'research_seals', d['experiment_id']) if journal.present(connection, 'research_seals', d['experiment_id']) else None
    if seal and (seal.data['protocol_sha256'] != protocol.fact_sha256 or seal.data['slots'] != slots):
        raise ValueError('Sealed research evidence changed, including a formerly missing result')
    conditions, selected_conditions = {}, {}
    for name, ref in d['selection']['conditions'].items():
        selected = [e for s, e in zip(d['slots'], slots) if s['skill_ref'] == ref]
        selected_conditions[name] = selected
        conditions[name] = _counts(selected)
    families = [{'taskFamilySha256': family, 'conditions': {key: _counts([row for row in rows if row['taskFamilySha256'] == family])
        for key, rows in selected_conditions.items()}} for family in sorted({row['taskFamilySha256'] for row in slots})]
    paired = {}
    baseline = {row['caseIdSha256']: row for row in selected_conditions['A']}
    for key in ('B', 'C'):
        complete = [(baseline[row['caseIdSha256']], row) for row in selected_conditions[key]
                    if row['resultSha256'] and baseline[row['caseIdSha256']]['resultSha256']]
        total, observed = len(baseline), len(complete)
        delta = sum(int(right['outcome'] == 'SIMULATED_PASS') - int(left['outcome'] == 'SIMULATED_PASS') for left, right in complete)
        missing = total - observed
        paired[key + '_minus_A'] = {'allDeclaredPairs': total, 'completePairs': observed, 'missingEvidencePairs': missing,
            'observedNetPassDifference': delta, 'conditionalCompletePairDifference': delta / observed if observed else None,
            'allDeclaredDifferenceBounds': [(delta - missing) / total, (delta + missing) / total] if total else None}
    reservations = sum(s['submissionSha256'] is not None for s in slots)
    results = sum(s['resultSha256'] is not None for s in slots)
    return {'schemaVersion': 1, 'experimentId': d['experiment_id'], 'protocolSha256': protocol.fact_sha256,
        'runKind': d['run_kind'], 'mode': 'BOUNDED_FILE_SIMULATION', 'caseRole': d['case_role'],
        'datasetManifestSha256': d['dataset_manifest_sha256'], 'suiteDefinitionSha256': d['suite_definition_sha256'],
        'sourceTreeSha256': d['source_identity']['sha256'], 'sourceCommitLabel': d['source_commit_label'],
        'sourceCommitVerification': 'CALLER_LABEL_SEPARATE_FROM_VERIFIED_SOURCE_BYTES',
        'modelProfileSha256': digest(d['model_profile']), 'selectionSha256': digest(d['selection']),
        'metricPolicy': d['metric_policy'], 'conditions': conditions, 'slots': slots,
        'taskFamilies': families, 'pairedComparisons': paired,
        'unitOfAnalysis': 'DECLARED_TASK_CASE_WITHIN_FAMILY_NOT_MODEL_CALL',
        'candidateGateAtSelection': {'eligible': d['selection']['gate_evidence']['eligible'],
            'status': d['selection']['gate_evidence']['status'], 'policyId': d['selection']['gate_evidence']['policy_id'],
            'manifestSha256': d['selection']['gate_evidence']['gate_manifest_sha256']},
        'modelDispatchReservations': reservations, 'modelResultsRecorded': results,
        'actualModelCalls': results if results == reservations else None,
        'modelCallCountBounds': [results, reservations], 'modelCallUnit': 'LOCAL_ADAPTER_ATTEMPT_NOT_PROVIDER_RECEIPT',
        'unknownAttempts': sum(s['outcome'] == 'TRIAL_OUTCOME_UNKNOWN' for s in slots),
        'reportedTokenUsage': None, 'tokenUsageStatus': 'TOKEN_USAGE_UNAVAILABLE', 'verifiedCost': None,
        'heldoutImprovement': 'NOT_MEASURED', 'sealed': seal is not None,
        'sealSha256': seal.fact_sha256 if seal else None,
        'limitations': ['Simulation is not production execution or Skill causality.',
            'Shared exact-version outcomes are reused across conditions, not independent samples.',
            'UNKNOWN and unsubmitted cases remain in all-declared denominators.',
            'Intervals are descriptive; small engineering fixtures do not establish population effects.',
            'Same-account local filesystem access does not enforce cryptographic holdout blindness.']}


def write_research_exports(report, export_directory):
    """Public projection contains only stable identifiers, digests and metrics."""
    from .sandbox import WorkspacePathResolver
    destination = Path(export_directory).absolute()
    WorkspacePathResolver._directories(destination.parent)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Research exports require a new directory; old results cannot be overwritten')
    destination.mkdir()
    paths = {key: str(destination / filename) for key, filename in (
        ('json', 'results.json'), ('csv', 'results.csv'), ('markdown', 'SUMMARY.md'))}
    Path(paths['json']).write_bytes(canonical_json_bytes(report))
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(['experiment_id', 'protocol_sha256', 'condition', 'case_sha256', 'family_sha256', 'trial_id', 'outcome'])
    for key in ('A', 'B', 'C'):
        c = report['conditions'][key]
        for row in c['cases']:
            writer.writerow([report['experimentId'], report['protocolSha256'], key,
                row['caseIdSha256'], row['taskFamilySha256'], row['trialId'], row['outcome']])
    Path(paths['csv']).write_text(stream.getvalue(), encoding='utf-8', newline='')
    text = [f"# Engineering research evidence: {report['experimentId']}", '',
            'Mode: bounded file simulation. Final holdout improvement: NOT_MEASURED.', '',
            '| Condition | Declared | Pass | Recorded nonpass | UNKNOWN | Unsubmitted |',
            '| --- | ---: | ---: | ---: | ---: | ---: |']
    for key in ('A', 'B', 'C'):
        c = report['conditions'][key]
        text.append(f"| {key} | {c['total']} | {c['passed']} | {c['recordedNonpass']} | {c['unknown']} | {c['notSubmitted']} |")
    text.extend(['', 'Token usage and verified cost: unavailable.', '', 'Protocol SHA-256: ' + report['protocolSha256'],
                 'Source tree SHA-256: ' + report['sourceTreeSha256']])
    Path(paths['markdown']).write_text('\n'.join(text) + '\n', encoding='utf-8')
    return paths

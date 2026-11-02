"""Offline calibration packets, session validation and descriptive error counts.

No human observations are created here. A trusted operator must authenticate a
roster/receipt outside this library; HUMAN_DECLARED alone never counts as human
calibration. All rates are conditional on the supplied adjudicated reference.
"""
import hashlib
import json
from .hashing import canonical_json_bytes

PROTOCOL_ID = 'minutes-review-calibration-v1'


def digest(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def text_sha(text):
    if type(text) is not str or len(text.encode('utf-8')) > 65536 or '\x00' in text:
        raise ValueError('Bounded UTF-8 text required')
    return hashlib.sha256(text.encode()).hexdigest()


def make_packet(phase, items):
    """Items are anonymous. Origin strata and intended labels stay operator-only."""
    items = json.loads(canonical_json_bytes(items))
    if phase not in ('SOURCE', 'OUTPUT') or type(items) is not list or not 1 <= len(items) <= 32:
        raise ValueError('Bounded SOURCE or OUTPUT packet required')
    seen = set()
    for item in items:
        if type(item) is not dict or set(item) != {'item_id','source_id','source_text','policy_text','output_text','criteria'}:
            raise ValueError('Unexpected packet item fields')
        for field in ('item_id','source_id'):
            if type(item[field]) is not str or not item[field] or len(item[field]) > 128:
                raise ValueError('Anonymous identifiers required')
        if item['item_id'] in seen:
            raise ValueError('Duplicate packet item')
        seen.add(item['item_id'])
        item['source_sha256'] = text_sha(item['source_text'])
        item['policy_sha256'] = text_sha(item['policy_text'])
        if phase == 'SOURCE':
            if item['output_text'] is not None:
                raise ValueError('Source-only reference review must not contain output bytes')
            item['output_sha256'] = None
        else:
            item['output_sha256'] = text_sha(item['output_text'])
        if type(item['criteria']) is not list or not 1 <= len(item['criteria']) <= 128:
            raise ValueError('Predeclared atomic reference draft required')
        criterion_ids = set()
        for criterion in item['criteria']:
            if type(criterion) is not dict or set(criterion) != {'id','dimension','critical','obligation','source_quote'}:
                raise ValueError('Unexpected reference criterion fields')
            for field in ('id','dimension','obligation','source_quote'):
                if not criterion[field] or type(criterion[field]) is not str:
                    raise ValueError('Explicit source-backed reference text required')
            if criterion['id'] in criterion_ids or type(criterion['critical']) is not bool:
                raise ValueError('Duplicate criterion or invalid criticality')
            criterion_ids.add(criterion['id'])
            if criterion['source_quote'] not in item['source_text'] and criterion['source_quote'] not in item['policy_text']:
                raise ValueError('Reference quote absent from source and policy')
        item['reference_draft_sha256'] = digest(item['criteria'])
    packet = {'schema_version':1,'protocol_id':PROTOCOL_ID,'phase':phase,'items':items,
              'reference_status':'LLM_DRAFT_REQUIRES_SOURCE_ONLY_HUMAN_CHECK',
              'human_calibration':'PENDING','network_calls':0}
    return {'packet':packet,'packet_sha256':digest(packet)}


def validate_session(packet_fact, record):
    """Validate identity, coverage, quote locations and self-recorded timer bounds."""
    packet = packet_fact['packet']
    if digest(packet) != packet_fact['packet_sha256']:
        raise ValueError('Packet identity changed')
    record = json.loads(canonical_json_bytes(record))
    fields = {'schema_version','packet_sha256','phase','item_id','reviewer_id','kind','self_confirmed_human',
              'independent_of_author','version_blind','prior_exposure','verdict','audit_status','reason',
              'findings','issues','timing'}
    if type(record) is not dict or set(record) != fields:
        raise ValueError('Unexpected session fields')
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['packet_sha256'] != packet_fact['packet_sha256'] or record['phase'] != packet['phase']
            or record['kind'] not in ('HUMAN_DECLARED','LLM','SYNTHETIC_TEST')):
        raise ValueError('Session identity or origin differs')
    if type(record['reviewer_id']) is not str or not record['reviewer_id'].strip() or len(record['reviewer_id']) > 128:
        raise ValueError('Reviewer code required')
    for field in ('self_confirmed_human','independent_of_author','version_blind'):
        if type(record[field]) is not bool:
            raise ValueError('Explicit independence declarations required')
    if record['prior_exposure'] not in ('YES','NO','UNKNOWN'):
        raise ValueError('Exposure declaration required')
    matched = [i for i in packet['items'] if i['item_id'] == record['item_id']]
    if len(matched) != 1:
        raise ValueError('Session outside the fixed packet')
    item = matched[0]
    allowed = ('CONFIRM','CHANGE','UNKNOWN') if packet['phase'] == 'SOURCE' else ('PASS','FAIL','MISSING','UNKNOWN')
    overall=('CONFIRM','CHANGE','UNKNOWN') if packet['phase']=='SOURCE' else ('PASS','FAIL','UNKNOWN')
    if record['verdict'] not in overall or not isinstance(record['reason'],str) or not record['reason'].strip():
        raise ValueError('Explicit conclusion and reason required')
    if record['audit_status'] not in (('NA',) if packet['phase']=='SOURCE' else ('CLEAR','ISSUES','UNKNOWN')):
        raise ValueError('Full-output audit required')
    findings = record['findings']
    expected = {c['id'] for c in item['criteria']}
    if type(findings) is not list or len(findings) != len(expected):
        raise ValueError('All predeclared criteria must retain their denominator')
    seen = set()
    for finding in findings:
        if type(finding) is not dict or set(finding) != {'criterion_id','verdict','quote','reason'}:
            raise ValueError('Unexpected finding fields')
        if finding['criterion_id'] not in expected or finding['criterion_id'] in seen or finding['verdict'] not in allowed:
            raise ValueError('Duplicate, missing or unplanned criterion')
        seen.add(finding['criterion_id'])
        if type(finding['reason']) is not str or not finding['reason'].strip() or type(finding['quote']) is not str:
            raise ValueError('Finding evidence and reason required')
        if packet['phase'] == 'OUTPUT':
            if finding['verdict'] in ('PASS','FAIL') and (not finding['quote'] or finding['quote'] not in item['output_text']):
                raise ValueError('Located output evidence required; location is not entailment')
            if finding['verdict'] == 'MISSING' and finding['quote']:
                raise ValueError('Omissions must not fabricate a quote')
    if type(record['issues']) is not list or len(record['issues']) > 128:
        raise ValueError('Bounded issue list required')
    for issue in record['issues']:
        if type(issue) is not dict or set(issue) != {'severity','quote','reason'} or issue['severity'] not in ('MAJOR','MINOR','UNKNOWN'):
            raise ValueError('Unexpected issue fields')
        if not isinstance(issue['reason'],str) or not issue['reason'].strip():
            raise ValueError('Issue rationale required')
        evidence = item['source_text']+'\n'+item['policy_text'] if packet['phase']=='SOURCE' else item['output_text']
        if not isinstance(issue['quote'],str) or not issue['quote'] or issue['quote'] not in evidence:
            raise ValueError('Issue quote is not in the pinned artifact')
    if packet['phase']=='OUTPUT' and (record['audit_status']=='ISSUES') != bool(record['issues']):
        raise ValueError('Audit status and issues disagree')
    timing = record['timing']
    if type(timing) is not dict or set(timing) != {'basis','wall_ms','active_ms','pause_count'}:
        raise ValueError('Separate wall and active timing required')
    if (timing['basis']!='CLIENT_MONOTONIC_SELF_RECORDED'
            or any(type(timing[k]) is not int or timing[k]<0 for k in ('wall_ms','active_ms','pause_count'))
            or not 0 < timing['active_ms'] <= timing['wall_ms']):
        raise ValueError('Invalid timer; cannot fabricate positive or negative work')
    return {'record':record,'record_sha256':digest(record)}


def error_counts(predictions, truths):
    """One artifact per key; UNKNOWN is deferral, not a correct classification."""
    if set(predictions)!=set(truths) or any(v not in ('PASS','FAIL','UNKNOWN') for v in [*predictions.values(),*truths.values()]):
        raise ValueError('A complete paired universe and three-way labels are required')
    matrix = {t:{p:0 for p in ('PASS','FAIL','UNKNOWN')} for t in ('PASS','FAIL','UNKNOWN')}
    for key in truths:matrix[truths[key]][predictions[key]]+=1
    bad=sum(matrix['FAIL'].values());good=sum(matrix['PASS'].values())
    return {'artifact_count':len(truths),'confusion_truth_rows_prediction_columns':matrix,
        'false_accept':{'count':matrix['FAIL']['PASS'],'denominator':bad,
                        'rate':matrix['FAIL']['PASS']/bad if bad else None},
        'false_reject':{'count':matrix['PASS']['FAIL'],'denominator':good,
                        'rate':matrix['PASS']['FAIL']/good if good else None},
        'prediction_unknown':sum(predictions[k]=='UNKNOWN' for k in predictions),
        'truth_unknown':sum(truths[k]=='UNKNOWN' for k in truths),
        'scope':'DESCRIPTIVE_CONDITIONAL_ON_SUPPLIED_LABELS_NOT_GENERAL_ACCURACY'}


def summarize_sessions(packet_fact, records, *, confirmed_roster=None):
    """No roster => no human time/agreement/accuracy, even for self-declared humans.

    Roster receipts are externally authenticated by the operator, not by hashes.
    Raw findings and corrections stay append-only in separate session exports.
    """
    validated=[validate_session(packet_fact,r)['record'] for r in records]
    keys=[(r['item_id'],r['reviewer_id']) for r in validated]
    if len(set(keys))!=len(keys):
        raise ValueError('Duplicate/revised sessions need explicit adjudication, not latest-wins selection')
    roster=confirmed_roster or {}
    for identity,attestation in roster.items():
        if (type(attestation) is not dict or set(attestation)!={'receipt_sha256','independence_group','role'}
                or type(attestation['receipt_sha256']) is not str or len(attestation['receipt_sha256'])!=64
                or any(c not in '0123456789abcdef' for c in attestation['receipt_sha256'])
                or attestation['role'] not in ('RATER','ADJUDICATOR') or not attestation['independence_group']):
            raise ValueError('Externally confirmed roster receipt required')
    human=[r for r in validated if r['kind']=='HUMAN_DECLARED' and r['self_confirmed_human']
           and r['independent_of_author'] and r['reviewer_id'] in roster]
    groups={r['reviewer_id']:roster[r['reviewer_id']]['independence_group'] for r in human}
    pairs=[];criterion_pairs=[]
    for item in packet_fact['packet']['items']:
        rows=[r for r in human if r['item_id']==item['item_id'] and roster[r['reviewer_id']]['role']=='RATER']
        if len(rows)==2 and groups[rows[0]['reviewer_id']]!=groups[rows[1]['reviewer_id']]:
            pairs.append({'item_id':item['item_id'],'agree':rows[0]['verdict']==rows[1]['verdict'],
                          'verdicts':[r['verdict'] for r in rows]})
            votes=[{f['criterion_id']:f['verdict'] for f in r['findings']} for r in rows]
            for criterion in item['criteria']:
                values=[v[criterion['id']] for v in votes]
                criterion_pairs.append({'item_id':item['item_id'],'criterion_id':criterion['id'],
                    'critical':criterion['critical'],'agree':values[0]==values[1],'verdicts':values})
    return {'protocol_id':PROTOCOL_ID,'packet_sha256':packet_fact['packet_sha256'],
        'declared_items':len(packet_fact['packet']['items']),'submitted_records':len(validated),
        'externally_confirmed_human_records':len(human),
        'adjudicator_records':sum(roster[r['reviewer_id']]['role']=='ADJUDICATOR' for r in human),
        'blind_unexposed_human_records':sum(r['version_blind'] and r['prior_exposure']=='NO' for r in human),
        'human_calibration':'PENDING' if not human else 'PARTIAL_RECORDED_EXTERNAL_AUTHENTICATION_ASSUMED',
        'active_minutes':[r['timing']['active_ms']/60000 for r in human] if human else None,
        'wall_minutes':[r['timing']['wall_ms']/60000 for r in human] if human else None,
        'human_sessions':[{'item_id':r['item_id'],'reviewer_id':r['reviewer_id'],
            'role':roster[r['reviewer_id']]['role'],'active_minutes':r['timing']['active_ms']/60000,
            'wall_minutes':r['timing']['wall_ms']/60000,'pause_count':r['timing']['pause_count'],
            'version_blind':r['version_blind'],'prior_exposure':r['prior_exposure']} for r in human],
        'agreement_scope':'RAW_PACKET_COUNTS_JOIN_OPERATOR_STRATA_BEFORE_NATURAL_OR_CHALLENGE_REPORTING',
        'agreement':{'paired_items':len(pairs),'agreements':sum(p['agree'] for p in pairs),
                     'disagreements':sum(not p['agree'] for p in pairs),'pairs':pairs} if pairs else None,
        'criterion_agreement':{'paired_criteria':len(criterion_pairs),
            'disagreements':sum(not p['agree'] for p in criterion_pairs),
            'critical_disagreements':sum(not p['agree'] and p['critical'] for p in criterion_pairs),
            'rows':criterion_pairs} if criterion_pairs else None,
        'false_accept':None,'false_reject':None,
        'accuracy_status':'PENDING_INDEPENDENT_ADJUDICATED_TRUTH_AND_PAIRED_PREDICTIONS',
        'timing_limit':'Client self-recorded timer, not authenticated human effort; report interruptions separately.'}

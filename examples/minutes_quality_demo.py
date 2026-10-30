"""Offline synthetic adjudication example, NOT a semantic-classifier benchmark.

The example supplies explicit LLM/test-authored semantic annotations. No model,
human, database, filesystem tool or historical Gate is invoked by this module.
"""
import hashlib
import json

from axis_evo.minutes_quality import prepare_reference, evaluate_minutes

MEETING = '''[1] 林岚：我负责核对退款清单，11月6日前完成。
[2] 培训材料需要整理，负责人和日期未定。
[3] 试点扩到三家门店只是建议，未获批准。
[4] 本周退款总额为1200元，财务尚未复核。
'''
POLICY = '[P1] 仅供内部复核的草稿，须标明“草稿，待审核”。\n'


def span(path, text, quote):
    start = text.index(quote)
    return {'path': path, 'start': start, 'end': start+len(quote), 'quote': quote}


def fixture():
    initial = {'meeting.md': MEETING.encode(), 'organization-policy.md': POLICY.encode()}
    specs = [
        ('action', 'ACTION_RECALL', '[1]', '保留核对退款清单的已承诺行动'),
        ('followup', 'ACTION_RECALL', '[2]', '单列培训材料待分配事项，不算已承诺行动'),
        ('owner', 'OWNER', '[1]', '退款清单负责人林岚'),
        ('unknown_owner', 'OWNER', '[2]', '培训材料负责人未知'),
        ('due', 'DEADLINE', '[1]', '保留11月6日前的前字，不补年份'),
        ('unknown_due', 'DEADLINE', '[2]', '培训材料日期未知'),
        ('proposal', 'DECISION_STATUS', '[3]', '三家门店扩点为未批准建议'),
        ('amount', 'BUSINESS_FACT', '[4]', '退款总额1200元'),
        ('uncertainty', 'UNCERTAINTY', '[4]', '财务尚未复核'),
        ('policy', 'POLICY', '[P1]', '保留草稿，待审核标记'),
    ]
    criteria = []
    for identifier, dimension, tag, obligation in specs:
        path, text = ('organization-policy.md', POLICY) if tag == '[P1]' else ('meeting.md', MEETING)
        line = next(line for line in text.splitlines() if line.startswith(tag))
        criteria.append({'id': identifier, 'dimension': dimension, 'critical': True,
                         'obligation': obligation, 'source_spans': [span(path, text, line)]})
    # The reference is prepared before any output is constructed.
    reference = prepare_reference('synthetic-closed-evaluation-challenge', initial, criteria)
    good = '''草稿，待审核
行动：林岚核对退款清单，11月6日前完成。
待分配：整理培训材料，负责人未知，截止日期未知。
建议：扩到三家门店，尚未批准。
退款总额1200元，财务尚未复核。
'''
    quotes = {'action': '林岚核对退款清单', 'followup': '整理培训材料', 'owner': '林岚',
              'unknown_owner': '负责人未知', 'due': '11月6日前', 'unknown_due': '截止日期未知',
              'proposal': '建议：扩到三家门店，尚未批准', 'amount': '退款总额1200元',
              'uncertainty': '财务尚未复核', 'policy': '草稿，待审核'}
    return initial, reference, good, quotes


def annotated_review(reference, output, quotes, *, errors=None, reviewer='offline-annotator', kind='SYNTHETIC_TEST'):
    """Locate supplied annotations; this function DOES NOT decide semantics."""
    findings = []
    for criterion in reference.data['criteria']:
        identifier = criterion['id']
        verdict, quote, reason = (errors or {}).get(identifier, ('PASS', quotes[identifier], '该命题与固定来源一致；合成示例标注'))
        findings.append({'criterion_id': identifier, 'verdict': verdict,
                         'output_spans': [span('minutes.md', output, quote)] if quote else [], 'reason': reason})
    return {'reviewer_id': reviewer, 'kind': kind, 'context_id': 'context-'+reviewer,
            'candidate_author': 'synthetic-author', 'reference_sha256': reference.sha256,
            'output_sha256': hashlib.sha256(output.encode()).hexdigest(), 'findings': findings,
            'unsupported_claims': {'status': 'CLEAR', 'issues': [], 'reason': '合成示例全篇审阅声明，不是独立测得的审阅准确率'},
            'subjective': {'readability': 3, 'usefulness': 3}}


def challenges():
    initial, reference, good, quotes = fixture()
    variants = [
        ('empty', '', None),
        ('missing_action', good.replace('行动：林岚核对退款清单，11月6日前完成。\n', ''),
         {k: ('MISSING', '', '已承诺退款行动整行缺失') for k in ('action', 'owner', 'due')}),
        ('invented_owner', good.replace('负责人未知', '负责人周凯'), {'unknown_owner': ('FAIL', '负责人周凯', '原文未分配负责人')}),
        ('wrong_due', good.replace('11月6日前', '11月7日前'), {'due': ('FAIL', '11月7日前', '日期与原文不同')}),
        ('missing_due', good.replace('11月6日前', '尽快'), {'due': ('MISSING', '', '没有截止日期及前字限定')}),
        ('lost_before', good.replace('11月6日前', '11月6日'), {'due': ('FAIL', '11月6日', '丢失前字的范围限定')}),
        ('proposal_as_decision', good.replace('建议：扩到三家门店，尚未批准', '决议：批准扩到三家门店'),
         {'proposal': ('FAIL', '决议：批准扩到三家门店', '未获批准的建议被写成决议')}),
        ('distorted_amount', good.replace('退款总额1200元', '退款总额12000元'), {'amount': ('FAIL', '退款总额12000元', '金额失真')}),
        ('uncertainty_erased', good.replace('财务尚未复核', '财务已复核'), {'uncertainty': ('FAIL', '财务已复核', '待核验被改成已核验')}),
        ('policy_violation', good.replace('草稿，待审核', '正式发布版'), {'policy': ('FAIL', '正式发布版', '违反草稿待审要求')}),
    ]
    result = []
    for name, output, annotations in [('faithful', good, {}), *variants]:
        reviews = [annotated_review(reference, output, quotes, errors=annotations)] if output else []
        report = evaluate_minutes(initial, {**initial, 'minutes.md': output.encode()}, reference,
            expected_reference_sha256=reference.sha256, candidate_author='synthetic-author', reviews=reviews)
        result.append({'challenge': name, **report})
    # Counterexample to naive quote matching: same keywords, opposite semantics.
    output = good + '补充：以上“未知”仅为占位，真实负责人已确定为周凯。\n'
    review = annotated_review(reference, output, quotes)
    review['unsupported_claims'] = {'status': 'ISSUES', 'reason': '额外整句否定未知，不能只搜到关键词就通过',
        'issues': [{'severity': 'MAJOR', 'output_span': span('minutes.md', output, '真实负责人已确定为周凯'), 'reason': '来源没有这项指派'}]}
    result.append({'challenge': 'keyword_padding', **evaluate_minutes(initial, {**initial, 'minutes.md': output.encode()}, reference,
        expected_reference_sha256=reference.sha256, candidate_author='synthetic-author', reviews=[review])})
    return result


if __name__ == '__main__':
    print(json.dumps({'scope': 'SYNTHETIC_ANNOTATED_ADJUDICATION_NOT_CLASSIFIER_ACCURACY',
                     'results': [{'challenge': r['challenge'], 'disposition': r['report']['disposition'],
                                  'critical_failures': r['report']['critical_failure_ids'],
                                  'report_sha256': r['report_sha256']} for r in challenges()]}, ensure_ascii=False, indent=2))

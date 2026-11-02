"""Prepare offline masked human review pages; never produce human observations.

The explicit catalog is authorized input data, not executable instructions. The
operator must distribute SOURCE first, then OUTPUT only after standards lock.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid

from axis_evo.review_calibration import make_packet, digest, summarize_sessions


def write_new(path, raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as stream:stream.write(raw)


def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()


def render(packet, audience):
    template=Path(__file__).with_name('calibration_review.html').read_text(encoding='utf-8')
    order=sorted((i['item_id'] for i in packet['packet']['items']),
                 key=lambda x:hashlib.sha256((audience+'|20261031|'+x).encode()).hexdigest())
    def safe(value):return json.dumps(value,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    return template.replace('__PACKET__',safe(packet['packet'])).replace('__PACKET_SHA__',safe(packet['packet_sha256'])).replace('__DISPLAY_ORDER__',safe(order)).encode()


def prepare(catalog, output):
    output=Path(output).absolute()
    output.mkdir(parents=True,exist_ok=False)
    if type(catalog) is not dict or set(catalog)!={'items','reference_timing','operator_exposure'}:
        raise ValueError('Explicit catalog and exposure declarations required')
    if catalog['reference_timing'] not in ('POSTHOC','PRE_OUTPUT','UNKNOWN') or catalog['operator_exposure'] not in ('YES','NO','UNKNOWN'):
        raise ValueError('Actual reference/exposure context required')
    anonymous, origins, source_ids, source_items=[],{}, {},{}
    for row in catalog['items']:
        fields={'origin_id','stratum','event_id','source_text','policy_text','output_text','criteria','intended_label'}
        if type(row) is not dict or set(row)!=fields or row['stratum'] not in ('HISTORICAL_MODEL_OUTPUT','CONSTRUCTED_CHALLENGE','AUTOMATIC_FIXTURE'):
            raise ValueError('Declared data provenance required')
        if row['intended_label'] not in (None,'PASS','FAIL','UNKNOWN'):
            raise ValueError('Intended constructed label is not human truth')
        token='item_'+uuid.uuid4().hex[:12]
        source_id=source_ids.setdefault(row['event_id'],'source_'+uuid.uuid4().hex[:12])
        item={k:row[k] for k in ('source_text','policy_text','output_text','criteria')}
        item.update(item_id=token,source_id=source_id)
        anonymous.append(item)
        origins[token]={'origin_id':row['origin_id'],'stratum':row['stratum'],'event_id':row['event_id'],
                        'intended_label':row['intended_label'],'human_truth':'PENDING'}
        source_item={**item,'item_id':source_id,'output_text':None}
        if source_id in source_items and source_items[source_id]!=source_item:
            raise ValueError('Same event must use identical source, policy and reference draft')
        source_items[source_id]=source_item
    packets={'SOURCE':make_packet('SOURCE',list(source_items.values())), 'OUTPUT':make_packet('OUTPUT',anonymous)}
    for phase,packet in packets.items():
        write_new(output/'operator'/f'{phase.lower()}-packet.json',json_bytes(packet))
        write_new(output/'operator'/f'{phase.lower()}-pending-summary.json',json_bytes(summarize_sessions(packet,[])))
        for audience in ('A','B','C'):
            write_new(output/f'{phase.lower()}-reviewer-{audience}'/'review.html',render(packet,audience))
            write_new(output/f'{phase.lower()}-reviewer-{audience}'/'README.txt',
                ('独立人类审阅材料；请使用自定代号。先 SOURCE，待保管者确认标准后再发 OUTPUT。\n'
                 '不要向另一审阅者或 LLM 询问本项结论。导出 JSON 保留原件；暂不回传作者的版本猜测。\n'
                 '本材料只遮蔽版本标签；已有暴露或可推断身份须如实登记。\n').encode())
    mapping={'schema_version':1,'protocol_id':'minutes-review-calibration-v1','catalog_sha256':digest(catalog),
             'reference_timing':catalog['reference_timing'],'operator_exposure':catalog['operator_exposure'],
             'mapping':origins,'packet_sha256':{p:v['packet_sha256'] for p,v in packets.items()},
             'human_calibration':'PENDING','actual_human_records':0}
    write_new(output/'operator'/'mapping-private.json',json_bytes(mapping))
    write_new(output/'operator'/'CONFIRMED_ROSTER.template.json',b'{}\n')
    write_new(output/'README-保管者.md',('''# 两阶段分发

1. 只向两名独立人类分别发送 source-reviewer-A/B。C 为测量错误率时使用的独立裁决者，不能把 A/B 共识当作评估他们自身准确率的真值。不得发送 operator 目录或预期挑战标签。
2. 收回 SOURCE 原件，核对标准正确性和重大性。CHANGE/UNKNOWN 交独立裁决；修改须生成新目录、新摘要并重发，旧材料保留。
3. 标准确认前不要分发 output-reviewer-A/B。若标准修改，当前 OUTPUT 包失效，不得复用旧引用。
4. 分别收回 OUTPUT 原件。不要让两名审阅者先互相讨论；分歧追加裁决，不覆盖原始记录。
5. 由保管者核实实际人类参与、独立性、来源及收件记录，再填写 confirmed roster（receipt_sha256、independence_group、role=RATER/ADJUDICATOR）。模板为空，不能把自报 HUMAN 当核验。需要报告误接受/误拒绝时，C 应先独立审全体校准材料，再查看争议；仅复核分歧会引入核验选择偏差。
6. 页面计时只记录本地活跃/墙钟/暂停。浏览器关闭或未导出项为缺失，不能补零；程序测试耗时不充当人工耗时。

operator 目录含版本/来源映射和构造标签，保密且不纳入公共 Preview。HTML 用随机匿名 ID、不同显示顺序；正文风格仍可能泄露身份，没有OS隔离保证。所有参考草稿均需来源核验，历史产物仅可事后校准。
''').encode())
    files={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
    write_new(output/'SHA256SUMS.txt',''.join(h+'  '+p+'\n' for p,h in sorted(files.items())).encode())
    return mapping


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    prep=commands.add_parser('prepare');prep.add_argument('--catalog',type=Path,required=True);prep.add_argument('--output',type=Path,required=True)
    analyze=commands.add_parser('analyze');analyze.add_argument('--packet',type=Path,required=True);analyze.add_argument('--sessions',type=Path,required=True);analyze.add_argument('--roster',type=Path);analyze.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='prepare':
        result=prepare(json.loads(args.catalog.read_text(encoding='utf-8')),args.output)
        print(json.dumps({'packet_sha256':result['packet_sha256'],'human_calibration':'PENDING','actual_human_records':0}))
    else:
        packet=json.loads(args.packet.read_text(encoding='utf-8'))
        records=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(args.sessions.glob('*.json'))]
        roster=json.loads(args.roster.read_text(encoding='utf-8')) if args.roster else None
        result=summarize_sessions(packet,records,confirmed_roster=roster)
        write_new(args.output,json_bytes(result));print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()

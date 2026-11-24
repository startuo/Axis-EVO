import { useEffect, useState } from 'react';
import { readResearchReadiness, type ResearchReadinessData } from '../../lib/research';
import { Badge, Field, Loading } from '../ui/Primitives';

export function ResearchReadiness({ projectId, onError }: { projectId: string; onError: (error: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ResearchReadinessData | null>(null);
  const [view, setView] = useState<'setup' | 'evidence'>('setup');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    readResearchReadiness(projectId, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(error => { if (!controller.signal.aborted) onError(error); });
    return () => controller.abort();
  }, [projectId, open, onError]);
  return <details className="evolution-card research-readiness" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>实验准备与证据，独立于生产任务</summary>
    <div className="research-view-switch" role="group" aria-label="研究视图">
      <button type="button" className="button secondary" aria-pressed={view === 'setup'} onClick={() => setView('setup')}>实验设置</button>
      <button type="button" className="button secondary" aria-pressed={view === 'evidence'} onClick={() => setView('evidence')}>实验事实</button>
    </div>
    {!data ? <Loading /> : view === 'setup' ? <section aria-label="实验设置与冻结边界">
      <h2>先冻结，再评估</h2><Badge>正式 holdout 未冻结 / 未运行</Badge>
      <dl className="research-role-list"><div><dt>DEVELOPMENT</dt><dd>仅用于修订开发与工程试点。</dd></div>
        <div><dt>GATE</dt><dd>固定 Suite、完整配对 Trial 与保守资格判断。</dd></div>
        <div><dt>FINAL_HOLDOUT</dt><dd>候选选择与策略冻结后才能正式开放；不进入修订请求。</dd></div></dl>
      <Field label="当前 Core 源码树 SHA-256" value={data.sourceTreeSha256} copy />
      <p>研究快照需固定数据集、TaskSpec、seed、Oracle、候选池、模型配置和全部试次，再明确批准协议摘要。</p>
      <p className="caption">A 固定 v1；B 使用同一候选的封闭模拟；C 使用 Gate 与独立批准、激活后的版本或 v1。相同版本共享结果，不额外抽样。</p>
      <p className="notice">此视图只读。运行入口使用一次性研究数据库；浏览器不接受任意路径，也不启动正式论文主实验。</p>
    </section> : <section aria-label="已登记实验事实">
      <h2>已登记研究快照</h2>
      {!data.experiments.length && <p className="notice">后台尚未登记研究快照。没有可报告的 holdout 结果，不能据此判断演化收益。</p>}
      {data.experiments.map(experiment => <section className="campaign-evidence" key={experiment.experimentId}>
        <h3>{experiment.experimentId}</h3><Badge>{experiment.runKind}，{experiment.caseRole}</Badge>
        <Field label="协议 SHA-256" value={experiment.protocolSha256} copy />
        <Field label="数据集 manifest SHA-256" value={experiment.datasetManifestSha256} copy />
        <Field label="快照 Core 源码 SHA-256" value={experiment.sourceTreeSha256} copy />
        <Field label="模型配置摘要" value={experiment.modelProfileSha256} copy />
        <div className="evolution-table-scroll" tabIndex={0} role="group" aria-label="实验精确分母">
          <table className="evolution-evidence-table"><thead><tr><th scope="col">条件</th><th scope="col">全部声明</th><th scope="col">通过</th><th scope="col">已记录非通过</th><th scope="col">UNKNOWN / 未提交</th></tr></thead>
            <tbody>{(['A', 'B', 'C'] as const).map(key => { const value = experiment.conditions[key];
              return <tr key={key}><th scope="row">{key}</th><td>{value.total}</td><td>{value.passed}</td>
                <td>{value.recordedNonpass}</td><td>{value.unknown} / {value.notSubmitted}</td></tr>;
            })}</tbody></table>
        </div><p className="caption">{experiment.sealed ? '快照已明确封存' : '快照尚未封存'}。Token 与实际费用不可用；UNKNOWN 不从分母删除。</p>
      </section>)}
    </section>}
  </details>;
}

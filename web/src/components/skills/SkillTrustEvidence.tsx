import { record, text } from '../../lib/evolution';
import type { SkillRef } from '../../lib/runtime';
import { Field, JsonView } from '../ui/Primitives';

const label = (ref: SkillRef | null) => ref ? `${ref.skill_id}@${ref.skill_version}` : '未记录';
const count = (metrics: Record<string, unknown>, key: string) =>
  Number.isSafeInteger(metrics[key]) && (metrics[key] as number) >= 0 ? String(metrics[key]) : '未记录';

export function SkillTrustEvidence({ reference, candidate, metrics, outcomes, gate, assessmentSha256 }: {
  reference: SkillRef | null; candidate: SkillRef; metrics: unknown; outcomes: unknown;
  gate: Record<string, unknown> | null; assessmentSha256: string;
}) {
  const values = record(metrics) ? metrics : {};
  const cases = Array.isArray(outcomes) ? outcomes.filter(record) : [];
  return <section aria-label="配对 Shadow 证据">
    <p className="caption">模拟结果不代表生产任务成功；UNKNOWN、UNSUPPORTED 不计为通过或失败。</p>
    <div className="evolution-table-scroll" tabIndex={0} role="group" aria-label="配对结果表格">
      <table className="evolution-evidence-table" aria-label="配对模拟结果汇总">
        <thead><tr><th scope="col">角色 / 精确版本</th><th scope="col">模拟通过</th><th scope="col">模拟失败</th></tr></thead>
        <tbody>{([['reference', reference], ['candidate', candidate]] as const).map(([side, ref]) =>
          <tr key={side}><th scope="row">{side} {label(ref)}</th>
            <td>{cases.filter(item => item[side] === 'SIMULATED_PASS').length}</td>
            <td>{cases.filter(item => item[side] === 'SIMULATED_FAILURE').length}</td></tr>)}</tbody>
      </table>
      <table className="evolution-evidence-table" aria-label="封闭用例的独立 Oracle 结果">
        <thead><tr><th scope="col">用例</th><th scope="col">reference</th><th scope="col">candidate</th></tr></thead>
        <tbody>{cases.map((item, index) => <tr key={index}><th scope="row">{text(item, 'caseId') || '未记录'}</th>
          <td>{text(item, 'reference') || '未记录'}</td><td>{text(item, 'candidate') || '未记录'}</td></tr>)}</tbody>
      </table>
    </div>
    <Field label="可比较用例" value={count(values, 'eligible_cases')} />
    <Field label="配对回归 / 改善" value={`${count(values, 'paired_regression_count')} / ${count(values, 'paired_improvement_count')}`} />
    <Field label="UNKNOWN / UNSUPPORTED trial" value={`${count(values, 'unknown_trial_count')} / ${count(values, 'unsupported_trial_count')}`} />
    <Field label="Assessment SHA-256" value={assessmentSha256 || '未记录'} copy />
    <section aria-label="晋升 Gate">
      <h4>晋升 Gate</h4><Field label="状态" value={gate ? text(gate, 'status') || '未记录' : '未记录'} />
      <Field label="Gate 资格" value={gate?.eligible === true ? '满足' : gate?.eligible === false ? '不满足' : '未记录'} />
      <Field label="原因" value={Array.isArray(gate?.reasons) ? gate.reasons.filter(reason => typeof reason === 'string').join(' · ') : '未记录'} />
      <Field label="Gate manifest SHA-256" value={gate ? text(gate, 'manifest_sha256') || '未记录' : '未记录'} />
      <p className="caption">Gate 资格、精确批准、TRUSTED 与首选激活是分别记录的事实。</p>
    </section>
    <details><summary>查看完整评估与 Gate JSON</summary>
      <div className="evolution-json" role="group" aria-label="配对评估审计 JSON" tabIndex={0}>
        <JsonView value={{ metrics, outcomes, gate }} />
      </div>
    </details>
  </section>;
}

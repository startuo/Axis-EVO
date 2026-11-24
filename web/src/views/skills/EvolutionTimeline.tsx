/**
 * Evolution timeline (skills-mcp stream): one card per cycle with status,
 * rating, per-check reference/candidate verdicts (host-recomputed), advisory
 * review, reasons and adoption outcome. All data is real server state.
 */
import { AlertTriangle, Check, FlaskConical, GitBranch, X } from 'lucide-react';
import type { SkillEvolution } from '@axis/protocol';
import type { EvolutionEvidenceSummary, ProductEvolutionCycle } from './types';

export interface EvolutionTimelineProps {
  evolutions: SkillEvolution[];
  evidence: Record<string, EvolutionEvidenceSummary>;
  cycles?: ProductEvolutionCycle[];
}

const STATUS_LABEL: Record<SkillEvolution['status'], { text: string; chip: string }> = {
  proposed: { text: '已提案', chip: 'info' },
  evaluating: { text: 'A/B 评估中', chip: 'info' },
  observing: { text: '观察中', chip: 'warn' },
  adopted: { text: '已采用', chip: 'success' },
  rejected: { text: '已拒绝', chip: 'danger' },
  stopped: { text: '已停止', chip: 'muted' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function EvolutionTimeline({ evolutions, evidence, cycles = [] }: EvolutionTimelineProps) {
  if (cycles.length > 0) {
    return <div className="sk-timeline" data-testid="evolution-timeline">
      {[...cycles].reverse().map(cycle => <ProductCycle key={cycle.id} cycle={cycle} />)}
    </div>;
  }
  if (evolutions.length === 0) {
    return (
      <div className="sk-empty">
        <FlaskConical size={20} strokeWidth={1.5} aria-hidden />
        <div className="sk-empty-title">还没有进化周期</div>
        <div className="sk-empty-desc">对使用过该技能的会话提交反馈后，这里会记录提案、隔离 A/B、检查重算与采用决策的完整证据链。</div>
      </div>
    );
  }
  return (
    <div className="sk-timeline" data-testid="evolution-timeline">
      {evolutions.map(cycle => {
        const status = STATUS_LABEL[cycle.status];
        const summary = evidence[cycle.id];
        return (
          <div className={`sk-cycle ${cycle.status}`} key={cycle.id}>
            <div className="sk-cycle-card">
              <div className="sk-cycle-head">
                <span className={`chip ${status.chip}`}>{status.text}</span>
                <span className={`chip ${cycle.rating === 'positive' ? 'success' : 'danger'}`}>
                  {cycle.rating === 'positive' ? '👍 正向' : '👎 负向'}
                </span>
                {cycle.candidateVersion !== undefined && (
                  <span className="chip info"><GitBranch size={11} aria-hidden /> 候选 v{cycle.candidateVersion}</span>
                )}
                <span className="sk-cycle-date">{formatTime(cycle.createdAt)}</span>
              </div>

              {cycle.comment && <div className="sk-cycle-comment">“{cycle.comment}”</div>}

              {summary && summary.checkResults.length > 0 && (
                <div className="sk-cycle-checks">
                  {summary.checkResults.map((r, i) => (
                    <div className="sk-check-row" key={i}>
                      <span className="sk-check-kind">{r.check.kind}</span>
                      <span className="sk-check-value" title={r.check.value}>{r.check.value}</span>
                      <span className={`sk-check-verdict ${r.referencePass ? 'pass' : 'fail'}`}>
                        原版 {r.referencePass ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
                      </span>
                      <span className={`sk-check-verdict ${r.candidatePass ? 'pass' : 'fail'}`}>
                        候选 {r.candidatePass ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {cycle.review && (
                <div className="sk-cycle-review">
                  <span className={`chip ${cycle.review.verdict === 'accept' ? 'success' : cycle.review.verdict === 'reject' ? 'danger' : 'muted'}`}>
                    评审 {cycle.review.verdict}
                  </span>
                  <span className="sk-form-note">建议依据独立列出，采用仍由固定检查决定</span>
                </div>
              )}

              {summary?.sourceUsedBrowserMaterial && (
                <div className="sk-disclosure">
                  <AlertTriangle size={13} aria-hidden />
                  原 turn 使用了浏览器材料且未快照（sourceUsedBrowserMaterial）：A/B 不重放网页，证据范围受限。
                </div>
              )}

              {cycle.reasons.length > 0 && (
                <ul className="sk-cycle-reasons">
                  {cycle.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                </ul>
              )}

              {summary && <div className="sk-hash">evidence sha256 {summary.evidenceSha256.slice(0, 16)}…</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PRODUCT_OUTCOMES: Record<string, string> = {
  MEASURED: '已执行固定检查', PENDING: '等待实测', NOT_RUN: '未执行固定检查',
  UNCONFIRMED: '测量未确认', RUNNING: '进行中', OBSERVING: '观察中',
  ADOPTED: '已采用', STOPPED: '已停止', UNKNOWN: '结果未确认',
};

function ProductCycle({ cycle }: { cycle: ProductEvolutionCycle }) {
  const { rationale, prediction, measuredOutcome: measured, modelAndBenchmark: models } = cycle.simLedger;
  const cases = measured.historicalCases ?? [];
  const checks = [...(measured.checks ?? []), ...(measured.commandChecks ?? [])];
  const verdict = (value: boolean, comparable?: boolean) => comparable === false ? '无法比较' : value ? '通过' : '未通过';
  const renderChecks = (rows: typeof checks) => rows.map((check, index) => (
    <div className="sk-check-row" key={index}>
      <span className="sk-check-kind">{check.check?.kind ?? '固定检查'}</span>
      <span className="sk-check-value">{check.name ?? check.check?.value}</span>
      <span className={`sk-check-verdict ${check.referencePassed ? 'pass' : 'fail'}`}>原版 {verdict(check.referencePassed, check.comparable)}</span>
      <span className={`sk-check-verdict ${check.candidatePassed ? 'pass' : 'fail'}`}>候选 {verdict(check.candidatePassed, check.comparable)}</span>
    </div>
  ));
  return (
    <div className="sk-cycle">
      <div className="sk-cycle-card">
        <div className="sk-cycle-head">
          <span className="chip muted">{PRODUCT_OUTCOMES[cycle.status] ?? cycle.status}</span>
          {cycle.result?.candidate?.version !== undefined && (
            <span className="chip info">候选 v{cycle.result.candidate.version}</span>
          )}
        </div>
        <dl className="sk-sim">
          <dt>编辑理由</dt><dd>{rationale ?? '尚无修订理由'}</dd>
          <dt>测试前预测</dt><dd>{prediction ?? '尚无预测'}</dd>
          <dt>实测结果</dt><dd>{PRODUCT_OUTCOMES[measured.status] ?? measured.status}</dd>
          <dt>模型与基准</dt>
          <dd>
            {models.generationModel && <span>生成模型 {models.generationModel.modelId}</span>}
            {models.evaluationModel && <span>评估模型 {models.evaluationModel.modelId}</span>}
            {models.benchmarkRequestSha256 && <span title={models.benchmarkRequestSha256}>基准 SHA-256 {models.benchmarkRequestSha256}</span>}
            {!models.generationModel && !models.evaluationModel && !models.benchmarkRequestSha256 && '尚无模型与基准回执'}
          </dd>
        </dl>
        {checks.length > 0 && <section className="sk-cycle-checks" aria-label="固定检查 A/B">{renderChecks(checks)}</section>}
        {measured.reasons && measured.reasons.length > 0 && (
          <ul className="sk-cycle-reasons">{measured.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        )}
        {cases.map(example => (
          <details className="sk-cycle-checks" key={example.experienceId}>
            <summary>历史案例 {example.experienceId}</summary>
            {renderChecks([...example.checks, ...example.commandChecks])}
            {example.reasons.length > 0 && <ul className="sk-cycle-reasons">{example.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          </details>
        ))}
      </div>
    </div>
  );
}

export default EvolutionTimeline;

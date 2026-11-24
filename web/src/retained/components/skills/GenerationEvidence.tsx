import type { CampaignEvidence, EvolutionCaseSummary, EvolutionReport, GenerationEvidence as GenerationRecord } from '../../lib/evolution';
import type { SkillRef } from '../../lib/runtime';
import { Badge, Field } from '../ui/Primitives';

const ref = (value: SkillRef | null) => value ? `${value.skill_id}@${value.skill_version}` : '原始版本';
const short = (value: string | null) => value ? value.slice(0, 12) : '未记录';

export function GenerationHistory({ report, cases, onCase, focusRef }: {
  report: EvolutionReport; cases: EvolutionCaseSummary[]; onCase: (id: string) => void; focusRef?: SkillRef | null;
}) {
  if (!report.lineage?.length) return null;
  const ancestry: GenerationRecord[] = [];
  let cursor = focusRef ?? report.lineage.at(-1)?.skillRef;
  while (cursor && ancestry.length < 8) {
    const current = cursor;
    const matches = report.lineage.filter(g => ref(g.skillRef) === ref(current));
    if (matches.length !== 1 || ancestry.some(g => ref(g.skillRef) === ref(current))) break;
    ancestry.unshift(matches[0]);
    cursor = matches[0].parentSkillRef ?? undefined;
  }
  const branches = report.lineage.filter(g => !ancestry.some(parent => ref(parent.skillRef) === ref(g.skillRef)));
  const renderGeneration = (generation: GenerationRecord) => {
    const owners = cases.filter(c => c.coreCaseId === generation.evolutionCaseId);
    return <li key={ref(generation.skillRef)}>
      <div className="section-heading"><strong>{ref(generation.skillRef)}</strong><Badge>{generation.state}</Badge></div>
      <small>父版本：{ref(generation.parentSkillRef)}，{generation.policyId ?? '无晋升策略记录'}</small>
      <Field label="Card SHA-256" value={generation.cardSha256} copy />
      <div className="generation-facts"><span>候选 Receipt：{short(generation.candidateReceiptSha256)}</span>
        <span>晋升 Receipt：{short(generation.promotionReceiptSha256)}</span></div>
      {owners.length === 1 && <button type="button" className="button secondary" onClick={() => onCase(owners[0].id)}>查看此代演化记录</button>}
    </li>;
  };
  return <section className="evolution-card" aria-label="多代 Skill 证据">
    <div className="section-heading"><h2>版本与授权链</h2><Badge>{report.campaignPolicyEnabled ? 'Gate v2 已显式启用' : 'Gate v1'}</Badge></div>
    <p className="caption">每代使用精确父版本。晋升与首选激活分开记录；尚未测量独立 holdout 改善。</p>
    <ol className="generation-history">{ancestry.map(renderGeneration)}</ol>
    {!!branches.length && <details><summary>其他已记录版本，{branches.length} 个（含未晋升分支）</summary>
      <ol className="generation-history">{branches.map(renderGeneration)}</ol></details>}
    {!!report.activations?.length && <details><summary>首选激活与路由回退，{report.activations.length} 条事实</summary>
      <ol className="generation-history">{report.activations.map(activation => <li key={activation.activationId}>
        <strong>#{activation.sequence} → {ref(activation.skillRef)}</strong><Field label="激活摘要" value={activation.sha256} copy />
      </li>)}</ol></details>}
  </section>;
}

export function CampaignEvidencePanel({ campaign, bridgeComplete }: { campaign: CampaignEvidence; bridgeComplete: boolean }) {
  return <section className="campaign-evidence" aria-label="前瞻评估 Campaign">
    <div className="section-heading"><h3>前瞻评估 Campaign</h3><Badge>{campaign.sealed ? '首次结果已封存' : '尚未封存'}</Badge></div>
    <p>{ref(campaign.referenceSkillRef)} → {ref(campaign.candidateSkillRef)}</p>
    <Field label="策略" value={campaign.policyId} /><Field label="Campaign ID" value={campaign.campaignId} copy />
    <Field label="Campaign SHA-256" value={campaign.campaignSha256} copy />
    <Field label="固定 Provider / Model" value={`${campaign.profile.profile_id}，r${campaign.profile.profile_revision}，${campaign.profile.model_id}`} />
    <Field label="配置 SHA-256" value={campaign.profile.config_sha256} copy />
    <Field label="Suite SHA-256" value={campaign.suiteSha256} copy />
    <div className="campaign-counts"><div><strong>{campaign.trials.length}</strong><span>预先声明的试次</span></div>
      <div><strong>{campaign.dispatchClaimCount}</strong><span>持久化调用 Claim</span></div>
      <div><strong>{campaign.unknownCount}</strong><span>缺失结果（不重试）</span></div></div>
    <p className="caption">每个用例、每个角色仅一次。Claim 不证明远端已经处理；缺失结果不等于未执行。</p>
    {!bridgeComplete && <p className="notice">Core campaign 已记录，Web 尚无完整评估回执。分别展示已提交事实，不自动补写或重复调用。</p>}
    <div className="evolution-table-scroll" role="group" aria-label="完整 Campaign 试次" tabIndex={0}>
      <table className="evolution-evidence-table"><thead><tr><th scope="col">用例 / 角色</th><th scope="col">结果</th><th scope="col">Intent / Result 摘要</th></tr></thead>
        <tbody>{campaign.trials.map(trial => <tr key={trial.trial_id}><th scope="row">{trial.case_id}<small className="block-caption">{trial.role}</small></th>
          <td>{trial.outcome}</td><td><code title={trial.intent_sha256 ?? undefined}>{short(trial.intent_sha256)}</code><br />
            <code title={trial.result_sha256 ?? undefined}>{short(trial.result_sha256)}</code></td></tr>)}</tbody></table>
    </div>
    <details><summary>既有历史 Trial，{campaign.historicalContext.length} 条（仅作为历史上下文）</summary>
      <p className="caption">这些事实保留，不冒充本代新的 TRUSTED reference 试次。</p>
      <ul className="campaign-history">{campaign.historicalContext.map(trial => <li key={trial.trial_id}>
        <code>{trial.trial_id}</code><span>{trial.case_id}，{trial.outcome}</span></li>)}</ul>
    </details>
    <Field label="首次封存 Receipt" value={campaign.receiptSha256 ?? '未封存'} copy />
    <p className="caption">评估完整、Gate 合格、明确批准、TRUSTED、首选激活与独立 holdout 改善是不同事实。</p>
  </section>;
}

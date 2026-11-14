import { useEffect, useState } from 'react';
import { Check, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { agentApi, type AgentEvolution as EvolutionData, type AgentEvolutionCycle, type AgentEvolutionPolicy, type AgentEvolutionPolicyInput, type AgentSkill } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';
import { RuntimeError } from '../../lib/runtime';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const reasons: Record<string, string> = {
  NO_UNAMBIGUOUS_SKILL_REVISION_TARGET: '尚不能把问题关联到一个明确的 Skill 版本。',
  REVISION_PROVIDER_NOT_CONFIGURED: '尚未选择修订模型，反馈已保留。',
  NO_EXPLICIT_USER_CHECKS: '尚无你指定的可核验要求，候选继续观察。',
  EXECUTION_EVALUATOR_UNAVAILABLE: '当前无法完成实际执行对比。',
  SOURCE_EXECUTION_UNKNOWN: '原任务存在未知执行结果，已停止自动改进。',
  INDEPENDENT_REVIEW_REJECTED: '独立审查提出反对意见。',
  REVIEW_CONCERNS_UNRESOLVED: '审查意见仍有未解决的疑问。',
  OUTPUT_BYTES_NOT_VERIFIED: '对比任务的文档字节未全部核验。',
  REGRESSION_DETECTED: '候选未通过原版已通过的要求。',
  CANDIDATE_CHECK_FAILED: '候选仍有要求未满足。',
  NO_MEASURED_IMPROVEMENT: '本次对比没有测得指定要求上的改善。',
  OBSERVE_POLICY: '当前策略保留候选，继续观察。',
  POLICY_OBSERVE_ONLY: '当前策略保留候选，继续观察。',
  POLICY_REQUIRES_OBSERVATION: '当前策略保留候选，继续观察。',
  AGENT_EVOLUTION_AUTHORITY_CHANGED: '工作区或来源授权已变化，本次周期停止。',
  SOURCE_NOT_AUTHORIZED: 'Skill 来源尚未授权或已撤销。',
  EVOLUTION_OPERATION_UNCONFIRMED: '本次改进操作未能确认，已保留记录并停止。',
  PREFERRED_VERSION_CHANGED: '任务当前使用的版本已变化，本次未采用。',
  AGENT_EVOLUTION_POLICY_CHANGED: '改进策略已变化，本次周期停止。',
  AGENT_EVOLUTION_STALE: '原任务证据已变化，本次未重放。',
};
const cycleStatus: Record<string, string> = { RUNNING: '正在改进', OBSERVING: '继续观察', ADOPTED: '已自动采用', STOPPED: '已停止', UNKNOWN: '结果待确认' };

function PolicyForm({ policy, data }: { policy: AgentEvolutionPolicy; data: AgentWorkspaceController }) {
  const [mode, setMode] = useState(policy.mode);
  const [revisionKey, setRevisionKey] = useState(policy.revisionProfileId ? `${policy.revisionProfileId}@${policy.revisionProfileRevision}` : '');
  const [reviewerKey, setReviewerKey] = useState(policy.reviewerProfileId ? `${policy.reviewerProfileId}@${policy.reviewerProfileRevision}` : '');
  const [saved, setSaved] = useState(false);
  const profiles = data.profiles?.profiles ?? [];
  const key = (id: string | null, revision: number | null) => id ? `${id}@${revision}` : '';
  const dirty = mode !== policy.mode || revisionKey !== key(policy.revisionProfileId, policy.revisionProfileRevision) || reviewerKey !== key(policy.reviewerProfileId, policy.reviewerProfileRevision);
  const reference = (value: string, prefix: 'revision' | 'reviewer') => {
    const selected = profiles.find(profile => `${profile.id}@${profile.revision}` === value);
    return selected ? { id: selected.id, revision: selected.revision } : value ? { id: policy[`${prefix}ProfileId`], revision: policy[`${prefix}ProfileRevision`] } : { id: null, revision: null };
  };
  const options = (selected: string) => <><option value="">不配置</option>{selected && !profiles.some(profile => `${profile.id}@${profile.revision}` === selected) && <option value={selected}>已固定的配置 · {selected}</option>}{profiles.map(profile => <option key={`${profile.id}@${profile.revision}`} value={`${profile.id}@${profile.revision}`}>{profile.name} · {profile.modelId} · v{profile.revision}{profile.credentialConfigured ? '' : '（未配置凭据）'}</option>)}</>;
  async function save() {
    if (!data.workspace) return;
    const revision = reference(revisionKey, 'revision'), reviewer = reference(reviewerKey, 'reviewer');
    const body: AgentEvolutionPolicyInput = { mode, revisionProfileId: revision.id, revisionProfileRevision: revision.revision, reviewerProfileId: reviewer.id, reviewerProfileRevision: reviewer.revision };
    if (await data.mutate('evolution-policy', () => agentApi.evolutionPolicy(data.workspace!.id, body))) setSaved(true);
  }
  return <form className="agent-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label>Skill 改进策略<select aria-label="Skill 改进策略" value={mode} onChange={event => { setMode(event.target.value as AgentEvolutionPolicy['mode']); setSaved(false); }}><option value="OFF">关闭 · 仅保留任务反馈</option><option value="OBSERVE">观察 · 修订与评价，保留候选</option><option value="AUTO">自动采用 · 实际对比达到条件后采用</option></select></label>
    <div className="agent-field-row agent-evolution-profiles"><label>修订模型<select aria-label="Skill 修订模型" value={revisionKey} onChange={event => { setRevisionKey(event.target.value); setSaved(false); }}>{options(revisionKey)}</select><small>根据真实任务和反馈提出候选。不配置时只记录反馈。</small></label><label>独立审查模型<select aria-label="Skill 独立审查模型" value={reviewerKey} onChange={event => { setReviewerKey(event.target.value); setSaved(false); }}>{options(reviewerKey)}</select><small>在单独上下文中审查候选。可以选择不同模型；同模型会明确标注。</small></label></div>
    <p className="agent-policy-explanation">自动采用需要在隔离工作区实际运行原版与候选，候选满足你指定的全部文档要求，且至少一项改善、没有退步。采用范围仅限这些明确的文档检查。模型审查提供建议；审阅结论为反对或不确定时，不会自动采用。</p>
    <div className="agent-form-actions"><button className="button secondary" disabled={!dirty || !!data.busy}>{data.busy === 'evolution-policy' ? '正在保存…' : '保存改进策略'}</button>{saved && <span role="status"><Check size={13}/>策略已保存</span>}<button type="button" className="text-button" onClick={() => data.go('settings', { section: 'models' })}>管理模型连接</button></div>
  </form>;
}

export function EvolutionCycle({ cycle }: { cycle: AgentEvolutionCycle }) {
  const candidate = record(cycle.result?.candidate) ?? cycle.facts.find(fact => fact.kind === 'skill_candidate')?.payload;
  const gate = record(cycle.result?.gate) ?? cycle.facts.find(fact => fact.kind === 'evolution_gate')?.payload;
  const review = cycle.facts.find(fact => fact.kind === 'evolution_review')?.payload;
  const outcomeReasons = strings(cycle.result?.reasons);
  const rawChecks = Array.isArray(gate?.checks) ? gate.checks : [];
  const checks = rawChecks.flatMap(value => {
    const row = record(value), check = record(row?.check);
    return row && check && typeof check.value === 'string' && typeof row.referencePassed === 'boolean' && typeof row.candidatePassed === 'boolean' ? [{ kind: String(check.kind), value: check.value, before: row.referencePassed, after: row.candidatePassed }] : [];
  });
  const verdict = review?.verdict === 'ACCEPT' ? '建议接受' : review?.verdict === 'REJECT' ? '建议停止' : review?.verdict === 'UNCERTAIN' ? '仍有疑问' : '未进行模型审查';
  return <article className="agent-evolution-cycle">
    <header><div><strong>{candidate && typeof candidate.skillId === 'string' ? candidate.skillId : '任务反馈改进'}</strong><span>{typeof candidate?.version === 'number' ? `候选 v${candidate.version}` : '反馈已关联执行记录'}</span></div><span className={`agent-cycle-status${cycle.status === 'ADOPTED' ? ' is-adopted' : ''}`}>{cycle.workerActive && <LoaderCircle size={13} className="loader"/>}{cycleStatus[cycle.status] ?? cycle.status}</span></header>
    {cycle.workerActive && <p role="status">正在生成候选、审查或进行隔离执行对比。完成后会自动更新。</p>}
    {outcomeReasons.length > 0 && <ul className="agent-cycle-reasons">{outcomeReasons.map(reason => <li key={reason}>{reasons[reason] ?? reason}</li>)}</ul>}
    {checks.length > 0 && <div className="agent-check-results"><table><caption>保存文档的实际检查</caption><thead><tr><th scope="col">要求</th><th scope="col">原版</th><th scope="col">候选</th></tr></thead><tbody>{checks.map((check, index) => <tr key={index}><th scope="row"><small>{check.kind === 'heading' ? '标题' : check.kind === 'not_contains' ? '不得包含' : '必须包含'}</small>{check.value}</th><td>{check.before ? '通过' : '未通过'}</td><td>{check.after ? '通过' : '未通过'}</td></tr>)}</tbody></table><p>仅说明这些明确要求的结果，不代表一般语义质量或学术实验结论。</p></div>}
    {review && <details className="agent-cycle-review"><summary>模型审查建议 · {verdict}<ChevronRight size={12}/></summary><p>{review.independence === 'DIFFERENT_MODEL' ? '不同模型、独立上下文' : review.independence === 'SEPARATE_CONTEXT_SAME_MODEL' ? '同一模型、独立上下文；不视为跨模型评价' : '未配置独立审查模型'}</p>{strings(review.reasons).map((reason, index) => <p key={`reason-${index}`}>{reason}</p>)}{strings(review.uncertainties).length > 0 && <p>审阅保留的局限与不确定性：{strings(review.uncertainties).join('；')}</p>}</details>}
    <details className="agent-cycle-evidence"><summary>查看版本与执行证据</summary><pre>{JSON.stringify({ cycleId: cycle.id, feedbackId: cycle.feedbackId, policy: cycle.policy, facts: cycle.facts, result: cycle.result }, null, 2)}</pre></details>
  </article>;
}

export function AgentEvolution({ data }: { data: AgentWorkspaceController }) {
  const [result, setResult] = useState<{ workspaceId: string; value: EvolutionData; skills: AgentSkill[] } | null>(null);
  const [error, setError] = useState('');
  const workspaceId = data.workspaceId;
  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const [value, catalog] = await Promise.all([agentApi.evolution(workspaceId, abort.signal), agentApi.skills(workspaceId, abort.signal)]);
        if (abort.signal.aborted) return;
        setResult({ workspaceId, value, skills: catalog.skills }); setError('');
        if (value.cycles.some(cycle => cycle.workerActive)) timer = setTimeout(() => void read(), 2000);
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof RuntimeError ? failure.message : '暂时无法读取改进记录，请刷新。'); }
    };
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [workspaceId, data.revision]);
  if (!data.workspace) return <p className="agent-settings-empty">先选择一个工作区，再设置 Skill 改进方式。</p>;
  const current = result?.workspaceId === workspaceId ? result : null;
  return <><div className="agent-section-heading"><div><h2>让能力随反馈改进</h2><p>任务反馈、候选版本、实际对比与采用决定，在这里保持关联。</p></div><button className="text-button" onClick={data.reload}><RefreshCw size={14}/>刷新记录</button></div>
    {error && <p role="alert" className="agent-inline-error">{error}</p>}
    {current ? <><PolicyForm key={`${workspaceId}:${current.value.policy.id ?? 'default'}`} policy={current.value.policy} data={data}/>
      <section className="agent-settings-section"><h2>任务中使用的 Skills</h2>{current.skills.length ? <ul className="agent-skill-list">{current.skills.map(skill => <li key={skill.skillId}><div><strong>{skill.name}</strong><code>{skill.source.path}</code></div><span>当前 v{skill.version}</span></li>)}</ul> : <p>Agent 使用已授权目录中的 Skill 后，版本会显示在这里。</p>}</section>
      <section className="agent-settings-section"><div className="agent-section-heading"><h2>改进记录</h2><span className="agent-subtle">{current.value.cycles.length} 个周期</span></div>{current.value.cycles.length ? [...current.value.cycles].reverse().map(cycle => <EvolutionCycle key={cycle.id} cycle={cycle}/>) : <p>在任务结果下提交“需要改进”的反馈，即可按当前策略开始处理。建议补充可以核验的文档要求。</p>}</section>
    </> : !error && <p role="status">正在读取策略与版本记录…</p>}
  </>;
}

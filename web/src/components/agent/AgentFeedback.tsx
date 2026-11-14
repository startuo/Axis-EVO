import { useRef, useState } from 'react';
import { Check, Plus, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { agentApi, type AgentCheck, type AgentTurn } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';

type CheckDraft = AgentCheck & { id: string };

export function AgentFeedback({ turn, data }: { turn: AgentTurn; data: AgentWorkspaceController }) {
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null);
  const [comment, setComment] = useState('');
  const [skillId, setSkillId] = useState('');
  const [checks, setChecks] = useState<CheckDraft[]>([]);
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState('');
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const skills = [...new Map((turn.skillUses ?? []).map(skill => [skill.skillId, skill])).values()];
  const editCheck = (id: string, patch: Partial<AgentCheck>) => { setChecks(current => current.map(check => check.id === id ? { ...check, ...patch } : check)); setInvalid(''); };
  async function submit() {
    if (!rating) return;
    const submitted = rating === 'negative' ? checks.map(({ kind, value }) => ({ kind, value: value.trim() })) : [];
    if (submitted.some(check => !check.value || new TextEncoder().encode(check.value).length > 512 || /[\u0000-\u001f]/.test(check.value))) { setInvalid('每项检查需要填写单行内容，长度不超过 512 个 UTF-8 字节。'); return; }
    if (new Set(submitted.map(check => JSON.stringify(check))).size !== submitted.length) { setInvalid('请合并相同的检查项。'); return; }
    if (new TextEncoder().encode(comment).length > 4096) { setInvalid('反馈内容超过 4096 个 UTF-8 字节，请精简后提交。'); return; }
    const body = { rating, comment, checks: submitted, ...(skillId ? { skillId } : {}) };
    const signature = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== signature) attempt.current = { body: signature, id: `feedback_${crypto.randomUUID()}` };
    const submissionId = attempt.current.id;
    const ok = await data.mutate(`feedback:${turn.id}`, () => agentApi.feedback(turn.id, { ...body, submissionId }));
    if (ok) { setSaved(true); setRating(null); setComment(''); setChecks([]); setSkillId(''); setInvalid(''); }
  }
  return <div className="agent-feedback">
    <div className="agent-feedback-controls"><span>这次结果怎么样？</span><button type="button" className="icon-button" aria-label="结果有帮助" aria-pressed={rating === 'positive'} onClick={() => { setRating('positive'); setSaved(false); }}><ThumbsUp size={14}/></button><button type="button" className="icon-button" aria-label="结果需要改进" aria-pressed={rating === 'negative'} onClick={() => { setRating('negative'); setSaved(false); }}><ThumbsDown size={14}/></button>{(saved || turn.feedback.length > 0) && <small role="status"><Check size={12}/>反馈已记录</small>}</div>
    {rating && !saved && <form className="agent-feedback-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor={`feedback-${turn.id}`}>{rating === 'negative' ? '告诉 Agent 哪里需要改进' : '哪些部分值得保留'}<textarea id={`feedback-${turn.id}`} value={comment} onChange={event => { setComment(event.target.value); setInvalid(''); }} maxLength={4096} rows={2} placeholder="可以补充具体期望或发现的问题"/></label>
      {rating === 'negative' && <>
        {skills.length > 1 && <label className="agent-feedback-target">关联本轮使用的 Skill<select value={skillId} onChange={event => setSkillId(event.target.value)}><option value="">仅记录反馈，暂不归因</option>{skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.name ?? skill.skillId} · v{skill.version}</option>)}</select></label>}
        <details className="agent-feedback-checks"><summary>补充可核验的文档要求（可选）</summary><p>这些要求由你指定。Agent 会在隔离副本中实际运行两个版本，核对保存的文档；文字或标题检查不代表整体质量。标题按完整文字匹配，不填 #，编号也须一致；例如“归档清单”不会匹配“六、归档清单”。</p>
          {checks.map((check, index) => <div className="agent-check-editor" key={check.id}><select aria-label={`检查 ${index + 1} 类型`} value={check.kind} onChange={event => editCheck(check.id, { kind: event.target.value as AgentCheck['kind'] })}><option value="contains">必须包含</option><option value="not_contains">不得包含</option><option value="heading">必须有标题</option></select><input aria-label={`检查 ${index + 1} 内容`} value={check.value} maxLength={512} placeholder={check.kind === 'heading' ? '例如：行动计划（不含 #）' : '填写需要核对的原文'} onChange={event => editCheck(check.id, { value: event.target.value })}/><button type="button" className="icon-button" aria-label={`移除检查 ${index + 1}`} onClick={() => { setChecks(current => current.filter(item => item.id !== check.id)); setInvalid(''); }}><X size={13}/></button></div>)}
          <button type="button" className="text-button" disabled={checks.length >= 16} onClick={() => setChecks(current => [...current, { id: crypto.randomUUID(), kind: 'contains', value: '' }])}><Plus size={13}/>添加检查</button>
        </details>
        <p className="agent-feedback-policy">{data.workspace?.policy.evolutionMode === 'off' ? '当前仅记录反馈，自动改进已关闭。' : skills.length ? '反馈会按工作区的改进策略处理。' : '本轮没有使用 Skill；反馈会保留在任务中，不会自动归因。'}<button type="button" className="text-button" onClick={() => data.go('settings', { section: 'evolution' })}>查看改进策略</button></p>
      </>}
      {invalid && <p role="alert" className="agent-inline-error">{invalid}</p>}
      <div className="agent-feedback-actions"><span>反馈与本轮工具证据一同保留。</span><button type="button" className="text-button" onClick={() => setRating(null)}>取消</button><button className="button secondary" disabled={!!data.busy}>{data.busy === `feedback:${turn.id}` ? '正在记录…' : '提交反馈'}</button></div>
    </form>}
    {saved && <button className="text-button agent-feedback-link" onClick={() => data.go('settings', { section: 'evolution' })}>查看 Skill 改进记录</button>}
  </div>;
}

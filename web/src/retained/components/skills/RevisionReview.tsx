import { useState, type ReactNode } from 'react';
import { instructionDiff, type RevisionDraft } from '../../lib/evolution';
import { Field } from '../ui/Primitives';

export function ExactEvolutionApproval({ title, digest, busy, onApprove, children }: {
  title: string; digest: string; busy: boolean; onApprove: (digest: string) => void; children?: ReactNode;
}) {
  const [confirmation, setConfirmation] = useState({ digest, text: '' });
  const approved = confirmation.digest === digest && confirmation.text === digest && /^[0-9a-f]{64}$/.test(digest);
  return <section className="evolution-approval" aria-label={`${title}授权`}>
    <h3>{title}，独立授权</h3>{children}
    <Field label="待批准 SHA-256" value={digest} copy />
    <label>{title}，确认摘要<input autoComplete="off" spellCheck={false} aria-label={`${title}，确认摘要`}
      value={confirmation.digest === digest ? confirmation.text : ''}
      onChange={event => setConfirmation({ digest, text: event.target.value })} placeholder="输入或粘贴完整摘要，明确确认此操作" /></label>
    <button className="button primary" disabled={busy || !approved} onClick={() => onApprove(confirmation.text)}>{title}，批准此摘要</button>
  </section>;
}

export function RevisionReview({ source, sourceTools, initial, busy, onSave, onReject }: {
  source: string; sourceTools: string[]; initial: RevisionDraft; busy: boolean;
  onSave: (draft: RevisionDraft) => void; onReject?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const setText = (key: keyof RevisionDraft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const diff = instructionDiff(source, draft.instructions);
  return <section aria-label="模型建议与用户修订" className="revision-review">
    <div className="section-heading"><h2>审阅模型建议</h2><span className="badge">未批准，无执行权限</span></div>
    <p>模型文本不是改进证明。保存编辑稿后仍需单独准备候选并批准精确摘要。</p>
    <div className="revision-side-by-side"><section><h3>原版 Instructions</h3><pre tabIndex={0}>{source}</pre></section>
      <label>候选 Instructions<textarea value={draft.instructions} onChange={e => setText('instructions', e.target.value)} rows={10} /></label></div>
    <label>候选名称<input value={draft.name} onChange={e => setText('name', e.target.value)} /></label>
    <label>候选描述<textarea rows={2} value={draft.description} onChange={e => setText('description', e.target.value)} /></label>
    <label>修订说明<textarea rows={2} value={draft.change_summary} onChange={e => setText('change_summary', e.target.value)} /></label>
    <label>预期行为变化<textarea rows={2} value={draft.expected_behavior_change} onChange={e => setText('expected_behavior_change', e.target.value)} /></label>
    <fieldset><legend>工具权限对比，始终展开</legend><p>父版本：{sourceTools.join('，')}</p>
      {sourceTools.map(tool => <label className="evolution-checkbox" key={tool}><input type="checkbox"
        checked={draft.allowed_tools.includes(tool)} onChange={event => setDraft(current => ({ ...current,
          allowed_tools: event.target.checked ? [...current.allowed_tools, tool] : current.allowed_tools.filter(t => t !== tool) }))} />{tool}</label>)}
      <p className="caption">禁止扩权。缩减权限可创建候选，但当前 Gate v1 会判为 INCOMPARABLE。</p></fieldset>
    <label>已知风险（每行一项）<textarea rows={3} value={draft.declared_risks.join('\n')}
      onChange={e => setDraft(current => ({ ...current, declared_risks: e.target.value.split('\n').filter(Boolean) }))} /></label>
    <Field label="Reason codes" value={draft.reason_codes.join('，')} />
    <Field label="支持证据 ID" value={draft.supporting_evidence_ids.join('，')} copy />
    <details open><summary>Instructions 差异</summary><pre className="instruction-diff" tabIndex={0}>{diff.map((line, index) =>
      <span key={index} className={`diff-${line.kind}`}>{line.kind === 'removed' ? '− ' : line.kind === 'added' ? '+ ' : '  '}{line.text}{'\n'}</span>)}</pre></details>
    <div className="form-actions"><button className="button primary" disabled={busy || !draft.instructions.trim() || !draft.name.trim() || !draft.allowed_tools.length}
      onClick={() => onSave(draft)}>保存不可变编辑稿</button>{onReject && <button className="button secondary" disabled={busy} onClick={onReject}>拒绝此模型建议</button>}</div>
  </section>;
}

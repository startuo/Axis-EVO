import { AlertTriangle, CirclePause } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TurnDecision } from '@axis/protocol';
import { TurnErrorDetails } from '../../components/TurnError';
import { useSocket } from '../../hooks/useSocket';
import './evidence.css';

export function ExecutionDecisionCard({ decision, onReviewEvidence }: {
  decision: TurnDecision;
  onReviewEvidence?: () => void;
}) {
  if (decision.status === 'STALL') return <StallDecisionCard decision={decision} onReviewEvidence={onReviewEvidence} />;
  const uncertain = decision.status === 'UNKNOWN';
  const Icon = uncertain ? AlertTriangle : CirclePause;
  return (
    <aside className="execution-decision" aria-label={uncertain ? '未知执行结果' : '连续错误已暂停'}>
      <div className="execution-decision-heading">
        <Icon size={15} aria-hidden />
        {uncertain ? '执行结果待核对' : '连续同错，已暂停'}
      </div>
      <p>
        {uncertain ? '请先查看工具回执和实际文件。系统会保留现状，等待你确认下一步。'
          : `${decision.tool ? `${decision.tool} ` : '同一工具'}连续失败 ${decision.consecutiveFailures ?? 3} 次。请核对原因后再发起新请求。`}
      </p>
      {decision.hint && <p>{decision.hint}</p>}
      <TurnErrorDetails code={decision.code} />
      {onReviewEvidence && (
        <button type="button" className="text-button" onClick={onReviewEvidence}>查看执行证据</button>
      )}
    </aside>
  );
}

type StallAction = NonNullable<TurnDecision['resolvedAction']>;
const stallCopy = {
  READ_ONLY_SPIN: '多步只读操作重复查看相同目标。',
  EDIT_OSCILLATION: '同一文件的改动出现回摆，或固定检查持续报告相同失败项。',
  PROGRESSLESS_BURN: '已用去大部分任务预算，验收条件暂无可核查的进展。',
};

function StallDecisionCard({ decision, onReviewEvidence }: {
  decision: TurnDecision; onReviewEvidence?: () => void;
}) {
  const { request } = useSocket();
  const [form, setForm] = useState<'ADD_CONSTRAINTS' | 'REDUCE_CONTRACT' | null>(null);
  const [constraints, setConstraints] = useState('');
  const [drops, setDrops] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [localAction, setLocalAction] = useState<StallAction>();
  const lastRequest = useRef<{ body: string; id: string } | undefined>(undefined);
  const criteria = decision.criteria ?? [];
  const resolved = decision.resolvedAction ?? localAction;

  async function choose(action: StallAction) {
    if (saving || resolved || !decision.turnId) return;
    const fields = action === 'ADD_CONSTRAINTS' ? { constraints: constraints.trim() }
      : action === 'REDUCE_CONTRACT' ? { dropCriteria: [...drops].sort((a, b) => a - b) } : {};
    const fingerprint = JSON.stringify({ action, ...fields });
    if (lastRequest.current?.body !== fingerprint) lastRequest.current = { body: fingerprint, id: crypto.randomUUID() };
    setSaving(true);
    setError(undefined);
    try {
      await request('stall.resolve', { turnId: decision.turnId, action, requestId: lastRequest.current.id, ...fields });
      setLocalAction(action);
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂时无法保存处置。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="execution-decision" aria-label="语义停滞已暂停">
      <div className="execution-decision-heading"><CirclePause size={15} aria-hidden />语义停滞，已暂停</div>
      {decision.stallKind && <p>{stallCopy[decision.stallKind]}</p>}
      {resolved ? <p role="status">{resolved === 'KEEP_SNAPSHOT' ? '已保留授权文本快照与原有产物记录。' : '已提交新的回合。'}</p> : (
        <>
          <div className="stall-actions">
            <button type="button" className="text-button" disabled={saving} onClick={() => setForm('ADD_CONSTRAINTS')}>追加约束后继续</button>
            {criteria.length > 1 && <button type="button" className="text-button" disabled={saving} onClick={() => setForm('REDUCE_CONTRACT')}>缩减契约范围</button>}
            <button type="button" className="text-button" disabled={saving} onClick={() => void choose('KEEP_SNAPSHOT')}>保留当前快照</button>
          </div>
          {form === 'ADD_CONSTRAINTS' && <form className="stall-form" onSubmit={event => { event.preventDefault(); void choose(form); }}>
            <label>追加约束<textarea rows={2} maxLength={2000} value={constraints} onChange={event => setConstraints(event.target.value)} /></label>
            <button type="submit" className="text-button" disabled={saving || !constraints.trim()}>提交并继续</button>
          </form>}
          {form === 'REDUCE_CONTRACT' && <form className="stall-form" onSubmit={event => { event.preventDefault(); void choose(form); }}>
            <p>选择要移除的验收条件，至少保留一项。</p>
            {criteria.map((criterion, index) => <label className="stall-criterion" key={index}>
              <input type="checkbox" checked={drops.includes(index)} onChange={event => setDrops(previous => event.target.checked
                ? [...previous, index] : previous.filter(i => i !== index))} />
              {'name' in criterion ? criterion.name : criterion.path}
            </label>)}
            <button type="submit" className="text-button" disabled={saving || drops.length === 0 || drops.length === criteria.length}>提交并继续</button>
          </form>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {onReviewEvidence && <button type="button" className="text-button" onClick={onReviewEvidence}>查看执行证据</button>}
    </aside>
  );
}

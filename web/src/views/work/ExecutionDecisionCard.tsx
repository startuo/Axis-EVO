import { AlertTriangle, CirclePause } from 'lucide-react';
import type { TurnDecision } from '@axis/protocol';
import './evidence.css';

export function ExecutionDecisionCard({ decision, onReviewEvidence }: {
  decision: TurnDecision;
  onReviewEvidence?: () => void;
}) {
  const uncertain = decision.status === 'UNKNOWN';
  const Icon = uncertain ? AlertTriangle : CirclePause;
  return (
    <aside className="execution-decision" aria-label={uncertain ? '未知执行结果' : '连续错误已暂停'}>
      <div className="execution-decision-heading">
        <Icon size={15} aria-hidden />
        {uncertain ? 'UNKNOWN：执行结果待核对' : '连续同错，已暂停'}
      </div>
      <p>
        {uncertain ? '请先查看工具回执和实际文件。系统会保留现状，等待你确认下一步。'
          : `${decision.tool ? `${decision.tool} ` : '同一工具'}连续失败 ${decision.consecutiveFailures ?? 3} 次。请核对原因后再发起新请求。`}
      </p>
      {decision.hint && <p>{decision.hint}</p>}
      <code>{decision.code}</code>
      {onReviewEvidence && (
        <button type="button" className="text-button" onClick={onReviewEvidence}>查看执行证据</button>
      )}
    </aside>
  );
}

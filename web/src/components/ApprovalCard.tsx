/** Inline risk-approval card: approve / deny → approval.respond. */
import { useState } from 'react';
import { Check, ChevronDown, FileText, Globe, Network, Plug, Terminal, X, type LucideIcon } from 'lucide-react';
import type { Approval } from '@axis/protocol';
import { errorMessage } from '../lib/format';
import { useSocket } from '../hooks/useSocket';
import { useToast } from './Toasts';

const KIND_ICON: Record<Approval['kind'], LucideIcon> = {
  command: Terminal,
  'file-write': FileText,
  mcp: Plug,
  browser: Globe,
  network: Network,
};

const RISK_META: Record<Approval['risk'], { cls: string; label: string }> = {
  low: { cls: 'info', label: '低风险' },
  medium: { cls: 'warn', label: '中风险' },
  high: { cls: 'danger', label: '高风险' },
};

const RESOLVED_META: Record<Exclude<Approval['status'], 'pending'>, { cls: string; label: string }> = {
  approved: { cls: 'success', label: '已批准' },
  denied: { cls: 'danger', label: '已拒绝' },
  expired: { cls: 'muted', label: '已过期' },
};

export function ApprovalCard({ approval }: { approval: Approval }) {
  const { request } = useSocket();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'once' | 'session'>('once');
  const [detailOpen, setDetailOpen] = useState(false);
  const Icon = KIND_ICON[approval.kind];
  const risk = RISK_META[approval.risk];
  const pending = approval.status === 'pending';

  const respond = async (decision: 'approve' | 'deny') => {
    setBusy(true);
    try {
      await request('approval.respond', { approvalId: approval.id, decision, scope });
    } catch (e) {
      toast.push('error', `审批响应失败：${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card approval-card risk-${approval.risk}`} role="alertdialog" aria-label={`审批请求：${approval.summary}`}>
      <div className="approval-head">
        <Icon size={15} className="approval-icon" aria-hidden />
        <span className="approval-summary">{approval.summary}</span>
        <span className={`chip ${risk.cls}`}>{risk.label}</span>
        {approval.status !== 'pending' && (
          <span className={`chip ${RESOLVED_META[approval.status].cls}`}>{RESOLVED_META[approval.status].label}</span>
        )}
      </div>
      {approval.detail && (
        <>
          <button className="approval-detail-toggle" aria-expanded={detailOpen} onClick={() => setDetailOpen((v) => !v)}>
            <ChevronDown size={13} className={`chev${detailOpen ? ' open' : ''}`} aria-hidden />
            详情
          </button>
          {detailOpen && <pre className="approval-detail">{approval.detail}</pre>}
        </>
      )}
      {pending && (
        <div className="approval-actions">
          <button className="button approve" disabled={busy} onClick={() => void respond('approve')}>
            <Check size={14} aria-hidden /> 批准
          </button>
          <button className="button deny" disabled={busy} onClick={() => void respond('deny')}>
            <X size={14} aria-hidden /> 拒绝
          </button>
          <label className="scope-label">
            范围
            <select value={scope} onChange={(e) => setScope(e.target.value as 'once' | 'session')} aria-label="批准范围">
              <option value="once">仅本次</option>
              <option value="session">本会话</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

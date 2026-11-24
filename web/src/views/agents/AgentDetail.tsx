/** Selected agent: header, summary, live activity (reused Conversation) + message timeline. */
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, LoaderCircle, Send } from 'lucide-react';
import type { AgentInfo, Session } from '@axis/protocol';
import { Conversation } from '../chat/Conversation';
import { Markdown } from '../../components/Markdown';
import { PermissionChip } from '../../components/PermissionChip';
import { useConversation } from '../../hooks/useConversation';
import { useSocket } from '../../hooks/useSocket';
import { useToast } from '../../components/Toasts';
import { errorMessage, timeAgo } from '../../lib/format';
import { AgentStatusChip } from './AgentTree';

export interface AgentDetailProps {
  agent: AgentInfo;
}

type Tab = 'activity' | 'messages';

export function AgentDetail({ agent }: AgentDetailProps) {
  const conv = useConversation(agent.sessionId);
  const { request } = useSocket();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('activity');
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    setSession(null);
    request<{ session: Session }>('session.get', { sessionId: agent.sessionId, itemLimit: 1 })
      .then((res) => { if (alive) setSession(res.session); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [agent.sessionId, request]);

  const userMessages = useMemo(
    () => conv.items.filter((i) => i.kind === 'message' && i.role === 'user'),
    [conv.items],
  );

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await request('agent.message', { agentId: agent.id, text });
      setDraft('');
      toast.push('success', '消息已投递');
    } catch (e) {
      toast.push('error', `投递失败：${errorMessage(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="agent-detail">
      <header className="agent-detail-head">
        <div className="agent-detail-title">
          <h2>{agent.name}</h2>
          <AgentStatusChip status={agent.status} />
          {session && <PermissionChip mode={session.mode} interactive={false} />}
        </div>
        <p className="agent-detail-role">{agent.role}</p>
        <div className="agent-detail-meta">
          <span>会话 <code>{agent.sessionId}</code></span>
          <span>创建于 {timeAgo(agent.createdAt)}</span>
          {agent.worktree && (
            <span className="agent-detail-wt" title={agent.worktree}>
              <GitBranch size={13} aria-hidden /> worktree 隔离
            </span>
          )}
        </div>
      </header>

      {agent.summary && (
        <section className="agent-summary card" aria-label="完成总结">
          <div className="agent-summary-label">完成总结</div>
          <div className="agent-summary-body"><Markdown text={agent.summary} /></div>
        </section>
      )}

      <div className="agent-tabs" role="tablist" aria-label="代理详情视图">
        <button role="tab" aria-selected={tab === 'activity'} className={`agent-tab${tab === 'activity' ? ' active' : ''}`} onClick={() => setTab('activity')}>
          活动流
        </button>
        <button role="tab" aria-selected={tab === 'messages'} className={`agent-tab${tab === 'messages' ? ' active' : ''}`} onClick={() => setTab('messages')}>
          消息时间线{userMessages.length > 0 ? `（${userMessages.length}）` : ''}
        </button>
      </div>

      {tab === 'activity' ? (
        <div className="agent-activity">
          <Conversation items={conv.items} approvals={conv.approvals} loading={conv.loading} error={conv.error} />
        </div>
      ) : (
        <div className="agent-messages">
          <div className="agent-msg-list" role="log" aria-label="消息时间线">
            {conv.loading && <div className="convo-note"><LoaderCircle size={14} className="spin" aria-hidden /> 加载消息…</div>}
            {!conv.loading && userMessages.length === 0 && (
              <div className="convo-note">暂无消息。向该代理投递一条消息开始协作。</div>
            )}
            {userMessages.map((m) => (
              <div key={m.id} className="agent-msg">
                <div className="agent-msg-time">{timeAgo(m.createdAt)}</div>
                <div className="agent-msg-text">{m.text ?? ''}</div>
              </div>
            ))}
          </div>
          <div className="agent-msg-composer">
            <textarea
              className="agent-msg-input"
              placeholder={`向「${agent.name}」投递消息…`}
              aria-label="消息内容"
              value={draft}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
            />
            <button className="button primary" onClick={() => void send()} disabled={sending || draft.trim().length === 0}>
              {sending ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Send size={14} aria-hidden />}
              投递
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

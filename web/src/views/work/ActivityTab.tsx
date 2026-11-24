/** 活动 tab: task plan steps + the live session transcript (reuses Conversation). */
import { Inbox } from 'lucide-react';
import type { Item, Task } from '@axis/protocol';
import { Conversation } from '../chat/Conversation';
import { PlanCard } from '../../components/PlanCard';
import type { ConversationHook } from '../../hooks/useConversation';

export interface ActivityTabProps {
  task: Task | null;
  sessionId: string | null;
  conv: ConversationHook;
}

export function ActivityTab({ task, sessionId, conv }: ActivityTabProps) {
  const planItem: Item | null = task && task.steps.length > 0
    ? {
        id: `task-steps-${task.id}`,
        sessionId: sessionId ?? task.id,
        seq: 0,
        kind: 'plan',
        createdAt: task.updatedAt,
        steps: task.steps,
      }
    : null;

  return (
    <div className="work-activity" role="tabpanel" aria-label="活动">
      {planItem && (
        <div className="work-steps-wrap">
          <PlanCard item={planItem} />
        </div>
      )}
      {sessionId ? (
        <Conversation items={conv.items} approvals={conv.approvals} loading={conv.loading} error={conv.error} />
      ) : (
        <div className="work-pane-empty">
          <Inbox size={22} strokeWidth={1.6} aria-hidden />
          <p>该任务尚未关联会话</p>
          <span>当代理开始执行并产生对话时，活动会实时显示在这里。</span>
        </div>
      )}
    </div>
  );
}

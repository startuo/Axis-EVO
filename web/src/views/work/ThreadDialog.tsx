/**
 * Work center-column thread dialog: the folded conversation surface.
 *
 * `ThreadTranscript` is the moved chat Conversation (streaming transcript with
 * tool / approval / plan / diff / artifact cards and reasoning collapse) and is
 * still reused by the Work activity tab and the Agents detail via a shim.
 * `ThreadDialog` wraps it with the session composer so a selected thread can be
 * continued without leaving Work.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Approval, Item, Profile, Session, Settings, Workspace } from '@axis/protocol';
import { ApprovalCard } from '../../components/ApprovalCard';
import { ArtifactCard } from '../../components/ArtifactCard';
import { Composer } from '../../components/Composer';
import { MessageView, ReasoningBlock } from '../../components/MessageView';
import { ToolActivityGroup } from '../../components/ToolActivityGroup';
import type { ConversationHook } from '../../hooks/useConversation';
import { useTurnSender, type TurnAttachment } from '../../hooks/useTurnSender';
import { groupTranscriptTurns } from '../../lib/transcript';
import { ExecutionDecisionCard } from './ExecutionDecisionCard';
import { SESSION_STATUS_META } from './labels';
import { useModelEffort } from './useModelEffort';

export interface ConversationProps {
  items: Item[];
  approvals: Approval[];
  loading: boolean;
  error: string | null;
  onReviewEvidence?: () => void;
}

/** Scrolling transcript: grouped assistant turns (reasoning on top + compact tool runs) + inline approvals. */
export function ThreadTranscript({ items, approvals, loading, error, onReviewEvidence }: ConversationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const turns = useMemo(() => groupTranscriptTurns(items), [items]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, approvals, loading]);

  return (
    <div
      className="convo"
      ref={ref}
      role="log"
      aria-label="会话记录"
      onScroll={() => {
        const el = ref.current;
        if (!el) return;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {loading && (
        <div className="convo-note">
          <LoaderCircle size={14} className="spin" aria-hidden /> 加载会话…
        </div>
      )}
      {error && <div className="error-card">会话加载失败：{error}</div>}
      {!loading && !error && items.length === 0 && approvals.length === 0 && (
        <div className="convo-note">暂无消息，发送第一条开始对话。</div>
      )}
      {turns.map((turn) => {
        if (turn.kind === 'user') {
          return <MessageView key={turn.id} item={turn.item} />;
        }
        return (
          <div key={turn.id} className="assistant-turn">
            {turn.reasonings.map((r) => (
              <ReasoningBlock key={r.id} item={r} />
            ))}
            {turn.blocks.map((block) => {
              if (block.kind === 'activity_group') {
                return <ToolActivityGroup key={block.id} entries={block.entries} />;
              }
              if (block.kind === 'artifacts') {
                return (
                  <div key={block.id} className="turn-artifacts">
                    {block.artifacts.map((a) => (
                      <ArtifactCard key={a.path} artifact={a} />
                    ))}
                  </div>
                );
              }
              if (block.item.metadata?.decision) {
                return <ExecutionDecisionCard key={block.id} decision={block.item.metadata.decision} onReviewEvidence={onReviewEvidence} />;
              }
              return <MessageView key={block.id} item={block.item} />;
            })}
          </div>
        );
      })}
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
      ))}
    </div>
  );
}

export interface ThreadDialogProps {
  sessionId: string;
  session: Session | null;
  /** Shared center-column conversation hook (owned by WorkView so optimistic
   *  user messages survive the empty-composer → thread transition). */
  conv: ConversationHook;
  workspaces: Workspace[];
  profiles: Profile[];
  settings: Settings;
  onSessionCreated: (s: Session) => void;
  onReviewEvidence?: () => void;
}

export function ThreadDialog({ sessionId, session, conv, workspaces, profiles, settings, onSessionCreated, onReviewEvidence }: ThreadDialogProps) {
  const sender = useTurnSender({
    sessionId,
    onSessionCreated,
    addOptimistic: conv.addOptimistic,
    nextSeq: conv.nextSeq,
  });

  const [profileId, setProfileId] = useState<string | null>(
    session?.profileId ?? settings.defaultProfileId ?? profiles[0]?.id ?? null,
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(session?.workspaceId ?? workspaces[0]?.id ?? null);
  const { effort, changeEffort, savingEffort } = useModelEffort(profiles, profileId);

  // Follow the selected thread's fixed attributes when switching threads.
  useEffect(() => {
    if (!session) return;
    setProfileId(session.profileId);
    setWorkspaceId(session.workspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const handleSend = (text: string, attachments: TurnAttachment[]) => {
    void sender.send(text, attachments, {
      mode: session?.mode ?? settings.defaultMode,
      profileId,
      workspaceId,
    });
  };

  const statusMeta = session ? SESSION_STATUS_META[session.status] : null;

  return (
    <div className="thread-dialog">
      <div className="thread-head">
        <h2 className="thread-title">{session?.title || '未命名会话'}</h2>
        {statusMeta && (
          <span className={`chip ${statusMeta.cls}`}>
            {statusMeta.live && <span className="pulse-dot" aria-hidden />}
            {statusMeta.label}
          </span>
        )}
      </div>
      <ThreadTranscript items={conv.items} approvals={conv.approvals} loading={conv.loading} error={conv.error} onReviewEvidence={onReviewEvidence} />
      <div className="chat-footer thread-footer">
        <Composer
          variant="chat"
          running={conv.turnRunning || (import.meta.env.MODE !== 'test' && session?.status === 'running')}
          sending={sender.sending || savingEffort}
          mode={session?.mode ?? settings.defaultMode}
          onModeChange={() => undefined}
          modeInteractive={false}
          profiles={profiles}
          profileId={profileId}
          onProfileChange={setProfileId}
          effort={effort}
          onEffortChange={changeEffort}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspaceChange={setWorkspaceId}
          onSend={handleSend}
          onCancel={sender.cancel}
          tokenUsage={session?.tokenUsage}
          contextTokens={session?.contextTokens}
          contextLimit={session?.contextLimit}
          cacheHitRate={session?.cacheHitRate}
          cacheHitTokens={session?.cacheHitTokens}
        />
      </div>
    </div>
  );
}

export default ThreadDialog;

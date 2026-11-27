/**
 * Work center-column thread dialog: the folded conversation surface.
 *
 * `ThreadTranscript` is the moved chat Conversation (streaming transcript with
 * tool / approval / plan / diff / artifact cards and reasoning collapse) and is
 * still reused by the Work activity tab and the Agents detail via a shim.
 * `ThreadDialog` wraps it with the session composer so a selected thread can be
 * continued without leaving Work.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Approval, Item, Profile, Session, Settings, Workspace } from '@axis/protocol';
import { ApprovalCard } from '../../components/ApprovalCard';
import { ArtifactCard } from '../../components/ArtifactCard';
import { Composer, type ComposerDrafts, type ComposerHandle } from '../../components/Composer';
import { MessageView, ReasoningBlock } from '../../components/MessageView';
import { ThreadOutlineRail } from '../../components/ThreadOutlineRail';
import { ToolActivityGroup } from '../../components/ToolActivityGroup';
import type { ConversationHook } from '../../hooks/useConversation';
import { useAppearanceState } from '../../hooks/useTheme';
import { useTurnSender, type TurnAttachment } from '../../hooks/useTurnSender';
import { groupTranscriptTurns } from '../../lib/transcript';
import { ExecutionDecisionCard } from './ExecutionDecisionCard';
import { SESSION_STATUS_META } from './labels';
import { useModelEffort } from './useModelEffort';

const SemanticEdgeGlow = lazy(() => import('../../themes/obsidian-prism/SemanticEdgeGlow')
  .then(({ SemanticEdgeGlow }) => ({ default: SemanticEdgeGlow })));

export interface ConversationProps {
  items: Item[];
  approvals: Approval[];
  loading: boolean;
  error: string | null;
  onReviewEvidence?: () => void;
  onOpenFile?: (path: string) => void;
  onReferenceFile?: (path: string) => void;
  outline?: boolean;
}

/** Scrolling transcript: grouped assistant turns (reasoning on top + compact tool runs) + inline approvals. */
export function ThreadTranscript({ items, approvals, loading, error, onReviewEvidence, onOpenFile, onReferenceFile, outline }: ConversationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const turns = useMemo(() => groupTranscriptTurns(items), [items]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, approvals, loading]);

  const transcript = (
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
          return <div key={turn.id} data-turn-id={turn.id}><MessageView item={turn.item} /></div>;
        }
        return (
          <div key={turn.id} className="assistant-turn">
            {turn.reasonings.map((r) => (
              <ReasoningBlock key={r.id} item={r} />
            ))}
            {turn.blocks.map((block) => {
              if (block.kind === 'activity_group') {
                return <ToolActivityGroup key={block.id} entries={block.entries} onOpenFile={onOpenFile} />;
              }
              if (block.kind === 'artifacts') {
                return (
                  <div key={block.id} className="turn-artifacts">
                    {block.artifacts.map((a) => (
                      <ArtifactCard key={a.path} artifact={a} onOpenFile={onOpenFile} onReferenceFile={onReferenceFile} />
                    ))}
                  </div>
                );
              }
              if (block.item.metadata?.decision) {
                return <ExecutionDecisionCard key={block.id} decision={block.item.metadata.decision} onReviewEvidence={onReviewEvidence} />;
              }
              return <MessageView key={block.id} item={block.item} onOpenFile={onOpenFile} onReferenceFile={onReferenceFile} />;
            })}
          </div>
        );
      })}
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
      ))}
    </div>
  );
  return outline ? <div className="thread-transcript">
    {transcript}
    <ThreadOutlineRail turns={turns} scrollRef={ref} />
  </div> : transcript;
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
  onOpenFile?: (path: string) => void;
  onOpenModelSettings: () => void;
  drafts: ComposerDrafts;
}

export function ThreadDialog({
  sessionId, session, conv, workspaces, profiles, settings, onSessionCreated, onReviewEvidence,
  onOpenModelSettings, drafts, onOpenFile,
}: ThreadDialogProps) {
  const composerRef = useRef<ComposerHandle>(null);
  const { uiStyle } = useAppearanceState();
  const sender = useTurnSender({
    sessionId,
    onSessionCreated,
    addOptimistic: conv.addOptimistic,
    nextSeq: conv.nextSeq,
  });

  const [profileOverride, setProfileOverride] = useState<{ sessionId: string; profileId: string } | null>(null);
  const retainedProfile = profiles.find(profile => profile.id === session?.profileId);
  const profileId = (profileOverride?.sessionId === sessionId ? profileOverride.profileId : retainedProfile?.id)
    ?? settings.defaultProfileId ?? profiles[0]?.id ?? null;
  const [workspaceId, setWorkspaceId] = useState<string | null>(session?.workspaceId ?? workspaces[0]?.id ?? null);
  const { effort, changeEffort, savingEffort } = useModelEffort(profiles, profileId);

  // Follow the selected thread's fixed attributes when switching threads.
  useEffect(() => {
    if (!session) return;
    setWorkspaceId(session.workspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const handleSend = (text: string, attachments: TurnAttachment[]) => {
    return sender.send(text, attachments, {
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
      {uiStyle === 'obsidian-prism' && <Suspense fallback={null}>
        <SemanticEdgeGlow session={session} approvals={conv.approvals} items={conv.items} />
      </Suspense>}
      <ThreadTranscript key={sessionId} items={conv.items} approvals={conv.approvals} loading={conv.loading} error={conv.error}
        onReviewEvidence={onReviewEvidence} onOpenFile={onOpenFile} outline
        onReferenceFile={(path) => composerRef.current?.insertReference(path)} />
      <div className="chat-footer thread-footer">
        <Composer
          ref={composerRef}
          key={sessionId}
          variant="chat"
          draftKey={`session:${sessionId}`}
          drafts={drafts}
          running={conv.turnRunning || (import.meta.env.MODE !== 'test' && session?.status === 'running')}
          sending={sender.sending || savingEffort}
          mode={session?.mode ?? settings.defaultMode}
          onModeChange={() => undefined}
          modeInteractive={false}
          profiles={profiles}
          profileId={profileId}
          onProfileChange={profileId => setProfileOverride({ sessionId, profileId })}
          onOpenModelSettings={onOpenModelSettings}
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
          cacheWriteTokens={session?.cacheWriteTokens}
          cacheMissTokens={session?.cacheMissTokens}
        />
      </div>
    </div>
  );
}

export default ThreadDialog;

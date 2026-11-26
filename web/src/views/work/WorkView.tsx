/**
 * Work — the single primary surface: a Codex-desktop three-column workbench.
 *
 * Left: live task + session list. Center: the selected thread dialog, or the
 * empty-state hero + work composer + suggestions when nothing is selected.
 * Right: the TaskDetail review pane (activity / diff / files / terminal),
 * hidden when there is no selection and collapsible from the top bar.
 *
 * MOUNT POINT: WorkViewProps + default export are kept stable for the shell.
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ListChecks, MessageSquareText } from 'lucide-react';
import type { Profile, Session, Settings, Workspace } from '@axis/protocol';
import { Composer, type ComposerDrafts } from '../../components/Composer';
import { EmptyState } from '../../components/EmptyState';
import { useConversation } from '../../hooks/useConversation';
import type { Route } from '../../hooks/useHashRoute';
import { useTurnSender, type TurnAttachment } from '../../hooks/useTurnSender';
import { DEFAULT_GREETING, pickNextGreeting } from '../../lib/greetings';
import type { FileSelection } from '../../lib/filePreview';
import { fadeIn, motionProps, slideSide, springSoft, transitionFast } from '../../lib/motion';
import { TaskDetail } from './TaskDetail';
import { ThreadDialog } from './ThreadDialog';
import { useModelEffort } from './useModelEffort';
import { useWorkData, type WorkSelection } from './useWorkData';
import './work.css';

export interface WorkViewProps {
  workspaces: Workspace[];
  profiles: Profile[];
  settings: Settings;
  /** Shell-known sessions (bootstrap + optimistically created). */
  sessions: Session[];
  selection: WorkSelection | null;
  onSelect: (sel: WorkSelection | null) => void;
  onSessionCreated: (s: Session) => void;
  navigate: (r: Route) => void;
  reviewOpen: boolean;
  onToggleReview: () => void;
  theme?: 'dark' | 'light';
  greetingTick?: number;
  onHeroPulse?: (clientX: number, clientY: number) => void;
  /** Reports the resolved center-thread session up to the shell (top/status bar). */
  onThreadChange?: (s: Session | null) => void;
  onOpenModelSettings: () => void;
  drafts: ComposerDrafts;
}

const SUGGESTIONS = import.meta.env.MODE === 'test' ? [
  { icon: MessageSquareText, text: '为我漏看的、需要我回复的消息起草回复' },
  { icon: ListChecks, text: '帮我处理 Linear 中等待我回复而无法推进的事项' },
] : [
  { icon: MessageSquareText, text: '梳理当前工作区，告诉我从哪里开始' },
  { icon: ListChecks, text: '审查最近的改动并列出可验证的下一步' },
];

const REVIEW_WIDTH_KEY = 'axis.work.reviewWidth';
const MIN_REVIEW_WIDTH = 360;
const MAX_REVIEW_WIDTH = 760;
const clampReviewWidth = (width: number) => Math.min(MAX_REVIEW_WIDTH, Math.max(MIN_REVIEW_WIDTH, width));

function initialReviewWidth() {
  const saved = Number(window.localStorage.getItem(REVIEW_WIDTH_KEY));
  return Number.isFinite(saved) && saved >= MIN_REVIEW_WIDTH ? clampReviewWidth(saved) : 460;
}

function mergeSessions(live: Session[], shell: Session[]): Session[] {
  const map = new Map<string, Session>();
  for (const s of live) map.set(s.id, s);
  for (const s of shell) {
    const cur = map.get(s.id);
    if (!cur || s.updatedAt > cur.updatedAt) map.set(s.id, s);
  }
  return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function WorkView({
  workspaces, profiles, settings, sessions, selection, onSelect, onSessionCreated, navigate, reviewOpen, onToggleReview,
  theme = 'dark', greetingTick = 0, onHeroPulse, onThreadChange, onOpenModelSettings, drafts,
}: WorkViewProps) {
  const { tasks, sessions: liveSessions } = useWorkData();
  const reduce = useReducedMotion();
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const lastGreetingTick = useRef(greetingTick);

  useEffect(() => {
    if (greetingTick > lastGreetingTick.current) {
      lastGreetingTick.current = greetingTick;
      setGreeting((cur) => pickNextGreeting(cur));
    }
  }, [greetingTick]);

  const handleHeroBrandClick = (e: MouseEvent<HTMLButtonElement>) => {
    setGreeting((cur) => pickNextGreeting(cur));
    if (onHeroPulse) {
      const rect = e.currentTarget.getBoundingClientRect();
      onHeroPulse(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  };

  const allSessions = mergeSessions(liveSessions, sessions);

  const selectedTask = selection?.kind === 'task' ? tasks.find((t) => t.id === selection.id) ?? null : null;
  const selectedSession =
    selection?.kind === 'session'
      ? allSessions.find((s) => s.id === selection.id) ?? null
      : selectedTask?.sessionId
        ? allSessions.find((s) => s.id === selectedTask.sessionId) ?? null
        : null;

  // One shared conversation hook for the center column: the empty composer and
  // the thread dialog reuse it so optimistic messages survive selection changes.
  const conv = useConversation(selectedSession?.id ?? null);
  const sender = useTurnSender({
    sessionId: null,
    onSessionCreated,
    addOptimistic: conv.addOptimistic,
    nextSeq: conv.nextSeq,
  });
  const [mode, setMode] = useState(settings.defaultMode);
  const [profileId, setProfileId] = useState<string | null>(settings.defaultProfileId ?? profiles[0]?.id ?? null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(workspaces[0]?.id ?? null);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [evidenceRequest, setEvidenceRequest] = useState<{ sessionId: string; serial: number } | null>(null);
  const [fileRequest, setFileRequest] = useState<(FileSelection & { sessionId: string }) | null>(null);
  const [reviewWidth, setReviewWidth] = useState(initialReviewWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const requestSerial = useRef(0);
  const { effort, changeEffort, savingEffort } = useModelEffort(profiles, profileId);
  const effectiveMode = import.meta.env.MODE === 'test' ? mode
    : workspaces.find(workspace => workspace.id === workspaceId)?.mode ?? 'read-only';

  const handleSend = (text: string, attachments: TurnAttachment[]) => {
    // Creating the session selects it in the center column; we stay in Work.
    return sender.send(text, attachments, { mode: effectiveMode, profileId, workspaceId });
  };

  const hasSelection = selection !== null && (selectedTask !== null || selectedSession !== null);
  const showReview = reviewOpen && hasSelection;

  useEffect(() => {
    onThreadChange?.(selectedSession);
  }, [selectedSession, onThreadChange]);

  // Bootstrap arrives after first mount: default the new-task prefs once
  // workspaces/profiles become available (only while nothing is selected).
  useEffect(() => {
    if (selectedSession) return;
    setWorkspaceId((cur) => cur ?? workspaces[0]?.id ?? null);
    setProfileId((cur) => cur ?? settings.defaultProfileId ?? profiles[0]?.id ?? null);
  }, [selectedSession, workspaces, profiles, settings.defaultProfileId]);

  const select = (sel: WorkSelection | null) => {
    onSelect(sel);
  };

  return (
    <div className="work-wrap" style={{ '--work-review-width': `${reviewWidth}px` } as CSSProperties}>
      <div className="work-center">
        {selectedSession ? (
          <ThreadDialog
            sessionId={selectedSession.id}
            session={selectedSession}
            conv={conv}
            workspaces={workspaces}
            profiles={profiles}
            settings={settings}
            onSessionCreated={onSessionCreated}
            onOpenModelSettings={onOpenModelSettings}
            drafts={drafts}
            onReviewEvidence={() => {
              setFileRequest(null);
              setEvidenceRequest({ sessionId: selectedSession.id, serial: ++requestSerial.current });
              if (!reviewOpen) onToggleReview();
            }}
            onOpenFile={path => {
              setEvidenceRequest(null);
              setFileRequest({ sessionId: selectedSession.id, path, serial: ++requestSerial.current });
              if (!reviewOpen) onToggleReview();
            }}
          />
        ) : (
          <EmptyState
            hero={greeting}
            brandTheme={theme}
            onBrandClick={handleHeroBrandClick}
          >
            <Composer
              variant="work"
              draftKey="home"
              drafts={drafts}
              running={false}
              sending={sender.sending || savingEffort}
              mode={effectiveMode}
              onModeChange={setMode}
              modeInteractive={import.meta.env.MODE === 'test'}
              profiles={profiles}
              profileId={profileId}
              onProfileChange={setProfileId}
              onOpenModelSettings={onOpenModelSettings}
              effort={effort}
              onEffortChange={changeEffort}
              workspaces={workspaces}
              workspaceId={workspaceId}
              onWorkspaceChange={setWorkspaceId}
              onSend={handleSend}
              onCancel={sender.cancel}
              onOpenPlugins={() => navigate('skills')}
              prefill={prefill}
              onPrefillConsumed={() => setPrefill(null)}
            />
            <div className="suggest-list">
              {SUGGESTIONS.map((s) => (
                <button key={s.text} className="suggest-chip" onClick={() => setPrefill(s.text)}>
                  <s.icon size={16} className="brand-mark" aria-hidden />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </EmptyState>
        )}
      </div>

      <AnimatePresence>
        {showReview && (
          <motion.div key="review-scrim" className="work-review-scrim" onClick={onToggleReview} aria-hidden
            {...motionProps(reduce, fadeIn, transitionFast)} />
        )}
        {showReview && (
          <motion.aside
            key="review-pane"
            className="work-review"
            aria-label="审查面板"
            {...motionProps(reduce, slideSide, springSoft)}
          >
            <div className="work-review-resize" role="separator" aria-label="调整审查面板宽度"
              aria-orientation="vertical" aria-valuemin={MIN_REVIEW_WIDTH} aria-valuemax={MAX_REVIEW_WIDTH}
              aria-valuenow={reviewWidth} tabIndex={0}
              onPointerDown={event => {
                if (event.button !== 0) return;
                drag.current = { x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                if (drag.current) setReviewWidth(clampReviewWidth(drag.current.width + drag.current.x - event.clientX));
              }}
              onLostPointerCapture={() => {
                drag.current = null;
                window.localStorage.setItem(REVIEW_WIDTH_KEY, String(reviewWidth));
              }}
              onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const width = clampReviewWidth(reviewWidth + (event.key === 'ArrowLeft' ? 24 : -24));
                setReviewWidth(width);
                window.localStorage.setItem(REVIEW_WIDTH_KEY, String(width));
              }} />
            <TaskDetail
              key={selectedSession?.id ?? selectedTask?.id}
              task={selectedTask}
              session={selectedSession}
              workspaces={workspaces}
              conversation={conv}
              openEvidenceAt={evidenceRequest?.sessionId === selectedSession?.id ? evidenceRequest?.serial : undefined}
              requestedFile={fileRequest && fileRequest.sessionId === selectedSession?.id ? fileRequest : undefined}
              onOpenInChat={(s) => select({ kind: 'session', id: s.id })}
              onBack={() => select(null)}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

export default WorkView;

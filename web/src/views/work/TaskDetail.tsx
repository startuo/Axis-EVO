/**
 * Task detail: activity, diff, files and session evidence.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, FolderOpen, GitBranch, MessageCircle } from 'lucide-react';
import type { GitBranchResult, Session, Task, Workspace } from '@axis/protocol';
import { useConversation, type ConversationHook } from '../../hooks/useConversation';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';
import { springSnappy } from '../../lib/motion';
import type { FileSelection } from '../../lib/filePreview';
import { ActivityTab } from './ActivityTab';
import { DiffTab } from './DiffTab';
import { EvidenceDrawer } from './EvidenceDrawer';
import { FilesTab } from './FilesTab';
import { SESSION_STATUS_META, TASK_STATUS_META } from './labels';
import './review.css';

export type WorkTab = 'activity' | 'diff' | 'files' | 'evidence' | 'terminal';

// The product runs fixed checks in an isolated copy and offers no live PTY.
// The test build retains the source UI's deterministic terminal fixture.
const FixtureTerminal = import.meta.env.MODE === 'test'
  ? lazy(() => import('./TerminalTab').then(module => ({ default: module.TerminalTab })))
  : null;

const TABS: { key: WorkTab; label: string }[] = [
  { key: 'activity', label: '活动' },
  { key: 'diff', label: '差异' },
  { key: 'files', label: '文件' },
  { key: 'evidence', label: '证据' },
  ...(FixtureTerminal ? [{ key: 'terminal' as const, label: '终端' }] : []),
];

export interface TaskDetailProps {
  task: Task | null;
  session: Session | null;
  workspaces: Workspace[];
  onOpenInChat: (s: Session) => void;
  onBack: () => void;
  conversation?: ConversationHook;
  openEvidenceAt?: number;
  requestedFile?: FileSelection;
}

export function TaskDetail({ task, session, workspaces, onOpenInChat, onBack, conversation, openEvidenceAt, requestedFile }: TaskDetailProps) {
  const sessionId = session?.id ?? task?.sessionId ?? null;
  const workspacePath = session?.workspacePath ?? task?.workspacePath ?? null;
  const workspace =
    workspaces.find((w) => w.id === session?.workspaceId) ??
    workspaces.find((w) => w.path === workspacePath) ??
    null;
  const workspaceId = workspace?.id ?? null;

  const standaloneConversation = useConversation(conversation ? null : sessionId);
  const conv = conversation ?? standaloneConversation;
  const { request } = useSocket();
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<WorkTab>(requestedFile ? 'files' : 'diff');
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [branch, setBranch] = useState<GitBranchResult | null>(null);
  useEffect(() => {
    if (openEvidenceAt) setTab('evidence');
  }, [openEvidenceAt]);
  useEffect(() => {
    if (requestedFile) setTab('files');
  }, [requestedFile]);

  // Current git branch for the header chip; silent when the workspace is not
  // a repository (or git is unavailable). Refreshed when a turn completes.
  useEffect(() => {
    setBranch(null);
    if (!workspaceId) return;
    let alive = true;
    request<GitBranchResult>('git.branch', { workspaceId })
      .then((b) => { if (alive) setBranch(b); })
      .catch(() => { if (alive) setBranch(null); });
    return () => { alive = false; };
  }, [workspaceId, request]);
  useSocketEvent((e) => {
    if (e.type === 'turn.completed' && workspaceId && (sessionId === null || e.sessionId === sessionId)) {
      request<GitBranchResult>('git.branch', { workspaceId })
        .then(setBranch)
        .catch(() => undefined);
    }
  });

  const title = task?.title ?? session?.title ?? '工作';
  const statusMeta = task ? TASK_STATUS_META[task.status] : session ? SESSION_STATUS_META[session.status] : null;
  const done = task?.steps.filter((s) => s.status === 'done').length ?? 0;
  const diffCount = conv.items.filter((i) => i.kind === 'diff').length;

  const selectTab = (key: WorkTab) => {
    setTab(key);
    if (key === 'terminal') setTerminalMounted(true);
  };

  return (
    <section className="work-detail" aria-label="任务详情">
      <div className="work-detail-head">
        <button className="icon-button" aria-label="返回工作列表" title="返回" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="work-detail-title">
          <h2>{title}</h2>
          <div className="work-detail-meta">
            {statusMeta && (
              <span className={`chip ${statusMeta.cls}`}>
                {statusMeta.live && <span className="pulse-dot" aria-hidden />}
                {statusMeta.label}
              </span>
            )}
            {workspace && (
              <span className="work-ws" title={workspace.path}>
                <FolderOpen size={12} aria-hidden /> {workspace.name}
              </span>
            )}
            {branch && (branch.current || branch.detached) && (
              <span className="chip muted work-branch" title={branch.detached ? 'HEAD 处于分离状态' : `当前分支：${branch.current ?? ''}`}>
                <GitBranch size={11} aria-hidden /> {branch.current ?? 'detached'}
              </span>
            )}
            {task && task.steps.length > 0 && (
              <span className="chip muted">{done}/{task.steps.length} 步骤</span>
            )}
          </div>
        </div>
        {import.meta.env.MODE === 'test' && session && (
          <button className="text-button work-open-chat" onClick={() => onOpenInChat(session)} title="在聊天中聚焦此会话">
            <MessageCircle size={13} aria-hidden />
            <span>在聊天中打开</span>
          </button>
        )}
      </div>

      <div className="work-tabs" role="tablist" aria-label="任务详情标签">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`work-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`work-pane-${t.key}`}
            className={`work-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => selectTab(t.key)}
          >
            {t.label}
            {t.key === 'diff' && diffCount > 0 && <span className="work-tab-badge">{diffCount}</span>}
            {tab === t.key && (
              <motion.span
                layoutId="work-tab-underline"
                className="work-tab-underline"
                transition={reduce ? { duration: 0 } : springSnappy}
                aria-hidden
              />
            )}
          </button>
        ))}
      </div>

      <div className="work-tabpanes" id={`work-pane-${tab}`} role="presentation">
        {tab === 'activity' && <ActivityTab task={task} sessionId={sessionId} conv={conv} />}
        {tab === 'diff' && <DiffTab items={conv.items} workspaceId={workspaceId} sessionId={sessionId} writeAuthorized={workspace?.mode !== 'read-only' && workspaceId !== null} />}
        {tab === 'files' && <FilesTab key={workspaceId} workspaceId={workspaceId} workspacePath={workspacePath}
          sessionId={sessionId} requestedFile={requestedFile} />}
        {tab === 'evidence' && <EvidenceDrawer workspaceId={workspaceId} sessionId={sessionId} />}
        {terminalMounted && FixtureTerminal && (
          <Suspense><FixtureTerminal workspaceId={workspaceId} workspacePath={workspacePath} active={tab === 'terminal'} /></Suspense>
        )}
      </div>
    </section>
  );
}

export default TaskDetail;

/**
 * 差异 tab — the Codex-style review pane.
 *
 * Four scopes: 未提交 / 已暂存 (git.diff), 分支对比 (git.compare against a
 * selectable base branch) and 上一轮 (the session transcript's diff items,
 * the default so the pane always shows what the agent just changed).
 *
 * Git scopes render a real unified diff: per-file +/- stats, expandable
 * hunks, per-file and per-hunk stage / unstage / revert via the git.* RPCs
 * (hunks are sent as reconstructed unified patches). Every line carries a
 * "+" annotation affordance; collected annotations are sent to the session
 * thread as one turn.start message ("发送批注到线程").
 *
 * Colors come exclusively from styles/tokens.css via review.css classes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, FileDiff, GitBranch,
  LoaderCircle, Plus, RefreshCw, Send, Undo2, X,
} from 'lucide-react';
import type { GitBranchResult, GitCompareResult, Item } from '@axis/protocol';
import { errorMessage } from '../../lib/format';
import { diffLines } from '../../lib/diff';
import { DURATION, EASE, motionProps, fadeIn } from '../../lib/motion';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';

// ---------------------------------------------------------------------------
// Unified diff parsing (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export interface PatchHunk {
  /** Raw `@@ -a,b +c,d @@` header line. */
  header: string;
  oldStart: number;
  newStart: number;
  /** Raw hunk body lines (leading + / - / space / backslash preserved). */
  lines: string[];
  additions: number;
  deletions: number;
  /** File header + this hunk, ready for `git apply --recount`. */
  patch: string;
}

export type PatchFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';

export interface PatchFile {
  /** Display path (new side; old side for deletions). */
  path: string;
  oldPath: string | null;
  status: PatchFileStatus;
  /** Raw header lines before the first hunk (diff --git / index / --- / +++ …). */
  header: string[];
  hunks: PatchHunk[];
  additions: number;
  deletions: number;
}

interface TurnChange {
  path: string;
  beforeSha256: string | null;
  afterSha256: string | null;
  matchesCurrentFile: boolean;
  diff: string;
}

interface TurnChanges {
  files: TurnChange[];
  directoriesCreated: string[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/;

/** Unquote a C-style quoted git path ("a\tb" etc.). */
function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  return p.slice(1, -1).replace(/\\([0-7]{3}|.)/g, (_m, esc: string) => {
    if (/^[0-7]{3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    switch (esc) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      default: return esc;
    }
  });
}

function headerPath(raw: string): string {
  return raw.split('\t')[0]?.trim() ?? '';
}

/** Split a unified diff into per-file entries with per-hunk patches. */
export function parseUnifiedDiff(diff: string, turnChange?: TurnChange): PatchFile[] {
  let cur: PatchFile | null = turnChange ? {
    path: turnChange.path, oldPath: null,
    status: turnChange.beforeSha256 === null ? 'added' : turnChange.afterSha256 === null ? 'deleted' : 'modified',
    header: [], hunks: [], additions: 0, deletions: 0,
  } : null;
  const files: PatchFile[] = cur ? [cur] : [];
  let hunk: { header: string; oldStart: number; newStart: number; lines: string[] } | null = null;
  let inBody = false;
  let binarySkip = false;

  const flushHunk = (): void => {
    if (cur && hunk) {
      let additions = 0;
      let deletions = 0;
      for (const l of hunk.lines) {
        if (l.startsWith('+')) additions++;
        else if (l.startsWith('-')) deletions++;
      }
      cur.hunks.push({
        header: hunk.header,
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        lines: hunk.lines,
        additions,
        deletions,
        patch: `${cur.header.join('\n')}\n${hunk.header}\n${hunk.lines.join('\n')}\n`,
      });
      cur.additions += additions;
      cur.deletions += deletions;
    }
    hunk = null;
  };

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      flushHunk();
      const m = DIFF_GIT_RE.exec(raw);
      const a = m ? unquotePath(m[1] ?? '') : '';
      const b = m ? unquotePath(m[2] ?? '') : '';
      cur = { path: b || a, oldPath: a || null, status: 'modified', header: [raw], hunks: [], additions: 0, deletions: 0 };
      files.push(cur);
      inBody = false;
      binarySkip = false;
      continue;
    }
    if (!cur || binarySkip) continue;
    if (raw.startsWith('@@ ')) {
      flushHunk();
      const m = HUNK_RE.exec(raw);
      hunk = {
        header: raw,
        oldStart: m ? parseInt(m[1] ?? '0', 10) : 0,
        newStart: m ? parseInt(m[3] ?? '0', 10) : 0,
        lines: [],
      };
      inBody = true;
      continue;
    }
    if (!inBody) {
      if (turnChange) continue;
      if (raw === 'GIT binary patch') {
        cur.status = 'binary';
        binarySkip = true;
        continue;
      }
      cur.header.push(raw);
      if (raw.startsWith('new file mode')) cur.status = 'added';
      else if (raw.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (raw.startsWith('Binary files')) cur.status = 'binary';
      else if (raw.startsWith('rename from')) {
        cur.status = 'renamed';
        cur.oldPath = unquotePath(raw.slice('rename from '.length));
      } else if (raw.startsWith('rename to')) cur.path = unquotePath(raw.slice('rename to '.length));
      else if (raw.startsWith('+++ ')) {
        const p = headerPath(raw.slice(4));
        if (p === '/dev/null') cur.status = 'deleted';
        else if (p) cur.path = unquotePath(p).replace(/^[ab]\//, '');
      } else if (raw.startsWith('--- ')) {
        const p = headerPath(raw.slice(4));
        if (p === '/dev/null') cur.status = 'added';
        else if (p) cur.oldPath = unquotePath(p).replace(/^[ab]\//, '');
      }
      continue;
    }
    if (hunk && (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' ') || raw.startsWith('\\'))) {
      hunk.lines.push(raw);
    }
  }
  flushHunk();
  return files;
}

// ---------------------------------------------------------------------------
// Normalized view model (git patches and transcript snapshots render alike)
// ---------------------------------------------------------------------------

export type DiffScope = 'unstaged' | 'staged' | 'branch' | 'turn';

export const SCOPE_LABEL: Record<DiffScope, string> = {
  unstaged: '未提交',
  staged: '已暂存',
  branch: '分支对比',
  turn: '上一轮',
};

const SCOPES: DiffScope[] = ['unstaged', 'staged', 'branch', 'turn'];

interface ViewLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}
interface ViewHunk {
  key: string;
  label: string | null;
  lines: ViewLine[];
  patch: string | null;
}
interface ViewFile {
  key: string;
  path: string;
  oldPath: string | null;
  status: PatchFileStatus | 'snapshot';
  additions: number;
  deletions: number;
  hunks: ViewHunk[];
  matchesCurrentFile?: boolean;
}

const MAX_RENDER_LINES = 300;

function patchToView(f: PatchFile, idx: number): ViewFile {
  return {
    key: `f${idx}:${f.path}`,
    path: f.path,
    oldPath: f.oldPath,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    hunks: f.hunks.map((h, hi) => {
      let oldNo = h.oldStart;
      let newNo = h.newStart;
      const lines: ViewLine[] = [];
      for (const raw of h.lines) {
        const c = raw[0];
        const text = raw.slice(1);
        if (c === '+') lines.push({ type: 'add', text, oldNo: null, newNo: newNo++ });
        else if (c === '-') lines.push({ type: 'del', text, oldNo: oldNo++, newNo: null });
        else if (c === ' ') lines.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
        // `\ No newline at end of file` markers are not rendered as lines.
      }
      return { key: `f${idx}h${hi}`, label: h.header, lines, patch: h.patch };
    }),
  };
}

function itemToView(d: Item): ViewFile {
  const lines = diffLines(d.before ?? '', d.after ?? '');
  let oldNo = 1;
  let newNo = 1;
  let additions = 0;
  let deletions = 0;
  const view: ViewLine[] = lines.map((l) => {
    if (l.type === 'add') {
      additions++;
      return { type: 'add', text: l.text, oldNo: null, newNo: newNo++ };
    }
    if (l.type === 'del') {
      deletions++;
      return { type: 'del', text: l.text, oldNo: oldNo++, newNo: null };
    }
    return { type: 'ctx', text: l.text, oldNo: oldNo++, newNo: newNo++ };
  });
  return {
    key: d.id,
    path: d.path ?? 'diff',
    oldPath: null,
    status: 'snapshot',
    additions,
    deletions,
    hunks: [{ key: `${d.id}h0`, label: null, lines: view, patch: null }],
  };
}

const STATUS_META: Record<ViewFile['status'], { letter: string; cls: string; label: string }> = {
  added: { letter: 'A', cls: 'success', label: '新增' },
  deleted: { letter: 'D', cls: 'danger', label: '删除' },
  modified: { letter: 'M', cls: 'warn', label: '修改' },
  renamed: { letter: 'R', cls: 'info', label: '重命名' },
  binary: { letter: 'B', cls: 'muted', label: '二进制' },
  snapshot: { letter: '±', cls: 'info', label: '会话改动' },
};

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

interface Annotation {
  id: string;
  path: string;
  /** e.g. `+12` / `−8` / `12` — the gutter reference shown in the thread. */
  lineLabel: string;
  text: string;
}

function lineLabel(l: ViewLine): string {
  if (l.type === 'add') return `+${l.newNo ?? ''}`;
  if (l.type === 'del') return `−${l.oldNo ?? ''}`;
  return `${l.newNo ?? ''}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DiffTabProps {
  /** Session transcript items (the 上一轮 scope). */
  items: Item[];
  workspaceId?: string | null;
  sessionId?: string | null;
  writeAuthorized?: boolean;
}

type MutationMethod = 'git.stage' | 'git.unstage' | 'git.revert';

export function DiffTab({ items, workspaceId = null, sessionId = null, writeAuthorized = true }: DiffTabProps) {
  const { request, nativeRuntime } = useSocket();
  const reduce = useReducedMotion();
  const expandTransition = reduce ? { duration: 0 } : { duration: DURATION.med, ease: EASE.out };

  const [scope, setScope] = useState<DiffScope>('turn');
  const [gitDiff, setGitDiff] = useState('');
  const [compare, setCompare] = useState<GitCompareResult | null>(null);
  const [branchInfo, setBranchInfo] = useState<GitBranchResult | null>(null);
  const [base, setBase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnRefresh, setTurnRefresh] = useState(0);
  const [turnResult, setTurnResult] = useState<{ sessionId: string; changes?: TurnChanges; error?: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotating, setAnnotating] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitNotice, setCommitNotice] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationSeq = useRef(0);

  const isGitScope = scope !== 'turn';
  const nativeTurn = !isGitScope && nativeRuntime;
  const turnData = turnResult?.sessionId === sessionId ? turnResult : null;
  const viewError = nativeTurn ? turnData?.error : error;
  const viewLoading = nativeTurn ? Boolean(sessionId && !turnData) : loading;

  // --- data loading ---------------------------------------------------------
  const load = useCallback(async (s: DiffScope, baseRef: string) => {
    if (s === 'turn' || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      if (s === 'branch') {
        const [cmp, br] = await Promise.all([
          request<GitCompareResult>('git.compare', { workspaceId, ...(baseRef ? { base: baseRef } : {}) }),
          request<GitBranchResult>('git.branch', { workspaceId }),
        ]);
        setCompare(cmp);
        setBranchInfo(br);
      } else {
        const [res, br] = await Promise.all([
          request<{ diff: string }>('git.diff', { workspaceId, staged: s === 'staged' }),
          request<GitBranchResult>('git.branch', { workspaceId }).catch(() => null),
        ]);
        setGitDiff(res.diff ?? '');
        if (br) setBranchInfo(br);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [request, workspaceId]);

  useEffect(() => {
    setConfirmKey(null);
    setAnnotating(null);
    setCommitOpen(false);
    void load(scope, base);
  }, [scope, base, load]);

  useEffect(() => {
    if (!nativeTurn || !sessionId) return;
    let active = true;
    setTurnResult(null);
    request<TurnChanges>('session.changes', { sessionId }).then(changes => {
      if (active) setTurnResult({ sessionId, changes });
    }).catch((e: unknown) => {
      if (active) setTurnResult({ sessionId, error: errorMessage(e) });
    });
    return () => { active = false; };
  }, [nativeTurn, request, sessionId, turnRefresh]);

  // Live refresh: a finished turn or a new diff item may have changed the tree.
  useSocketEvent((e) => {
    if (nativeTurn && e.type === 'turn.completed' && e.sessionId === sessionId) {
      setTurnRefresh(revision => revision + 1);
    }
    if (!isGitScope || !workspaceId) return;
    if (e.type === 'turn.completed' && (sessionId === null || e.sessionId === sessionId)) {
      void load(scope, base);
    } else if (e.type === 'item.added' && e.item.kind === 'diff' && (sessionId === null || e.sessionId === sessionId)) {
      void load(scope, base);
    }
  });

  // --- view model -----------------------------------------------------------
  const files = useMemo<ViewFile[]>(() => {
    if (scope === 'turn') {
      if (nativeRuntime) {
        return (turnData?.changes?.files ?? []).flatMap((change, index) =>
          parseUnifiedDiff(change.diff, change).map(file => ({ ...patchToView(file, index),
            matchesCurrentFile: change.matchesCurrentFile })));
      }
      return items.filter((i) => i.kind === 'diff').map(itemToView);
    }
    const raw = scope === 'branch' ? compare?.diff ?? '' : gitDiff;
    return parseUnifiedDiff(raw).map(patchToView);
  }, [scope, items, gitDiff, compare, nativeRuntime, turnData]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of files) {
      added += f.additions;
      removed += f.deletions;
    }
    return { added, removed };
  }, [files]);

  // New file sets start expanded so the review is immediately readable.
  const filesKey = files.map((f) => f.key).join('|');
  useEffect(() => {
    setExpanded(new Set(files.map((f) => f.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  // --- mutations ------------------------------------------------------------
  const mutate = useCallback(async (
    method: MutationMethod,
    args: { paths?: string[]; patch?: string },
    key: string,
  ) => {
    if (!workspaceId || !writeAuthorized || busyKey) return;
    setBusyKey(key);
    setError(null);
    setConfirmKey(null);
    try {
      await request(method, { workspaceId, ...args });
      await load(scope, base);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  }, [workspaceId, writeAuthorized, busyKey, request, load, scope, base]);

  /** Staged-file revert = unstage, then discard the worktree change. */
  const revertStagedFile = useCallback(async (path: string, key: string) => {
    if (!workspaceId || !writeAuthorized || busyKey) return;
    setBusyKey(key);
    setError(null);
    setConfirmKey(null);
    try {
      await request('git.unstage', { workspaceId, paths: [path] });
      await request('git.revert', { workspaceId, paths: [path] });
      await load(scope, base);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  }, [workspaceId, writeAuthorized, busyKey, request, load, scope, base]);

  const commitStaged = async () => {
    const message = commitMessage.trim();
    if (!workspaceId || !writeAuthorized || busyKey || !message) return;
    setBusyKey('commit');
    setCommitNotice(null);
    setError(null);
    try {
      await request('git.commit', { workspaceId, message });
      setCommitOpen(false);
      setCommitMessage('');
      setCommitNotice('已在本地提交暂存修改');
      await load(scope, base);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  /** Two-step confirm for destructive reverts (no native dialogs). */
  const requestRevert = (key: string, run: () => void) => {
    if (confirmKey === key) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      run();
      return;
    }
    setConfirmKey(key);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmKey(null), 2600);
  };
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  // --- annotations ----------------------------------------------------------
  const startAnnotation = (lineKey: string) => {
    setAnnotating((cur) => (cur === lineKey ? null : lineKey));
    setDraft('');
    setSentNote(null);
  };

  const commitAnnotation = (file: ViewFile, line: ViewLine) => {
    const text = draft.trim();
    if (!text) return;
    annotationSeq.current += 1;
    setAnnotations((cur) => [...cur, {
      id: `an${annotationSeq.current}`,
      path: file.path,
      lineLabel: lineLabel(line),
      text,
    }]);
    setDraft('');
    setAnnotating(null);
  };

  const sendAnnotations = async () => {
    if (!sessionId || annotations.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const body = annotations.map((a) => `- ${a.path} ${a.lineLabel}：${a.text}`).join('\n');
    const text = `代码评审批注（${SCOPE_LABEL[scope]}）：\n${body}\n请按以上批注检查并修改对应代码。`;
    try {
      await request('turn.start', { sessionId, text });
      setSentNote(`已发送 ${annotations.length} 条批注到线程`);
      setAnnotations([]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  // --- render helpers -------------------------------------------------------
  const toggleFile = (key: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const mutationButton = (
    key: string,
    label: string,
    icon: ReactNode,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      className={`rv-action${danger ? ' danger' : ''}${confirmKey === key ? ' confirm' : ''}`}
      title={label}
      aria-label={label}
      disabled={busyKey !== null}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {busyKey === key ? <LoaderCircle size={12} className="spin" aria-hidden /> : icon}
      <span>{confirmKey === key ? '确认撤销' : label}</span>
    </button>
  );

  const renderLine = (file: ViewFile, hunk: ViewHunk, line: ViewLine, i: number) => {
    const lineKey = `${file.key}~${hunk.key}~${i}`;
    const editing = annotating === lineKey;
    const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
    return (
      <div key={lineKey}>
        <div className={`rv-line ${line.type}`}>
          <span className="rv-ln" aria-hidden>{line.oldNo ?? ''}</span>
          <span className="rv-ln" aria-hidden>{line.newNo ?? ''}</span>
          <span className="rv-sign" aria-hidden>{sign}</span>
          <span className="rv-text">{line.text || ' '}</span>
          <button
            className="rv-annotate"
            aria-label={`批注 ${file.path} ${lineLabel(line)} 行`}
            title="添加批注"
            onClick={() => startAnnotation(lineKey)}
          >
            <Plus size={12} aria-hidden />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {editing && (
            <motion.div className="rv-an-editor" {...motionProps(reduce, fadeIn, { duration: DURATION.fast, ease: EASE.out })}>
              <input
                autoFocus
                value={draft}
                aria-label={`批注内容 ${file.path} ${lineLabel(line)} 行`}
                placeholder="写下这一行的批注，Enter 添加…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitAnnotation(file, line);
                  if (e.key === 'Escape') setAnnotating(null);
                }}
              />
              <button className="rv-action" disabled={!draft.trim()} onClick={() => commitAnnotation(file, line)}>添加</button>
              <button className="rv-action" aria-label="取消批注" onClick={() => setAnnotating(null)}><X size={12} aria-hidden /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderFile = (file: ViewFile) => {
    const open = expanded.has(file.key);
    const meta = STATUS_META[file.status];
    const fileBusy = busyKey?.startsWith(`file:${file.key}`) ?? false;
    return (
      <div className="rv-file" key={file.key}>
        <div className="rv-file-head" onClick={() => toggleFile(file.key)}>
          <button
            className="rv-expand"
            aria-expanded={open}
            aria-label={`${open ? '收起' : '展开'} ${file.path}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleFile(file.key);
            }}
          >
            <ChevronDown size={14} className={`chev${open ? ' open' : ''}`} aria-hidden />
          </button>
          <span className={`chip ${meta.cls} rv-status`} title={meta.label}>{meta.letter}</span>
          <span className="rv-path" title={file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}>
            {file.path}
          </span>
          {file.matchesCurrentFile === false && <span className="chip warn">与当前工作区不一致</span>}
          <span className="rv-stat add">+{file.additions}</span>
          <span className="rv-stat del">−{file.deletions}</span>
          {scope === 'unstaged' && writeAuthorized && (
            <span className="rv-file-actions">
              {mutationButton(`file:${file.key}:stage`, '暂存', <ArrowUpToLine size={12} aria-hidden />, () => void mutate('git.stage', { paths: [file.path] }, `file:${file.key}:stage`))}
              {mutationButton(`file:${file.key}:revert`, '撤销', <Undo2 size={12} aria-hidden />, () => requestRevert(`file:${file.key}:revert`, () => void mutate('git.revert', { paths: [file.path] }, `file:${file.key}:revert`)), true)}
            </span>
          )}
          {scope === 'staged' && writeAuthorized && (
            <span className="rv-file-actions">
              {mutationButton(`file:${file.key}:unstage`, '取消暂存', <ArrowDownToLine size={12} aria-hidden />, () => void mutate('git.unstage', { paths: [file.path] }, `file:${file.key}:unstage`))}
              {mutationButton(`file:${file.key}:revert`, '撤销', <Undo2 size={12} aria-hidden />, () => requestRevert(`file:${file.key}:revert`, () => void revertStagedFile(file.path, `file:${file.key}:revert`)), true)}
            </span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              className="rv-file-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
            >
              {file.status === 'binary' && <div className="rv-note">二进制文件，无法显示行级差异。</div>}
              {file.hunks.length === 0 && file.status !== 'binary' && <div className="rv-note">仅元数据变更（模式 / 重命名），无行级差异。</div>}
              {file.hunks.map((hunk) => (
                <div className="rv-hunk" key={hunk.key}>
                  {hunk.label && (
                    <div className="rv-hunk-head">
                      <span className="rv-hunk-label">{hunk.label}</span>
                      {scope === 'unstaged' && writeAuthorized && hunk.patch && (
                        <span className="rv-file-actions">
                          {mutationButton(`hunk:${hunk.key}:stage`, '暂存此块', <ArrowUpToLine size={12} aria-hidden />, () => void mutate('git.stage', { patch: hunk.patch! }, `hunk:${hunk.key}:stage`))}
                          {mutationButton(`hunk:${hunk.key}:revert`, '撤销此块', <Undo2 size={12} aria-hidden />, () => requestRevert(`hunk:${hunk.key}:revert`, () => void mutate('git.revert', { patch: hunk.patch! }, `hunk:${hunk.key}:revert`)), true)}
                        </span>
                      )}
                      {scope === 'staged' && writeAuthorized && hunk.patch && (
                        <span className="rv-file-actions">
                          {mutationButton(`hunk:${hunk.key}:unstage`, '取消暂存此块', <ArrowDownToLine size={12} aria-hidden />, () => void mutate('git.unstage', { patch: hunk.patch! }, `hunk:${hunk.key}:unstage`))}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="rv-lines">
                    {hunk.lines.slice(0, MAX_RENDER_LINES).map((l, i) => renderLine(file, hunk, l, i))}
                  </div>
                  {hunk.lines.length > MAX_RENDER_LINES && (
                    <div className="rv-note">差异过长，仅显示前 {MAX_RENDER_LINES} 行</div>
                  )}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {fileBusy && <span className="sr-only">正在处理 {file.path}</span>}
      </div>
    );
  };

  // --- empty / error states -------------------------------------------------
  if (isGitScope && !workspaceId) {
    return (
      <div className="work-diff" role="tabpanel" aria-label="差异">
        {renderScopeTabs()}
        <div className="work-pane-empty">
          <FileDiff size={22} strokeWidth={1.6} aria-hidden />
          <p>工作区未授权</p>
          <span>该任务的工作区尚未授权，无法读取 git 差异。请在设置中添加工作区。</span>
        </div>
      </div>
    );
  }

  function renderScopeTabs() {
    return (
      <div className="rv-scopes" role="tablist" aria-label="差异范围">
        {SCOPES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            className={`rv-scope${scope === s ? ' active' : ''}`}
            onClick={() => setScope(s)}
          >
            {SCOPE_LABEL[s]}
            {scope === s && (
              <motion.span
                layoutId="rv-scope-underline"
                className="rv-scope-underline"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        ))}
      </div>
    );
  }

  const emptyText = scope === 'turn'
    ? { p: '暂无文件差异', span: '会话中产生的文件改动（写入 / 编辑 / 补丁）会在这里按文件汇总。' }
    : scope === 'unstaged'
      ? { p: '没有未提交的改动', span: '工作区相对暂存区是干净的；代理或你的编辑产生改动后会显示在这里。' }
      : scope === 'staged'
        ? { p: '暂存区为空', span: '在「未提交」中暂存文件或 hunk 后，它们会出现在这里等待提交。' }
        : { p: '与基线分支无差异', span: '当前工作树相对所选基线分支没有改动。' };

  return (
    <div className="work-diff" role="tabpanel" aria-label="差异">
      {renderScopeTabs()}
      <div className="work-diff-head rv-head">
        {scope === 'turn' ? (
          <span className="work-diff-count">{files.length} 个文件改动</span>
        ) : (
          <span className="work-diff-count">{files.length} 个文件</span>
        )}
        <span className="chip success">+{totals.added}</span>
        <span className="chip danger">−{totals.removed}</span>
        {isGitScope && branchInfo?.current && (
          <span className="chip muted rv-branch" title="当前分支">
            <GitBranch size={11} aria-hidden /> {branchInfo.current}
          </span>
        )}
        {scope === 'branch' && compare && (
          <>
            <select
              className="rv-base-select"
              aria-label="对比基线分支"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              <option value="">基线：{compare.base}（自动）</option>
              {(branchInfo?.branches ?? [])
                .filter((b) => b !== branchInfo?.current)
                .map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <span className="chip muted rv-mergebase" title={`merge-base ${compare.mergeBase}`}>
              ⇄ {compare.mergeBase.slice(0, 7)}
            </span>
            {compare.truncated && <span className="chip warn">已截断</span>}
          </>
        )}
        <div className="composer-spacer" />
        {scope === 'staged' && writeAuthorized && files.length > 0 && (
          <button type="button" className="text-button" aria-expanded={commitOpen}
            disabled={Boolean(busyKey)} onClick={() => setCommitOpen(open => !open)}>提交</button>
        )}
        {isGitScope && (
          <button className="icon-button" aria-label="刷新差异" title="刷新" disabled={loading} onClick={() => void load(scope, base)}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden />
          </button>
        )}
      </div>

      {viewError && (
        <div className="error-card rv-error" role="alert">
          {viewError}
          <button className="text-button" onClick={() => {
            if (nativeTurn) setTurnRefresh(revision => revision + 1);
            else void load(scope, base);
          }}>重试</button>
        </div>
      )}
      {commitOpen && (
        <form className="rv-commit-form" onSubmit={event => { event.preventDefault(); void commitStaged(); }}>
          <label htmlFor="review-commit-message">提交说明</label>
          <input id="review-commit-message" value={commitMessage} onChange={event => setCommitMessage(event.target.value)}
            maxLength={8000} />
          <button type="submit" className="rv-action" disabled={!commitMessage.trim() || Boolean(busyKey)}>
            提交全部暂存修改
          </button>
        </form>
      )}
      {commitNotice && <p className="rv-note" role="status">{commitNotice}</p>}

      <div className="work-diff-list rv-list">
        {viewLoading && files.length === 0 && (
          <div className="rv-note rv-loading"><LoaderCircle size={14} className="spin" aria-hidden /> 正在读取差异…</div>
        )}
        {!viewLoading && files.length === 0 && !viewError && !(nativeTurn && turnData?.changes?.directoriesCreated.length) && (
          <div className="work-pane-empty rv-empty">
            <FileDiff size={22} strokeWidth={1.6} aria-hidden />
            <p>{emptyText.p}</p>
            <span>{emptyText.span}</span>
          </div>
        )}
        {files.map(renderFile)}
        {nativeTurn && turnData?.changes?.directoriesCreated.map(path => (
          <div key={path} className="rv-note">已创建目录 <code>{path}</code></div>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {(annotations.length > 0 || sentNote) && (
          <motion.div
            className="rv-an-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={expandTransition}
          >
            {sentNote && annotations.length === 0 && (
              <div className="rv-an-sent" role="status">{sentNote}</div>
            )}
            {annotations.length > 0 && (
              <>
                <div className="rv-an-list">
                  {annotations.map((a) => (
                    <span className="rv-an-item" key={a.id}>
                      <code>{a.path} {a.lineLabel}</code>
                      <span className="rv-an-text" title={a.text}>{a.text}</span>
                      <button
                        className="rv-an-remove"
                        aria-label={`删除批注 ${a.path} ${a.lineLabel}`}
                        onClick={() => setAnnotations((cur) => cur.filter((x) => x.id !== a.id))}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="rv-an-send-row">
                  <span className="rv-an-count">{annotations.length} 条批注</span>
                  <div className="composer-spacer" />
                  <button
                    className="button primary rv-send"
                    disabled={!sessionId || sending}
                    title={sessionId ? '以一条用户消息发送到会话线程' : '该任务没有关联会话，无法发送'}
                    onClick={() => void sendAnnotations()}
                  >
                    {sending ? <LoaderCircle size={13} className="spin" aria-hidden /> : <Send size={13} aria-hidden />}
                    发送批注到线程
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default DiffTab;

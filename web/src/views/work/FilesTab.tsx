/**
 * 文件 tab: a real fenced file browser — fs.list tree + fs.read preview.
 * Markdown files can toggle between raw source and rendered preview; the
 * tree and the open preview refresh when the session finishes a turn or
 * produces a diff item (debounced), and on manual refresh.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, FileText, Folder, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import { errorMessage } from '../../lib/format';
import { fadeIn, motionProps } from '../../lib/motion';
import { Markdown } from '../../components/Markdown';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';

interface FsEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
}
interface FsListResult {
  path: string;
  entries: FsEntry[];
  truncated: boolean;
}
interface FsReadResult {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}

export interface FilesTabProps {
  workspaceId: string | null;
  workspacePath: string | null;
  /** When set, live-refresh events are filtered to this session. */
  sessionId?: string | null;
}

const MD_EXTS = new Set(['md', 'markdown', 'mdx']);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function FilesTab({ workspaceId, workspacePath, sessionId = null }: FilesTabProps) {
  const { request } = useSocket();
  const reduce = useReducedMotion();
  const [cache, setCache] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FsReadResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDir = useCallback(async (path: string) => {
    if (!workspaceId) return;
    setLoadingDirs((cur) => new Set(cur).add(path));
    setDirErrors((cur) => {
      const next = { ...cur };
      delete next[path];
      return next;
    });
    try {
      const res = await request<FsListResult>('fs.list', { workspaceId, path });
      setCache((cur) => ({ ...cur, [path]: res.entries }));
    } catch (e) {
      setDirErrors((cur) => ({ ...cur, [path]: errorMessage(e) }));
    } finally {
      setLoadingDirs((cur) => {
        const next = new Set(cur);
        next.delete(path);
        return next;
      });
    }
  }, [request, workspaceId]);

  // Reset + load the root whenever the workspace changes.
  useEffect(() => {
    setCache({});
    setExpanded(new Set(['']));
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    if (workspaceId) void loadDir('');
  }, [workspaceId, loadDir]);

  const toggleDir = (path: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!cache[path]) void loadDir(path);
      }
      return next;
    });
  };

  const openFile = async (path: string) => {
    if (!workspaceId) return;
    setSelected(path);
    setRendered(false);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await request<FsReadResult>('fs.read', { workspaceId, path });
      setPreview(res);
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  /** Re-read the open preview without the loading flicker (live refresh). */
  const reloadPreview = useCallback(async (path: string) => {
    if (!workspaceId) return;
    try {
      const res = await request<FsReadResult>('fs.read', { workspaceId, path });
      setPreview(res);
      setPreviewError(null);
    } catch {
      /* keep the last good preview; the tree error surface reports problems */
    }
  }, [request, workspaceId]);

  /** Reload every expanded directory in place, preserving tree + selection. */
  const refreshDirs = useCallback(() => {
    if (!workspaceId) return;
    for (const path of expanded) void loadDir(path);
    if (selected) void reloadPreview(selected);
  }, [workspaceId, expanded, selected, loadDir, reloadPreview]);

  const refresh = () => refreshDirs();

  // Live refresh: finished turns / new diff items may have changed the tree.
  useSocketEvent((e) => {
    if (!workspaceId) return;
    const mine = (sid: string) => sessionId === null || sid === sessionId;
    const hit =
      (e.type === 'turn.completed' && mine(e.sessionId)) ||
      (e.type === 'item.added' && e.item.kind === 'diff' && mine(e.sessionId));
    if (!hit) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refreshDirs, 400);
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  if (!workspaceId) {
    return (
      <div className="work-pane-empty" role="tabpanel" aria-label="文件">
        <Folder size={22} strokeWidth={1.6} aria-hidden />
        <p>工作区未授权</p>
        <span>该任务的工作区尚未授权，无法浏览文件。请在设置中添加工作区。</span>
      </div>
    );
  }

  const renderLevel = (path: string, depth: number): ReactNode => {
    const entries = cache[path];
    const isLoading = loadingDirs.has(path);
    const error = dirErrors[path];
    if (isLoading && !entries) {
      return <div className="tree-note" style={{ paddingLeft: depth * 14 + 26 }}><LoaderCircle size={12} className="spin" aria-hidden /> 加载中…</div>;
    }
    if (error) {
      return <div className="tree-note tree-error" style={{ paddingLeft: depth * 14 + 26 }}>{error}</div>;
    }
    if (!entries) return null;
    if (entries.length === 0) {
      return <div className="tree-note" style={{ paddingLeft: depth * 14 + 26 }}>空目录</div>;
    }
    return entries.map((entry) => {
      const full = path ? `${path}/${entry.name}` : entry.name;
      const pad = depth * 14 + 8;
      if (entry.type === 'dir') {
        const open = expanded.has(full);
        return (
          <div key={full}>
            <button className="tree-row" style={{ paddingLeft: pad }} onClick={() => toggleDir(full)} aria-expanded={open}>
              <ChevronRight size={13} className={`chev${open ? ' open' : ''}`} aria-hidden />
              {open ? <FolderOpen size={14} className="tree-icon dir" aria-hidden /> : <Folder size={14} className="tree-icon dir" aria-hidden />}
              <span className="tree-name">{entry.name}</span>
            </button>
            {open && renderLevel(full, depth + 1)}
          </div>
        );
      }
      return (
        <button
          key={full}
          className={`tree-row${selected === full ? ' selected' : ''}`}
          style={{ paddingLeft: pad + 17 }}
          onClick={() => void openFile(full)}
          aria-current={selected === full ? 'true' : undefined}
        >
          <FileText size={14} className="tree-icon" aria-hidden />
          <span className="tree-name">{entry.name}</span>
          <span className="tree-size">{formatSize(entry.size)}</span>
        </button>
      );
    });
  };

  return (
    <div className="work-files" role="tabpanel" aria-label="文件">
      <div className="files-tree">
        <div className="files-tree-head">
          <span className="files-tree-title" title={workspacePath ?? ''}>文件</span>
          <button className="icon-button" aria-label="刷新文件树" title="刷新" onClick={refresh}>
            <RefreshCw size={14} aria-hidden />
          </button>
        </div>
        <div className="files-tree-scroll">{renderLevel('', 0)}</div>
      </div>
      <div className="files-preview">
        {!selected && (
          <div className="work-pane-empty">
            <FileText size={22} strokeWidth={1.6} aria-hidden />
            <p>选择文件以预览</p>
            <span>从左侧文件树选择一个文件，内容会以只读方式显示在这里。</span>
          </div>
        )}
        {selected && previewLoading && (
          <div className="work-pane-empty"><LoaderCircle size={20} className="spin" aria-hidden /><p>读取中…</p></div>
        )}
        {selected && previewError && <div className="error-card files-error">{previewError}</div>}
        {selected && preview && !previewLoading && (
          <>
            <div className="files-preview-head">
              <span className="files-preview-path" title={selected}>{selected}</span>
              {extOf(selected) && <span className="chip muted">{extOf(selected)}</span>}
              <span className="files-preview-size">{formatSize(preview.size)}</span>
              {preview.truncated && <span className="chip warn">已截断</span>}
              {MD_EXTS.has(extOf(selected)) && (
                <span className="rv-view-toggle" role="group" aria-label="Markdown 预览方式">
                  <button aria-pressed={!rendered} onClick={() => setRendered(false)}>源码</button>
                  <button aria-pressed={rendered} onClick={() => setRendered(true)}>预览</button>
                </span>
              )}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${selected}:${rendered ? 'md' : 'src'}`}
                className="files-preview-body"
                {...motionProps(reduce, fadeIn, { duration: 0.12 })}
              >
                {rendered && MD_EXTS.has(extOf(selected)) ? (
                  <div className="files-preview-md"><Markdown text={preview.content} /></div>
                ) : (
                  <pre className="files-preview-code"><code>{preview.content}</code></pre>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

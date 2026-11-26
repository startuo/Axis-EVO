/**
 * The file tree and read-only preview share the workspace fence. After a
 * turn finishes, update the selected preview without replacing its view.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, LoaderCircle, Maximize2, RefreshCw } from 'lucide-react';
import { errorMessage, formatBytes } from '../../lib/format';
import { fileExtension, initialPreviewQuery, previewKind, type FileSelection, type PreviewQuery,
  type StructuredPreview } from '../../lib/filePreview';
import { Markdown } from '../../components/Markdown';
import { PreviewDialog } from '../../components/PreviewDialog';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';

const OfficePreview = lazy(() => import('./OfficePreview'));

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
  requestedFile?: FileSelection;
}

export function FilesTab({ workspaceId, workspacePath, sessionId = null, requestedFile }: FilesTabProps) {
  const { request } = useSocket();
  const [cache, setCache] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FsReadResult | StructuredPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [query, setQuery] = useState<PreviewQuery>({});
  const [wide, setWide] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

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
      if (workspaceRef.current === workspaceId) setCache((cur) => ({ ...cur, [path]: res.entries }));
    } catch (e) {
      if (workspaceRef.current === workspaceId) setDirErrors((cur) => ({ ...cur, [path]: errorMessage(e) }));
    } finally {
      if (workspaceRef.current === workspaceId) setLoadingDirs((cur) => {
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
    setLoadingDirs(new Set());
    setDirErrors({});
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    setWide(false);
    if (workspaceId) void loadDir('');
  }, [workspaceId, loadDir]);

  const toggleDir = (path: string) => {
    const next = new Set(expanded);
    if (!next.delete(path)) {
      next.add(path);
      if (!cache[path]) void loadDir(path);
    }
    setExpanded(next);
  };

  const openFile = useCallback((path: string) => {
    setSelected(path);
    setRendered(previewKind(path) === 'markdown');
    setQuery(initialPreviewQuery(path));
    setWide(false);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
  }, []);

  useEffect(() => {
    if (requestedFile) openFile(requestedFile.path);
  }, [requestedFile, workspaceId, openFile]);

  useEffect(() => {
    if (!workspaceId || !selected) return;
    let current = true;
    const method = previewKind(selected) === 'structured' ? 'fs.preview' : 'fs.read';
    setPreviewLoading(true);
    request<FsReadResult | StructuredPreview>(method, { workspaceId, path: selected, ...query })
      .then((result) => {
        if (!current) return;
        setPreview(result);
        setPreviewError(null);
      })
      .catch((error: unknown) => { if (current) setPreviewError(errorMessage(error)); })
      .finally(() => { if (current) setPreviewLoading(false); });
    return () => { current = false; };
  }, [request, workspaceId, selected, query, revision]);

  /** Reload every expanded directory in place, preserving tree + selection. */
  const refreshDirs = useCallback(() => {
    if (!workspaceId) return;
    for (const path of expanded) void loadDir(path);
    setRevision(value => value + 1);
  }, [workspaceId, expanded, loadDir]);

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
  }, [workspaceId]);

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
          <span className="tree-size">{formatBytes(entry.size)}</span>
        </button>
      );
    });
  };

  const structured = preview && 'kind' in preview ? preview : null;
  const markdown = selected !== null && previewKind(selected) === 'markdown';
  const canWiden = structured?.kind === 'table' || structured?.kind === 'presentation' || structured?.kind === 'pdf';
  const structuredBody = structured && (
    <Suspense fallback={<div className="tree-note">加载预览…</div>}>
      <OfficePreview key={selected} preview={structured} query={query} change={setQuery}
        busy={previewLoading} workspaceId={workspaceId} />
    </Suspense>
  );

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
        {selected && previewLoading && !preview && (
          <div className="work-pane-empty"><LoaderCircle size={20} className="spin" aria-hidden /><p>读取中…</p></div>
        )}
        {selected && previewError && <div className="error-card files-error">{previewError}</div>}
        {selected && preview && (
          <>
            <div className="files-preview-head">
              <span className="files-preview-path" title={selected}>{selected}</span>
              {fileExtension(selected) && <span className="chip muted">{fileExtension(selected)}</span>}
              <span className="files-preview-size">{formatBytes('sizeBytes' in preview ? preview.sizeBytes : preview.size)}</span>
              {preview.truncated && <span className="chip warn">已截断</span>}
              {markdown && (
                <span className="rv-view-toggle" role="group" aria-label="Markdown 预览方式">
                  <button aria-pressed={!rendered} onClick={() => setRendered(false)}>源码</button>
                  <button aria-pressed={rendered} onClick={() => setRendered(true)}>预览</button>
                </span>
              )}
              {canWiden && <button className="icon-button" title="宽屏预览" aria-label="宽屏预览" onClick={() => setWide(true)}>
                <Maximize2 size={15} aria-hidden />
              </button>}
            </div>
            {structured ? (
              wide && canWiden ? <PreviewDialog title={selected} onClose={() => setWide(false)}>
                {previewError && <div className="error-card files-error">{previewError}</div>}
                {structuredBody}
              </PreviewDialog> : <div className="files-preview-body">{structuredBody}</div>
            ) : 'content' in preview && <div className="files-preview-body">
              {rendered && markdown ? <div className="files-preview-md"><Markdown text={preview.content} /></div>
                : <pre className="files-preview-code"><code>{preview.content}</code></pre>}
            </div>}
          </>
        )}
      </div>
    </div>
  );
}

/** Verified artifact actions and workspace preview. */
import { useCallback, useState } from 'react';
import { AtSign, Copy, Download, FileSpreadsheet, FileText, PanelRight, Presentation } from 'lucide-react';
import type { Artifact } from '../lib/artifacts';
import { baseName, formatBytes } from '../lib/format';
import { workspaceFileLink } from '../lib/filePreview';
import { ContextActionMenu, type ContextMenuAction } from './ContextActionMenu';
import { useToast } from './Toasts';

export function ArtifactCard({ artifact, onOpenFile, onReferenceFile }: {
  artifact: Artifact; onOpenFile?: (path: string) => void; onReferenceFile?: (path: string) => void;
}) {
  const toast = useToast();
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuPosition(null), []);
  const path = onOpenFile && workspaceFileLink(artifact.path);
  const { document } = artifact;
  const Icon = document?.format === 'xlsx' ? FileSpreadsheet : document?.format === 'pptx' ? Presentation : FileText;
  const details = [artifact.sizeBytes !== undefined && formatBytes(artifact.sizeBytes),
    document?.pageCount !== undefined && `${document.pageCount} 页`,
    document?.sheetCount !== undefined && `${document.sheetCount} 张工作表`,
    document?.blockCount !== undefined && `${document.blockCount} 个文档块`].filter(Boolean).join(' / ');
  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.push('success', message);
    } catch {
      toast.push('warn', '复制失败，请手动选择路径');
    }
  };
  const copyPath = () => void copy(artifact.path, '路径已复制');
  const actions: ContextMenuAction[] = [
    ...(path ? [{ id: 'preview', label: '在右侧边栏预览', icon: PanelRight, onSelect: () => onOpenFile?.(path) }] : []),
    { id: 'path', label: '复制路径', icon: Copy, onSelect: copyPath },
    { id: 'name', label: '复制文件名', icon: FileText, onSelect: () => void copy(baseName(artifact.path), '文件名已复制') },
    ...(onReferenceFile ? [{
      id: 'reference', label: '作为 @引用 填入输入框', icon: AtSign, onSelect: () => onReferenceFile(artifact.path),
    }] : []),
  ];
  const content = <>
    <span className="artifact-title">{artifact.label ?? baseName(artifact.path)}</span>
    <span className="artifact-path" title={artifact.path}>{artifact.path}</span>
    {document?.summary && <span className="artifact-summary">{document.summary}</span>}
    {(details || artifact.sha256) && <span className="artifact-meta">
      {details && <span>{details}</span>}
      {artifact.sha256 && <span title={`SHA-256 ${artifact.sha256}`}>SHA-256 {artifact.sha256.slice(0, 12)}</span>}
    </span>}
  </>;
  return (
    <div className="card artifact-card" onContextMenu={(event) => {
      event.preventDefault();
      setMenuPosition({ x: event.clientX, y: event.clientY });
    }} onKeyDown={(event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPosition({ x: rect.left + 12, y: rect.top + 12 });
    }}>
      <Icon size={17} className="tool-icon" aria-hidden />
      {path ? <button className="artifact-main artifact-open" type="button" onClick={() => onOpenFile?.(path)}
        aria-label={`预览 ${artifact.path}`}>{content}</button> : <span className="artifact-main">{content}</span>}
      {document && <span className="chip muted">{document.format.toUpperCase()}</span>}
      {artifact.id && <a className="icon-button" href={`/api/runtime/agent/artifacts/${artifact.id}/download`}
        download={baseName(artifact.path)} title="下载已验证产物" aria-label={`下载 ${artifact.path}`}><Download size={14} aria-hidden /></a>}
      <button className="icon-button" aria-label={`复制路径 ${artifact.path}`} title="复制路径" onClick={copyPath}>
        <Copy size={13} aria-hidden />
      </button>
      <ContextActionMenu position={menuPosition} actions={actions} onClose={closeMenu} />
    </div>
  );
}

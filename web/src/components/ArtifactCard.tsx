/** File / artifact card with copy-path action. */
import { Copy, Download, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import type { Artifact } from '../lib/artifacts';
import { baseName, formatBytes } from '../lib/format';
import { workspaceFileLink } from '../lib/filePreview';
import { useToast } from './Toasts';

export function ArtifactCard({ artifact, onOpenFile }: { artifact: Artifact; onOpenFile?: (path: string) => void }) {
  const toast = useToast();
  const path = onOpenFile && workspaceFileLink(artifact.path);
  const { document } = artifact;
  const Icon = document?.format === 'xlsx' ? FileSpreadsheet : document?.format === 'pptx' ? Presentation : FileText;
  const details = [artifact.sizeBytes !== undefined && formatBytes(artifact.sizeBytes),
    document?.pageCount !== undefined && `${document.pageCount} 页`,
    document?.sheetCount !== undefined && `${document.sheetCount} 张工作表`,
    document?.blockCount !== undefined && `${document.blockCount} 个文档块`].filter(Boolean).join(' / ');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      toast.push('success', '路径已复制');
    } catch {
      toast.push('warn', '复制失败，请手动选择路径');
    }
  };
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
    <div className="card artifact-card">
      <Icon size={17} className="tool-icon" aria-hidden />
      {path ? <button className="artifact-main artifact-open" type="button" onClick={() => onOpenFile?.(path)}
        aria-label={`预览 ${artifact.path}`}>{content}</button> : <span className="artifact-main">{content}</span>}
      {document && <span className="chip muted">{document.format.toUpperCase()}</span>}
      {artifact.id && <a className="icon-button" href={`/api/runtime/agent/artifacts/${artifact.id}/download`}
        download={baseName(artifact.path)} title="下载已验证产物" aria-label={`下载 ${artifact.path}`}><Download size={14} aria-hidden /></a>}
      <button className="icon-button" aria-label={`复制路径 ${artifact.path}`} title="复制路径" onClick={() => void copy()}>
        <Copy size={13} aria-hidden />
      </button>
    </div>
  );
}

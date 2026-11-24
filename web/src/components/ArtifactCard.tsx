/** File / artifact card with copy-path action. */
import { Copy, FileText } from 'lucide-react';
import type { Artifact } from '../lib/artifacts';
import { baseName } from '../lib/format';
import { useToast } from './Toasts';

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      toast.push('success', '路径已复制');
    } catch {
      toast.push('warn', '复制失败，请手动选择路径');
    }
  };
  return (
    <div className="card artifact-card">
      <FileText size={15} className="tool-icon" aria-hidden />
      <span className="artifact-main">
        <span className="artifact-title">{artifact.label ?? baseName(artifact.path)}</span>
        <span className="artifact-path" title={artifact.path}>
          {artifact.path}
        </span>
      </span>
      <button className="icon-button" aria-label={`复制路径 ${artifact.path}`} title="复制路径" onClick={() => void copy()}>
        <Copy size={13} aria-hidden />
      </button>
    </div>
  );
}

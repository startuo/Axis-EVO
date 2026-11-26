/** Extract file/artifact references from a tool_result payload (pure). */
export interface Artifact {
  path: string;
  label?: string;
  id?: string;
  sizeBytes?: number;
  sha256?: string;
  document?: { format: string; summary?: string; pageCount?: number; sheetCount?: number; blockCount?: number };
}

export function extractArtifacts(data: unknown): Artifact[] {
  const out: Artifact[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push({ path: v });
      }
      return;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.path === 'string' && o.path && !seen.has(o.path)) {
        seen.add(o.path);
        const label = typeof o.title === 'string' ? o.title : typeof o.name === 'string' ? o.name : undefined;
        const artifact: Artifact = label ? { path: o.path, label } : { path: o.path };
        if (typeof o.artifactId === 'string' && /^artifact_[a-f0-9]{32}$/.test(o.artifactId)) artifact.id = o.artifactId;
        if (typeof o.sha256 === 'string' && /^[a-f0-9]{64}$/.test(o.sha256)) artifact.sha256 = o.sha256;
        if (typeof o.sizeBytes === 'number' && o.sizeBytes >= 0) artifact.sizeBytes = o.sizeBytes;
        if (o.document && typeof o.document === 'object') {
          const doc = o.document as Record<string, unknown>;
          if (typeof doc.format === 'string' && /^(docx|xlsx|pptx|pdf)$/.test(doc.format)) {
            artifact.document = { format: doc.format,
              summary: typeof doc.summary === 'string' ? doc.summary : undefined,
              pageCount: typeof doc.pageCount === 'number' ? doc.pageCount : undefined,
              sheetCount: typeof doc.sheetCount === 'number' ? doc.sheetCount : undefined,
              blockCount: typeof doc.blockCount === 'number' ? doc.blockCount : undefined };
          }
        }
        out.push(artifact);
      }
    }
  };
  if (!data) return out;
  if (Array.isArray(data)) {
    for (const v of data) push(v);
    return out;
  }
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.files)) for (const v of o.files) push(v);
    if (Array.isArray(o.artifacts)) for (const v of o.artifacts) push(v);
    push(o);
  }
  return out;
}

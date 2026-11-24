/** Extract file/artifact references from a tool_result payload (pure). */
export interface Artifact {
  path: string;
  label?: string;
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
        out.push(label ? { path: o.path, label } : { path: o.path });
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

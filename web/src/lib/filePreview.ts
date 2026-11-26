export interface FileSelection { path: string; serial: number }

export interface PreviewQuery { sheet?: string; startRow?: number; startPage?: number; endPage?: number }

interface PreviewMetadata { path: string; sha256: string; sizeBytes: number; format: string; truncated: boolean }

export type WordBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph' | 'list'; text: string }
  | { type: 'table'; rows: string[][] };

export interface PreviewSlide {
  page: number;
  title: string;
  points: { text: string; level: number }[];
  tables: string[][][];
  notes: string;
}

export type StructuredPreview = PreviewMetadata & (
  | { kind: 'word'; blocks: WordBlock[]; paragraphCount: number; wordCount: number }
  | { kind: 'table'; sheets: string[]; sheet: string; totalRows: number; totalColumns: number;
      startRow: number; header: string[]; rows: string[][]; nextRow: number | null }
  | { kind: 'presentation'; totalPages: number; slides: PreviewSlide[]; nextPage: number | null }
  | { kind: 'pdf'; totalPages: number; pages: { page: number; text: string; scanLikely: boolean }[];
      nextPage: number | null; scanLikely: boolean; inlineAvailable?: boolean }
  | { kind: 'image'; mediaType: string }
);

const STRUCTURED = new Set(['docx', 'xlsx', 'pptx', 'pdf', 'csv', 'tsv',
  'doc', 'xls', 'ppt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const WORKSPACE_TEXT = new Set('md markdown mdx txt rst json yaml yml toml py js mjs cjs ts tsx jsx html css scss c h cpp rs go java xml sql sh ps1 bat cmd ini cfg lock vue svelte'.split(' '));

export function fileExtension(path: string): string {
  return /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? '';
}

export function previewKind(path: string) {
  const extension = fileExtension(path);
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return 'markdown';
  return STRUCTURED.has(extension) ? 'structured' : 'text';
}

export function initialPreviewQuery(path: string): PreviewQuery {
  const extension = fileExtension(path);
  return extension === 'pptx' || extension === 'pdf' ? { startPage: 1, endPage: 1 } : {};
}

export function workspaceFileUrl(workspaceId: string, preview: PreviewMetadata): string {
  const query = new URLSearchParams({ path: preview.path, sha256: preview.sha256 });
  return `/api/runtime/agent/workspaces/${encodeURIComponent(workspaceId)}/files/raw?${query}`;
}

export function workspaceFileLink(value: string | undefined): string | undefined {
  if (!value || value.length > 512 || /[:?#\u0000-\u001f]/.test(value)) return undefined;
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (path.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
  const extension = fileExtension(path);
  return STRUCTURED.has(extension) || WORKSPACE_TEXT.has(extension) ? path : undefined;
}

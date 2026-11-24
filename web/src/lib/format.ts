/** Small pure formatting helpers shared across the shell. */
import type { PermissionMode, ReasoningEffort, ToolStatus, TurnStatus } from '@axis/protocol';

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export const MODE_LABEL: Record<PermissionMode, string> = {
  'read-only': '只读',
  'workspace-write': '工作区写入',
  'full-access': '完全访问',
};

export const MODE_ORDER: PermissionMode[] = ['read-only', 'workspace-write', 'full-access'];

export function nextMode(mode: PermissionMode): PermissionMode {
  const i = MODE_ORDER.indexOf(mode);
  return MODE_ORDER[(i + 1) % MODE_ORDER.length] ?? 'workspace-write';
}

export const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
};

export const EFFORT_ORDER: ReasoningEffort[] = ['off', 'low', 'medium', 'high'];

export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
  unknown: '未知',
  rejected: '已拒绝',
};

export const TURN_STATUS_LABEL: Record<TurnStatus, string> = {
  running: '运行中',
  blocked: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  unknown: '状态未知',
  'limit-reached': '达到上限',
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** First meaningful string argument of a tool call, for the collapsed header. */
export function toolArgSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  for (const key of ['command', 'path', 'query', 'url', 'pattern', 'file', 'text']) {
    const v = args[key];
    if (typeof v === 'string' && v.length > 0) return truncate(v.replace(/\s+/g, ' '), 80);
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) return truncate(v.replace(/\s+/g, ' '), 80);
  }
  return '';
}

/** Shared status metadata for Work view chips (labels + token chip classes). */
import type { SessionStatus, TaskStatus } from '@axis/protocol';

export interface StatusMeta {
  label: string;
  cls: 'muted' | 'info' | 'success' | 'danger' | 'warn';
  live?: boolean;
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: { label: '待处理', cls: 'muted' },
  running: { label: '运行中', cls: 'info', live: true },
  done: { label: '已完成', cls: 'success' },
  failed: { label: '失败', cls: 'danger' },
  cancelled: { label: '已取消', cls: 'muted' },
};

export const SESSION_STATUS_META: Record<SessionStatus, StatusMeta> = {
  idle: { label: '空闲', cls: 'muted' },
  running: { label: '运行中', cls: 'info', live: true },
  error: { label: '错误', cls: 'danger' },
};

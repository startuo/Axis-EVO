/** Shared agent-status presentation metadata (tokens-driven chips). */
import type { AgentStatus } from '@axis/protocol';

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; cls: string; live: boolean }> = {
  starting: { label: '启动中', cls: 'info', live: true },
  running: { label: '运行中', cls: 'info', live: true },
  done: { label: '已完成', cls: 'success', live: false },
  failed: { label: '失败', cls: 'danger', live: false },
  cancelled: { label: '已取消', cls: 'muted', live: false },
};

export function countByStatus(agents: { status: AgentStatus }[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = { starting: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const a of agents) counts[a.status] += 1;
  return counts;
}

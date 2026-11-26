import type { AgentCommand } from '@axis/protocol';

export const SLASH_COMMANDS: readonly { name: AgentCommand; description: string }[] = [
  { name: 'plan', description: '只读调研并列出执行计划' },
  { name: 'goal', description: '按目标推进并验证各阶段' },
  { name: 'review', description: '只读审查并报告问题' },
  { name: 'compact', description: '整理历史并保留原始要求' },
];

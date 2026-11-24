/** Parent→child agent tree with live status chips. */
import { Bot, GitBranch, User } from 'lucide-react';
import type { AgentInfo } from '@axis/protocol';
import { AGENT_STATUS_META } from './meta';
import type { AgentNode } from './useAgents';

export interface AgentTreeProps {
  roots: AgentNode[];
  selectedId: string | null;
  onSelect: (agent: AgentInfo) => void;
}

function StatusChip({ status }: { status: AgentInfo['status'] }) {
  const meta = AGENT_STATUS_META[status];
  return (
    <span className={`chip ${meta.cls} agent-status-chip`}>
      {meta.live && <span className="pulse-dot" aria-hidden />}
      {meta.label}
    </span>
  );
}

function TreeNode({ node, depth, selectedId, onSelect }: {
  node: AgentNode; depth: number; selectedId: string | null; onSelect: (a: AgentInfo) => void;
}) {
  const { agent, children } = node;
  const selected = agent.id === selectedId;
  const isRoot = depth === 0;
  return (
    <li className="agent-tree-item">
      <button
        className={`agent-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(agent)}
      >
        <span className="agent-row-icon" aria-hidden>
          {isRoot ? <User size={15} /> : <Bot size={15} />}
        </span>
        <span className="agent-row-main">
          <span className="agent-row-name">{agent.name}</span>
          <span className="agent-row-role">{agent.role}</span>
        </span>
        {agent.worktree && <GitBranch size={13} className="agent-row-wt" aria-label="worktree 隔离" />}
        <StatusChip status={agent.status} />
      </button>
      {children.length > 0 && (
        <ul className="agent-tree-children">
          {children.map((child) => (
            <TreeNode key={child.agent.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AgentTree({ roots, selectedId, onSelect }: AgentTreeProps) {
  return (
    <ul className="agent-tree" role="tree" aria-label="代理树">
      {roots.map((node) => (
        <TreeNode key={node.agent.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

export { StatusChip as AgentStatusChip };

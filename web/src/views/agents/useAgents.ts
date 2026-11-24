/** Agent roster: initial agent.list snapshot + live agent.updated upserts. */
import { useEffect, useState } from 'react';
import type { AgentInfo } from '@axis/protocol';
import { errorMessage } from '../../lib/format';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';

export interface AgentsHook {
  agents: AgentInfo[];
  loading: boolean;
  error: string | null;
}

function byCreated(a: AgentInfo, b: AgentInfo): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function useAgents(): AgentsHook {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { request } = useSocket();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    request<AgentInfo[]>('agent.list')
      .then((list) => {
        if (!alive) return;
        setAgents([...list].sort(byCreated));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [request]);

  useSocketEvent((e) => {
    if (e.type !== 'agent.updated') return;
    setAgents((cur) => {
      const next = cur.filter((a) => a.id !== e.agent.id);
      next.push(e.agent);
      return next.sort(byCreated);
    });
  });

  return { agents, loading, error };
}

export interface AgentNode {
  agent: AgentInfo;
  children: AgentNode[];
}

/** Build parent→child trees; orphans (missing parent) surface as roots. */
export function buildAgentTree(agents: AgentInfo[]): AgentNode[] {
  const nodes = new Map<string, AgentNode>();
  for (const agent of agents) nodes.set(agent.id, { agent, children: [] });
  const roots: AgentNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.agent.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: AgentNode[]): void => {
    list.sort((a, b) => byCreated(a.agent, b.agent));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

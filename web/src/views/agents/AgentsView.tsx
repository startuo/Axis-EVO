/**
 * Agents view (agents-settings stream): live parent→child agent tree, status
 * chips, and a detail panel that reuses the chat Conversation for child session
 * activity plus a message timeline. Real data via agent.list + agent.updated.
 * MOUNT POINT: keeps the named + default export so the shell router stays stable.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot } from 'lucide-react';
import type { AgentInfo } from '@axis/protocol';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/ui';
import { fadeUp, motionProps } from '../../lib/motion';
import { AgentDetail } from './AgentDetail';
import { AgentTree } from './AgentTree';
import { countByStatus } from './meta';
import { buildAgentTree, useAgents } from './useAgents';
import './agents.css';

export function AgentsView() {
  const { agents, loading, error } = useAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const roots = useMemo(() => buildAgentTree(agents), [agents]);
  const counts = useMemo(() => countByStatus(agents), [agents]);
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  // Keep a sensible selection as the roster changes (auto-select the first agent).
  useEffect(() => {
    if (agents.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => (cur && agents.some((a) => a.id === cur) ? cur : agents[0]!.id));
  }, [agents]);

  const handleSelect = (agent: AgentInfo) => setSelectedId(agent.id);

  return (
    <div data-view="agents" className="agents-view">
      <header className="agents-head">
        <h1 className="agents-title">代理</h1>
        {agents.length > 0 && (
          <div className="agents-stats" aria-label="代理状态统计">
            <span className="chip info">{counts.running + counts.starting} 运行中</span>
            <span className="chip success">{counts.done} 已完成</span>
            {counts.failed > 0 && <span className="chip danger">{counts.failed} 失败</span>}
            <span className="chip muted">{agents.length} 总计</span>
          </div>
        )}
      </header>

      {loading && (
        <div className="agents-loading" role="status" aria-label="加载代理">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!loading && error && <div className="error-card agents-error">代理加载失败：{error}</div>}

      {!loading && !error && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          hero="还没有子代理"
          description="在聊天中让主代理使用 spawn_agent 派生子代理：它们会在独立会话中执行子任务，可选 git worktree 隔离，权限只降不升。派生后这里会实时显示代理树与运行状态。"
          badge={<span className="chip muted">等待首次派生</span>}
        />
      )}

      {!loading && !error && agents.length > 0 && (
        <motion.div className="agents-body" {...motionProps(reduce, fadeUp)}>
          <aside className="agents-tree-panel" aria-label="代理列表">
            <AgentTree roots={roots} selectedId={selectedId} onSelect={handleSelect} />
          </aside>
          <section className="agents-detail-panel" aria-label="代理详情">
            {selected ? (
              <AgentDetail key={selected.id} agent={selected} />
            ) : (
              <div className="agents-detail-empty">选择一个代理查看其会话活动与消息。</div>
            )}
          </section>
        </motion.div>
      )}
    </div>
  );
}

export default AgentsView;

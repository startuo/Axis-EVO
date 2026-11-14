import { ArrowUpRight, FolderOpen, MessageSquare, Workflow } from 'lucide-react';
import { agentRunning, agentStatus, type AgentArtifact } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';
import { AgentArtifacts } from './AgentConversation';
import { SafeMarkdown } from '../ui/SafeMarkdown';

export function AgentWork({ data, openArtifact }: { data: AgentWorkspaceController; openArtifact: (artifact: AgentArtifact) => void }) {
  const artifacts = data.conversation?.turns.flatMap(turn => turn.artifacts) ?? [];
  const excerpt = data.conversation?.turns.at(-1)?.answer?.split(/\n\s*\n/)[0];
  return <div className="agent-work-page"><header className="agent-page-heading"><span className="agent-eyebrow">WORK</span><h1>正在发生的工作</h1><p>任务、成果和下一步，都留在这个工作区。</p></header>
    <div className="agent-work-scope"><FolderOpen size={16}/><span>{data.workspace?.name ?? '尚未选择工作区'}</span><small>{data.rows.filter(row => agentRunning(row.status)).length} 项正在处理</small></div>
    {!data.rows.length ? <div className="agent-work-empty"><Workflow size={30} strokeWidth={1.3}/><h2>把一个目标交给 Axis</h2><p>从整理材料、撰写文档，到根据反馈完善成果。</p><button className="button secondary" onClick={() => data.go('chat')}><MessageSquare size={15}/>开始对话</button></div> : <div className="agent-work-layout">
      <section className="agent-work-list" aria-label="工作任务">{data.rows.map(row => <button key={row.id} title={row.title} className={data.parsed.conversationId === row.id ? 'is-selected' : ''} onClick={() => data.go('work', { conversationId: row.id })}>
        <span><strong>{row.title}</strong><small>{new Date(row.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>
        <span className={`agent-work-state ${agentRunning(row.status) ? 'is-running' : ''}`}>{agentStatus(row.status)}</span>
      </button>)}</section>
      <section className="agent-work-deliveries" aria-label="任务交付物">{data.conversation ? <>
        <div className="agent-section-heading"><h2 title={data.conversation.title}>{data.conversation.title}</h2><button className="text-button" onClick={() => data.go('chat', { conversationId: data.conversation!.id })}>继续协作<ArrowUpRight size={14}/></button></div>
        <p className="agent-subtle">{artifacts.length ? `${artifacts.length} 份交付物` : '本任务尚无已记录的文件交付物。'}</p>
        <AgentArtifacts artifacts={artifacts} open={openArtifact}/>
        {excerpt && <div className="agent-work-excerpt"><SafeMarkdown text={excerpt}/></div>}
      </> : <div className="agent-work-empty"><FolderOpen size={27} strokeWidth={1.3}/><h2>选择一项工作</h2><p>查看已生成的文档，或回到对话继续完善。</p></div>}</section>
    </div>}
  </div>;
}

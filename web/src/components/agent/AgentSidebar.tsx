import { FolderOpen, MessageSquare, PanelLeftClose, Plus, Search, Settings2, SquarePen, Workflow } from 'lucide-react';
import { AxisLogo } from '../ui/AxisLogo';
import { agentRunning, agentStatus } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';

export function AgentSidebar({ data, compact, toggle, search, setSearch, close }: { data: AgentWorkspaceController; compact: boolean; toggle: () => void; search: string; setSearch: (value: string) => void; close: () => void }) {
  const move = (view: string, conversationId?: string) => { close(); data.go(view, { conversationId }); };
  const rows = data.rows.filter(row => row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className={`agent-sidebar ${compact ? 'agent-sidebar-compact' : ''}`}>
    <header className="agent-brand"><AxisLogo size={27}/><strong>Axis<span>—</span>Evo</strong><button className="icon-button" aria-label="切换侧栏" onClick={toggle}><PanelLeftClose size={17}/></button></header>
    <div className="agent-workspace-picker"><FolderOpen size={16}/><select aria-label="当前工作区" title={data.workspace?.path ?? '选择工作区'} value={data.workspaceId} onChange={event => { close(); data.selectWorkspace(event.target.value); }}><option value="" disabled>选择工作区</option>{data.state?.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className="icon-button" aria-label="添加工作区" title="添加工作区" onClick={() => { close(); data.go('settings', { section: 'workspace' }); }}><Plus size={15}/></button></div>
    <nav className="agent-primary-nav" aria-label="主要入口">
      <button aria-current={data.parsed.view === 'chat' ? 'page' : undefined} onClick={() => move('chat', data.parsed.conversationId)} title="Chat · 对话"><MessageSquare size={17}/><span>Chat</span><small>对话</small></button>
      <button aria-current={data.parsed.view === 'work' ? 'page' : undefined} onClick={() => move('work', data.parsed.conversationId)} title="Work · 工作"><Workflow size={17}/><span>Work</span><small>工作</small></button>
    </nav>
    <div className="agent-history-heading"><span>对话</span><button className="icon-button" aria-label="新对话" title="新对话" onClick={() => move('chat')}><SquarePen size={16}/></button></div>
    <label className="agent-search"><Search size={14}/><input type="search" aria-label="搜索 Agent 对话" placeholder="搜索对话" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <div className="agent-history">{rows.map(row => <button key={row.id} aria-current={data.parsed.conversationId === row.id ? 'page' : undefined} onClick={() => move('chat', row.id)} title={row.title}><span className={`agent-history-dot ${agentRunning(row.status) ? 'is-running' : ''} ${['FAILED', 'UNKNOWN', 'BLOCKED'].includes(row.status) ? 'is-warning' : ''}`}/><span>{row.title}</span><span className="sr-only">{agentStatus(row.status)}</span></button>)}{!rows.length && <p>{search ? '没有匹配的对话' : '从一个目标开始。'}</p>}</div>
    <footer><button className="agent-settings-link" aria-current={data.parsed.view === 'settings' ? 'page' : undefined} title="设置" onClick={() => move('settings')}><Settings2 size={17}/><span>设置</span></button><div className="agent-preview"><span>本地工作空间</span><small>0.1.0 Preview</small></div></footer>
  </div>;
}

import { lazy, Suspense, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, FolderPlus, Globe2, Moon, Plus, RefreshCw, Server, Settings2, Sun, Unplug, Wrench } from 'lucide-react';
import { agentApi, type AgentPolicy, type AgentSource, type AgentWorkspace } from '../../lib/agent';
import type { AgentWorkspaceController } from '../../hooks/useAgentWorkspace';
import type { EdgeBrowserController } from '../../hooks/useEdgeBrowser';
import { EdgeBrowserPanel } from '../runtime/EdgeBrowserPanel';
import { CopyButton } from '../ui/Primitives';
import { AgentEvolution } from './AgentEvolution';

const RuntimeProviders = lazy(() => import('../runtime/RuntimeProviders').then(module => ({ default: module.RuntimeProviders })));
const sections = [{ id: 'workspace', label: '工作区', Icon: FolderPlus }, { id: 'sources', label: '知识与 Skills', Icon: BookOpen }, { id: 'evolution', label: 'Skill 改进', Icon: RefreshCw }, { id: 'models', label: '模型连接', Icon: Server }, { id: 'tools', label: '工具与插件', Icon: Wrench }, { id: 'style', label: '偏好与表达', Icon: Settings2 }];

function AddWorkspace({ data }: { data: AgentWorkspaceController }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [writeMode, setWriteMode] = useState<AgentPolicy['writeMode']>('write');
  const [share, setShare] = useState(false);
  const [saved, setSaved] = useState(false);
  return <form className="agent-settings-form" onSubmit={event => { event.preventDefault(); if (!share) return; void data.mutate('workspace', () => agentApi.addWorkspace({ name, path, writeMode, shareWithProvider: true })).then(ok => { if (ok) { setName(''); setPath(''); setShare(false); setSaved(true); } }); }}>
    <div className="agent-field-row"><label>工作区名称<input aria-label="工作区名称" required maxLength={80} placeholder="例如：文档工作间" value={name} onChange={event => { setName(event.target.value); setSaved(false); }}/></label><label>本地文件夹路径<input aria-label="工作区文件夹路径" required maxLength={4096} placeholder="例如：D:\AxisWorkspace" value={path} onChange={event => { setPath(event.target.value); setSaved(false); }}/></label></div>
    <fieldset className="agent-permission-options"><legend>Agent 在这个工作区的操作范围</legend><label><input type="radio" name="workspace-access" checked={writeMode === 'write'} onChange={() => setWriteMode('write')}/><span><strong>读取与写入</strong><small>允许在此目录内持续处理文件、生成交付物。</small></span></label><label><input type="radio" name="workspace-access" checked={writeMode === 'read'} onChange={() => setWriteMode('read')}/><span><strong>只读</strong><small>搜索与阅读材料，不修改文件。</small></span></label></fieldset>
    <label className="agent-consent"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)}/><span>授权读取此目录，并将任务所需内容提供给我选择的模型。</span></label><div className="agent-form-actions"><button className="button primary" disabled={!!data.busy || !share || !name.trim() || !path.trim()}><FolderPlus size={15}/>{data.busy === 'workspace' ? '正在添加…' : '添加并授权工作区'}</button>{saved && <span role="status"><Check size={14}/>已添加，可在侧栏选择</span>}</div>
  </form>;
}

function WorkspacePolicy({ workspace, data, styleOnly = false }: { workspace: AgentWorkspace; data: AgentWorkspaceController; styleOnly?: boolean }) {
  const [policy, setPolicy] = useState(workspace.policy);
  const dirty = Object.keys(policy).some(key => policy[key as keyof AgentPolicy] !== workspace.policy[key as keyof AgentPolicy]);
  return <form className="agent-settings-form" onSubmit={event => { event.preventDefault(); void data.mutate('policy', () => agentApi.settings(workspace.id, policy)); }}>
    {styleOnly ? <label>Agent 表达风格<select aria-label="Agent 表达风格" value={policy.style} onChange={event => setPolicy(current => ({ ...current, style: event.target.value as AgentPolicy['style'] }))}><option value="concise">简洁 · 先给结论，突出结果</option><option value="balanced">均衡 · 结果与必要解释</option><option value="detailed">详细 · 展开依据与执行说明</option></select><small>影响此工作区之后的回复，执行权限保持由程序控制。</small></label> : <><label>文件操作权限<select aria-label="文件操作权限" value={policy.writeMode} onChange={event => setPolicy(current => ({ ...current, writeMode: event.target.value as AgentPolicy['writeMode'] }))}><option value="write">允许读取与写入此工作区</option><option value="read">只读，不修改工作区文件</option></select></label><p className="agent-policy-summary">Skill 改进：{workspace.policy.evolutionMode === 'off' ? '已关闭' : workspace.policy.evolutionMode === 'auto' ? '按实际对比结果自动采用' : '保留候选，继续观察'}<button type="button" className="text-button" onClick={() => data.go('settings', { section: 'evolution' })}>管理改进策略与模型</button></p></>}
    <div className="agent-form-actions"><button className="button secondary" disabled={!!data.busy || !dirty}>{data.busy === 'policy' ? '正在保存…' : '保存设置'}</button><span className="agent-subtle">{workspace.name} · 设置版本 {workspace.revision}</span></div>
  </form>;
}

function Sources({ workspace, data }: { workspace: AgentWorkspace; data: AgentWorkspaceController }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [kind, setKind] = useState<AgentSource['kind']>('knowledge');
  const [share, setShare] = useState(false);
  return <><div className="agent-section-heading"><div><h2>供 Agent 使用的资料</h2><p>连接知识库备份或外部 Skill 目录，Agent 按目标搜索和选择。</p></div><button className="button secondary" onClick={() => setAdding(value => !value)}><Plus size={15}/>添加来源</button></div>
    {workspace.sources.length ? <ul className="agent-source-list">{workspace.sources.map(source => <li key={source.id}><BookOpen size={19}/><div><strong>{source.name}</strong><span>{source.kind === 'skills' ? 'Skill 库' : '知识库'} · {source.enabled ? '只读接入' : '已撤销'}</span><code>{source.path}</code></div>{source.enabled && <button className="text-button" disabled={!!data.busy} onClick={() => void data.mutate(`revoke:${source.id}`, () => agentApi.revokeSource(workspace.id, source.id))}><Unplug size={13}/>撤销</button>}</li>)}</ul> : <div className="agent-settings-empty"><BookOpen size={25} strokeWidth={1.3}/><h3>从你明确授权的资料开始</h3><p>这里尚未连接外部知识库或 Skill 库。添加来源不会修改原始资料。</p></div>}
    {adding && <form className="agent-settings-form agent-source-form" onSubmit={event => { event.preventDefault(); if (!share) return; void data.mutate('source', () => agentApi.addSource(workspace.id, { name, path, kind, shareWithProvider: true })).then(ok => { if (ok) { setAdding(false); setShare(false); setName(''); setPath(''); } }); }}><div className="agent-field-row"><label>来源名称<input aria-label="来源名称" required maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label><label>来源类型<select aria-label="来源类型" value={kind} onChange={event => setKind(event.target.value as AgentSource['kind'])}><option value="knowledge">知识库备份</option><option value="skills">外部 Skill 库</option></select></label></div><label>已授权的目录路径<input aria-label="来源目录路径" required maxLength={4096} value={path} onChange={event => setPath(event.target.value)} placeholder="填写备份或外部 Skill 库的完整路径"/></label><label className="agent-consent"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)}/><span>允许 Agent 只读检索此目录，并将所需内容提供给我选择的模型。</span></label><div className="agent-form-actions"><button className="button primary" disabled={!!data.busy || !share || !name.trim() || !path.trim()}>授权这个来源</button><button type="button" className="text-button" onClick={() => setAdding(false)}>取消</button></div></form>}
  </>;
}

export function AgentSettings({ data, edge, dark, setDark, navigate, attachPage }: { data: AgentWorkspaceController; edge: EdgeBrowserController; dark: boolean; setDark: (value: boolean) => void; navigate: (path: string) => void; attachPage: () => void }) {
  const section = sections.some(item => item.id === data.parsed.section) ? data.parsed.section : 'workspace';
  const workspace = data.workspace;
  return <div className="agent-settings-page"><header className="agent-page-heading"><span className="agent-eyebrow">SETTINGS</span><h1>一个地方，管理工作方式。</h1><p>工作区、模型、工具与 Agent 的协作偏好。</p></header><nav className="agent-settings-tabs" aria-label="设置分类">{sections.map(({ id, label, Icon }) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => data.go('settings', { section: id })}><Icon size={15}/>{label}</button>)}</nav>
    <div className="agent-settings-body">
      {section === 'workspace' && <><section><div className="agent-section-heading"><div><h2>{workspace ? workspace.name : '添加第一个工作区'}</h2><p>{workspace ? '授权范围由这个本地目录和以下设置共同决定。' : '选择用于本次协作的本地目录。'}</p></div></div>{workspace && <><div className="agent-path"><code>{workspace.path}</code><CopyButton value={workspace.path} label="复制工作区路径"/></div><WorkspacePolicy key={`${workspace.id}:${workspace.revision}`} workspace={workspace} data={data}/></>}</section><section className="agent-settings-section"><h2>{workspace ? '添加另一个工作区' : '开始使用'}</h2><AddWorkspace data={data}/></section></>}
      {section === 'sources' && (workspace ? <Sources key={workspace.id} workspace={workspace} data={data}/> : <p className="agent-settings-empty">先添加并选择一个工作区，再连接资料来源。</p>)}
      {section === 'evolution' && <AgentEvolution data={data}/>}
      {section === 'models' && <Suspense fallback={<p role="status">正在加载模型设置…</p>}><RuntimeProviders data={data.profiles} token={data.token} reload={data.reload} reportError={data.reportError} onChat={profile => { data.setProfileKey(`${profile.id}@${profile.revision}`); data.go('chat'); }}/></Suspense>}
      {section === 'tools' && <><div className="agent-section-heading"><div><h2>Agent 可发现的工具</h2><p>工具是否可用取决于本机实现与当前授权。</p></div><span className="agent-tool-count">{data.state?.tools.filter(tool => tool.available).length ?? 0} 个可用</span></div><ul className="agent-tool-list">{data.state?.tools.map(tool => <li key={tool.name}><Wrench size={16}/><div><strong>{tool.name}</strong><p>{tool.description}</p></div><span>{tool.available ? tool.mutating ? '可产生修改' : '只读' : '未启用'}</span></li>)}</ul><section className="agent-settings-section"><div className="agent-section-heading"><div><h2><Globe2 size={17}/>Microsoft Edge</h2><p>关联指定标签页，供当前任务按授权使用。</p></div></div><details className="agent-extension-help"><summary>安装、更新与重新连接</summary><ol><li>在 Edge 打开扩展管理页：<code>edge://extensions</code><CopyButton value="edge://extensions" label="复制 Edge 扩展管理地址"/>。</li><li>开启开发者模式，选择“加载解压缩的扩展”，加载下方目录。</li><li>更新 Axis 后，在扩展卡片点击重新加载，再刷新连接并选择标签页。</li></ol>{edge.status?.extensionDirectory && <div className="agent-path"><code>{edge.status.extensionDirectory}</code><CopyButton value={edge.status.extensionDirectory} label="复制 Edge 扩展目录"/></div>}<p>连接状态来自当前扩展实例。旧操作记录保留，重新连接不会重做已发出的操作。</p></details><EdgeBrowserPanel edge={edge} onAttach={attachPage}/></section></>}
      {section === 'style' && <><section><h2>外观</h2><div className="agent-theme-options"><button aria-pressed={!dark} onClick={() => setDark(false)}><Sun size={18}/>浅色</button><button aria-pressed={dark} onClick={() => setDark(true)}><Moon size={18}/>深色</button></div></section><section className="agent-settings-section"><h2>Agent 表达</h2>{workspace ? <WorkspacePolicy key={`style:${workspace.id}:${workspace.revision}`} workspace={workspace} data={data} styleOnly/> : <p>选择工作区后设置表达风格。</p>}</section></>}
    </div><footer className="agent-settings-footer"><span>Axis-Evo · 0.1.0 Preview</span><button className="text-button" onClick={() => navigate('/runtime')}>工程工作台与历史证据<ArrowUpRight size={14}/></button></footer>
  </div>;
}

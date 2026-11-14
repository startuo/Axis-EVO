import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Globe2, PanelRightClose, RefreshCw, X } from 'lucide-react';
import { useAgentWorkspace } from '../../hooks/useAgentWorkspace';
import { useWorkbenchLayout } from '../../hooks/useWorkbenchLayout';
import { useEdgeBrowser } from '../../hooks/useEdgeBrowser';
import { WorkbenchShell } from '../layout/WorkbenchShell';
import { EdgeBrowserPanel } from '../runtime/EdgeBrowserPanel';
import { AgentSidebar } from './AgentSidebar';
import { AgentComposer, type AgentAttachment } from './AgentComposer';
import { AgentArtifactPreview, AgentConversation } from './AgentConversation';
import { AgentSettings } from './AgentSettings';
import { AgentWork } from './AgentWork';
import type { AgentArtifact } from '../../lib/agent';
import '../../styles/axis-next.css';
import '../../styles/agent-workspace.css';

export function AgentWorkbench({ route, navigate, dark, setDark }: { route: string; navigate: (path: string) => void; dark: boolean; setDark: (value: boolean) => void }) {
  const data = useAgentWorkspace(route, navigate);
  const layout = useWorkbenchLayout(520);
  const edge = useEdgeBrowser(!!data.token);
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<'browser' | 'artifact'>('browser');
  const [artifactId, setArtifactId] = useState('');
  const [attachment, setAttachment] = useState<AgentAttachment | null>(null);
  const [sharePage, setSharePage] = useState(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const activeAttachment = attachment?.workspaceId === data.workspaceId && attachment.conversationId === data.parsed.conversationId && attachment.profileKey === data.profileKey && attachment.id === edge.binding?.id && edge.binding.active ? attachment : null;
  const artifact = data.conversation?.turns.flatMap(turn => turn.artifacts).find(item => item.id === artifactId);
  const { closeOverlays, setInspector, setSheet, narrow } = layout;
  const closePanel = () => { setInspector(false); setSheet(false); focusReturn.current?.focus(); };
  const openBrowser = () => { focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPanel('browser'); setSharePage(false); layout.showInspector(); };
  const openArtifact = (item: AgentArtifact) => { focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setArtifactId(item.id); setPanel('artifact'); layout.showInspector(); };
  useEffect(() => { closeOverlays(); setInspector(false); setSharePage(false); }, [route, closeOverlays, setInspector]);
  useEffect(() => { setSharePage(false); }, [data.profileKey, edge.binding?.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !narrow) { setInspector(false); focusReturn.current?.focus(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (layout.mobile) layout.openNavigation(); else layout.setCompact(false); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="搜索 Agent 对话"]')?.focus()); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [narrow, setInspector, layout]);
  function grantPage() {
    if (!sharePage || !edge.binding?.active || !data.profile || !data.workspace) return;
    setAttachment({ id: edge.binding.id, title: edge.binding.title, workspaceId: data.workspaceId, conversationId: data.parsed.conversationId, profileKey: data.profileKey });
    setSharePage(false); closePanel();
    if (data.parsed.view !== 'chat') data.go('chat', { conversationId: data.parsed.conversationId });
  }
  const inspector = panel === 'artifact' && artifact ? <AgentArtifactPreview artifact={artifact} close={closePanel}/> : <section className="agent-browser-panel"><header><strong>浏览器工作空间</strong><button className="icon-button" aria-label="关闭浏览器工作面板" onClick={closePanel}><PanelRightClose size={17}/></button></header><div className="agent-browser-scroll"><EdgeBrowserPanel edge={edge}/>{edge.binding?.active && <div className="agent-browser-grant"><label className="agent-consent"><input type="checkbox" checked={sharePage} onChange={event => setSharePage(event.target.checked)}/><span>允许本轮任务读取这个页面，并将正文提供给 {data.profile?.name ?? '所选模型'}。</span></label><button className="button primary" disabled={!sharePage || !data.profile?.credentialConfigured || !data.workspace || !!edge.busy} onClick={grantPage}>用于本轮对话</button></div>}<button className="text-button agent-browser-settings" onClick={() => { closePanel(); data.go('settings', { section: 'tools' }); }}>查看安装与连接设置</button></div></section>;
  const composer = <AgentComposer data={data} attachment={activeAttachment} clearAttachment={() => setAttachment(null)} openBrowser={openBrowser} submit={() => { void data.send(activeAttachment?.id).then(ok => { if (ok) setAttachment(null); }); }}/ >;
  return <WorkbenchShell layout={layout} sidebar={<AgentSidebar data={data} compact={layout.compact && !layout.mobile} toggle={layout.toggleSidebar} search={search} setSearch={setSearch} close={closeOverlays}/>} toolbar={<><div className="toolbar-identity"><FolderOpen size={14}/><span>{data.workspace?.name ?? '选择一个工作区'}</span>{data.parsed.view === 'chat' && data.conversation && <><span className="agent-breadcrumb-separator">/</span><span className="toolbar-task">{data.conversation.title}</span></>}</div><div className="toolbar-actions"><button className="icon-button" aria-label="刷新 Agent 记录" title="刷新 Agent 记录" onClick={() => { data.setError(''); data.reload(); }}><RefreshCw size={16}/></button><button className="icon-button" aria-label="打开浏览器工作面板" title="浏览器工作面板" onClick={openBrowser}><Globe2 size={17}/></button></div></>} inspector={inspector} inspectorLabel={panel === 'artifact' ? '交付物预览' : '浏览器工作空间'} inspectorMaxWidth={680} mainId="agent-main" className="agent-workspace" resetKey={`${data.workspaceId}:${data.parsed.conversationId}:${data.parsed.view}`}>
    {data.error && <div className="agent-error" role="alert"><div><span>{data.error}</span>{data.errorCode && <details><summary>错误详情</summary><code>{data.errorCode}</code></details>}</div><button className="icon-button" aria-label="关闭错误提示" onClick={() => data.setError('')}><X size={14}/></button></div>}
    {data.parsed.view === 'settings' ? <div className="runtime-scroll agent-scroll"><AgentSettings data={data} edge={edge} dark={dark} setDark={setDark} navigate={navigate} attachPage={openBrowser}/></div> : data.parsed.view === 'work' ? <div className="runtime-scroll agent-scroll"><AgentWork data={data} openArtifact={openArtifact}/></div> : data.parsed.conversationId ? <><div className="runtime-scroll agent-scroll agent-chat-scroll">{data.loadingConversation && !data.conversation ? <div className="agent-loading" role="status">正在读取对话与执行记录…</div> : data.conversation ? <AgentConversation data={data} openArtifact={openArtifact}/> : <div className="agent-loading">此对话尚未读取成功，请刷新记录。</div>}</div>{composer}</> : <div className="runtime-scroll agent-scroll agent-home-scroll"><div className="agent-home"><div className="agent-welcome"><span className="agent-eyebrow">AXIS · AGENT WORKSPACE</span><h1>从目标，到完成。</h1><p>把材料放进工作区，把下一步交给 Axis。</p></div>{composer}<div className="agent-start-options"><button onClick={() => data.go('settings', { section: 'sources' })}>连接知识与 Skills<span>提供上下文</span></button><button onClick={openBrowser}>使用 Edge 网页<span>从浏览器开始</span></button><button onClick={() => data.go('work')}>查看工作<span>继续已有成果</span></button></div>{!data.state && !data.initializing && <button className="text-button" onClick={() => navigate('/runtime')}>打开工程工作台</button>}</div></div>}
  </WorkbenchShell>;
}

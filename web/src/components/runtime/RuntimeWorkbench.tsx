import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowUp, BookOpen, Globe2, Link2, FileText, ChevronRight, Folder, LoaderCircle, Moon, PanelRight, RefreshCw, Server, ShieldCheck, Sun, X } from "lucide-react";
import { useRuntimeWorkbench } from "../../hooks/useRuntimeWorkbench";
import { useWorkbenchLayout } from "../../hooks/useWorkbenchLayout";
import {useEdgeBrowser} from "../../hooks/useEdgeBrowser";
import {useWorkspace} from "../../hooks/useWorkspace";
import {RuntimeArtifactsPanel} from "./RuntimeArtifactsPanel";
import type {WorkspaceDraft} from "../../lib/workspace";
import {RuntimeWorkspacePanel,type WorkspacePanelTab} from "./RuntimeWorkspacePanel";
import "../../styles/axis-next.css";
import { WorkbenchShell } from "../layout/WorkbenchShell";
import { WorkbenchSidebar, type SidebarLink } from "../layout/WorkbenchSidebar";
import { PopoverSelect } from "../ui/PopoverSelect";
import { Badge, EmptyState, Loading } from "../ui/Primitives";
import { RuntimeInspector, type RuntimeTab } from "./RuntimeInspector";
import { RuntimePermissions } from "./RuntimePermissions";
import { RuntimeThreadView, threadLabels } from "./RuntimeThreadView";
import { RuntimeContext } from './RuntimeContext';
import { RuntimeConversationFeed } from './RuntimeConversationFeed';
import {RuntimeFeedback} from './RuntimeFeedback';
const RuntimeProviders = lazy(() => import("./RuntimeProviders")
  .then(module => ({ default: module.RuntimeProviders })));
const SkillEvolutionWorkbench = lazy(() => import("../skills/SkillEvolutionWorkbench")
  .then(module => ({ default: module.SkillEvolutionWorkbench })));

export function RuntimeWorkbench({ route, navigate, dark, setDark }: { route: string; navigate: (path: string) => void; dark: boolean; setDark: (value: boolean) => void }) {
  const data = useRuntimeWorkbench(route, navigate);
  const layout = useWorkbenchLayout(440);
  const edge = useEdgeBrowser(!!data.token);
  const [panelTab,setPanelTab] = useState<WorkspacePanelTab>("browser");
  const [artifactMode,setArtifactMode]=useState<'drafts'|'files'>('drafts');
  const [workContext,setWorkContext]=useState<{kind:'edge'|'draft';id:string;title:string;projectId:string;conversationId:string|null}|null>(null);
  const [shareContent,setShareContent]=useState(false);
  const showPanel=(selected:WorkspacePanelTab)=>{setPanelTab(selected);layout.showInspector();};
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<RuntimeTab>("审查");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const { parsed, thread, project } = data;
  const documents=useWorkspace(data.projectId,parsed.conversationId,!!data.token);
  useEffect(()=>{setWorkContext(current=>current?.projectId===data.projectId&&current.conversationId===parsed.conversationId?current:null);setShareContent(false);},[data.projectId,parsed.conversationId]);
  useEffect(()=>{setShareContent(false);},[data.selectedProfile]);
  const canSubmit=data.canPlan&&!documents.busy&&(!workContext||(shareContent&&(workContext.kind!=='edge'||edge.binding?.id===workContext.id&&edge.binding.active&&!edge.busy)));
  async function submit(){
    if(!canSubmit)return;
    if(workContext&&data.profile){
      const draft=await documents.send(data.prompt,data.profile,workContext.kind==='edge'?{bindingId:workContext.id}:{parentDraftId:workContext.id});
      if(draft){
        data.setPrompt('');
        setWorkContext({kind:'draft',id:draft.id,title:`文档草稿 · v${draft.version}`,projectId:draft.projectId,conversationId:draft.conversationId});
        setShareContent(false);
        data.openThread(draft.conversationId,draft.projectId);
        data.reload();
        setArtifactMode('drafts');showPanel('artifacts');
      }
    }else await data.plan();
  }
  function attachPage(){if(!edge.binding?.active)return;setWorkContext({kind:'edge',id:edge.binding.id,title:edge.binding.title,projectId:data.projectId,conversationId:parsed.conversationId});setShareContent(false);data.setInteractionMode('chat');if(layout.narrow)layout.setSheet(false);requestAnimationFrame(()=>textarea.current?.focus());}
  function continueDraft(draft:WorkspaceDraft){setWorkContext({kind:'draft',id:draft.id,title:`${draft.delivery?.filename??'文档草稿'} · v${draft.version}`,projectId:draft.projectId,conversationId:draft.conversationId});setShareContent(false);data.setInteractionMode('chat');if(layout.narrow)layout.setSheet(false);requestAnimationFrame(()=>textarea.current?.focus());}
  const readScope=!data.isChat?project?.taskTemplates?.find(t=>t.id===data.selectedTemplate)?.readPolicy:undefined;
  const submitLabel=documents.busy?'正在处理':workContext?'开始协作':data.isChat?'发送消息':readScope?'读取文件':'生成计划';
  const onHome = parsed.path === "/runtime" || parsed.path === "/runtime/";
  const onProviders = parsed.path === "/runtime/providers";
  const onPermissions = parsed.path === "/runtime/permissions";
  const onActivity = parsed.path === "/runtime/activity";
  const onSkills = parsed.path === '/runtime/skills';
  const knownRoute = onHome || onProviders || onPermissions || onActivity || onSkills || !!parsed.id || !!parsed.conversationId;
  const { closeOverlays, resetLayout, openNavigation, mobile } = layout;
  useEffect(() => { closeOverlays(); }, [route, closeOverlays]);
  useEffect(() => { setSearch(""); }, [data.projectId]);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(384, Math.max(48, element.scrollHeight))}px`;
  }, [data.prompt, data.conversation, onHome]);
  function newConversation() {
    data.newConversation(); resetLayout(); setTab("审查"); setSearch(""); setWorkContext(null);setShareContent(false);
    composing.current = false;
    window.dispatchEvent(new Event("axis:new-conversation"));
    requestAnimationFrame(() => textarea.current?.focus());
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newConversation(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); if (mobile) openNavigation(); else layout.setCompact(false);
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="搜索运行线程"]')?.focus());
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const go = (path: string) => { closeOverlays(); data.go(path); };
  const links: SidebarLink[] = [
    { label: "连接 Microsoft Edge", Icon: Globe2, action: () => showPanel("browser") },
    { label: "运行活动", Icon: Activity, action: () => go("/runtime/activity"), active: onActivity },
    { label: "模型设置", Icon: Server, action: () => go("/runtime/providers"), active: onProviders },
    { label: "权限与环境", Icon: ShieldCheck, action: () => go("/runtime/permissions"), active: onPermissions },
    { label: '技能演化', Icon: BookOpen, action: () => go('/runtime/skills'), active: onSkills },
    { label: "技能记录", Icon: BookOpen, action: () => go("/skills") },
    { label: "演示 / Core 只读", Icon: ArrowLeft, action: () => go("/workbench") },
  ];
  const sidebar = <WorkbenchSidebar compact={layout.compact && !mobile} toggle={layout.toggleSidebar} newConversation={newConversation} search={search} setSearch={setSearch} searchLabel="搜索运行线程" threads={data.rows.map(item => ({ id: item.id, title: item.title, status: threadLabels[item.status], warning: item.status === "UNKNOWN" || item.status === "FAILED" }))} currentThread={parsed.conversationId ?? parsed.id} openThread={id => { closeOverlays(); data.openThread(id); }} links={links} modeLabel="本地运行" modeHint="文件工具受控" />;
  const toolbar = <>
    <div className="toolbar-identity cds-toolbar-identity">{!onHome && <><span>{onProviders ? "模型配置" : onPermissions ? "权限与环境" : onSkills ? 'Skills 与演化' : onActivity ? "运行活动" : "对话"}</span></>}</div>
    <div className="toolbar-actions cds-toolbar-actions"><button className="icon-button" aria-label="刷新真实记录" title="刷新真实记录" onClick={data.refresh}><RefreshCw size={16} /></button><button className="icon-button" aria-label="切换主题" title="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button" aria-label="切换工作面板" title="工作面板" aria-expanded={layout.narrow ? layout.sheet : layout.inspector} onClick={layout.toggleInspector}><PanelRight size={17} /></button></div>
  </>;
  const hint = data.initializing ? "正在连接本地运行…" : !data.capabilities?.enabled ? "尚未连接本地运行" : !data.token ? "无法连接本地服务" : !project ? "请先配置运行项目" : !data.promptValid ? `输入超过 ${data.promptLimit} 个 Unicode 字符或包含无效字符` : parsed.conversationId && (data.isChat ? !data.sessionConversation?.canChat : !data.sessionConversation?.canContinue) ? data.isChat ? '正在等待本条回复' : '当前任务尚未结束或结果不确定，不能开始新操作' : !data.profile ? "选择一个模型配置" : !data.profile.credentialConfigured ? "未配置 API Key" : !data.isChat && !data.skill ? "请选择明确的 Skill 版本" : data.isChat ? "对话不会访问文件" : readScope ? "将按项目策略读取下列文件，不修改内容" : "先查看待执行操作，再批准修改";
  const composerHint=workContext?'将所选材料提供给当前模型；保存修改另行批准':hint;
  const composer = <form className="runtime-composer cds-composer" aria-label="任务输入区" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="runtime-composer-box cds-composer-box">
      <textarea ref={textarea} aria-label="真实任务输入" placeholder={data.isChat?'发送消息…':parsed.conversationId?'描述接下来要完成的文件任务…':'描述你想完成的任务…'} rows={2} value={data.prompt} onChange={event => data.setPrompt(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
        if (!event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); if (canSubmit) void submit(); }
      }} />
      <div className="runtime-composer-toolbar cds-composer-toolbar"><div className="cds-composer-selectors">
        <PopoverSelect label="运行项目" value={data.projectId} placeholder="选择项目" icon={<Folder size={14} />} options={data.capabilities?.projects.map(item => ({ value: item.id, label: item.name })) ?? []} onChange={id => { resetLayout(); data.selectProject(id); }} />
        <PopoverSelect label="规划模型" value={data.selectedProfile} placeholder="选择模型" icon={<Server size={14} />} options={data.profiles?.profiles.map(item => ({ value: `${item.id}@${item.revision}`, label: `${item.name} (${item.modelId})`, description: item.credentialConfigured ? "API Key 已配置" : "未配置 API Key" })) ?? []} onChange={data.setSelectedProfile} disabled={!data.token} />
        {data.capabilities?.supportsReplies&&<PopoverSelect label="工作方式" value={data.interactionMode} options={[{value:'chat',label:'对话'},{value:'task',label:'文件任务'}]} onChange={value=>data.setInteractionMode(value==='task'?'task':'chat')} disabled={!data.token||!!workContext}/>}
        {!data.isChat&&<PopoverSelect label="规划Skill" value={data.selectedSkill} placeholder="选择 Skill" icon={<BookOpen size={14} />} options={project?.skills.map(item => ({ value: `${item.skill_id}@${item.skill_version}`, label: item.skill_id, description: `版本 ${item.skill_version}` })) ?? []} onChange={data.setSelectedSkill} disabled={!data.token} />}
        {!data.isChat&&!!project?.taskTemplates && project.taskTemplates.length > 1 && <PopoverSelect label="独立验收模板" value={data.selectedTemplate} options={project.taskTemplates.map(t => ({ value: t.id, label: t.readPolicy?'读取授权范围内文件':t.name }))} onChange={data.setSelectedTemplate} disabled={!data.token} />}
      </div><button className="runtime-plan-button" aria-label={submitLabel} title={submitLabel} disabled={!canSubmit}>{data.busy === "planning" || documents.busy ? <LoaderCircle size={17} className="loader" /> : <ArrowUp size={18} />}<span className="sr-only">{submitLabel}</span></button></div>
    </div>
    <div className="composer-caption cds-composer-caption"><span role="status">{composerHint}{data.promptLength > data.promptLimit - 256 ? ` ${data.promptLength}/${data.promptLimit}` : ''}</span>{!data.token ? <button type="button" className="text-button" onClick={data.refresh}>重新连接 <ChevronRight size={12} /></button> : (!data.profile || !data.profile.credentialConfigured) ? <button type="button" className="text-button" onClick={() => go("/runtime/providers")}>配置模型 <ChevronRight size={12} /></button> : <span className="composer-shortcut">{workContext?'Enter 开始协作':data.isChat?'Enter 发送':'Enter 生成计划'}</span>}</div>
    {workContext&&<div className="next-composer-context"><div><span>{workContext.kind==='edge'?<Link2 size={13}/>:<FileText size={13}/>}</span><strong>{workContext.title}</strong><button type="button" className="icon-button" aria-label="移除协作材料" onClick={()=>{setWorkContext(null);setShareContent(false);}}><X size={12}/></button></div><label><input type="checkbox" checked={shareContent} onChange={event=>setShareContent(event.target.checked)}/><span>将这份材料提供给 {data.profile?.name??'所选模型'}，用于本次协作</span></label></div>}
    {documents.error&&<p className="next-inline-notice" role="alert">{documents.error}</p>}
    {readScope&&<p className="runtime-read-scope" aria-label="本次读取授权范围">项目策略允许自动批准纯读取操作：<strong>{readScope.allowedPaths.join("，")}</strong>。规划上下文只包含这些文件；不带入历史消息正文，不允许修改。</p>}
    {data.error && <div className="cds-home-error" role="alert"><span>{data.error}</span><button type="button" className="icon-button" aria-label="关闭提示" onClick={() => data.setError("")}><X size={13} /></button></div>}
  </form>;
  const permissions = data.capabilities?.enabled ? <RuntimePermissions capabilities={data.capabilities} /> : <EmptyState title="真实运行尚未启用" action={<button className="button secondary" onClick={() => go("/workbench")}>打开演示 / Core 只读</button>}>请按工作台启动说明开启本地运行，再刷新连接。</EmptyState>;
  const turnContent = thread ? <RuntimeThreadView key={thread.id} thread={thread} busy={data.busy === "approval"} canAct={!!data.token} approve={() => void data.approve()} openReview={() => { setTab("审查"); showPanel("evidence"); }} openPlan={()=>showPanel("plan")} openArtifacts={()=>{setArtifactMode("files");showPanel("artifacts");}} inConversation={!!parsed.conversationId} feedback={<RuntimeFeedback key={thread.id} thread={thread} token={data.token} profiles={data.profiles?.profiles??[]} onCase={id=>go(`/runtime/skills?project=${encodeURIComponent(thread.projectId)}&case=${encodeURIComponent(id)}`)}/>} /> : <EmptyState title="线程不可用">未找到对应项目中的真实线程。</EmptyState>;
  const closePanel=()=>{if(layout.narrow)layout.setSheet(false);else layout.setInspector(false);};
  const evidence=<RuntimeInspector key={`${data.projectId}:${parsed.id??data.selectedTurn?.id}`} thread={thread} tab={tab} selectTab={setTab} close={closePanel}/>;
  const workspace=<RuntimeWorkspacePanel tab={panelTab} selectTab={setPanelTab} close={closePanel} edge={edge} thread={thread} approve={()=>void data.approve()} busy={data.busy==="approval"} canAct={!!data.token} evidence={evidence} artifacts={<RuntimeArtifactsPanel workspace={documents} thread={thread} mode={artifactMode} setMode={setArtifactMode} onContinue={continueDraft}/>} onAttach={attachPage}/>;
  return <WorkbenchShell layout={layout} sidebar={sidebar} toolbar={toolbar} className="cds-runtime axis-next" mainId="runtime-main" resetKey={`${route}:${data.conversation}`} inspector={workspace} inspectorLabel="工作面板">
    <div className={`runtime-scroll cds-page-scroll ${onHome ? "cds-home-scroll" : ""}`} tabIndex={onHome ? undefined : 0} aria-label="运行页面内容">
      {onHome ? <div className="cds-home"><div className="cds-welcome next-welcome"><span className="next-eyebrow">AXIS · 你的本地协作空间</span><h1>一起，把事情完成。</h1><p>从一个问题，到可使用的成果。</p></div>{composer}<div className="next-start-actions"><button onClick={()=>showPanel("browser")}><Globe2 size={15}/><span>关联 Edge 网页</span></button><button onClick={()=>{data.setInteractionMode('task');textarea.current?.focus();}}><Folder size={15}/><span>处理项目文件</span></button></div></div> : <>
        {data.error && <div className="runtime-error" role="alert"><strong>操作未确认</strong><p>{data.error}</p><button className="text-button" onClick={() => data.setError("")}>关闭提示</button></div>}
        <Suspense fallback={<Loading />}>{data.initializing ? <Loading /> : !knownRoute ? <EmptyState title="运行页面不可用">返回新对话，或选择已有线程。</EmptyState> : onPermissions ? permissions : !data.token ? <EmptyState title="无法连接本地服务" action={<button className="button secondary" onClick={data.refresh}>重新连接</button>}>请确认本地服务已启动。</EmptyState> : onProviders ? <RuntimeProviders data={data.profiles} token={data.token} reload={data.reload} reportError={data.reportError} onChat={profile=>{data.setSelectedProfile(profile.id+"@"+profile.revision);go("/runtime");}} /> : onSkills ? project ? <SkillEvolutionWorkbench key={project.id} projectId={project.id} token={data.token} profiles={data.profiles?.profiles ?? []} onError={data.reportError} onTask={ref => { data.setSelectedSkill(`${ref.skill_id}@${ref.skill_version}`); data.setInteractionMode('task'); data.refresh(); go("/runtime"); }} /> : <EmptyState title="请先配置运行项目">Skills 演化仅面向后端明确配置的项目。</EmptyState> : onActivity ? <div className="runtime-settings-page"><div className="runtime-page-heading"><h1>运行活动</h1><p>查看本地记录的任务状态与执行结果。</p></div>{data.rows.length ? <div className="runtime-activity-list">{[...data.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <button key={item.id} onClick={() => data.openThread(item.id)}><Activity size={16} /><span><strong>{item.title}</strong><small>{item.updatedAt}</small></span><Badge>{threadLabels[item.status]}</Badge><ChevronRight size={14} /></button>)}</div> : <EmptyState title="没有运行活动">新建任务后会显示真实规划与执行状态。</EmptyState>}</div>  : data.loadingThread && !thread ? <Loading /> : parsed.conversationId && data.sessionConversation?.items ? <div className="runtime-multiturn next-conversation-layout">
          <h1 className="sr-only">{data.sessionConversation.title}</h1>
          <RuntimeConversationFeed conversation={data.sessionConversation} currentTurnId={data.selectedTurn?.id} currentTask={turnContent} openTurn={data.openTurn} drafts={documents.drafts} openDraft={id=>{documents.select(id);setArtifactMode("drafts");showPanel("artifacts");}}/>
          {composer}
        </div> : parsed.conversationId && data.sessionConversation ? <div className="runtime-multiturn">
          <nav className="runtime-turn-nav" aria-label="对话轮次">{data.sessionConversation.turns.map(turn => <button key={turn.id} className={turn.id === data.selectedTurn?.id ? 'selected' : ''} aria-current={turn.id === data.selectedTurn?.id ? 'step' : undefined} onClick={() => data.openTurn(turn.id)}><span>第 {turn.number} 轮</span><small>{threadLabels[turn.webStatus]}{turn.coreOutcome ? `，Core ${turn.coreOutcome}` : ''}</small></button>)}</nav>
          {turnContent}
          {data.selectedTurn && <RuntimeContext key={data.selectedTurn.id} project={data.projectId} conversation={parsed.conversationId} turn={data.selectedTurn.id} digest={data.selectedTurn.contextSha256} />}
          <section className="runtime-followup" aria-label="跟进最新一轮"><h2>跟进最新一轮</h2><p className="caption">后端独立验收模板决定完成条件。新输入使用最新已验证工作区；当前显示第 {data.selectedTurn?.number} 轮。修改操作每轮重新批准；读取策略另行标明。</p>{composer}</section>
        </div> : turnContent}</Suspense>
      </>}
    </div>
  </WorkbenchShell>;
}

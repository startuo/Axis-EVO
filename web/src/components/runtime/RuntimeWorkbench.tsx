import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowUp, BookOpen, ChevronRight, Folder, LoaderCircle, Moon, PanelRight, RefreshCw, Server, ShieldCheck, Sun, X } from "lucide-react";
import { useRuntimeWorkbench } from "../../hooks/useRuntimeWorkbench";
import { useWorkbenchLayout } from "../../hooks/useWorkbenchLayout";
import { WorkbenchShell } from "../layout/WorkbenchShell";
import { WorkbenchSidebar, type SidebarLink } from "../layout/WorkbenchSidebar";
import { PopoverSelect } from "../ui/PopoverSelect";
import { Badge, EmptyState, Loading } from "../ui/Primitives";
import { RuntimeInspector, type RuntimeTab } from "./RuntimeInspector";
import { RuntimePermissions } from "./RuntimePermissions";
import { RuntimeThreadView, threadLabels } from "./RuntimeThreadView";
import { RuntimeContext } from './RuntimeContext';
const RuntimeProviders = lazy(() => import("./RuntimeProviders")
  .then(module => ({ default: module.RuntimeProviders })));
const SkillEvolutionWorkbench = lazy(() => import("../skills/SkillEvolutionWorkbench")
  .then(module => ({ default: module.SkillEvolutionWorkbench })));

export function RuntimeWorkbench({ route, navigate, dark, setDark }: { route: string; navigate: (path: string) => void; dark: boolean; setDark: (value: boolean) => void }) {
  const data = useRuntimeWorkbench(route, navigate);
  const layout = useWorkbenchLayout();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<RuntimeTab>("审查");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const { parsed, thread, project } = data;
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
    data.newConversation(); resetLayout(); setTab("审查"); setSearch("");
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
    { label: "运行活动", Icon: Activity, action: () => go("/runtime/activity"), active: onActivity },
    { label: "Provider 配置", Icon: Server, action: () => go("/runtime/providers"), active: onProviders },
    { label: "权限与环境", Icon: ShieldCheck, action: () => go("/runtime/permissions"), active: onPermissions },
    { label: 'Skills · 演化工作区', Icon: BookOpen, action: () => go('/runtime/skills'), active: onSkills },
    { label: "Skills · 只读视图", Icon: BookOpen, action: () => go("/skills") },
    { label: "演示 / Core 只读", Icon: ArrowLeft, action: () => go("/workbench") },
  ];
  const sidebar = <WorkbenchSidebar compact={layout.compact && !mobile} toggle={layout.toggleSidebar} newConversation={newConversation} search={search} setSearch={setSearch} searchLabel="搜索运行线程" threads={data.rows.map(item => ({ id: item.id, title: item.title, status: threadLabels[item.status], warning: item.status === "UNKNOWN" || item.status === "FAILED" }))} currentThread={parsed.conversationId ?? parsed.id} openThread={id => { closeOverlays(); data.openThread(id); }} links={links} modeLabel="本地运行" modeHint={data.token ? "会话已连接" : "会话未连接"} />;
  const toolbar = <>
    <div className="toolbar-identity cds-toolbar-identity">{!onHome && <><span>{onProviders ? "模型配置" : onPermissions ? "权限与环境" : onSkills ? 'Skills 与演化' : onActivity ? "运行活动" : thread?.title ?? "对话"}</span></>}</div>
    <div className="toolbar-actions cds-toolbar-actions"><span className="runtime-source-label">RUNTIME · 本地执行</span><button className="icon-button" aria-label="刷新真实记录" title="刷新真实记录" onClick={data.refresh}><RefreshCw size={16} /></button><button className="icon-button" aria-label="切换主题" title="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>{!!(parsed.id || parsed.conversationId) && <button className="icon-button" aria-label="切换运行审查面板" title="查看证据" aria-expanded={layout.narrow ? layout.sheet : layout.inspector} onClick={layout.toggleInspector}><PanelRight size={17} /></button>}</div>
  </>;
  const hint = data.initializing ? "正在连接本地运行…" : !data.capabilities?.enabled ? "尚未连接本地运行" : !data.token ? "连接本地会话后即可生成计划" : !project ? "请先配置运行项目" : !data.promptValid ? `输入超过 ${data.promptLimit} 个 Unicode 字符或包含无效字符` : parsed.conversationId && !data.sessionConversation?.canContinue ? '当前轮尚未结束或结果不确定，禁止自动续轮' : !data.profile ? "选择一个模型配置" : !data.profile.credentialConfigured ? "模型凭据尚未配置" : !data.skill ? "请选择明确的 Skill 版本" : "先生成计划，批准后执行";
  const composer = <form className="runtime-composer cds-composer" aria-label="任务输入区" onSubmit={event => { event.preventDefault(); void data.plan(); }}>
    <div className="runtime-composer-box cds-composer-box">
      <textarea ref={textarea} aria-label="真实任务输入" placeholder={parsed.conversationId ? '跟进最新一轮的已验证结果…' : '描述你想完成的任务…'} rows={2} value={data.prompt} onChange={event => data.setPrompt(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
        if (!event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); if (data.canPlan) void data.plan(); }
      }} />
      <div className="runtime-composer-toolbar cds-composer-toolbar"><div className="cds-composer-selectors">
        <PopoverSelect label="运行项目" value={data.projectId} placeholder="选择项目" icon={<Folder size={14} />} options={data.capabilities?.projects.map(item => ({ value: item.id, label: item.name })) ?? []} onChange={id => { resetLayout(); data.selectProject(id); }} />
        <PopoverSelect label="规划模型" value={data.selectedProfile} placeholder="选择模型" icon={<Server size={14} />} options={data.profiles?.profiles.map(item => ({ value: `${item.id}@${item.revision}`, label: item.name, description: `${item.modelId} · r${item.revision}${item.credentialConfigured ? "" : " · 缺少凭据"}` })) ?? []} onChange={data.setSelectedProfile} disabled={!data.token} />
        <PopoverSelect label="规划Skill" value={data.selectedSkill} placeholder="选择 Skill" icon={<BookOpen size={14} />} options={project?.skills.map(item => ({ value: `${item.skill_id}@${item.skill_version}`, label: item.skill_id, description: `版本 ${item.skill_version}` })) ?? []} onChange={data.setSelectedSkill} disabled={!data.token} />
        {!!project?.taskTemplates && project.taskTemplates.length > 1 && <PopoverSelect label="独立验收模板" value={data.selectedTemplate} options={project.taskTemplates.map(t => ({ value: t.id, label: t.name }))} onChange={data.setSelectedTemplate} disabled={!data.token} />}
      </div><button className="runtime-plan-button" aria-label="生成计划" title="生成计划" disabled={!data.canPlan}>{data.busy === "planning" ? <LoaderCircle size={17} className="loader" /> : <ArrowUp size={18} />}<span className="sr-only">{data.busy === "planning" ? "正在提交计划" : "生成计划"}</span></button></div>
    </div>
    <div className="composer-caption cds-composer-caption"><span role="status">{hint}{data.promptLength > data.promptLimit - 256 ? ` · ${data.promptLength}/${data.promptLimit}` : ''}</span>{!data.token ? <button type="button" className="text-button" onClick={() => go("/runtime/permissions")}>连接与权限 <ChevronRight size={12} /></button> : (!data.profile || !data.profile.credentialConfigured) ? <button type="button" className="text-button" onClick={() => go("/runtime/providers")}>配置模型 <ChevronRight size={12} /></button> : <span className="composer-shortcut">Enter 生成计划</span>}</div>
    {data.error && data.capabilities?.enabled && <div className="cds-home-error" role="alert"><span>{data.error}</span><button type="button" className="icon-button" aria-label="关闭提示" onClick={() => data.setError("")}><X size={13} /></button></div>}
  </form>;
  const permissions = data.capabilities?.enabled ? <RuntimePermissions capabilities={data.capabilities} unlocked={!!data.token} busy={data.busy === "session"} unlock={data.unlock} /> : <EmptyState title="真实运行尚未启用" action={<button className="button secondary" onClick={() => go("/workbench")}>打开演示 / Core 只读</button>}>请按工作台启动说明开启本地运行，再刷新连接。</EmptyState>;
  const turnContent = thread ? <RuntimeThreadView key={thread.id} thread={thread} busy={data.busy === "approval"} canAct={!!data.token} approve={() => void data.approve()} openReview={() => { setTab("审查"); layout.showInspector(); }} inConversation={!!parsed.conversationId} /> : <EmptyState title="线程不可用">未找到对应项目中的真实线程。</EmptyState>;
  return <WorkbenchShell layout={layout} sidebar={sidebar} toolbar={toolbar} className="cds-runtime" mainId="runtime-main" resetKey={`${route}:${data.conversation}`} inspector={parsed.id || parsed.conversationId ? <RuntimeInspector key={`${data.projectId}:${parsed.id ?? data.selectedTurn?.id}`} thread={thread} tab={tab} selectTab={setTab} close={() => { if (layout.narrow) layout.setSheet(false); else layout.setInspector(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="切换运行审查面板"]')?.focus()); }} /> : undefined} inspectorLabel="运行审查面板">
    <div className={`runtime-scroll cds-page-scroll ${onHome ? "cds-home-scroll" : ""}`} tabIndex={onHome ? undefined : 0} aria-label="运行页面内容">
      {onHome ? <div className="cds-home"><div className="cds-welcome"><h1>今天，想完成什么？</h1></div>{composer}</div> : <>
        {data.error && <div className="runtime-error" role="alert"><strong>操作未确认</strong><p>{data.error}</p><button className="text-button" onClick={() => data.setError("")}>关闭提示</button></div>}
        <Suspense fallback={<Loading />}>{data.initializing ? <Loading /> : !knownRoute ? <EmptyState title="运行页面不可用">返回新对话，或选择已有线程。</EmptyState> : onPermissions || !data.token ? permissions : onProviders ? <RuntimeProviders data={data.profiles} token={data.token} reload={data.reload} reportError={data.reportError} /> : onSkills ? project ? <SkillEvolutionWorkbench key={project.id} projectId={project.id} token={data.token} profiles={data.profiles?.profiles ?? []} onError={data.reportError} onTask={ref => { data.setSelectedSkill(`${ref.skill_id}@${ref.skill_version}`); data.refresh(); go("/runtime"); }} /> : <EmptyState title="请先配置运行项目">Skills 演化仅面向后端明确配置的项目。</EmptyState> : onActivity ? <div className="runtime-settings-page"><div className="runtime-page-heading"><h1>运行活动</h1><p>查看本地记录的任务状态与执行结果。</p></div>{data.rows.length ? <div className="runtime-activity-list">{[...data.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <button key={item.id} onClick={() => data.openThread(item.id)}><Activity size={16} /><span><strong>{item.title}</strong><small>{item.updatedAt}</small></span><Badge>{threadLabels[item.status]}</Badge><ChevronRight size={14} /></button>)}</div> : <EmptyState title="没有运行活动">新建任务后会显示真实规划与执行状态。</EmptyState>}</div>  : data.loadingThread && !thread ? <Loading /> : parsed.conversationId && data.sessionConversation ? <div className="runtime-multiturn">
          <nav className="runtime-turn-nav" aria-label="对话轮次">{data.sessionConversation.turns.map(turn => <button key={turn.id} className={turn.id === data.selectedTurn?.id ? 'selected' : ''} aria-current={turn.id === data.selectedTurn?.id ? 'step' : undefined} onClick={() => data.openTurn(turn.id)}><span>第 {turn.number} 轮</span><small>{threadLabels[turn.webStatus]}{turn.coreOutcome ? ` · Core ${turn.coreOutcome}` : ''}</small></button>)}</nav>
          {turnContent}
          {data.selectedTurn && <RuntimeContext key={data.selectedTurn.id} project={data.projectId} conversation={parsed.conversationId} turn={data.selectedTurn.id} digest={data.selectedTurn.contextSha256} />}
          <section className="runtime-followup" aria-label="跟进最新一轮"><h2>跟进最新一轮</h2><p className="caption">后端独立验收模板决定完成条件。新输入使用最新已验证工作区；当前显示第 {data.selectedTurn?.number} 轮。每轮重新批准。</p>{composer}</section>
        </div> : turnContent}</Suspense>
      </>}
    </div>
  </WorkbenchShell>;
}

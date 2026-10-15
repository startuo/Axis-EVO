import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, ArrowLeft, ArrowUp, BookOpen, ChevronDown, ChevronRight, CircleDot, Folder, Menu, Moon, PanelLeftClose, PanelRight, Plus, RefreshCw, Search, Server, ShieldCheck, Sun, TerminalSquare, X } from "lucide-react";
import { runtimeApi, RuntimeError, type RuntimeCapabilities, type RuntimeProfiles, type RuntimeThread, type RuntimeThreadSummary } from "../../lib/runtime";
import { AxisLogo } from "../ui/AxisLogo";
import { Badge, EmptyState, Loading, keepDialogTab } from "../ui/Primitives";
import { RuntimeInspector, type RuntimeTab } from "./RuntimeInspector";
import { RuntimePermissions } from "./RuntimePermissions";
import { RuntimeProviders } from "./RuntimeProviders";
import { RuntimeThreadView, threadLabels } from "./RuntimeThreadView";

const active = (status: string) => ["QUEUED", "PLANNING", "DISPATCH_RESERVED", "EXECUTING"].includes(status);
function routeData(route: string) {
  try {
    const url = new URL(route, "http://runtime.local");
    const id = url.pathname.startsWith("/runtime/thread/") ? decodeURIComponent(url.pathname.slice(16)) : null;
    return { id: id || null, project: url.searchParams.get("project"), path: url.pathname };
  } catch { return { id: null, project: null, path: "/runtime/invalid" }; }
}

export function RuntimeWorkbench({ route, navigate, dark, setDark }: { route: string; navigate: (path: string) => void; dark: boolean; setDark: (value: boolean) => void }) {
  const parsed = routeData(route);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [projectId, setProjectId] = useState(parsed.project ?? "");
  const [profiles, setProfiles] = useState<RuntimeProfiles | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [catalog, setCatalog] = useState<{ project: string; data: RuntimeThreadSummary[] }>({ project: "", data: [] });
  const [detail, setDetail] = useState<{ scope: string; data: RuntimeThread | null }>({ scope: "", data: null });
  const [loadingThread, setLoadingThread] = useState(false);
  const [revision, setRevision] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [compact, setCompact] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(376);
  const [tab, setTab] = useState<RuntimeTab>("审查");
  const [narrow, setNarrow] = useState(window.innerWidth < 1200);
  const [mobile, setMobile] = useState(window.innerWidth < 760);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const overlay = useRef<HTMLDialogElement>(null);
  const mutation = useRef(false);
  const project = capabilities?.projects.find((item) => item.id === projectId);
  const rows = catalog.project === projectId && token ? catalog.data : [];
  const scope = `${projectId}:${parsed.id ?? ""}`;
  const thread = detail.scope === scope && token ? detail.data : null;
  const profile = profiles?.profiles.find((item) => `${item.id}@${item.revision}` === selectedProfile);
  const skill = project?.skills.find((item) => `${item.skill_id}@${item.skill_version}` === selectedSkill);
  const prompt = drafts[projectId] ?? "";
  const onHome = parsed.path === "/runtime" || parsed.path === "/runtime/";
  const onProviders = parsed.path === "/runtime/providers";
  const onPermissions = parsed.path === "/runtime/permissions";
  const onActivity = parsed.path === "/runtime/activity";
  const knownRoute = onHome || onProviders || onPermissions || onActivity || !!parsed.id;

  const reportError = useCallback((failure: unknown) => {
    setError(failure instanceof RuntimeError ? `${failure.code} · ${failure.message}` : "REQUEST_FAILED · 操作未能确认完成。请重新读取真实记录，不会自动重试。");
  }, []);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await runtimeApi.capabilities(controller.signal);
        if (controller.signal.aborted) return;
        setCapabilities(current);
        setProjectId((selected) => selected || current.projects[0]?.id || "");
        if (current.enabled && current.authenticated) {
          try { const restored = await runtimeApi.restoreSession(controller.signal); if (!controller.signal.aborted) setToken(restored.csrfToken); }
          catch { /* An unopened or expired session stays explicitly locked. */ }
        }
      } catch (failure) {
        if (!controller.signal.aborted) { setCapabilities({ enabled: false, authenticated: false, projects: [], allowedTools: [], blockedTools: ["run_tests"], limitations: ["当前服务未启用 Runtime，或无法安全连接。"] }); reportError(failure); }
      } finally { if (!controller.signal.aborted) setInitializing(false); }
    })();
    return () => controller.abort();
  }, [reportError]);
  useEffect(() => {
    const resize = () => { setNarrow(window.innerWidth < 1200); setMobile(window.innerWidth < 760); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    runtimeApi.profiles(controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setProfiles(data);
        setSelectedProfile((current) => current || (() => { const chosen = data.profiles.find((item) => item.id === data.activeProfileId) ?? data.profiles[0]; return chosen ? `${chosen.id}@${chosen.revision}` : ""; })());
      }
    }).catch((failure) => { if (!controller.signal.aborted) reportError(failure); });
    return () => controller.abort();
  }, [token, revision, reportError]);
  useEffect(() => {
    setSelectedSkill("");
    setSearch("");
  }, [projectId]);
  useEffect(() => {
    if (!token || !project) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const data = await runtimeApi.threads(project.id, controller.signal);
        if (controller.signal.aborted) return;
        setCatalog({ project: project.id, data });
        if (data.some((item) => active(item.status))) timer = setTimeout(() => void read(), 1000);
      } catch (failure) { if (!controller.signal.aborted) reportError(failure); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, project, revision, reportError]);
  useEffect(() => {
    if (!token || !project || !parsed.id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoadingThread(true);
    const read = async () => {
      try {
        const data = await runtimeApi.thread(project.id, parsed.id!, controller.signal);
        if (controller.signal.aborted) return;
        setDetail({ scope, data });
        setLoadingThread(false);
        if (active(data.status)) timer = setTimeout(() => void read(), 1000);
      } catch (failure) { if (!controller.signal.aborted) { setLoadingThread(false); setDetail({ scope, data: null }); reportError(failure); } }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, project, parsed.id, scope, revision, reportError]);
  useEffect(() => {
    if (!parsed.project || capabilities?.projects.some((item) => item.id === parsed.project) !== true) return;
    setProjectId(parsed.project);
  }, [parsed.project, capabilities]);
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    if ((drawer || sheet) && !element.open) element.showModal();
    if (!drawer && !sheet && element.open) element.close();
  }, [drawer, sheet]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); navigate("/runtime"); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="真实任务输入"]')?.focus()); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (mobile) setDrawer(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="搜索运行线程"]')?.focus()); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate, mobile]);
  function go(path: string) { navigate(path); setDrawer(false); setSheet(false); setError(""); }
  function openThread(id: string, currentProject = projectId) { setProjectId(currentProject); go(`/runtime/thread/${encodeURIComponent(id)}?project=${encodeURIComponent(currentProject)}`); }
  async function unlock(code: string) {
    if (mutation.current) return;
    mutation.current = true; setBusy("session"); setError("");
    try { const data = await runtimeApi.session(code); setToken(data.csrfToken); setCapabilities((current) => current ? { ...current, authenticated: true } : current); reload(); go("/runtime"); }
    catch (failure) { reportError(failure); }
    finally { mutation.current = false; setBusy(""); }
  }
  async function plan() {
    if (!token || !profile || !skill || !project || !prompt.trim() || mutation.current) return;
    mutation.current = true; setBusy("planning"); setError("");
    try {
      const created = await runtimeApi.plan(project.id, { prompt, profileId: profile.id, profileRevision: profile.revision, skillRef: skill }, token);
      setDetail({ scope: `${created.projectId}:${created.id}`, data: created });
      setDrafts((current) => ({ ...current, [project.id]: "" }));
      reload(); openThread(created.id, created.projectId);
    } catch (failure) { reportError(failure); }
    finally { mutation.current = false; setBusy(""); }
  }
  async function approve() {
    if (!token || !thread?.proposal || thread.status !== "AWAITING_APPROVAL" || mutation.current) return;
    mutation.current = true; setBusy("approval"); setError("");
    try { const updated = await runtimeApi.approve(thread, token); setDetail({ scope, data: updated }); reload(); }
    catch (failure) { reportError(failure); }
    finally { mutation.current = false; setBusy(""); }
  }
  const panel = <RuntimeInspector thread={thread} tab={tab} selectTab={setTab} close={() => narrow ? setSheet(false) : setInspector(false)} />;
  const sidebar = <div className={`sidebar-content runtime-sidebar-content ${compact && !mobile ? "compact" : ""}`}>
    <header className="brand-row"><AxisLogo size={28} /><strong>Axis<span>—</span>Evo</strong><button className="icon-button" aria-label="切换运行侧栏" onClick={() => mobile ? setDrawer(false) : setCompact((value) => !value)}><PanelLeftClose size={17} /></button></header>
    <button className="new-task-button" onClick={() => go("/runtime")} title="新建真实任务"><Plus size={17} /><span>新建任务</span><kbd>⌘ N</kbd></button>
    <nav aria-label="真实运行导航">{[{ path: "/runtime", label: "运行工作台", Icon: TerminalSquare }, { path: "/runtime/activity", label: "运行活动", Icon: Activity }, { path: "/runtime/providers", label: "Provider 配置", Icon: Server }, { path: "/runtime/permissions", label: "权限与环境", Icon: ShieldCheck }].map(({ path, label, Icon }) => <button className={`nav-item ${parsed.path === path || (path === "/runtime" && !!parsed.id) ? "active" : ""}`} key={path} onClick={() => go(path)} title={label}><Icon size={17} /><span>{label}</span></button>)}</nav>
    <div className="sidebar-section-title"><span>项目</span><Folder size={13} /></div><div className="project-picker"><Folder size={15} /><select aria-label="运行项目" value={projectId} onChange={(event) => { setProjectId(event.target.value); go("/runtime"); }}><option value="" disabled>选择已配置项目</option>{capabilities?.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></div>
    <div className="sidebar-section-title"><span>运行线程</span><span>{rows.length}</span></div><div className="runtime-sidebar-search"><Search size={14} /><input aria-label="搜索运行线程" placeholder="搜索线程…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="task-list">{rows.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())).map((item) => <button className={`task-item ${item.id === parsed.id ? "active" : ""}`} key={item.id} title={item.title} onClick={() => openThread(item.id)}><CircleDot size={13} className={item.status === "UNKNOWN" ? "status-running" : ""} /><span>{item.title}<small>{threadLabels[item.status]}</small></span></button>)}{!rows.length && <p className="caption sidebar-empty">{token ? "当前项目尚无线程" : "开启本地会话后读取线程"}</p>}</div>
    <footer className="sidebar-footer"><button className="nav-item" onClick={() => go("/skills")} title="查看只读Skills"><BookOpen size={17} /><span>Skills · 只读视图</span></button><button className="nav-item" onClick={() => go("/workbench")} title="返回演示与只读工作台"><ArrowLeft size={17} /><span>演示 / Core 只读</span></button><div className="local-note"><ShieldCheck size={17} /><span>受控本地 Runtime<small>{token ? "本地会话已开启" : "会话未授权"}</small></span><span className="version">0.2</span></div></footer>
  </div>;
  const style = { "--runtime-inspector-width": `${inspectorWidth}px` } as CSSProperties;
  const canPlan = !!token && !!project && !!profile?.credentialConfigured && !!skill && !!prompt.trim() && !busy;
  const showPanel = inspector && !narrow && !onProviders && !onPermissions;
  return <div style={style} className={`runtime-shell ${compact ? "runtime-compact" : ""} ${showPanel ? "runtime-with-inspector" : ""}`}>
    <a className="skip-link" href="#runtime-main" onClick={(event) => { event.preventDefault(); document.getElementById("runtime-main")?.focus(); }}>跳到运行内容</a>
    {!mobile && <aside className="sidebar" aria-label="运行项目与线程">{sidebar}</aside>}
    <header className="runtime-toolbar"><div className="toolbar-identity">{mobile && <button className="icon-button" aria-label="打开运行导航" onClick={() => { setSheet(false); setDrawer(true); }}><Menu size={18} /></button>}<Folder size={14} /><span>{project?.name ?? "本地 Runtime"}</span><ChevronRight size={12} /><span className="toolbar-task">{thread?.title ?? (onProviders ? "Provider 配置" : onPermissions ? "权限与环境" : "新任务")}</span></div><div className="toolbar-actions"><span className="runtime-source-label">RUNTIME · 本地执行</span><button className="icon-button" aria-label="刷新真实记录" onClick={reload}><RefreshCw size={15} /></button><button className="icon-button" aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button" aria-label="切换运行审查面板" aria-expanded={narrow ? sheet : showPanel} onClick={() => { if (narrow) { setDrawer(false); setSheet((value) => !value); } else setInspector((value) => !value); }}><PanelRight size={16} /></button></div></header>
    <main id="runtime-main" tabIndex={-1} className="runtime-main"><div className="runtime-security-strip"><ShieldCheck size={13} /><span>受控文件工具 · 计划需明确批准 · 独立验收</span><button className="text-button" onClick={() => go("/runtime/permissions")}>权限 <ChevronRight size={12} /></button></div><div className="runtime-scroll" tabIndex={0} aria-label="运行页面内容">
      {error && <div className="runtime-error" role="alert"><strong>操作未确认</strong><p>{error}</p><button className="text-button" onClick={() => setError("")}>关闭提示</button></div>}
      {initializing ? <Loading /> : !capabilities?.enabled ? <EmptyState title="真实运行尚未启用">当前服务只提供 Demo 或只读记录。请按启动文档配置安全 Runtime；不会显示预设成功结果。</EmptyState> : !token ? <RuntimePermissions capabilities={capabilities} unlocked={false} busy={busy === "session"} unlock={unlock} /> : !knownRoute ? <EmptyState title="运行页面不可用">返回运行工作台选择已有线程。</EmptyState> : onProviders ? <RuntimeProviders data={profiles} token={token} reload={reload} reportError={reportError} /> : onPermissions ? <RuntimePermissions capabilities={capabilities} unlocked busy={false} unlock={unlock} /> : onActivity ? <div className="runtime-settings-page"><div className="runtime-page-heading"><span className="page-eyebrow">本地已记录活动</span><h1>运行活动</h1><p>线程状态属于 Web Runtime，Core 事实进入具体线程后按 seq 审查。</p></div>{rows.length ? <div className="runtime-activity-list">{[...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => <button key={item.id} onClick={() => openThread(item.id)}><CircleDot size={16} /><span><strong>{item.title}</strong><small>{item.updatedAt} · {item.runId ? `Run ${item.runId}` : "Run 关联请进入线程核对"}</small></span><Badge>{threadLabels[item.status]}</Badge><ChevronRight size={14} /></button>)}</div> : <EmptyState title="没有运行活动">新建任务后会显示真实规划与执行状态。</EmptyState>}</div> : parsed.id ? loadingThread && !thread ? <Loading /> : thread ? <RuntimeThreadView thread={thread} busy={busy === "approval"} canAct={!!token} approve={() => void approve()} openReview={() => { setTab("审查"); if (narrow) setSheet(true); else setInspector(true); }} /> : <EmptyState title="线程不可用">未找到对应项目中的真实线程。不会使用演示记录替代。</EmptyState> : <div className="runtime-home"><AxisLogo size={42} /><span className="page-eyebrow">AXIS-EVO / LOCAL WORKBENCH</span><h1>这次需要完成什么？</h1><p>先生成一个可审查的计划，再明确授权执行。</p><div className="runtime-project-summary"><Folder size={17} /><span><strong>{project?.name ?? "尚未配置项目"}</strong><small>独立工作区 · 精确 Skill 绑定</small></span><Badge>FILE-ONLY</Badge></div><div className="section-heading"><h2>最近线程</h2><span className="caption">真实本地记录</span></div>{rows.length ? rows.slice(0, 5).map((item) => <button className="runtime-recent-thread" key={item.id} onClick={() => openThread(item.id)}><CircleDot size={15} /><span>{item.title}<small>{item.id}</small></span><Badge>{threadLabels[item.status]}</Badge><ChevronRight size={14} /></button>) : <EmptyState title="从第一个任务开始">选择模型与 Skill，描述任务目标。生成计划不会执行工具。</EmptyState>}</div>}
    </div>{capabilities?.enabled && token && onHome && <form className="runtime-composer" onSubmit={(event) => { event.preventDefault(); void plan(); }}><div className="runtime-composer-box"><textarea aria-label="真实任务输入" placeholder="描述目标和需要核验的结果…" rows={2} maxLength={12000} value={prompt} onChange={(event) => setDrafts((current) => ({ ...current, [projectId]: event.target.value }))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (canPlan) void plan(); } }} /><div className="runtime-composer-toolbar"><label><Server size={14} /><span className="sr-only">规划模型</span><select aria-label="规划模型" value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}><option value="">选择模型配置</option>{profiles?.profiles.map((item) => <option key={`${item.id}@${item.revision}`} value={`${item.id}@${item.revision}`}>{item.name} · r{item.revision}{item.credentialConfigured ? "" : " · 缺少凭据"}</option>)}</select></label><label><BookOpen size={14} /><span className="sr-only">规划Skill</span><select aria-label="规划Skill" value={selectedSkill} onChange={(event) => setSelectedSkill(event.target.value)}><option value="">明确选择 Skill</option>{project?.skills.map((item) => <option key={`${item.skill_id}@${item.skill_version}`} value={`${item.skill_id}@${item.skill_version}`}>{item.skill_id} · v{item.skill_version}</option>)}</select></label><button className="runtime-plan-button" aria-label="生成计划" disabled={!canPlan}><ArrowUp size={17} />{busy === "planning" ? "提交中…" : "生成计划"}</button></div></div><div className="composer-caption"><span>{!project ? "请先由后端配置允许的项目。" : !profile ? "选择已配置的模型，或前往 Provider 配置。" : !profile.credentialConfigured ? "对应后端凭据尚未配置。" : !skill ? "请明确选择一个准入 Skill 版本。" : "仅请求规划 · 完整计划批准后才执行文件工具"}</span><span>Ctrl / ⌘ + Enter</span></div></form>}</main>
    {showPanel && <><div className="runtime-resize-region" role="region" aria-label="审查面板布局"><div className="runtime-splitter" role="separator" aria-label="调整审查面板宽度" aria-orientation="vertical" tabIndex={0} aria-valuemin={320} aria-valuemax={520} aria-valuenow={inspectorWidth} onKeyDown={(event) => { const next = event.key === "ArrowLeft" ? inspectorWidth + 16 : event.key === "ArrowRight" ? inspectorWidth - 16 : event.key === "Home" ? 320 : event.key === "End" ? 520 : null; if (next !== null) { event.preventDefault(); setInspectorWidth(Math.max(320, Math.min(520, next))); } }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setInspectorWidth(Math.max(320, Math.min(520, window.innerWidth - event.clientX))); }} /></div><aside className="runtime-inspector" aria-label="运行审查面板">{panel}</aside></>}
    <dialog ref={overlay} className={`overlay-dialog ${drawer ? "navigation-drawer" : "inspector-sheet"}`} aria-label={drawer ? "运行导航" : "运行审查面板"} onKeyDown={keepDialogTab} onCancel={() => { setDrawer(false); setSheet(false); }} onClick={(event) => { if (event.target === event.currentTarget) { setDrawer(false); setSheet(false); } }}>{drawer ? <><button className="drawer-close icon-button" aria-label="关闭运行导航" onClick={() => setDrawer(false)}><X size={17} /></button>{sidebar}</> : sheet ? panel : null}</dialog>
  </div>;
}

import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, BookOpen, ChevronRight, CircleDot, FileCheck2, Moon, PanelRight, RefreshCw, Search, Server, Settings, ShieldCheck, Sun } from "lucide-react";
import { useWorkbench } from "../../hooks/useWorkbench";
import { useWorkbenchLayout } from "../../hooks/useWorkbenchLayout";
import type { EvolutionView as EvolutionData, Mode, ProviderProfile, RunView } from "../../lib/types";
import { WorkbenchShell } from "../layout/WorkbenchShell";
import { WorkbenchSidebar } from "../layout/WorkbenchSidebar";
import { CommandPalette, type Command } from "../layout/CommandPalette";
import { Inspector, type InspectorTab } from "../inspector/Inspector";
import { Composer } from "../tasks/Composer";
import { PlanCard } from "../tasks/PlanCard";
import { Timeline } from "../tasks/Timeline";
import { ProviderSettings } from "../providers/ProviderSettings";
import { SkillsView } from "../skills/SkillsView";
import { EvolutionView } from "../skills/EvolutionView";
import { AxisLogo } from "../ui/AxisLogo";
import { Badge, EmptyState, Loading, runTone } from "../ui/Primitives";

function routeIdentity(route: string, prefix: string): string | null {
  if (!route.startsWith(prefix)) return null;
  try { return decodeURIComponent(route.slice(prefix.length)) || null; }
  catch { return null; }
}

export function LegacyWorkbench({ route, navigate, dark, setDark }: {
  route: string;
  navigate: (path: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("demo");
  const [projectId, setProjectId] = useState("axis-evo");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [palette, setPalette] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("概览");
  const [toast, setToast] = useState("");
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [skill, setSkill] = useState("");
  const [conversation, setConversation] = useState(0);
  const [evolution, setEvolution] = useState<{ scope: string; value: EvolutionData | null }>({ scope: "", value: null });
  const layout = useWorkbenchLayout();
  const { closeOverlays, resetLayout, toggleInspector, showInspector } = layout;
  const runId = routeIdentity(route, "/task/");
  const evolutionId = routeIdentity(route, "/evolution/");
  const data = useWorkbench(mode, projectId, runId, revision);
  const { readEvolution } = data;
  const home = route === "/workbench";
  const knownRoute = ["/workbench", "/skills", "/activity", "/settings"].includes(route) || !!runId || !!evolutionId;
  const evolutionScope = `${mode}:${projectId}:${evolutionId}`;
  const runs = data.catalog.data.runs;
  const run = runId ? data.run.data : null;
  const sourceError = data.projects.state === "error" ? data.projects.error : data.catalog.state === "error" ? data.catalog.error : undefined;
  const go = useCallback((path: string) => {
    closeOverlays();
    window.dispatchEvent(new Event("axis:new-conversation"));
    navigate(path);
  }, [closeOverlays, navigate]);
  const notify = useCallback((message: string) => setToast(message), []);
  const newConversation = useCallback(() => {
    resetLayout();
    setPalette(false);
    setToast("");
    setSearch("");
    setTab("概览");
    setConversation((value) => value + 1);
    go("/workbench");
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="任务草稿"]')?.focus());
  }, [go, resetLayout]);

  useEffect(() => {
    if (mode === "connected" && data.projects.state === "ready" && !data.projects.data.some((project) => project.id === projectId)) setProjectId(data.projects.data[0]?.id ?? "");
  }, [mode, data.projects, projectId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        closeOverlays();
        setPalette((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newConversation(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeOverlays, newConversation]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => { resetLayout(); }, [route, resetLayout]);
  useEffect(() => {
    setEvolution({ scope: evolutionScope, value: null });
    if (!evolutionId) return;
    const controller = new AbortController();
    readEvolution(evolutionId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setEvolution({ scope: evolutionScope, value }); })
      .catch(() => { if (!controller.signal.aborted) setEvolution({ scope: evolutionScope, value: null }); });
    return () => controller.abort();
  }, [evolutionId, readEvolution, evolutionScope]);

  function changeMode(value: Mode) {
    setMode(value);
    setProjectId(value === "demo" ? "axis-evo" : "");
    setSearch("");
    setSkill("");
    setEvolution({ scope: "", value: null });
    setToast("");
    go("/workbench");
  }
  function setProject(id: string) {
    setProjectId(id);
    setSearch("");
    setSkill("");
    setToast("");
    go("/workbench");
  }
  function inspect(target: InspectorTab) { setTab(target); showInspector(); }

  const commands: Command[] = [
    { label: "新对话", run: newConversation },
    { label: "Skills", run: () => go("/skills") },
    { label: "活动", run: () => go("/activity") },
    { label: "设置", run: () => go("/settings") },
    { label: "进入真实运行", run: () => go("/runtime") },
    ...(runId ? [{ label: "查看证据", run: toggleInspector }] : []),
    { label: "切换主题", run: () => setDark(!dark) },
    ...runs.map((item) => ({ label: item.title, hint: item.status, run: () => go(`/task/${encodeURIComponent(item.id)}`) })),
  ];
  const sidebar = <WorkbenchSidebar
    compact={!layout.mobile && layout.compact}
    toggle={layout.toggleSidebar}
    newConversation={newConversation}
    search={search}
    setSearch={setSearch}
    threads={runs.map((item) => ({ id: item.id, title: item.title, status: item.status, warning: item.status === "FAILED" || item.status === "INTERRUPTED" }))}
    currentThread={runId}
    openThread={(id) => go(`/task/${encodeURIComponent(id)}`)}
    searchAction={() => { closeOverlays(); setPalette(true); }}
    links={[
      { label: "Skills", Icon: BookOpen, action: () => go("/skills"), active: route === "/skills" },
      { label: "活动", Icon: Activity, action: () => go("/activity"), active: route === "/activity" },
      { label: "设置", Icon: Settings, action: () => go("/settings"), active: route === "/settings" },
      { label: "进入真实运行", Icon: Server, action: () => go("/runtime") },
    ]}
    modeLabel={mode === "demo" ? "DEMO · 演示" : "CORE · 只读"}
    modeHint={mode === "demo" ? "预设示例，非真实执行历史" : "已配置的本地只读记录"}
  />;
  const toolbar = <>
    <div className="cds-toolbar-identity"><span className="toolbar-task">{run?.title ?? (route === "/skills" ? "Skills" : route === "/settings" ? "模型配置草稿" : route === "/activity" ? "活动" : evolutionId ? "演化证据" : "新对话")}</span></div>
    <div className="cds-toolbar-actions">
      {run?.model.modelId && <span className="model-label" title="记录中的模型">{run.model.modelId}</span>}
      <label className="mode-picker cds-mode-picker"><span className="sr-only">数据模式</span><select aria-label="数据模式" value={mode} onChange={(event) => changeMode(event.target.value as Mode)}><option value="demo">DEMO · 演示</option><option value="connected">CORE · 只读</option></select></label>
      <button className="icon-button" aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      {runId && <button className="icon-button" aria-label="查看证据" aria-expanded={layout.narrow ? layout.sheet : layout.inspector} onClick={toggleInspector}><PanelRight size={17} /></button>}
    </div>
  </>;

  return <WorkbenchShell layout={layout} sidebar={sidebar} toolbar={toolbar} className="cds-legacy" resetKey={`${mode}:${projectId}:${route}:${conversation}`}
    inspector={runId ? <Inspector key={`${mode}:${projectId}:${runId}`} run={run} mode={mode} tab={tab} setTab={setTab} close={resetLayout} /> : undefined}
    inspectorLabel="检查面板"
    overlays={<><CommandPalette open={palette} close={() => setPalette(false)} commands={commands} />{toast && <div className="toast" role="status">{toast}</div>}</>}>
    <div className={`workspace-scroll ${home ? "cds-home" : ""}`}>
      {home && <h1 className="cds-welcome">今天，想完成什么？</h1>}
      {!home && mode === "connected" && (sourceError ? <EmptyState title="只读后端不可用" action={<button className="button secondary" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} />重新检查连接</button>}>{sourceError}</EmptyState> : data.projects.state === "loading" || data.catalog.state === "loading" ? <Loading /> : null)}
      {!sourceError && <>
        {!knownRoute && <EmptyState title="页面不可用" action={<button className="button secondary" onClick={newConversation}>返回工作台</button>}>地址无效。请选择项目中的已有记录。</EmptyState>}
        {runId && (data.run.state === "loading" ? <Loading /> : data.run.state === "error" ? <EmptyState title="运行不可用">{data.run.error}</EmptyState> : run ? <TaskView run={run} inspect={inspect} /> : <EmptyState title="未找到此任务">选择当前项目中的一个已有任务。</EmptyState>)}
        {route === "/skills" && <SkillsView key={`${mode}:${projectId}`} skills={data.catalog.data.skills} read={data.readSkill} navigate={go} caseForSkill={(id, version) => data.catalog.data.evolutions.find((item) => item.sourceSkillRef.skill_id === id && item.sourceSkillRef.skill_version === version)?.id} />}
        {evolutionId && <EvolutionView key={evolutionScope} evolution={evolution.scope === evolutionScope ? evolution.value : null} mode={mode} />}
        {route === "/activity" && <div className="page"><div className="page-eyebrow"><Search size={15} />已持久化活动</div><h1>活动</h1><p className="page-description">选择运行后，按 seq 查看已加载的事件。不推断缺失的执行。</p><div className="activity-runs">{runs.map((item) => <button className="button secondary" key={item.id} onClick={() => { setTab("事件"); go(`/task/${encodeURIComponent(item.id)}`); }}>{item.title}<ChevronRight size={13} /></button>)}</div>{!runs.length && <EmptyState title="没有可显示的活动">当前项目还没有运行记录。</EmptyState>}</div>}
        {route === "/settings" && <ProviderSettings profiles={profiles} selected={profile} select={setProfile} save={(value) => setProfiles((values) => [...values.filter((item) => item.id !== value.id), value])} notify={notify} />}
      </>}
      <Composer key={conversation} visible={home || !!runId} scope={`${mode}:${projectId}:${runId ?? "new"}`} notify={notify}
        projectSelection={{ value: projectId, options: data.projects.data.map((item) => ({ value: item.id, label: item.name })), onChange: setProject }}
        profileSelection={{ value: profile ?? "", options: [{ value: "", label: "配置草稿 · 未选择" }, ...profiles.map((item) => ({ value: item.id, label: item.name, description: `草稿 · ${item.modelId}` }))], onChange: (value) => setProfile(value || null) }}
        skillSelection={{ value: skill, options: [{ value: "", label: "Skill · 未选择" }, ...data.catalog.data.skills.map((item) => ({ value: `${item.id}@${item.version}`, label: `${item.name} · v${item.version}` }))], onChange: setSkill }}
        status={sourceError ? `只读后端不可用 · ${sourceError}` : mode === "connected" && data.projects.state === "loading" ? "正在读取本地数据源…" : undefined}
        statusAction={sourceError ? () => setRevision((value) => value + 1) : undefined}
      />
    </div>
  </WorkbenchShell>;
}

function TaskView({ run, inspect }: { run: RunView; inspect: (tab: InspectorTab) => void }) {
  const unknown = run.inspection.observations.includes("EXECUTION_RESULT_UNKNOWN");
  const validation = run.events.find((event) => event.type === "VALIDATION_PASSED" || event.type === "VALIDATION_FAILED");
  return <article className="task-page cds-conversation">
    <div className="page-eyebrow"><span className="eyebrow-line" />TASK / {run.taskId}</div>
    <div className="task-heading"><h1>{run.title}</h1><Badge tone={runTone(run.status)}>{run.status}</Badge></div>
    <div className="task-meta"><span>存储状态 · {run.status}</span><span>{run.events.length} / {run.eventCount} 条可见事件</span><span>计划版本 · {run.plan?.skillRef ? `v${run.plan.skillRef.skill_version}` : "未记录"}</span></div>
    <section className="cds-user-message"><p>{run.goal ?? "此源没有可显示的任务目标，不从计划或事件推测用户原话。"}</p></section>
    <div className="cds-assistant-content">
      <div className="core-activity-label"><AxisLogo size={22} /><strong>结构化执行事实</strong><span>系统活动 · 非对话转写</span></div>
      {run.inspection.traceConsistent === false && <section className="integrity-callout" role="alert"><strong>INTEGRITY_FAILURE · 轨迹核验未通过</strong><p>轨迹包含完整性问题。存储状态与验收事件按原值展示，不代表证据已通过核验。</p></section>}
      {unknown && <section className="unknown-callout"><CircleDot size={19} /><div><h2>执行结果尚不确定</h2><p>TOOL_INTENT 已记录，但 TOOL_RESULT 未持久化。当前文件变化不能证明工具执行因果。</p><span>EXECUTION_RESULT_UNKNOWN · Source outcome: UNKNOWN</span><button className="text-button" onClick={() => inspect("恢复")}>查看独立恢复证据<ArrowRight size={13} /></button></div></section>}
      <PlanCard plan={run.plan} inspectProposal={() => inspect("计划")} />
      <details className="cds-event-disclosure"><summary>执行记录<span>{run.events.length} 条事件</span></summary><div className="section-heading execution-heading"><h2>执行记录</h2><button className="text-button" onClick={() => inspect("事件")}>查看事件<ArrowRight size={13} /></button></div><Timeline events={run.events} /></details>
      <section className={`validation-summary ${validation?.type === "VALIDATION_FAILED" ? "validation-failed" : ""}`}><ShieldCheck size={17} /><div><strong>独立验收 · {validation ? validation.type === "VALIDATION_PASSED" ? "PASSED" : "FAILED" : "尚无结果"}</strong><p>{validation ? "任务完成由独立 Acceptance 决定，与工具返回状态分别记录。" : run.eventsTruncated || run.eventCount > run.events.length ? "当前已加载前缀没有验收结果；后续事件未加载，不推断其是否持久化。" : "当前已加载事件未包含验收结果，不显示任务已通过。"}</p></div><button className="icon-button" aria-label="查看验收证据" onClick={() => inspect("概览")}><FileCheck2 size={17} /></button></section>
    </div>
  </article>;
}

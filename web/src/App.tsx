import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  CircleDot,
  FileCheck2,
  FolderOpen,
  LockKeyhole,
  Menu,
  Moon,
  PanelRight,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { useWorkbench } from "./hooks/useWorkbench";
import type {
  EvolutionView as EvolutionData,
  Mode,
  ProviderProfile,
  RunView,
} from "./lib/types";
import { Sidebar } from "./components/layout/Sidebar";
import {
  CommandPalette,
  type Command,
} from "./components/layout/CommandPalette";
import { Inspector, type InspectorTab } from "./components/inspector/Inspector";
import { Composer } from "./components/tasks/Composer";
import { PlanCard } from "./components/tasks/PlanCard";
import { Timeline } from "./components/tasks/Timeline";
import { ProviderSettings } from "./components/providers/ProviderSettings";
import { SkillsView } from "./components/skills/SkillsView";
import { EvolutionView } from "./components/skills/EvolutionView";
import {
  Badge,
  EmptyState,
  Loading,
  keepDialogTab,
  runTone,
} from "./components/ui/Primitives";

function routeIdentity(route: string, prefix: string): string | null {
  if (!route.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(route.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

export default function App() {
  const [route, setRoute] = useState(
    () => window.location.hash.slice(1) || "/workbench",
  );
  const [mode, setMode] = useState<Mode>("demo");
  const [projectId, setProjectId] = useState("axis-evo");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [narrow, setNarrow] = useState(window.innerWidth < 1200);
  const [mobile, setMobile] = useState(window.innerWidth < 760);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("概览");
  const [toast, setToast] = useState("");
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [evolution, setEvolution] = useState<{
    scope: string;
    value: EvolutionData | null;
  }>({ scope: "", value: null });
  const overlay = useRef<HTMLDialogElement>(null);
  const runId = routeIdentity(route, "/task/");
  const data = useWorkbench(mode, projectId, runId, revision);
  const { readEvolution } = data;
  const navigate = useCallback((path: string) => {
    window.location.hash = path;
    setRoute(path);
    setDrawer(false);
    setSheet(false);
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    const change = () =>
      setRoute(window.location.hash.slice(1) || "/workbench");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const resize = () => {
      setNarrow(window.innerWidth < 1200);
      setMobile(window.innerWidth < 760);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (
      mode === "connected" &&
      data.projects.state === "ready" &&
      !data.projects.data.some((p) => p.id === projectId)
    )
      setProjectId(data.projects.data[0]?.id ?? "");
  }, [mode, data.projects, projectId]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(false);
        setSheet(false);
        setPalette((value) => !value);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("/workbench");
        document
          .querySelector<HTMLTextAreaElement>('[aria-label="任务草稿"]')
          ?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    if ((drawer || sheet) && !element.open) element.showModal();
    if (!drawer && !sheet && element.open) element.close();
  }, [drawer, sheet]);
  const evolutionId = routeIdentity(route, "/evolution/");
  const knownRoute =
    ["/workbench", "/skills", "/activity", "/settings"].includes(route) ||
    !!runId ||
    !!evolutionId;
  const evolutionScope = `${mode}:${projectId}:${evolutionId}`;
  useEffect(() => {
    setEvolution({ scope: evolutionScope, value: null });
    if (!evolutionId) return;
    const controller = new AbortController();
    readEvolution(evolutionId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setEvolution({ scope: evolutionScope, value });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setEvolution({ scope: evolutionScope, value: null });
      });
    return () => controller.abort();
  }, [evolutionId, readEvolution, evolutionScope]);
  function changeMode(value: Mode) {
    setMode(value);
    setProjectId(value === "demo" ? "axis-evo" : "");
    setSearch("");
    setEvolution({ scope: "", value: null });
    navigate("/workbench");
  }
  function setProject(id: string) {
    setProjectId(id);
    setSearch("");
    navigate("/workbench");
  }
  function toggleInspector() {
    if (narrow) {
      setDrawer(false);
      setSheet((value) => !value);
    } else setInspector((value) => !value);
  }
  const runs = data.catalog.data.runs;
  const run = runId ? data.run.data : null;
  const commands: Command[] = [
    { label: "工作台", run: () => navigate("/workbench") },
    { label: "Skills", run: () => navigate("/skills") },
    { label: "活动", run: () => navigate("/activity") },
    { label: "设置", run: () => navigate("/settings") },
    { label: "切换检查面板", run: toggleInspector },
    { label: "切换主题", run: () => setDark((value) => !value) },
    ...runs.map((r) => ({
      label: r.title,
      hint: r.status,
      run: () => navigate(`/task/${encodeURIComponent(r.id)}`),
    })),
  ];
  const sidebar = (
    <Sidebar
      projects={data.projects.data}
      projectId={projectId}
      setProject={setProject}
      runs={runs}
      currentRun={runId}
      navigate={navigate}
      route={route}
      compact={!mobile && compact}
      toggle={() => (mobile ? setDrawer(false) : setCompact((value) => !value))}
      openSearch={() => {
        setDrawer(false);
        setPalette(true);
      }}
      search={search}
      setSearch={setSearch}
      mode={mode}
    />
  );
  const inspectorPanel = (
    <Inspector
      key={`${mode}:${projectId}:${runId}`}
      run={run}
      mode={mode}
      tab={tab}
      setTab={setTab}
      close={() => (narrow ? setSheet(false) : setInspector(false))}
    />
  );
  const sourceError =
    data.projects.state === "error"
      ? data.projects.error
      : data.catalog.state === "error"
        ? data.catalog.error
        : undefined;
  return (
    <div
      className={`app-shell ${compact ? "sidebar-compact" : ""} ${inspector && !narrow ? "with-inspector" : ""}`}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      {!mobile && (
        <aside className="sidebar" aria-label="项目与任务导航">
          {sidebar}
        </aside>
      )}
      <header className="app-toolbar">
        <div className="toolbar-identity">
          {mobile && (
            <button
              className="icon-button"
              aria-label="切换侧栏"
              onClick={() => {
                setSheet(false);
                setDrawer(true);
              }}
            >
              <Menu size={18} />
            </button>
          )}
          <FolderOpen size={15} />
          <span>
            {data.projects.data.find((p) => p.id === projectId)?.name ??
              "未选择项目"}
          </span>
          <ChevronRight size={13} />
          <span className="toolbar-task">
            {run?.title ??
              (route === "/skills"
                ? "Skills"
                : route === "/settings"
                  ? "模型配置"
                  : "工作台")}
          </span>
        </div>
        <div className="toolbar-actions">
          <span className="model-label">
            {run?.model.modelId ?? "模型未连接"}
          </span>
          <label className="mode-picker">
            <span className="sr-only">数据模式</span>
            <select
              aria-label="数据模式"
              value={mode}
              onChange={(e) => changeMode(e.target.value as Mode)}
            >
              <option value="demo">DEMO · 演示</option>
              <option value="connected">CORE · 只读</option>
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="切换主题"
            onClick={() => setDark((value) => !value)}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="切换检查面板"
            aria-expanded={narrow ? sheet : inspector}
            onClick={toggleInspector}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="main-workspace">
        <div className={`source-strip ${mode === "demo" ? "" : "core-strip"}`}>
          <span>
            <span className="source-dot" />
            {mode === "demo"
              ? "演示模式 · 所有场景为预设示例，非真实执行历史"
              : "Core 只读 · 来自显式配置的本地数据源"}
          </span>
          {mode === "demo" ? (
            <select
              aria-label="演示场景"
              value={runId ?? ""}
              onChange={(e) =>
                navigate(
                  e.target.value ? `/task/${e.target.value}` : "/workbench",
                )
              }
            >
              <option value="">选择场景</option>
              {runs.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          ) : (
            <button
              className="text-button"
              aria-label="重新检查连接"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={13} /> 重新检查连接
            </button>
          )}
        </div>
        <div className="workspace-scroll">
          {mode === "connected" &&
            (sourceError ? (
              <EmptyState
                title="只读后端不可用"
                action={
                  <button
                    className="button secondary"
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    重新检查连接
                  </button>
                }
              >
                {sourceError}
              </EmptyState>
            ) : data.projects.state === "loading" ||
              data.catalog.state === "loading" ? (
              <Loading />
            ) : null)}
          {!sourceError && (
            <>
              {!knownRoute && (
                <EmptyState
                  title="页面不可用"
                  action={
                    <button
                      className="button secondary"
                      onClick={() => navigate("/workbench")}
                    >
                      返回工作台
                    </button>
                  }
                >
                  地址无效。请选择项目中的已有记录。
                </EmptyState>
              )}
              {route === "/workbench" && (
                <div className="home-page">
                  <div className="home-brand">
                    <img src="/axis.svg" width="42" height="42" alt="" />
                  </div>
                  <div className="page-eyebrow">AXIS-EVO WORKBENCH</div>
                  <h1>让每一步，都有据可循。</h1>
                  <p>
                    从一个清晰的目标开始。计划、执行与验收，分别留下可审查的事实。
                  </p>
                  <div className="home-workspace">
                    <FolderOpen size={17} />
                    <span>
                      {data.projects.data.find((p) => p.id === projectId)
                        ?.name ?? "尚未配置项目"}
                      <small>
                        {mode === "demo"
                          ? "本地演示工作区"
                          : "仅展示已提交的 Core 记录"}
                      </small>
                    </span>
                    <LockKeyhole size={15} />
                  </div>
                  <div className="home-recent">
                    <div className="section-heading">
                      <h2>最近任务</h2>
                      <span className="caption">
                        {mode === "demo" ? "预设场景" : "已记录的运行"}
                      </span>
                    </div>
                    {runs.length ? (
                      runs.slice(0, 4).map((r) => (
                        <button
                          className="recent-row"
                          key={r.id}
                          onClick={() =>
                            navigate(`/task/${encodeURIComponent(r.id)}`)
                          }
                        >
                          <CircleDot
                            size={15}
                            className={`status-${r.status.toLowerCase()}`}
                          />
                          <span>
                            {r.title}
                            <small>{r.taskId}</small>
                          </span>
                          <Badge tone={runTone(r.status)}>{r.status}</Badge>
                          <ArrowRight size={14} />
                        </button>
                      ))
                    ) : (
                      <EmptyState title="没有运行记录">
                        通过启动配置选择已有数据库。此处不会创建任务或运行。
                      </EmptyState>
                    )}
                  </div>
                </div>
              )}
              {runId &&
                (data.run.state === "loading" ? (
                  <Loading />
                ) : data.run.state === "error" ? (
                  <EmptyState title="运行不可用">{data.run.error}</EmptyState>
                ) : run ? (
                  <TaskView
                    run={run}
                    inspect={(target) => {
                      setTab(target);
                      if (narrow) setSheet(true);
                      else setInspector(true);
                    }}
                  />
                ) : (
                  <EmptyState title="未找到此任务">
                    选择当前项目中的一个已有任务。
                  </EmptyState>
                ))}
              {route === "/skills" && (
                <SkillsView
                  key={`${mode}:${projectId}`}
                  skills={data.catalog.data.skills}
                  read={data.readSkill}
                  navigate={navigate}
                  caseId={data.catalog.data.evolutions[0]?.id}
                />
              )}
              {evolutionId && (
                <EvolutionView
                  key={evolutionScope}
                  evolution={
                    evolution.scope === evolutionScope ? evolution.value : null
                  }
                  mode={mode}
                />
              )}
              {route === "/activity" && (
                <div className="page">
                  <div className="page-eyebrow">
                    <Search size={15} /> 已持久化活动
                  </div>
                  <h1>活动</h1>
                  <p className="page-description">
                    选择运行后，按 seq 查看已加载的事件。不推断缺失的执行。
                  </p>
                  <div className="activity-runs">
                    {runs.map((r) => (
                      <button
                        className="button secondary"
                        key={r.id}
                        onClick={() => {
                          setTab("事件");
                          navigate(`/task/${encodeURIComponent(r.id)}`);
                        }}
                      >
                        {r.title}
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                  {!runs.length && (
                    <EmptyState title="没有可显示的活动">
                      当前项目还没有运行记录。
                    </EmptyState>
                  )}
                </div>
              )}
              {route === "/settings" && (
                <ProviderSettings
                  profiles={profiles}
                  selected={profile}
                  select={setProfile}
                  save={(value) =>
                    setProfiles((values) => [
                      ...values.filter((p) => p.id !== value.id),
                      value,
                    ])
                  }
                  notify={notify}
                />
              )}
            </>
          )}
        </div>
        <Composer
          visible={route === "/workbench" || !!runId}
          scope={`${mode}:${projectId}:${runId ?? "new"}`}
          notify={notify}
        />
      </main>
      {!narrow && inspector && (
        <aside className="inspector-pane" aria-label="检查面板">
          {inspectorPanel}
        </aside>
      )}
      <dialog
        ref={overlay}
        className={`overlay-dialog ${drawer ? "navigation-drawer" : "inspector-sheet"}`}
        aria-label={drawer ? "项目导航" : "检查面板"}
        onKeyDown={keepDialogTab}
        onCancel={() => {
          setDrawer(false);
          setSheet(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setDrawer(false);
            setSheet(false);
          }
        }}
      >
        {drawer ? (
          <>
            <button
              className="drawer-close icon-button"
              aria-label="关闭项目导航"
              onClick={() => setDrawer(false)}
            >
              <X size={17} />
            </button>
            {sidebar}
          </>
        ) : sheet ? (
          inspectorPanel
        ) : null}
      </dialog>
      <CommandPalette
        open={palette}
        close={() => setPalette(false)}
        commands={commands}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function TaskView({
  run,
  inspect,
}: {
  run: RunView;
  inspect: (tab: InspectorTab) => void;
}) {
  const unknown = run.inspection.observations.includes(
    "EXECUTION_RESULT_UNKNOWN",
  );
  const validation = run.events.find(
    (e) => e.type === "VALIDATION_PASSED" || e.type === "VALIDATION_FAILED",
  );
  return (
    <article className="task-page">
      <div className="page-eyebrow">
        <span className="eyebrow-line" /> TASK / {run.taskId}
      </div>
      <div className="task-heading">
        <h1>{run.title}</h1>
        <Badge tone={runTone(run.status)}>{run.status}</Badge>
      </div>
      <div className="task-meta">
        <span>存储状态 · {run.status}</span>
        <span>
          {run.events.length} / {run.eventCount} 条可见事件
        </span>
        <span>
          精确版本 ·{" "}
          {run.plan?.skillRef
            ? `v${run.plan.skillRef.skill_version}`
            : "未绑定"}
        </span>
      </div>
      {run.inspection.traceConsistent === false && (
        <section className="integrity-callout" role="alert">
          <strong>INTEGRITY_FAILURE · 轨迹核验未通过</strong>
          <p>
            轨迹包含完整性问题。存储状态与验收事件按原值展示，不代表证据已通过核验。
          </p>
        </section>
      )}
      <section className="objective-block">
        <span className="avatar">你</span>
        <div>
          <span className="objective-label">任务目标</span>
          <p>
            {run.goal ??
              "此源没有可显示的任务目标，不从计划或事件推测用户原话。"}
          </p>
        </div>
      </section>
      {unknown && (
        <section className="unknown-callout">
          <CircleDot size={19} />
          <div>
            <h2>执行结果尚不确定</h2>
            <p>
              TOOL_INTENT 已记录，但 TOOL_RESULT
              未持久化。当前文件变化不能证明工具执行因果。
            </p>
            <span>EXECUTION_RESULT_UNKNOWN · Source outcome: UNKNOWN</span>
            <button className="text-button" onClick={() => inspect("恢复")}>
              查看独立恢复证据 <ArrowRight size={13} />
            </button>
          </div>
        </section>
      )}
      <div className="core-activity-label">
        <img src="/axis.svg" alt="" width="23" height="23" />
        <strong>结构化执行事实</strong>
        <span>系统活动 · 非对话转写</span>
      </div>
      <PlanCard plan={run.plan} />
      <div className="section-heading execution-heading">
        <h2>执行记录</h2>
        <button className="text-button" onClick={() => inspect("事件")}>
          查看事件 <ArrowRight size={13} />
        </button>
      </div>
      <Timeline events={run.events} />
      <section
        className={`validation-summary ${validation?.type === "VALIDATION_FAILED" ? "validation-failed" : ""}`}
      >
        <ShieldCheck size={17} />
        <div>
          <strong>
            独立验收 ·{" "}
            {validation
              ? validation.type === "VALIDATION_PASSED"
                ? "PASSED"
                : "FAILED"
              : "尚无结果"}
          </strong>
          <p>
            {validation
              ? "任务完成由独立 Acceptance 决定，与工具返回状态分别记录。"
              : run.eventsTruncated || run.eventCount > run.events.length
                ? "当前已加载前缀没有验收结果；后续事件未加载，不推断其是否持久化。"
                : "当前已加载事件未包含验收结果，不显示任务已通过。"}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="查看验收证据"
          onClick={() => inspect("概览")}
        >
          <FileCheck2 size={17} />
        </button>
      </section>
    </article>
  );
}

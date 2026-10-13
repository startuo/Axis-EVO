import {
  Activity,
  BookOpen,
  ChevronDown,
  CircleDot,
  Folder,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import type { Mode, ProjectView, RunSummary } from "../../lib/types";
import { AxisLogo } from "../ui/AxisLogo";
export function Sidebar({
  projects,
  projectId,
  setProject,
  runs,
  currentRun,
  navigate,
  route,
  compact,
  toggle,
  openSearch,
  search,
  setSearch,
  mode,
}: {
  projects: ProjectView[];
  projectId: string;
  setProject: (id: string) => void;
  runs: RunSummary[];
  currentRun: string | null;
  navigate: (route: string) => void;
  route: string;
  compact: boolean;
  toggle: () => void;
  openSearch: () => void;
  search: string;
  setSearch: (value: string) => void;
  mode: Mode;
}) {
  return (
    <div className={`sidebar-content ${compact ? "compact" : ""}`}>
      <header className="brand-row">
        <AxisLogo size={28} />
        <strong>
          Axis<span>—</span>Evo
        </strong>
        <button className="icon-button" aria-label="切换侧栏" onClick={toggle}>
          <PanelLeftClose size={17} />
        </button>
      </header>
      <button
        className="new-task-button"
        onClick={() => navigate("/workbench")}
        title="新建任务草稿"
      >
        <Plus size={17} />
        <span>新任务草稿</span>
        <kbd>⌘ N</kbd>
      </button>
      <button className="sidebar-search" onClick={openSearch}>
        <Search size={15} />
        <span>搜索命令与任务</span>
        <kbd>⌘ K</kbd>
      </button>
      <nav aria-label="主导航">
        {[
          { path: "/workbench", name: "工作台", Icon: SquareTerminal },
          { path: "/skills", name: "Skills", Icon: BookOpen },
          { path: "/activity", name: "活动", Icon: Activity },
        ].map(({ path, name, Icon }) => (
          <button
            key={path}
            className={`nav-item ${route === path || (path === "/workbench" && route.startsWith("/task/")) ? "active" : ""}`}
            onClick={() => navigate(path)}
            title={name}
          >
            <Icon size={17} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-section-title">
        <span>项目</span>
        <Folder size={13} />
      </div>
      <div className="project-picker">
        <Folder size={15} />
        <select
          aria-label="选择项目"
          value={projectId}
          onChange={(e) => setProject(e.target.value)}
        >
          {!projects.length && <option value="">无配置项目</option>}
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </div>
      <div className="sidebar-section-title">
        <span>最近任务</span>
        <span>{runs.length}</span>
      </div>
      <input
        className="task-search"
        aria-label="搜索任务"
        placeholder="筛选任务…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="task-list">
        {runs
          .filter((run) =>
            run.title.toLowerCase().includes(search.toLowerCase()),
          )
          .map((run) => (
            <button
              className={`task-item ${currentRun === run.id ? "active" : ""}`}
              key={run.id}
              onClick={() => navigate(`/task/${encodeURIComponent(run.id)}`)}
              title={run.title}
            >
              <CircleDot
                size={13}
                className={`status-${run.status.toLowerCase()}`}
              />
              <span>
                {run.title}
                <small>{run.status}</small>
              </span>
            </button>
          ))}
        {!runs.length && (
          <p className="caption sidebar-empty">当前项目没有运行记录</p>
        )}
      </div>
      <footer className="sidebar-footer">
        <button
          className={`nav-item ${route === "/settings" ? "active" : ""}`}
          onClick={() => navigate("/settings")}
          title="设置"
        >
          <Settings2 size={17} />
          <span>设置</span>
        </button>
        <div className="local-note">
          <span className="local-avatar">A</span>
          <span>
            本地工作台
            <small>
              {mode === "demo" ? "预设演示场景" : "已配置 Core · 只读"}
            </small>
          </span>
          <span className="version">0.1</span>
        </div>
      </footer>
    </div>
  );
}

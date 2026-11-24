/**
 * 单左侧栏（Codex / Linear 风格）：
 * - 左上角：Axis 图形标徽 + Axis 文字 Logo，折叠态保留图形标徽
 * - 主导航：新任务（合并原“工作”与“新任务”）、技能、代理
 * - 折叠模式：平滑收起为 56px 侧边图标栏（带右侧 Tooltip），而非整栏消失
 * - 底栏：左下角为「设置」，侧边栏右侧为「刷新」与「主题切换」
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bot, ChevronDown, Folder, LoaderCircle, Moon, PanelLeftClose, PanelLeftOpen,
  Pin, PinOff, Search, Settings, Sparkles, SquarePen, Sun,
} from 'lucide-react';
import type { Session, Task, Workspace } from '@axis/protocol';
import type { Route } from '../hooks/useHashRoute';
import { useSocketEvent } from '../hooks/useSocket';
import { useWorkData } from '../views/work/useWorkData';
import type { WorkSelection } from '../views/work/useWorkData';
import { BrandMark } from './BrandMark';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const PIN_KEY = 'axis.pinned.v1';
const SEEN_KEY = 'axis.seen.v1';
const WS_COLLAPSED_KEY = 'axis.ws.collapsed.v1';
const COLLAPSED_COUNT = 6;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/** 折叠态包裹右侧 Tooltip，展开态原样渲染避免冗余提示。 */
function RailTip({ enabled, label, children }: { enabled: boolean; label: string; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
    </Tooltip>
  );
}

const TASK_STATUS: Record<Task['status'], { text: string; cls: string }> = {
  pending: { text: '待办', cls: 'muted' },
  running: { text: '运行中', cls: 'info' },
  done: { text: '已完成', cls: 'success' },
  failed: { text: '失败', cls: 'danger' },
  cancelled: { text: '已取消', cls: 'muted' },
};

export interface SidebarProps {
  sessions: Session[];
  workspaces: Workspace[];
  selection: WorkSelection | null;
  onSelect: (sel: WorkSelection) => void;
  onNewTask: () => void;
  route: Route;
  navigate: (r: Route) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleCollapsed: () => void;
  open: boolean;
  collapsed: boolean;
}

export function Sidebar({
  sessions, workspaces, selection, onSelect, onNewTask, route, navigate,
  theme, onToggleTheme, onToggleCollapsed, open, collapsed,
}: SidebarProps) {
  const reduce = useReducedMotion();
  const { tasks, sessions: liveSessions, loading, error, reload } = useWorkData();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState<string[]>(() => readJson<string[]>(PIN_KEY, []));
  const [seen, setSeen] = useState<Record<string, string>>(() => readJson(SEEN_KEY, {}));
  const [wsCollapsed, setWsCollapsed] = useState<Record<string, boolean>>(() => readJson(WS_COLLAPSED_KEY, {}));
  const [wsShowAll, setWsShowAll] = useState<Record<string, boolean>>({});
  const [liveTasks, setLiveTasks] = useState<Task[]>(tasks);

  const toggleWsCollapsed = (id: string) => setWsCollapsed((cur) => {
    const next = { ...cur, [id]: !cur[id] };
    writeJson(WS_COLLAPSED_KEY, next);
    return next;
  });
  useEffect(() => setLiveTasks(tasks), [tasks]);
  useSocketEvent((e) => {
    if (e.type === 'task.updated') {
      setLiveTasks((cur) => {
        const i = cur.findIndex((t) => t.id === e.task.id);
        if (i >= 0) { const n = [...cur]; n[i] = e.task; return n; }
        return [e.task, ...cur];
      });
    }
  });

  const allSessions = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of liveSessions) map.set(s.id, s);
    for (const s of sessions) { const c = map.get(s.id); if (!c || s.updatedAt >= c.updatedAt) map.set(s.id, s); }
    return [...map.values()];
  }, [liveSessions, sessions]);

  const selectedSessionId = selection?.kind === 'session' ? selection.id : null;
  useEffect(() => {
    if (!selectedSessionId) return;
    const s = allSessions.find((x) => x.id === selectedSessionId);
    if (!s) return;
    setSeen((cur) => (cur[selectedSessionId] === s.updatedAt ? cur : { ...cur, [selectedSessionId]: s.updatedAt }));
  }, [selectedSessionId, allSessions]);

  const togglePin = (id: string) => setPinned((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    writeJson(PIN_KEY, next); return next;
  });

  const q = query.trim().toLowerCase();
  const matchTitle = (t: string) => !q || t.toLowerCase().includes(q);

  const openSearchFromRail = () => {
    if (collapsed) {
      onToggleCollapsed();
      setSearchOpen(true);
      setQuery('');
      return;
    }
    setSearchOpen((v) => !v);
    setQuery('');
  };

  const rowSession = (s: Session) => {
    const unread = s.id !== selectedSessionId && s.updatedAt > (seen[s.id] ?? '');
    const isPinned = pinned.includes(s.id);
    const active = selection?.kind === 'session' && selection.id === s.id;
    return (
      <motion.div key={s.id} layout={!reduce} className={`sb-row-wrap${active ? ' active' : ''}`} transition={{ duration: 0.16, ease: 'easeOut' }}>
        <button className="sb-row" onClick={() => { writeJson(SEEN_KEY, { ...seen, [s.id]: s.updatedAt }); setSeen((c) => ({ ...c, [s.id]: s.updatedAt })); onSelect({ kind: 'session', id: s.id }); }} title={s.title || '未命名会话'} aria-current={active ? 'true' : undefined}>
          {s.status === 'running'
            ? <LoaderCircle size={13} className="spin sb-row-icon" aria-label="运行中" />
            : <span className={`sb-dot ${s.status === 'error' ? 'err' : ''}`} aria-hidden />}
          <span className="sb-row-title">{s.title || '未命名会话'}</span>
          {unread && <span className="unread-dot" aria-label="有更新" />}
        </button>
        <button className="icon-button sb-pin" title={isPinned ? '取消置顶' : '置顶'} aria-label={isPinned ? `取消置顶 ${s.title}` : `置顶 ${s.title}`} onClick={() => togglePin(s.id)}>
          {isPinned ? <PinOff size={12} aria-hidden /> : <Pin size={12} aria-hidden />}
        </button>
      </motion.div>
    );
  };

  const rowTask = (t: Task) => {
    const active = selection?.kind === 'task' && selection.id === t.id;
    const st = TASK_STATUS[t.status];
    return (
      <motion.div key={t.id} layout={!reduce} className={`sb-row-wrap${active ? ' active' : ''}`} transition={{ duration: 0.16, ease: 'easeOut' }}>
        <button className="sb-row" onClick={() => onSelect({ kind: 'task', id: t.id })} title={t.title} aria-current={active ? 'true' : undefined}>
          <span className={`sb-task-glyph ${t.status}`} aria-hidden />
          <span className="sb-row-title">{t.title}</span>
          <span className={`chip ${st.cls} sb-chip`}>{st.text}</span>
        </button>
      </motion.div>
    );
  };

  const pinnedSessions = allSessions.filter((s) => pinned.includes(s.id) && matchTitle(s.title));
  const isNewTaskActive = route === 'work' && selection === null;
  const isSettingsActive = route === 'settings';

  return (
    <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`} aria-label="会话列表">
      <div className="sb-head">
        {collapsed ? (
          <RailTip enabled label="展开侧栏">
            <button
              className="sb-rail-toggle"
              onClick={onToggleCollapsed}
              title="展开侧栏"
              aria-label="展开侧栏"
              aria-expanded={false}
            >
              <span className="sb-rail-mark">
                <BrandMark theme={theme} showWordmark={false} />
              </span>
              <span className="sb-rail-expand-icon" aria-hidden="true">
                <PanelLeftOpen size={16} />
              </span>
            </button>
          </RailTip>
        ) : (
          <>
            <button
              className="sb-brand"
              onClick={onNewTask}
              title="Axis-Evo"
              aria-label="Axis-Evo"
            >
              <BrandMark theme={theme} showWordmark />
            </button>
            <div className="sb-head-actions">
              <button
                className="icon-button"
                title="搜索会话"
                aria-label="搜索会话"
                aria-expanded={searchOpen}
                onClick={openSearchFromRail}
              >
                <Search size={15} aria-hidden />
              </button>
              <button
                className="icon-button sb-collapse-btn"
                title="收起为图标栏"
                aria-label="收起侧栏"
                aria-expanded={true}
                onClick={onToggleCollapsed}
              >
                <PanelLeftClose size={15} aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>

      <nav className="sb-nav" aria-label="主导航">
        <RailTip enabled={collapsed} label="新任务">
          <button
            className={`sb-nav-item sb-nav-primary${isNewTaskActive ? ' active' : ''}`}
            aria-label="新任务"
            aria-current={isNewTaskActive ? 'page' : undefined}
            onClick={onNewTask}
          >
            {isNewTaskActive && (
              <motion.span
                layoutId="sb-nav-pill"
                className="sb-nav-pill"
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36, mass: 0.7 }}
              />
            )}
            <SquarePen size={15} aria-hidden />
            {!collapsed && <span>新任务</span>}
          </button>
        </RailTip>
        <RailTip enabled={collapsed} label="技能">
          <button
            className={`sb-nav-item${route === 'skills' ? ' active' : ''}`}
            aria-label="技能"
            aria-current={route === 'skills' ? 'page' : undefined}
            onClick={() => navigate('skills')}
          >
            {route === 'skills' && (
              <motion.span
                layoutId="sb-nav-pill"
                className="sb-nav-pill"
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36, mass: 0.7 }}
              />
            )}
            <Sparkles size={15} aria-hidden />
            {!collapsed && <span>技能</span>}
          </button>
        </RailTip>
        {import.meta.env.MODE === 'test' && <RailTip enabled={collapsed} label="代理">
          <button
            className={`sb-nav-item${route === 'agents' ? ' active' : ''}`}
            aria-label="代理"
            aria-current={route === 'agents' ? 'page' : undefined}
            onClick={() => navigate('agents')}
          >
            {route === 'agents' && (
              <motion.span
                layoutId="sb-nav-pill"
                className="sb-nav-pill"
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36, mass: 0.7 }}
              />
            )}
            <Bot size={15} aria-hidden />
            {!collapsed && <span>代理</span>}
          </button>
        </RailTip>}
        {collapsed && (
          <RailTip enabled label="搜索会话">
            <button
              className="sb-nav-item"
              aria-label="搜索会话"
              onClick={openSearchFromRail}
            >
              <Search size={15} aria-hidden />
            </button>
          </RailTip>
        )}
      </nav>

      {!collapsed && searchOpen && (
        <input className="sb-search" placeholder="搜索会话" aria-label="搜索会话" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      )}

      {!collapsed ? (
        <div className="sb-scroll">
          {error && <div className="sb-error" role="alert">{error}</div>}
          {pinnedSessions.length > 0 && (
            <section aria-label="置顶">
              <div className="sb-label">置顶</div>
              {pinnedSessions.map(rowSession)}
            </section>
          )}
          <section aria-label="项目">
            <div className="sb-label">项目</div>
            {workspaces.map((w) => {
              const wTasks = liveTasks.filter((t) => t.workspacePath === w.path && matchTitle(t.title));
              const wSessions = allSessions.filter((s) => s.workspaceId === w.id && matchTitle(s.title));
              const isWsOpen = Boolean(q) || !(wsCollapsed[w.id] ?? false);
              const showAll = Boolean(q) || (wsShowAll[w.id] ?? false);
              const total = wTasks.length + wSessions.length;
              const tasksVisible = showAll ? wTasks : wTasks.slice(0, 2);
              const sessionsVisible = showAll ? wSessions : wSessions.slice(0, Math.max(0, COLLAPSED_COUNT - tasksVisible.length));
              return (
                <div key={w.id} className="sb-proj">
                  <button
                    className="sb-proj-head"
                    title={w.path}
                    aria-expanded={isWsOpen}
                    onClick={() => toggleWsCollapsed(w.id)}
                  >
                    <Folder size={14} aria-hidden />
                    <span className="sb-proj-name">{w.name}</span>
                    {!isWsOpen && total > 0 && <span className="sb-proj-count">{total}</span>}
                    <ChevronDown size={13} className={`sb-chev${isWsOpen ? ' open' : ''}`} aria-hidden />
                  </button>
                  <AnimatePresence initial={false}>
                    {isWsOpen && (
                      <motion.div
                        className="sb-proj-body"
                        initial={reduce ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {tasksVisible.map(rowTask)}
                        {sessionsVisible.map(rowSession)}
                        {total === 0 && <div className="sb-empty">暂无任务</div>}
                        {total > COLLAPSED_COUNT && !q && (
                          <button
                            className="sb-expander"
                            aria-expanded={showAll}
                            onClick={() => setWsShowAll((c) => ({ ...c, [w.id]: !showAll }))}
                          >
                            {showAll ? '收起' : '展开显示'}
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {workspaces.length === 0 && !loading && <div className="sb-empty">尚未授权工作区</div>}
          </section>
        </div>
      ) : (
        <div className="sb-rail-spacer" aria-hidden />
      )}

      <div className="sb-footer">
        <RailTip enabled={collapsed} label="设置">
          <button
            className={`sb-footer-settings${isSettingsActive ? ' active' : ''}`}
            aria-label="设置"
            aria-current={isSettingsActive ? 'page' : undefined}
            title="设置"
            onClick={() => navigate('settings')}
          >
            <Settings size={15} aria-hidden />
            {!collapsed && <span>设置</span>}
          </button>
        </RailTip>
        <div className="sb-footer-actions">
          {!collapsed && (
            <button className="icon-button" title="刷新列表" aria-label="刷新列表" onClick={() => void reload()}>
              <LoaderCircle size={14} aria-hidden className={loading ? 'spin' : ''} />
            </button>
          )}
          <RailTip enabled={collapsed} label={theme === 'dark' ? '切换浅色主题' : '切换暗色主题'}>
            <button
              className="icon-button sb-theme-btn"
              title={theme === 'dark' ? '切换浅色主题' : '切换暗色主题'}
              aria-label="切换主题"
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </button>
          </RailTip>
        </div>
      </div>
    </aside>
  );
}

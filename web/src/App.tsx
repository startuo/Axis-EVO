/**
 * Axis-Evo Extreme application shell: icon rail + thread sidebar + top bar +
 * hash-routed views + status bar, connection banner, bootstrap gate, toasts and
 * a ⌘K command palette. Work is the single primary surface (chat is folded in).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoaderCircle } from 'lucide-react';
import type { Session } from '@axis/protocol';
import { BrandMark } from './components/BrandMark';
import { CommandPalette } from './components/CommandPalette';
import { ConnectionBanner } from './components/ConnectionBanner';
import { HalftoneCloudCanvas } from './components/HalftoneCloudCanvas';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { ToastProvider, useToast } from './components/Toasts';
import { TooltipProvider } from './components/ui/tooltip';
import { useBootstrap } from './hooks/useBootstrap';
import { useHashRoute } from './hooks/useHashRoute';
import { useProfiles } from './hooks/useProfiles';
import { useSessions } from './hooks/useSessions';
import { useSocketEvent, useSocketStatus } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { useWorkspaces } from './hooks/useWorkspaces';
import { socket } from './lib/socket';
import { AgentsView } from './views/agents/AgentsView';
import { SettingsView } from './views/settings/SettingsView';
import { SkillsView } from './views/skills/SkillsView';
import type { WorkSelection } from './views/work/useWorkData';
import { WorkView } from './views/work/WorkView';
import './styles/app.css';
import './styles/chat.css';

const SIDEBAR_COLLAPSED_KEY = 'axis.sidebar.collapsed.v1';

function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
}

export default function App() {
  return (
    <TooltipProvider delayDuration={250}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </TooltipProvider>
  );
}

function Shell() {
  const { state, loading, error, retry } = useBootstrap();
  const { route, navigate } = useHashRoute();
  const status = useSocketStatus();
  const sessions = useSessions(state);
  const workspaces = useWorkspaces(state);
  const profiles = useProfiles(state);
  const { theme, toggle } = useTheme(state?.settings ?? null);
  const toast = useToast();
  const reduce = useReducedMotion();

  const [selection, setSelection] = useState<WorkSelection | null>(null);
  const [threadSession, setThreadSession] = useState<Session | null>(null);
  const [created, setCreated] = useState<Session[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readCollapsed);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [greetingTick, setGreetingTick] = useState(0);
  const [cloudPulse, setCloudPulse] = useState<{ seq: number; x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const triggerCloudPulse = (clientX: number, clientY: number) => {
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (clientX - rect.left) / rect.width;
    const ny = 1 - (clientY - rect.top) / rect.height;
    setCloudPulse((cur) => ({ seq: (cur?.seq ?? 0) + 1, x: nx, y: ny }));
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((cur) => {
      const next = !cur;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    socket.connect();
    return () => socket.close();
  }, []);

  // ⌘K / Ctrl+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Server-side warnings/errors surface as toasts.
  useSocketEvent((e) => {
    if (e.type === 'log' && e.level !== 'info') {
      toast.push(e.level === 'error' ? 'error' : 'warn', e.message);
    }
  });

  const allSessions = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of created) map.set(s.id, s);
    for (const s of sessions) map.set(s.id, s);
    return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [sessions, created]);

  const handleSessionCreated = (s: Session) => {
    setCreated((cur) => [...cur.filter((x) => x.id !== s.id), s]);
    setSelection({ kind: 'session', id: s.id });
  };

  const handleSelect = (sel: WorkSelection) => {
    setSelection(sel);
    setDrawerOpen(false);
    navigate('work');
  };

  const handleNewTask = () => {
    if (route === 'work' && selection === null) {
      setGreetingTick((n) => n + 1);
    }
    setSelection(null);
    setDrawerOpen(false);
    navigate('work');
  };

  if (loading) {
    return (
      <div className="boot-screen" role="status">
        <BrandMark theme={theme} size="lg" srLabel={false} />
        <LoaderCircle size={20} className="spin" aria-hidden />
        <span>正在加载 Axis-Evo…</span>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="boot-screen">
        <BrandMark theme={theme} size="lg" srLabel={false} />
        <div className="error-card boot-error">无法加载应用状态：{error ?? '未知错误'}</div>
        <button className="button primary" onClick={retry}>
          重试
        </button>
      </div>
    );
  }

  const contextWorkspaceId = threadSession?.workspaceId ?? workspaces[0]?.id ?? null;
  const contextWorkspace = workspaces.find((w) => w.id === contextWorkspaceId) ?? null;

  return (
    <div className="shell" ref={shellRef}>
      <HalftoneCloudCanvas
        theme={theme}
        intensity={route === 'work' && selection === null ? 'hero' : 'ambient'}
        pulse={cloudPulse}
      />
      {drawerOpen && <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />}
      <Sidebar
        sessions={allSessions}
        workspaces={workspaces}
        selection={selection}
        onSelect={handleSelect}
        onNewTask={handleNewTask}
        route={route}
        navigate={navigate}
        theme={theme}
        onToggleTheme={toggle}
        onToggleCollapsed={toggleSidebarCollapsed}
        open={drawerOpen}
        collapsed={sidebarCollapsed}
      />
      <div className="main">
        <ConnectionBanner status={status} />
        <TopBar
          route={route}
          workspaceName={contextWorkspace?.name ?? null}
          mode={threadSession?.mode ?? state.settings.defaultMode}
          profiles={profiles}
          settings={state.settings}
          reviewOpen={reviewOpen}
          reviewAvailable={route === 'work' && selection !== null}
          onToggleReview={() => setReviewOpen((v) => !v)}
          onNewTask={handleNewTask}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <main className="view">
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              className="view-frame"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {route === 'work' && (
                <WorkView
                  workspaces={workspaces}
                  profiles={profiles}
                  settings={state.settings}
                  sessions={allSessions}
                  selection={selection}
                  onSelect={setSelection}
                  onSessionCreated={handleSessionCreated}
                  navigate={navigate}
                  reviewOpen={reviewOpen}
                  onToggleReview={() => setReviewOpen((v) => !v)}
                  theme={theme}
                  greetingTick={greetingTick}
                  onHeroPulse={triggerCloudPulse}
                  onThreadChange={setThreadSession}
                />
              )}
              {route === 'skills' && <SkillsView workspaces={workspaces} />}
              {import.meta.env.MODE === 'test' && route === 'agents' && <AgentsView />}
              {route === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
        <StatusBar workspaceId={contextWorkspaceId} session={threadSession} status={status} />
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sessions={allSessions}
        onNavigate={navigate}
        onSelectSession={(id) => handleSelect({ kind: 'session', id })}
        onNewTask={handleNewTask}
      />
    </div>
  );
}

/**
 * Axis-Evo Extreme application shell: icon rail + thread sidebar + top bar +
 * hash-routed views + status bar, connection banner, bootstrap gate, toasts and
 * a ⌘K command palette. Work is the single primary surface (chat is folded in).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoaderCircle } from 'lucide-react';
import type { Session } from '@axis/protocol';
import { BrandMark } from './components/BrandMark';
import { CommandPalette } from './components/CommandPalette';
import { createComposerDrafts } from './components/Composer';
import { ConnectionBanner } from './components/ConnectionBanner';
import { AppErrorBoundary } from './components/ErrorBoundary';
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
import { fadeIn, motionProps, transitionFast } from './lib/motion';
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
    <AppErrorBoundary>
      <TooltipProvider delayDuration={250}>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </TooltipProvider>
    </AppErrorBoundary>
  );
}

function Shell() {
  const { state, loading, error, retry } = useBootstrap();
  const { route, section, navigate } = useHashRoute();
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
  const [drafts] = useState(createComposerDrafts);
  const [cloudPulse, setCloudPulse] = useState<{ seq: number; x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hasWorkSelection = route === 'work' && selection !== null;

  const triggerCloudPulse = (clientX: number, clientY: number) => {
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (clientX - rect.left) / rect.width;
    const ny = 1 - (clientY - rect.top) / rect.height;
    setCloudPulse((cur) => ({ seq: (cur?.seq ?? 0) + 1, x: nx, y: ny }));
  };

  const toggleSidebarCollapsed = useCallback(() => setSidebarCollapsed((cur) => !cur), []);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [sidebarCollapsed]);

  useEffect(() => {
    socket.connect();
    return () => socket.close();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        if (e.repeat) return;
        if (paletteOpen) setPaletteOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
        else if (hasWorkSelection && window.innerWidth <= 1023) setReviewOpen(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'k' || key === 'b' || (key === '\\' && hasWorkSelection)) {
        e.preventDefault();
        if (e.repeat) return;
        if (key === 'k') setPaletteOpen((v) => !v);
        else if (key === 'b') {
          if (window.innerWidth <= 900) setDrawerOpen((v) => !v);
          else toggleSidebarCollapsed();
        }
        else setReviewOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, hasWorkSelection, paletteOpen, toggleSidebarCollapsed]);

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
      <AnimatePresence>
        {drawerOpen && <motion.div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden
          {...motionProps(reduce, fadeIn, transitionFast)} />}
      </AnimatePresence>
      <Sidebar
        sessions={allSessions}
        workspaces={workspaces}
        selection={selection}
        onSelect={handleSelect}
        onNewTask={handleNewTask}
        route={route}
        navigate={(next) => { setDrawerOpen(false); navigate(next); }}
        theme={theme}
        onToggleTheme={toggle}
        onToggleCollapsed={drawerOpen ? () => setDrawerOpen(false) : toggleSidebarCollapsed}
        open={drawerOpen}
        collapsed={sidebarCollapsed && !drawerOpen}
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
          reviewAvailable={hasWorkSelection}
          onToggleReview={() => setReviewOpen((v) => !v)}
          onNewTask={handleNewTask}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <main className="view">
          <motion.div
            key={route}
            className="view-frame"
            {...motionProps(reduce, fadeIn, transitionFast)}
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
                onOpenModelSettings={() => navigate('settings', 'profiles')}
                drafts={drafts}
              />
            )}
            {route === 'skills' && <SkillsView workspaces={workspaces} />}
            {import.meta.env.MODE === 'test' && route === 'agents' && <AgentsView />}
            {route === 'settings' && (
              <SettingsView profiles={profiles} section={section} onNavigateSection={(id) => navigate('settings', id)} />
            )}
          </motion.div>
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

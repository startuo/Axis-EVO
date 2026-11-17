import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { AgentWorkbench } from './components/agent/AgentWorkbench';
import { useStoredPreference } from "./hooks/useWorkbenchLayout";
import { loadWorkbenchFonts } from "./lib/fonts";
import { ThemeContext } from "./lib/theme";

const LegacyWorkbench = lazy(() => import('./components/legacy/LegacyWorkbench').then(module => ({ default: module.LegacyWorkbench })));
const RuntimeWorkbench = lazy(() => import('./components/runtime/RuntimeWorkbench').then(module => ({ default: module.RuntimeWorkbench })));
const ResearchArchive = lazy(() => import('./components/agent/ResearchArchive').then(module => ({ default: module.ResearchArchive })));
const currentRoute = () => window.location.hash.slice(1) || "/agent";

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [dark, setDark] = useStoredPreference("axis.theme.dark", false);
  const navigate = useCallback((path: string) => {
    window.location.hash = path;
    setRoute(path);
  }, []);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/agent");
    const change = () => setRoute(currentRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => { void loadWorkbenchFonts(); }, []);

  return (
    <ThemeContext.Provider value={dark}><MotionConfig reducedMotion="user">
      <Suspense fallback={<div className="agent-loading" role="status">正在打开工作空间…</div>}>{route === '/agent' || route.startsWith('/agent?') || route.startsWith('/agent/') ? (
        <AgentWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark}/>
      ) : route === '/research-demo' ? <ResearchArchive navigate={navigate}/> : route === "/runtime" || route.startsWith("/runtime/") ? (
        <RuntimeWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark} />
      ) : (
        <LegacyWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark} />
      )}</Suspense>
    </MotionConfig></ThemeContext.Provider>
  );
}

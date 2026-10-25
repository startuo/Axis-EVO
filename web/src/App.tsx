import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { LegacyWorkbench } from "./components/legacy/LegacyWorkbench";
import { RuntimeWorkbench } from "./components/runtime/RuntimeWorkbench";
import { useStoredPreference } from "./hooks/useWorkbenchLayout";
import { loadWorkbenchFonts } from "./lib/fonts";
import { ThemeContext } from "./lib/theme";

const currentRoute = () => window.location.hash.slice(1) || "/runtime";

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [dark, setDark] = useStoredPreference("axis.theme.dark", false);
  const navigate = useCallback((path: string) => {
    window.location.hash = path;
    setRoute(path);
  }, []);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", "#/runtime");
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
      {route === "/runtime" || route.startsWith("/runtime/") ? (
        <RuntimeWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark} />
      ) : (
        <LegacyWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark} />
      )}
    </MotionConfig></ThemeContext.Provider>
  );
}

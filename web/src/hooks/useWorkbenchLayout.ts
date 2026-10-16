import { useCallback, useEffect, useState } from "react";

export function useStoredPreference<T extends boolean>(key: string, fallback: T): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try { const saved = localStorage.getItem(key); return saved === "true" ? true : saved === "false" ? false : fallback; }
    catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(key, String(value)); } catch { /* Preferences remain usable in memory. */ } }, [key, value]);
  return [value, setValue];
}

export function useWorkbenchLayout() {
  const [compact, setCompact] = useStoredPreference("axis.sidebar.compact", false);
  const [inspector, setInspector] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(376);
  const [mobile, setMobile] = useState(window.innerWidth < 760);
  const [narrow, setNarrow] = useState(window.innerWidth < 1200);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const resize = () => { setMobile(window.innerWidth < 760); setNarrow(window.innerWidth < 1200); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => { if (!mobile) setDrawer(false); if (!narrow) setSheet(false); }, [mobile, narrow]);
  const closeOverlays = useCallback(() => { setDrawer(false); setSheet(false); }, []);
  const resetLayout = useCallback(() => { setDrawer(false); setSheet(false); setInspector(false); }, []);
  const showInspector = useCallback(() => { setDrawer(false); if (narrow) setSheet(true); else setInspector(true); }, [narrow]);
  const toggleInspector = useCallback(() => { setDrawer(false); if (narrow) setSheet(current => !current); else setInspector(current => !current); }, [narrow]);
  const toggleSidebar = useCallback(() => { if (mobile) setDrawer(current => !current); else setCompact(current => !current); }, [mobile, setCompact]);
  const openNavigation = useCallback(() => { setSheet(false); setDrawer(true); }, []);
  return { compact, setCompact, inspector, setInspector, inspectorWidth, setInspectorWidth, mobile, narrow, drawer, setDrawer, sheet, setSheet, closeOverlays, resetLayout, showInspector, toggleInspector, toggleSidebar, openNavigation };
}

export type WorkbenchLayout = ReturnType<typeof useWorkbenchLayout>;

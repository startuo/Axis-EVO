import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import type { WorkbenchLayout } from "../../hooks/useWorkbenchLayout";

import { keepDialogTab } from "../ui/Primitives";

export function WorkbenchShell({ layout, sidebar, toolbar, children, inspector, inspectorLabel = "审查面板", mainId = "main-content", className = "", resetKey = "", overlays }: {
  layout: WorkbenchLayout;
  sidebar: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  inspectorLabel?: string;
  mainId?: string;
  className?: string;
  resetKey?: string | number;
  overlays?: ReactNode;
}) {
  const overlay = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const showPanel = !!inspector && layout.inspector && !layout.narrow;
  const showOverlay = layout.drawer || (layout.sheet && !!inspector);
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    if (showOverlay && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    if (!showOverlay && element.open) { element.close(); returnFocus.current?.focus(); }
  }, [showOverlay]);
  useEffect(() => {
    main.current?.querySelectorAll<HTMLElement>(".workspace-scroll, .runtime-scroll").forEach(element => { element.scrollTop = 0; });
  }, [resetKey]);
  return <div className={`cds-shell ${layout.compact ? "cds-compact" : ""} ${showPanel ? "cds-with-inspector" : ""} ${className}`} style={{ "--inspector-width": `${layout.inspectorWidth}px` } as CSSProperties}>
    <a className="skip-link" href={`#${mainId}`} onClick={event => { event.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
    {!layout.mobile && <aside className="sidebar cds-sidebar-pane" aria-label="项目与对话导航">{sidebar}</aside>}
    <header className="cds-toolbar">
      {layout.mobile && <button className="icon-button mobile-navigation-button" aria-label="打开导航" onClick={layout.openNavigation}><Menu size={18} /></button>}
      {toolbar}
    </header>
    <main ref={main} id={mainId} tabIndex={-1} className="cds-main">{children}</main>
    <AnimatePresence initial={false}>
      {showPanel && <motion.aside key="inspector" className="cds-inspector-pane" aria-label={inspectorLabel} initial={{ opacity: 0, x: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}>
        <div className="cds-splitter" role="separator" aria-label="调整审查面板宽度" aria-orientation="vertical" tabIndex={0} aria-valuemin={320} aria-valuemax={520} aria-valuenow={layout.inspectorWidth}
          onKeyDown={event => {
            const next = event.key === "ArrowLeft" ? layout.inspectorWidth + 16 : event.key === "ArrowRight" ? layout.inspectorWidth - 16 : event.key === "Home" ? 320 : event.key === "End" ? 520 : null;
            if (next !== null) { event.preventDefault(); layout.setInspectorWidth(Math.max(320, Math.min(520, next))); }
          }}
          onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) layout.setInspectorWidth(Math.max(320, Math.min(520, window.innerWidth - event.clientX))); }} />
        {inspector}
      </motion.aside>}
    </AnimatePresence>
    <dialog ref={overlay} className={`overlay-dialog cds-overlay ${layout.drawer ? "navigation-drawer" : "inspector-sheet"}`} aria-label={layout.drawer ? "项目导航" : inspectorLabel} onKeyDown={keepDialogTab} onCancel={layout.closeOverlays} onClick={event => { if (event.target === event.currentTarget) layout.closeOverlays(); }}>
      {layout.drawer ? <><button className="drawer-close icon-button" aria-label="关闭导航" onClick={layout.closeOverlays}><X size={17} /></button>{sidebar}</> : layout.sheet ? inspector : null}
    </dialog>
    {overlays}
  </div>;
}

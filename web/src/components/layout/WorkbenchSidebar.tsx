import { useEffect, useRef, type ReactNode } from "react";
import { CircleDot, Ellipsis, PanelLeftClose, Search, SquarePen, type LucideIcon } from "lucide-react";
import { AxisLogo } from "../ui/AxisLogo";

export type SidebarThread = { id: string; title: string; status?: string; warning?: boolean };
export type SidebarLink = { label: string; Icon: LucideIcon; action: () => void; active?: boolean };

export function WorkbenchSidebar({ compact, toggle, newConversation, search, setSearch, searchLabel = "搜索对话", threads, currentThread, openThread, links, modeLabel, modeHint, projectControl, searchAction }: {
  compact: boolean;
  toggle: () => void;
  newConversation: () => void;
  search: string;
  setSearch: (value: string) => void;
  searchLabel?: string;
  threads: SidebarThread[];
  currentThread?: string | null;
  openThread: (id: string) => void;
  links: SidebarLink[];
  modeLabel: string;
  modeHint: string;
  projectControl?: ReactNode;
  searchAction?: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const reset = () => { if (menu.current) menu.current.open = false; };
    document.addEventListener("pointerdown", close);
    window.addEventListener("axis:new-conversation", reset);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("axis:new-conversation", reset); };
  }, []);
  const filtered = threads.filter(thread => thread.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className={`sidebar-content cds-sidebar ${compact ? "compact" : ""}`}>
    <header className="brand-row"><AxisLogo size={27} /><strong>Axis<span>—</span>Evo</strong><button className="icon-button" aria-label="切换侧栏" title="切换侧栏" onClick={toggle}><PanelLeftClose size={17} /></button></header>
    <button className="new-task-button cds-new-conversation" onClick={newConversation} title="新对话" aria-label="新对话"><SquarePen size={18} /><span>新对话</span><kbd>{modifier} N</kbd></button>
    <div className="cds-sidebar-search">
      <button className="icon-button" aria-label="搜索对话" onClick={() => { if (compact) toggle(); requestAnimationFrame(() => input.current?.focus()); }}><Search size={17} /></button>
      <input ref={input} type="search" aria-label={searchLabel} placeholder="搜索对话" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") searchAction?.(); }} />
      <kbd>{modifier} K</kbd>
    </div>
    <div className="sidebar-section-title"><span>最近对话</span></div>
    <div className="task-list">
      {filtered.map(thread => <button className={`task-item ${currentThread === thread.id ? "active" : ""}`} key={thread.id} title={thread.title} onClick={() => openThread(thread.id)} aria-current={currentThread === thread.id ? "page" : undefined}>
        <CircleDot size={13} className={thread.warning ? "thread-warning" : ""} /><span>{thread.title}</span>{thread.warning && <span className="sr-only"> · {thread.status}</span>}
      </button>)}
      {!filtered.length && <p className="caption sidebar-empty">{search ? "没有匹配的对话" : "对话会显示在这里"}</p>}
    </div>
    <footer className="sidebar-footer">
      {projectControl}
      <details ref={menu} className="cds-sidebar-menu" onKeyDown={event => { if (event.key === "Escape" && menu.current) { event.preventDefault(); event.stopPropagation(); menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
        <summary aria-label="更多功能" title="更多功能"><Ellipsis size={18} /><span>更多功能</span></summary>
        <div className="cds-sidebar-menu-items">{links.map(({ label, Icon, action, active }) => <button className={`nav-item ${active ? "active" : ""}`} key={label} onClick={() => { if (menu.current) menu.current.open = false; action(); }}><Icon size={16} /><span>{label}</span></button>)}</div>
      </details>
      <div className="local-note"><span className="local-avatar">A</span><span>{modeLabel}<small>{modeHint}</small></span><span className="mode-dot" /></div>
    </footer>
  </div>;
}

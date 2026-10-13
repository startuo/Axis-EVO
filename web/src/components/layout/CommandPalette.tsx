import { ArrowDownUp, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { keepDialogTab } from "../ui/Primitives";
export type Command = { label: string; hint?: string; run: () => void };
export function CommandPalette({
  open,
  close,
  commands,
}: {
  open: boolean;
  close: () => void;
  commands: Command[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery("");
      setIndex(0);
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);
  function choose(i: number) {
    const command = filtered[i];
    if (command) {
      close();
      command.run();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-label="命令面板"
      onKeyDown={keepDialogTab}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="command-search">
        <Search size={19} />
        <input
          aria-label="搜索命令或任务"
          autoFocus
          placeholder="搜索命令或任务…"
          role="combobox"
          aria-expanded={open}
          aria-controls="command-options"
          aria-autocomplete="list"
          aria-activedescendant={
            filtered.length
              ? `command-${Math.min(index, filtered.length - 1)}`
              : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(
                (value) =>
                  (value + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) %
                  Math.max(1, filtered.length),
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(index);
            }
          }}
        />
        <button className="keyboard-key" onClick={close}>
          Esc
        </button>
      </div>
      <div
        role="listbox"
        id="command-options"
        aria-label="可用命令"
        className="command-options"
      >
        {filtered.map((command, i) => (
          <button
            role="option"
            id={`command-${i}`}
            aria-selected={i === index}
            key={command.label}
            className={i === index ? "active" : ""}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(i)}
          >
            <span>{command.label}</span>
            <small>{command.hint}</small>
          </button>
        ))}
        {!filtered.length && <p className="caption">没有匹配命令</p>}
      </div>
      <footer>
        <span>
          <ArrowDownUp size={12} /> 选择
        </span>
        <span>
          <CornerDownLeft size={12} /> 打开
        </span>
        <span>无执行类命令</span>
      </footer>
    </dialog>
  );
}

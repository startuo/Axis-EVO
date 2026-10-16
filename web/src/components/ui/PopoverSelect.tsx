import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; description?: string; disabled?: boolean };

export function PopoverSelect({ label, value, options, onChange, placeholder = "请选择", icon, disabled = false }: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("axis:new-conversation", close);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); window.removeEventListener("axis:new-conversation", close); };
  }, [open]);
  useEffect(() => { if (open) list.current?.focus(); }, [open]);
  function show() {
    if (disabled) return;
    const rect = trigger.current!.getBoundingClientRect();
    setPortalHost(trigger.current?.closest("dialog[open]") ?? document.body);
    const height = Math.min(300, Math.max(64, options.length * 54 + 12));
    const above = rect.top > window.innerHeight - rect.bottom && rect.top > height;
    const width = Math.min(320, Math.max(240, rect.width), window.innerWidth - 24);
    const maxHeight = Math.min(height, Math.max(64, (above ? rect.top : window.innerHeight - rect.bottom) - 20));
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - maxHeight - 8 : rect.bottom + 8, width, maxHeight });
    const index = options.findIndex(option => option.value === value && !option.disabled);
    setActive(index >= 0 ? index : Math.max(0, options.findIndex(option => !option.disabled)));
    setOpen(true);
  }
  function choose(index: number) { const option = options[index]; if (!option || option.disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus(); }
  function move(direction: number) {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (active + direction * offset + options.length) % options.length;
      if (!options[index].disabled) { setActive(index); list.current?.querySelector(`[data-option-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" }); return; }
    }
  }
  return <>
    <button ref={trigger} type="button" className="cds-select-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`} disabled={disabled} title={selected?.label ?? placeholder}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); } }}>
      {icon}<span>{selected?.label ?? placeholder}</span><ChevronDown size={12} />
    </button>
    {open && portalHost && createPortal(<div ref={list} id={`${id}-list`} className="cds-select-popover" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={options[active] ? `${id}-${active}` : undefined} style={position}
      onKeyDown={event => {
        if (["Escape", "Tab"].includes(event.key)) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } setOpen(false); trigger.current?.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
        if (event.key === "Home" || event.key === "End") { event.preventDefault(); const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0); setActive((event.key === "Home" ? enabled[0] : enabled.at(-1)) ?? 0); }
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
      }}>
      {options.length ? options.map((option, index) => <div id={`${id}-${index}`} data-option-index={index} key={option.value} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={`cds-select-option ${active === index ? "focused" : ""}`} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={15} />}
      </div>) : <p className="cds-select-empty">暂无可用选项</p>}
    </div>, portalHost)}
  </>;
}

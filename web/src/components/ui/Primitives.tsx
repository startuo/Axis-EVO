import { Check, Copy, Info, LoaderCircle } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FactStatus } from "../../lib/types";
export function keepDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const closedSections = Array.from(event.currentTarget.querySelectorAll("details:not([open])"))
    .map(section => ({ section, summary: section.querySelector(":scope > summary") }));
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, summary, a[href], [tabindex="0"]',
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      element.getClientRects().length > 0 &&
      !element.closest("[hidden], [inert]") &&
      !closedSections.some(
        ({ section, summary }) => section.contains(element) && !summary?.contains(element),
      ),
  );
  const first = items[0],
    last = items.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: FactStatus;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Info size={23} strokeWidth={1.5} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={18} className="loader" /> 正在读取已提交的事实…
    </div>
  );
}
export function CopyButton({
  value,
  label = "复制标识",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      type="button"
      className="icon-button copy-button"
      aria-label={copied ? "已复制" : label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (reset.current) clearTimeout(reset.current);
          reset.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
export function Field({
  label,
  value,
  copy = false,
}: {
  label: string;
  value: ReactNode;
  copy?: boolean;
}) {
  return (
    <div className="fact-field">
      <span>{label}</span>
      <div>
        {value ?? "未记录"}
        {copy && typeof value === "string" && <CopyButton value={value} />}
      </div>
    </div>
  );
}
export function JsonView({ value }: { value: unknown }) {
  return <pre className="code-block">{JSON.stringify(value, null, 2)}</pre>;
}
export function runTone(status: string): FactStatus {
  return status === "COMPLETED" || status === "TRUSTED" || status === "PASSED"
    ? "success"
    : status === "FAILED"
      ? "error"
      : status === "RUNNING" || status === "UNKNOWN" || status === "SHADOW"
        ? "warning"
        : "neutral";
}

import {
  CheckCheck,
  CircleDot,
  FileSearch,
  ListChecks,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import type { EventView } from "../../lib/types";
import { CopyButton, EmptyState, Field } from "../ui/Primitives";
const iconFor = (type: string) =>
  type.includes("TOOL")
    ? TerminalSquare
    : type.includes("VALIDATION")
      ? ShieldCheck
      : type.includes("FILE")
        ? FileSearch
        : type.includes("PLANNED")
          ? ListChecks
          : type.includes("COMPLETED")
            ? CheckCheck
            : CircleDot;
export function Timeline({
  events,
  searchable = false,
}: {
  events: EventView[];
  searchable?: boolean;
}) {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const filtered = events
    .filter(
      (event) =>
        (filter === "ALL" || event.type.includes(filter)) &&
        `${event.stepId} ${event.toolCallId} ${event.type}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => a.seq - b.seq);
  return (
    <section className="timeline-section" aria-label="执行记录">
      {searchable && (
        <div className="event-filters">
          <input
            aria-label="搜索事件"
            placeholder="Step ID / Tool Call ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(50);
            }}
          />
          <select
            aria-label="事件类型"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(50);
            }}
          >
            <option value="ALL">全部事件</option>
            <option value="TOOL">工具</option>
            <option value="FILE">文件观察</option>
            <option value="VALIDATION">验收</option>
            <option value="RUN">运行</option>
          </select>
        </div>
      )}
      {!filtered.length && (
        <EmptyState title="暂无匹配事件">
          没有持久化的事实时，不推断后续动作。
        </EmptyState>
      )}
      <ol className="timeline">
        {filtered.slice(0, limit).map((event) => {
          const Icon = iconFor(event.type);
          return (
            <li key={`${event.id}-${event.seq}`}>
              <span className="timeline-icon">
                <Icon size={16} />
              </span>
              <details className="event-detail">
                <summary>
                  <span className="event-title">
                    {event.summary || event.type}
                    <small>{event.type}</small>
                  </span>
                  <span className="event-seq">#{event.seq}</span>
                </summary>
                <div className="detail-body">
                  <Field label="事件 ID" value={event.id} copy />
                  <Field label="Seq" value={event.seq} />
                  <Field label="时间" value={event.timestamp} />
                  <Field label="Step ID" value={event.stepId} copy />
                  <Field label="Tool Call ID" value={event.toolCallId} copy />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {filtered.length > limit && (
        <button
          className="text-button"
          onClick={() => setLimit((value) => value + 50)}
        >
          再显示 50 条（{filtered.length - limit} 条未展示）
        </button>
      )}
      {!!filtered.length && (
        <div className="timeline-note">
          <span>{filtered.length} 条已加载记录 · 按 seq 排序</span>
          <CopyButton
            value={filtered.map((e) => `${e.seq} ${e.type}`).join("\n")}
            label="复制事件索引"
          />
        </div>
      )}
    </section>
  );
}

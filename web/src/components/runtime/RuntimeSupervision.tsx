import { Activity, CircleDot } from "lucide-react";
import type { RuntimeThread } from "../../lib/runtime";
import { Badge, Field } from "../ui/Primitives";

export function RuntimeSupervisionPanel({ thread }: { thread: RuntimeThread }) {
  const health = thread.supervision;
  if (!health) return <p className="caption">此历史线程没有进程监督记录。</p>;
  const events = thread.run?.events ?? [];
  const intents = events.filter((event) => event.type === "TOOL_INTENT").length;
  const results = events.filter((event) => event.type === "TOOL_RESULT").length;
  const validated = events.some((event) => event.type === "VALIDATION_PASSED" || event.type === "VALIDATION_FAILED");
  return <section className="runtime-supervision" aria-label="进程监督与执行事实">
    <header><Activity size={17} /><h2>进程监督</h2><Badge tone={health.outcomeUnresolved ? "warning" : "neutral"}>{health.jobState}</Badge></header>
    <p className="caption">作业状态、进程健康和 Core 结果分别记录。退出码不替代工具结果或独立验收。</p>
    <div className="runtime-supervision-grid">
      <Field label="协调器 · 本次连接观察" value={health.coordinatorAvailable ? "可用" : "未连接"} />
      <Field label="Worker · 本次进程观察" value={health.workerRunning ? "进程仍运行" : health.workerExitObserved ? `已观察退出 · ${health.exitCode}` : health.workerAssigned ? "身份已分配，未确认运行" : "尚未分配"} />
      <Field label="Core Run" value={health.coreRunExists ? health.coreTerminalObserved ? "已有终态事实" : "已创建，尚无终态" : "尚无 Run"} />
      <Field label="Tool Intent / Result" value={`${intents} / ${results} 条已加载事实`} />
      <Field label="待结果调用 · Inspector" value={String(health.pendingIntentCount)} />
      <Field label="独立验收" value={validated ? "已有验收事实" : "尚无验收结果"} />
    </div>
    <Field label="Dispatch ID" value={health.dispatchId ?? "尚未保留执行"} copy={!!health.dispatchId} />
    <Field label="Worker identity" value={health.workerIdentity ?? "尚未分配"} copy={!!health.workerIdentity} />
    {health.supervisionLost && <p className="caption">曾丢失协调器监督。历史 PID 不代表当前进程身份，不据此补派或盲目终止进程。</p>}
    {health.outcomeUnresolved && <p className="runtime-supervision-warning"><CircleDot size={15} />结果未决；不自动重试已保留的执行。</p>}
    <p className="caption">{health.recoveryAvailable ? "已有独立 Recovery 记录；Child 结果不改写 Source。" : "此任务尚无已加载的独立 Recovery 记录。"} 本界面不自动恢复。</p>
    <button className="button secondary" disabled title="尚未提供可审计的交互取消协议">停止任务 · 暂不可用</button>
    <p className="caption">尚未提供可审计的交互取消协议。监督器仍会按执行期限终止 Worker，并保留未决结果。</p>
  </section>;
}

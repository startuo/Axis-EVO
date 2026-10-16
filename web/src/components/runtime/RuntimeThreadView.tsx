import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ChevronRight, CircleDot, FileCheck2, ShieldCheck } from "lucide-react";
import { cdsMotion } from "../../lib/motion";
import type { RuntimeThread } from "../../lib/runtime";
import { FilesView } from "../inspector/FilesView";
import { AxisLogo } from "../ui/AxisLogo";
import { Badge, Field, runTone } from "../ui/Primitives";
import { Timeline } from "../tasks/Timeline";
import { RuntimeProposalReview } from "./RuntimeProposal";
import { RuntimeSupervisionPanel } from "./RuntimeSupervision";
import "../../styles/conversation.css";

export const threadLabels: Record<RuntimeThread["status"], string> = {
  QUEUED: "等待规划", PLANNING: "模型请求中", AWAITING_APPROVAL: "等待批准", DISPATCH_RESERVED: "派发已保留", EXECUTING: "执行中", FINISHED: "Web 任务已结束", FAILED: "Web 任务失败", UNKNOWN: "结果不确定",
};

export function RuntimeThreadView({ thread, busy, canAct, approve, openReview }: { thread: RuntimeThread; busy: boolean; canAct: boolean; approve: () => void; openReview: () => void }) {
  const reduceMotion = useReducedMotion();
  const run = thread.run;
  const validation = run?.events.find((event) => event.type === "VALIDATION_PASSED" || event.type === "VALIDATION_FAILED");
  const missingResult = run?.inspection.observations.includes("EXECUTION_RESULT_UNKNOWN") === true;
  const unknown = thread.status === "UNKNOWN" || missingResult;
  const failed = thread.status === "FAILED" || run?.status === "FAILED";
  const failures = run?.events.filter((event) => event.type.endsWith("_FAILED") && event.type !== "VALIDATION_FAILED") ?? [];
  const health = thread.supervision;
  const statusTone = unknown ? "warning" : failed ? "error" : "neutral";
  return <article className="runtime-thread-page runtime-conversation">
    <header className="conversation-heading">
      <h1>{thread.title}</h1>
      <button className="text-button conversation-evidence" onClick={openReview}>查看证据 <FileCheck2 size={15} /></button>
    </header>
    <motion.section key={`${thread.id}-prompt`} className="conversation-user" aria-label="你的任务输入" initial={reduceMotion ? false : { y: 8 }} animate={{ y: 0 }} transition={cdsMotion.gentle}>
      <p className="conversation-user-bubble">{thread.prompt}</p>
    </motion.section>
    <motion.section key={`${thread.id}-assistant`} className="conversation-assistant" aria-label="AXIS 任务事实" initial={reduceMotion ? false : { y: 8 }} animate={{ y: 0 }} transition={cdsMotion.gentle}>
      <header className="conversation-assistant-heading">
        <AxisLogo size={24} />
        <strong>AXIS</strong>
        <span className="conversation-model" title={`${thread.profileSnapshot.name} · r${thread.profileSnapshot.revision}`}>{thread.profileSnapshot.modelId}</span>
        <Badge tone={statusTone}>{threadLabels[thread.status]}</Badge>
      </header>
      <p className="conversation-profile">{thread.profileSnapshot.name} · r{thread.profileSnapshot.revision}</p>
      <div className="conversation-status" aria-live="polite">
        <p>{thread.status === "QUEUED" || thread.status === "PLANNING" ? "正在请求所选 Provider 生成计划。尚未批准，不执行文件工具。" : thread.proposal ? "模型返回内容已由 Core 严格解析；计划提案与执行授权分别记录。" : "没有已接受的计划提案，不展示或执行未验证的模型输出。"}</p>
      </div>
      {(failed || thread.errorCode || failures.length > 0) && <section className="conversation-failure" role="alert">
        <AlertCircle size={18} />
        <div>
          <h2>{failed ? "任务记录包含失败" : "已记录异常"}</h2>
          {thread.errorCode && <code>{thread.errorCode}</code>}
          {failures.map((event) => <p key={event.id}><code>{event.type}</code>{event.summary && <span> · {event.summary}</span>}</p>)}
          {failed && failures.length === 0 && <p>{thread.status === "FAILED" ? "Web 任务失败。" : "Core Run 为 FAILED。"}具体结果以已记录的执行事实与独立验收为准。</p>}
        </div>
      </section>}
      {unknown && <section className="unknown-callout"><CircleDot size={19} /><div><h2>执行结果尚不确定</h2><p>连接或进程停止不能证明工具未执行。以已持久化的 Core 事实为准，不自动重试。</p><span>{missingResult ? "EXECUTION_RESULT_UNKNOWN · Source outcome: UNKNOWN" : "Web Runtime: UNKNOWN · 不代替 Core Inspector 分类"}</span></div></section>}
      {health && (health.outcomeUnresolved || health.supervisionLost || health.workerExitObserved && health.exitCode !== 0) && <div className="conversation-process-notice">
        <CircleDot size={16} />
        <div>
          {health.outcomeUnresolved && <p>结果未决；不自动重试已保留的执行。</p>}
          {health.workerExitObserved && health.exitCode !== 0 && <p>Worker 已观察退出 · {health.exitCode}</p>}
          {health.supervisionLost && <p>曾丢失协调器监督；当前结果以 Core 事实为准。</p>}
        </div>
      </div>}
      <RuntimeProposalReview thread={thread} busy={busy} canAct={canAct} onApprove={approve} />
      {run ? <>
        <div className="conversation-core-status"><span>Core 执行事实</span><Badge tone={runTone(run.status)}>{run.status}</Badge></div>
        {run.inspection.traceConsistent === false && <div className="conversation-failure conversation-trace" role="alert"><AlertCircle size={18} /><div><p>轨迹完整性核验未通过；存储终态不代表证据已通过核验。</p>{run.inspection.issues.map((issue, index) => <p key={index}><code>{issue}</code></p>)}</div></div>}
        <section className={`validation-summary ${validation?.type === "VALIDATION_FAILED" ? "validation-failed" : !validation ? "validation-unavailable" : ""}`}><ShieldCheck size={18} /><div><strong>独立验收 · {validation?.type === "VALIDATION_PASSED" ? "PASSED" : validation?.type === "VALIDATION_FAILED" ? "FAILED" : "尚无结果"}</strong><p>{validation ? "验收事件是独立事实。TOOL_RESULT=SUCCESS 不等于任务完成。" : "没有已加载的验收结果，不显示任务已通过。"}</p></div></section>
        {run.recovery.map((recovery) => <section className="runtime-recovery" key={recovery.id} aria-label="独立恢复记录"><h2>独立恢复记录</h2><Field label="Source outcome" value={recovery.sourceOutcome} /><Field label="Child Run" value={recovery.childRunId} copy /><Field label="Child 状态" value={recovery.childStatus} /><p className="caption">Child 结果不改写 Source。此界面不启动自动恢复。</p></section>)}
        <details className="conversation-disclosure" key={`${thread.id}-events`}>
          <summary><ChevronRight size={15} /><span>Core 执行记录</span><small>{run.events.length} 条</small></summary>
          <div className="conversation-disclosure-body"><p className="caption">Run {run.id} · Web 线程状态与 Core 存储终态分别展示。</p><Timeline events={run.events} /></div>
        </details>
        <details className="conversation-disclosure" key={`${thread.id}-files`}>
          <summary><ChevronRight size={15} /><span>文件证据</span><small>{run.files.length} 条观察</small></summary>
          <div className="conversation-disclosure-body"><FilesView files={run.files} mode="connected" /></div>
        </details>
      </> : <p className="runtime-no-run"><FileCheck2 size={16} />尚无 Core Run。规划排队或提案生成不构成工具执行。</p>}
      <details className="conversation-disclosure" key={`${thread.id}-supervision`}>
        <summary><ChevronRight size={15} /><span>进程监督</span><small>{health?.jobState ?? "尚无记录"}</small></summary>
        <div className="conversation-disclosure-body"><RuntimeSupervisionPanel thread={thread} /></div>
      </details>
      <p className="conversation-end">如需不同计划，请新建对话并重新批准。</p>
    </motion.section>
  </article>;
}

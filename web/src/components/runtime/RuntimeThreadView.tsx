import { CircleDot, FileCheck2, ShieldCheck } from "lucide-react";
import type { RuntimeThread } from "../../lib/runtime";
import { AxisLogo } from "../ui/AxisLogo";
import { Badge, Field, runTone } from "../ui/Primitives";
import { Timeline } from "../tasks/Timeline";
import { RuntimeProposalReview } from "./RuntimeProposal";

export const threadLabels: Record<RuntimeThread["status"], string> = {
  QUEUED: "等待规划", PLANNING: "模型请求中", AWAITING_APPROVAL: "等待批准", EXECUTING: "执行中", FINISHED: "Web 任务已结束", FAILED: "Web 任务失败", UNKNOWN: "结果不确定",
};

export function RuntimeThreadView({ thread, busy, canAct, approve, openReview }: { thread: RuntimeThread; busy: boolean; canAct: boolean; approve: () => void; openReview: () => void }) {
  const run = thread.run;
  const validation = run?.events.find((event) => event.type === "VALIDATION_PASSED" || event.type === "VALIDATION_FAILED");
  const missingResult = run?.inspection.observations.includes("EXECUTION_RESULT_UNKNOWN") === true;
  const unknown = thread.status === "UNKNOWN" || missingResult;
  return <article className="runtime-thread-page">
    <div className="runtime-thread-heading"><div><span className="page-eyebrow">本地运行线程</span><h1>{thread.title}</h1></div><Badge tone={unknown ? "warning" : "neutral"}>{threadLabels[thread.status]}</Badge></div>
    <div className="runtime-thread-meta"><span>{thread.profileSnapshot.name} · r{thread.profileSnapshot.revision}</span><span>{thread.profileSnapshot.modelId}</span><button className="text-button" onClick={openReview}>查看证据 <FileCheck2 size={14} /></button></div>
    <section className="runtime-user-prompt"><span className="runtime-avatar">你</span><div><span className="caption">已记录的任务输入</span><p>{thread.prompt}</p></div></section>
    <div className="runtime-core-heading"><AxisLogo size={22} /><strong>Axis-Evo</strong><span>结构化系统活动</span></div>
    <section className="runtime-planning-status" aria-live="polite"><CircleDot size={16} /><div><strong>{threadLabels[thread.status]}</strong><p>{thread.status === "QUEUED" || thread.status === "PLANNING" ? "正在请求所选 Provider 生成计划。尚未批准，不执行文件工具。" : thread.proposal ? "模型返回内容已由 Core 严格解析；计划提案与执行授权分别记录。" : "没有已接受的计划提案，不展示或执行未验证的模型输出。"}</p>{thread.errorCode && <code>{thread.errorCode}</code>}</div></section>
    {unknown && <section className="unknown-callout"><CircleDot size={19} /><div><h2>执行结果尚不确定</h2><p>连接或进程停止不能证明工具未执行。以已持久化的 Core 事实为准，不自动重试。</p><span>{missingResult ? "EXECUTION_RESULT_UNKNOWN · Source outcome: UNKNOWN" : "Web Runtime: UNKNOWN · 不代替 Core Inspector 分类"}</span></div></section>}
    <RuntimeProposalReview thread={thread} busy={busy} canAct={canAct} onApprove={approve} />
    {run ? <>
      <div className="section-heading runtime-events-heading"><h2>Core 执行事实</h2><Badge tone={runTone(run.status)}>{run.status}</Badge></div>
      <p className="caption">Run {run.id} · Web 线程状态与 Core 存储终态分别展示。</p>
      {run.inspection.traceConsistent === false && <p className="form-error" role="alert">轨迹完整性核验未通过；存储终态不代表证据已通过核验。</p>}
      <Timeline events={run.events} />
      <section className={`validation-summary ${validation?.type === "VALIDATION_FAILED" ? "validation-failed" : ""}`}><ShieldCheck size={18} /><div><strong>独立验收 · {validation?.type === "VALIDATION_PASSED" ? "PASSED" : validation?.type === "VALIDATION_FAILED" ? "FAILED" : "尚无结果"}</strong><p>{validation ? "验收事件是独立事实。TOOL_RESULT=SUCCESS 不等于任务完成。" : "没有已加载的验收结果，不显示任务已通过。"}</p></div></section>
      {run.recovery.map((recovery) => <section className="runtime-recovery" key={recovery.id}><h2>独立恢复记录</h2><Field label="Source outcome" value={recovery.sourceOutcome} /><Field label="Child Run" value={recovery.childRunId} copy /><Field label="Child 状态" value={recovery.childStatus} /><p className="caption">Child 结果不改写 Source。此界面不启动自动恢复。</p></section>)}
    </> : <p className="runtime-no-run"><FileCheck2 size={16} />尚无 Core Run。规划排队或提案生成不构成工具执行。</p>}
    <div className="runtime-thread-end">固定计划线程 · 如需不同计划，请新建任务并重新批准。</div>
  </article>;
}

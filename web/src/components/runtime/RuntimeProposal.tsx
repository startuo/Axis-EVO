import { useEffect, useState } from "react";
import { Check, ClipboardCheck, FileCode2, ShieldCheck } from "lucide-react";
import type { RuntimeThread } from "../../lib/runtime";
import { Badge, CopyButton, Field, JsonView } from "../ui/Primitives";

export function RuntimeProposalReview({ thread, busy, canAct, onApprove }: { thread: RuntimeThread; busy: boolean; canAct: boolean; onApprove: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const proposal = thread.proposal;
  useEffect(() => setReviewed(false), [proposal?.proposalId, proposal?.planSha256]);
  if (!proposal) return null;
  const approved = proposal.approvedPlanSha256 === proposal.planSha256;
  const canApprove = canAct && thread.status === "AWAITING_APPROVAL" && !approved && !thread.runId;
  return <section className="runtime-proposal" aria-label="计划审查与明确批准">
    <header><span><ClipboardCheck size={17} /><strong>计划提案</strong></span><Badge tone={approved ? "success" : "warning"}>{approved ? "APPROVED" : "PROPOSED"}</Badge></header>
    <div className="runtime-proposal-description"><p>以下是 Core 接受并持久化的完整步骤。模型提出计划；批准后由现有 Runner 执行。</p><span>{proposal.steps.length} 个步骤 · Skill {thread.skillRef.skill_id}@{thread.skillRef.skill_version}</span></div>
    <ol className="runtime-plan-steps">
      {proposal.steps.map((step, index) => <li key={step.step_id}>
        <div className="runtime-step-heading"><span className="step-number">{String(index + 1).padStart(2, "0")}</span><FileCode2 size={16} /><strong>{step.tool_name}</strong><code>{step.step_id}</code></div>
        <JsonView value={step.arguments} />
        {typeof step.arguments.path === "string" && <p className="caption">目标路径：<code>{step.arguments.path}</code></p>}
      </li>)}
    </ol>
    <div className="runtime-plan-identity"><Field label="Proposal ID" value={proposal.proposalId} copy /><Field label="Skill Card SHA-256" value={proposal.cardSha256} copy /><Field label="TaskSpec SHA-256" value={proposal.taskSpecSha256} copy /><Field label="固定 Provider" value={`${thread.profileSnapshot.name} · r${thread.profileSnapshot.revision} · ${thread.profileSnapshot.modelId}`} /><Field label="Provider Config SHA-256" value={thread.profileSnapshot.configSha256} copy /><div className="runtime-digest"><span>批准将绑定此 Plan SHA-256</span><code>{proposal.planSha256}</code><CopyButton label="复制待批准计划摘要" value={proposal.planSha256} /></div></div>
    {approved ? <div className="runtime-approved"><Check size={16} /><span>明确摘要批准已记录。工具结果与独立验收仍分别记录。</span></div> : <div className="runtime-approval-action">
      <label className="runtime-review-checkbox"><input type="checkbox" checked={reviewed} disabled={!canApprove || busy} onChange={(event) => setReviewed(event.target.checked)} />我已审阅以上全部步骤，批准这个精确计划摘要。</label>
      <button className="button primary" disabled={!reviewed || !canApprove || busy} onClick={onApprove}><ShieldCheck size={15} />{busy ? "正在提交批准…" : "批准并执行"}</button>
      <p className="caption">该操作允许计划中的文件工具在当前项目的新工作区执行。不会自动重规划或重试不确定的调用。</p>
      {!canApprove && <p className="caption">当前状态不允许新批准；请查看会话权限与已记录的线程状态。</p>}
    </div>}
  </section>;
}

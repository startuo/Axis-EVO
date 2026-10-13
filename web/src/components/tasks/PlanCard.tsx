import { ChevronDown, FileCode2, ListChecks, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PlanView } from "../../lib/types";
import { Badge, CopyButton, EmptyState, Field } from "../ui/Primitives";
export function PlanCard({ plan }: { plan: PlanView | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!plan)
    return (
      <EmptyState title="没有关联的计划提案">
        手工 Runner 运行可以没有模型 Plan Proposal；这里不会补造提案。
      </EmptyState>
    );
  const approved =
    !!plan.planSha256 &&
    plan.approvedPlanSha256 === plan.planSha256 &&
    plan.approvalStatus === "APPROVED";
  const approvalLabel = approved
    ? "APPROVED · 摘要已确认"
    : ["PROPOSED", "APPROVED"].includes(plan.approvalStatus)
      ? "PROPOSED · 未获批准"
      : `${plan.approvalStatus} · 无已核验批准`;
  return (
    <section className="plan-card" aria-label="结构化计划">
      <header>
        <span>
          <ListChecks size={17} /> 执行计划{" "}
          <Badge tone={approved ? "success" : "warning"}>{approvalLabel}</Badge>
        </span>
        <button
          className="text-button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起全部" : "展开全部"}
          <ChevronDown size={13} />
        </button>
      </header>
      {plan.steps.map((step, index) => (
        <details
          key={step.id}
          open={expanded}
          className="plan-step"
          onToggle={(event) => {
            if (!event.currentTarget.open) setExpanded(false);
          }}
        >
          <summary>
            <span className="step-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <FileCode2 size={16} />
            <span className="step-label">
              {step.toolName}
              <small>{step.path ?? "无文件目标"}</small>
            </span>
            <span className="muted">{step.id}</span>
            <ChevronDown size={13} />
          </summary>
          <div className="detail-body">
            <Field label="Step ID" value={step.id} copy />
            <Field
              label="参数摘要"
              value={step.argumentsSha256 || "未记录"}
              copy
            />
            <p className="caption">
              仅显示安全摘要。计划步骤不代表工具已经执行。
            </p>
          </div>
        </details>
      ))}
      <footer>
        <ShieldCheck size={14} />
        <span>
          {plan.skillRef
            ? `${plan.skillRef.skill_id} · v${plan.skillRef.skill_version}`
            : "未绑定 Skill 版本"}
        </span>
        <span className="digest-short">
          {plan.planSha256?.slice(0, 12) ?? "无计划摘要"}
        </span>
        {plan.planSha256 && (
          <CopyButton label="复制计划摘要" value={plan.planSha256} />
        )}
      </footer>
    </section>
  );
}

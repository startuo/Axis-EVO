import { ArrowDown, GitBranch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { EvolutionView as EvolutionData, Mode } from "../../lib/types";
import { Badge, EmptyState, Field, JsonView } from "../ui/Primitives";
export function EvolutionView({
  evolution,
  mode,
}: {
  evolution: EvolutionData | null;
  mode: Mode;
}) {
  const [selected, setSelected] = useState(0);
  if (!evolution)
    return (
      <EmptyState title="没有可用的演化证据">
        当前项目没有已记录的 Evolution Case，或该检查不受支持。
      </EmptyState>
    );
  const stages =
    mode === "demo" && Array.isArray(evolution.stages)
      ? (evolution.stages as { label: string; value: string; id: string }[])
      : [];
  return (
    <div className="page evolution-page">
      <div className="page-eyebrow">
        <GitBranch size={15} /> 显式授权的版本演进
      </div>
      <h1>Skill 演化</h1>
      <p className="page-description">
        证据支持决策，批准授予权限。新的首选版本不改写任何旧运行。
      </p>
      <div className="evolution-summary">
        <Field label="Evolution Case" value={evolution.id} copy />
        <Field label="治理模式" value={evolution.governanceMode ?? "未提供"} />
        <Field
          label="精确参考版本"
          value={`${evolution.sourceSkillRef.skill_id}@${evolution.sourceSkillRef.skill_version}`}
          copy
        />
      </div>
      {stages.length ? (
        <div className="evolution-grid">
          <ol className="evolution-flow">
            {stages.map((stage, i) => (
              <li key={stage.id}>
                <button
                  className={selected === i ? "active" : ""}
                  onClick={() => setSelected(i)}
                >
                  <span className="evolution-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    {stage.label}
                    <small>{stage.value}</small>
                  </span>
                  {i === 7 && <ShieldCheck size={17} />}
                </button>
                {i < stages.length - 1 && (
                  <ArrowDown className="flow-arrow" size={14} />
                )}
              </li>
            ))}
          </ol>
          <section className="evolution-evidence">
            <div className="section-heading">
              <h2>{stages[selected].label}</h2>
              <Badge>DEMO</Badge>
            </div>
            <Field label="事实标识" value={stages[selected].id} copy />
            <Field label="记录" value={stages[selected].value} />
            <h3>参考 / 候选对比</h3>
            <div className="comparison-refs">
              <span>
                v1 <Badge>TRUSTED</Badge>
              </span>
              <span>→</span>
              <span>
                v2 <Badge>TRUSTED</Badge>
              </span>
            </div>
            <JsonView value={evolution.comparison} />
            <p className="notice">
              5 / 5
              是此预设闭合套件的分母，不是通用可靠性评分。NO_REGRESSION_OBSERVED
              不构成晋升许可。
            </p>
            <h3>首选版本</h3>
            <JsonView value={evolution.preferredSkillRef} />
            <p className="caption">
              此阶段选择仅展示演示证据，不执行任何晋升或激活。
            </p>
          </section>
        </div>
      ) : (
        <>
          <p className="notice">
            {evolution.integrityVerified === true &&
            evolution.status === "SUPPORTED"
              ? "Core 已完成当前支持范围内的完整性核验。"
              : "只读元数据，未完成完整性核验。"}{" "}
            缺失的阶段不会被自动补造。
          </p>
          {Array.isArray(evolution.integrityIssues) &&
            evolution.integrityIssues.length > 0 && (
              <p className="form-error" role="alert">
                此证据包含完整性问题，请查看返回的 issue；不表示已批准或可激活。
              </p>
            )}
          <JsonView value={evolution} />
        </>
      )}
    </div>
  );
}

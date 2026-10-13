import { FileCheck2, Info, LockKeyhole, X } from "lucide-react";
import type { Mode, RunView } from "../../lib/types";
import { Badge, EmptyState, Field, JsonView, runTone } from "../ui/Primitives";
import { PlanCard } from "../tasks/PlanCard";
import { Timeline } from "../tasks/Timeline";
import { FilesView } from "./FilesView";
export const inspectorTabs = [
  "概览",
  "计划",
  "事件",
  "文件",
  "检查点",
  "恢复",
  "证据",
] as const;
export type InspectorTab = (typeof inspectorTabs)[number];
export function Inspector({
  run,
  mode,
  tab,
  setTab,
  close,
}: {
  run: RunView | null;
  mode: Mode;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  close: () => void;
}) {
  return (
    <div className="inspector-content">
      <header className="inspector-header">
        <span>
          <FileCheck2 size={16} /> 检查面板
        </span>
        <button
          aria-label="关闭检查面板"
          className="icon-button"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <div className="inspector-tabs" role="tablist" aria-label="检查面板标签">
        {inspectorTabs.map((name, index) => (
          <button
            role="tab"
            key={name}
            id={`tab-${index}`}
            aria-selected={tab === name}
            aria-controls="inspector-panel"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              const offset =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (offset) {
                e.preventDefault();
                const next =
                  (index + offset + inspectorTabs.length) %
                  inspectorTabs.length;
                setTab(inspectorTabs[next]);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        className="inspector-scroll"
        role="tabpanel"
        id="inspector-panel"
        aria-labelledby={`tab-${inspectorTabs.indexOf(tab)}`}
        tabIndex={0}
      >
        {!run ? (
          <EmptyState title="选择一个任务">
            查看对应的计划、事件和可用证据。
          </EmptyState>
        ) : (
          <>
            {tab === "概览" && (
              <>
                <div className="panel-heading">
                  <h2>运行概览</h2>
                  <Badge tone={runTone(run.status)}>{run.status}</Badge>
                </div>
                <p className="caption">
                  {mode === "demo"
                    ? "预设演示数据 · 非真实执行历史"
                    : "来自本地 Core · 只读已提交记录"}
                </p>
                <Field label="Run ID" value={run.id} copy />
                <Field label="Task ID" value={run.taskId} copy />
                <Field label="开始时间" value={run.startedAt} />
                <Field
                  label="结束时间"
                  value={run.endedAt ?? "NULL · 尚未结束"}
                />
                <Field
                  label="轨迹一致性"
                  value={
                    run.inspection.traceConsistent === null
                      ? "不支持核验"
                      : run.inspection.traceConsistent
                        ? "CONSISTENT"
                        : "INCONSISTENT"
                  }
                />
                <Field label="检查支持" value={run.inspection.status} />
                <h3>Inspector 观察</h3>
                {run.inspection.observations.length ? (
                  run.inspection.observations.map((item) => (
                    <p key={item} className="observation">
                      <Info size={14} />
                      {item}
                    </p>
                  ))
                ) : (
                  <p className="caption">
                    没有已返回的额外观察，不代表缺失事实已被证明。
                  </p>
                )}
                <h3>数据边界</h3>
                {run.limitations.map((item) => (
                  <p className="caption" key={item}>
                    {item}
                  </p>
                ))}
              </>
            )}
            {tab === "计划" && (
              <>
                <h2>计划与授权</h2>
                <PlanCard plan={run.plan} />
                <Field label="Proposal ID" value={run.plan?.proposalId} copy />
                <Field label="Plan SHA-256" value={run.plan?.planSha256} copy />
                <Field
                  label="批准摘要"
                  value={run.plan?.approvedPlanSha256}
                  copy
                />
                <p className="caption">生成提案与明确批准是不同事实。</p>
              </>
            )}
            {tab === "事件" && (
              <>
                <h2>持久化事件</h2>
                <Timeline events={run.events} searchable />
              </>
            )}
            {tab === "文件" && (
              <>
                <h2>文件证据</h2>
                <FilesView key={run.id} files={run.files} mode={mode} />
              </>
            )}
            {tab === "检查点" && (
              <>
                <h2>检查点</h2>
                {run.checkpoints.length ? (
                  run.checkpoints.map((point) => (
                    <section key={point.id ?? "checkpoint-unavailable"}>
                      <Field label="Checkpoint ID" value={point.id} copy />
                      <Field label="核验状态" value={point.status} />
                      <JsonView value={point.checks} />
                      <p className="caption">
                        各核验维度独立展示；不由检查点推出执行因果。
                      </p>
                    </section>
                  ))
                ) : (
                  <EmptyState title="没有关联的 Checkpoint">
                    当前运行没有可显示的已存检查点。
                  </EmptyState>
                )}
              </>
            )}
            {tab === "恢复" && (
              <>
                <h2>独立恢复证据</h2>
                {run.recovery.length ? (
                  run.recovery.map((recovery) => (
                    <section className="recovery-facts" key={recovery.id}>
                      <Field label="Recovery Case" value={recovery.id} copy />
                      <Field
                        label="原始执行结果"
                        value={
                          <Badge tone="warning">{recovery.sourceOutcome}</Badge>
                        }
                      />
                      <Field
                        label="独立 Child Run"
                        value={recovery.childRunId}
                        copy
                      />
                      <Field
                        label="Child 存储状态"
                        value={recovery.childStatus}
                      />
                      <Field label="恢复记录" value={recovery.status} />
                      <p className="notice">
                        {recovery.sourceOutcome === "UNKNOWN"
                          ? "Child 完成不会把原始 Source UNKNOWN 改写为成功。"
                          : "Source 结果保持独立；Child 完成不证明历史调用因果。"}
                      </p>
                    </section>
                  ))
                ) : (
                  <EmptyState title="没有 Recovery Case">
                    没有已记录的恢复事实，当前界面不会启动恢复。
                  </EmptyState>
                )}
                <button className="button secondary" disabled>
                  <LockKeyhole size={14} /> 批准恢复（不可用）
                </button>
                <p className="caption">当前工作台只读，没有审批或执行端点。</p>
              </>
            )}
            {tab === "证据" && (
              <>
                <h2>身份与完整性</h2>
                <Field label="记录模型" value={run.model.modelId} />
                <Field label="Adapter" value={run.model.adapterName} />
                <Field
                  label="计划 SkillRef"
                  value={
                    run.plan?.skillRef
                      ? `${run.plan.skillRef.skill_id}@${run.plan.skillRef.skill_version}`
                      : "未关联"
                  }
                  copy
                />
                <h3>完整性问题</h3>
                {run.inspection.issues.length ? (
                  <JsonView value={run.inspection.issues} />
                ) : (
                  <p className="caption">
                    没有已返回的问题；不超出当前检查支持范围。
                  </p>
                )}
                <h3>未闭合调用</h3>
                <JsonView value={run.inspection.pendingInvocations} />
              </>
            )}
          </>
        )}
      </div>
      <footer className="inspector-footer">
        <LockKeyhole size={12} />{" "}
        {mode === "demo" ? "DEMO · 预设证据" : "Core · READ ONLY"}
      </footer>
    </div>
  );
}

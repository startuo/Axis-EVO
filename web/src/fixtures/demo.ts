import type {
  EventView,
  EvolutionView,
  FileView,
  ProjectView,
  RunView,
  SkillView,
} from "../lib/types";

// All records in this module are illustrative, deterministic UI scenarios.
// They are never used as a fallback for connected Core data.
const digest = (character: string) => character.repeat(64);
const at = "2026-10-12T08:42:00Z";
const events = (types: string[]): EventView[] =>
  types.map((type, index) => ({
    id: `demo-event-${index + 1}`,
    seq: index + 1,
    type,
    timestamp: `2026-10-12T08:42:${String(index).padStart(2, "0")}Z`,
    stepId: index > 1 && index < 9 ? "update_timeout" : null,
    toolCallId: index > 1 && index < 9 ? "call_patch_001" : null,
    summary:
      (
        {
          FILE_OBSERVED: "Core 文件观察 · config/settings.json",
          TOOL_INTENT: "持久化执行意图 · patch_file",
          TOOL_RESULT: "工具报告 · SUCCESS",
          STEP_CONFIRMED: "调用具有完整结果证据",
          VALIDATION_PASSED: "独立文件断言通过",
          RUN_COMPLETED: "任务终态与事件原子提交",
        } as Record<string, string>
      )[type] ?? "预设场景中的结构化活动",
  }));
const files: FileView[] = [
  {
    path: "config/settings.json",
    reason: "POST_TOOL",
    exists: true,
    sha256: digest("a"),
    sizeBytes: 44,
    seq: 7,
    before: '{\n  "timeout": 10,\n  "retries": 3\n}\n',
    content: '{\n  "timeout": 20,\n  "retries": 3\n}\n',
  },
  {
    path: "tests/test_settings.py",
    reason: "VALIDATION",
    exists: true,
    sha256: digest("b"),
    sizeBytes: 96,
    seq: 11,
    content: 'def test_timeout():\n    assert settings["timeout"] == 20\n',
  },
];
const complete: RunView = {
  id: "demo-timeout",
  taskId: "update-timeout",
  title: "更新配置中的超时设置",
  status: "COMPLETED",
  goal: "将 config/settings.json 的 timeout 从 10 调整为 20，保留其他配置，并验证最终文件内容。",
  startedAt: at,
  endedAt: "2026-10-12T08:42:15Z",
  eventCount: 12,
  events: events([
    "RUN_STARTED",
    "TASK_LOADED",
    "STEP_PLANNED",
    "FILE_OBSERVED",
    "TOOL_INTENT",
    "FILE_OBSERVED",
    "TOOL_RESULT",
    "STEP_CONFIRMED",
    "VALIDATION_STARTED",
    "FILE_OBSERVED",
    "VALIDATION_PASSED",
    "RUN_COMPLETED",
  ]),
  plan: {
    proposalId: "demo-proposal-001",
    planSha256: digest("c"),
    approvedPlanSha256: digest("c"),
    approvalStatus: "APPROVED",
    skillRef: { skill_id: "config.safe-update", skill_version: 2 },
    steps: [
      {
        id: "update_timeout",
        toolName: "patch_file",
        path: "config/settings.json",
        argumentsSha256: digest("d"),
      },
    ],
  },
  inspection: {
    status: "SUPPORTED",
    observations: [],
    traceConsistent: true,
    issues: [],
    pendingInvocations: [],
  },
  files,
  checkpoints: [
    {
      id: "demo-checkpoint-001",
      status: "VALID",
      checks: {
        eventPrefix: "VALID",
        skillIdentity: "VALID",
        fileSnapshot: "VALID",
      },
    },
  ],
  recovery: [],
  model: {
    adapterName: "offline-demo-adapter",
    modelId: "deterministic-plan-v1",
  },
  limitations: ["预设界面场景；摘要与记录为演示数据，不代表实际执行。"],
};
const interrupted: RunView = {
  ...complete,
  id: "demo-interrupted",
  title: "检查中断的配置修改",
  status: "RUNNING",
  endedAt: null,
  goal: "检查一次已提交意图但未持久化工具结果的配置修改，保留原始执行结果为 UNKNOWN。",
  eventCount: 5,
  events: events([
    "RUN_STARTED",
    "TASK_LOADED",
    "STEP_PLANNED",
    "FILE_OBSERVED",
    "TOOL_INTENT",
  ]),
  inspection: {
    status: "SUPPORTED",
    observations: [
      "UNFINISHED_RUN",
      "EXECUTION_RESULT_UNKNOWN",
      "EXTERNAL_STATE_CHANGED",
    ],
    traceConsistent: true,
    issues: [],
    pendingInvocations: [{ toolCallId: "call_patch_001", result: null }],
  },
  files: [
    {
      ...files[0],
      reason: "PRE_TOOL",
      content: undefined,
      before: undefined,
      seq: 4,
    },
  ],
  recovery: [
    {
      id: "demo-recovery-001",
      sourceOutcome: "UNKNOWN",
      childRunId: "demo-child-001",
      childStatus: "COMPLETED",
      status: "INDEPENDENT_CHILD_COMPLETED",
      proposalSha256: digest("e"),
    },
  ],
};
const failed: RunView = {
  ...complete,
  id: "demo-failed",
  title: "核对独立验收失败",
  status: "FAILED",
  eventCount: 11,
  goal: "工具正常返回，但最终文件未满足任务断言。独立 Acceptance 决定失败，工具 SUCCESS 不等于任务完成。",
  events: events([
    "RUN_STARTED",
    "TASK_LOADED",
    "STEP_PLANNED",
    "FILE_OBSERVED",
    "TOOL_INTENT",
    "FILE_OBSERVED",
    "TOOL_RESULT",
    "STEP_CONFIRMED",
    "VALIDATION_STARTED",
    "VALIDATION_FAILED",
    "RUN_FAILED",
  ]),
  recovery: [],
};
const proposed: RunView = {
  ...complete,
  id: "demo-proposed",
  title: "审阅尚未批准的计划",
  status: "RUNNING",
  endedAt: null,
  events: [],
  eventCount: 0,
  files: [],
  checkpoints: [],
  recovery: [],
  plan: {
    ...complete.plan!,
    approvalStatus: "PROPOSED",
    approvedPlanSha256: null,
  },
  limitations: [
    "仅演示独立的计划提案视图；没有执行授权，不代表已经创建真实 Run。",
  ],
};
export const demoProjects: ProjectView[] = [
  { id: "axis-evo", name: "Axis-Evo" },
  { id: "research", name: "可靠性研究" },
];
export const demoRuns: RunView[] = [complete, interrupted, failed, proposed];
export const demoSkills: SkillView[] = [1, 2, 3].map((version) => ({
  id: "config.safe-update",
  version,
  name: "安全配置更新",
  description: "以唯一上下文修改配置，保留无关字节，并交由独立验收核对。",
  state: version === 3 ? "SHADOW" : "TRUSTED",
  allowedTools: ["read_file", "patch_file", "run_tests"],
  source:
    version === 1
      ? { type: "ORIGINAL" }
      : {
          type: "DERIVED",
          parent: {
            skill_id: "config.safe-update",
            skill_version: version - 1,
          },
        },
  cardSha256: digest(String(version)),
  preferred: version === 2,
  instructions:
    "先确认目标路径与精确上下文，只修改任务要求的配置项。保留编码、换行和其他字段。工具成功后仍须通过独立 Acceptance。",
  history: [
    { state: "CANDIDATE" },
    { state: "SHADOW" },
    ...(version < 3 ? [{ state: "TRUSTED" }] : []),
  ],
  trust: {
    recommendation:
      version === 3 ? "INSUFFICIENT_EVIDENCE" : "NO_REGRESSION_OBSERVED",
    eligibleCases: 5,
    candidatePassed: 5,
    regressions: 0,
    unknown: 0,
    unsupported: 0,
  },
}));
export const demoEvolution: EvolutionView = {
  id: "demo-case-001",
  sourceSkillRef: { skill_id: "config.safe-update", skill_version: 1 },
  governanceMode: "EVIDENCE_GATED",
  preferredSkillRef: { skill_id: "config.safe-update", skill_version: 2 },
  stages: [
    { label: "参考版本", value: "v1 · TRUSTED", id: "config.safe-update@1" },
    {
      label: "不可变修订",
      value: "调用方草稿 · 已批准",
      id: "demo-revision-001",
    },
    {
      label: "候选版本",
      value: "v2 · CANDIDATE → SHADOW",
      id: "config.safe-update@2",
    },
    {
      label: "配对评估",
      value: "5 / 5 通过 · 0 回归",
      id: "demo-comparison-001",
    },
    { label: "门禁资格", value: "ELIGIBLE_FOR_APPROVAL", id: "demo-gate-001" },
    { label: "精确摘要批准", value: "独立调用方动作", id: "demo-approval-001" },
    { label: "原子晋升", value: "TRUSTED + receipt", id: "demo-receipt-001" },
    {
      label: "版本激活",
      value: "首选 v2 · 显式选择",
      id: "demo-activation-001",
    },
  ],
  comparison: {
    suite: "demo-config-five-v1",
    eligibleCases: 5,
    candidatePassed: 5,
    regressions: 0,
    unknown: 0,
    unsupported: 0,
    recommendation: "NO_REGRESSION_OBSERVED",
  },
  revisions: [],
  activationHistory: [{ id: "demo-activation-001", version: 2 }],
  integrityIssues: [],
};

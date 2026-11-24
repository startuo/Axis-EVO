export type Mode = "demo" | "connected";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";
export type FactStatus = "success" | "warning" | "neutral" | "error";
export type EventView = {
  id: string;
  seq: number;
  type: string;
  timestamp: string;
  stepId: string | null;
  toolCallId: string | null;
  summary: string;
};
export type StepView = {
  id: string;
  toolName: string;
  path: string | null;
  argumentsSha256: string | null;
};
export type FileView = {
  path: string;
  reason: string;
  exists: boolean;
  sha256: string | null;
  sizeBytes: number | null;
  seq: number;
  content?: string;
  before?: string;
};
export type PlanView = {
  proposalId: string | null;
  planSha256: string | null;
  approvedPlanSha256: string | null;
  approvalStatus: string;
  skillRef: { skill_id: string; skill_version: number } | null;
  steps: StepView[];
};
export type RunSummary = {
  id: string;
  taskId: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
};
export type CheckpointView = {
  id: string | null;
  status: string;
  checks: Record<string, unknown>;
};
export type RecoveryView = {
  id: string;
  sourceOutcome: string;
  childRunId: string | null;
  childStatus: string | null;
  status: string;
  proposalSha256?: string;
};
export type RunView = RunSummary & {
  eventsTruncated?: boolean;
  goal: string | null;
  events: EventView[];
  plan: PlanView | null;
  inspection: {
    status: string;
    observations: string[];
    traceConsistent: boolean | null;
    issues: string[];
    pendingInvocations: unknown[];
  };
  files: FileView[];
  checkpoints: CheckpointView[];
  recovery: RecoveryView[];
  model: { adapterName: string | null; modelId: string | null };
  limitations: string[];
};
export type SkillView = {
  id: string;
  version: number;
  name: string;
  description: string;
  state: string;
  allowedTools: string[];
  source: unknown;
  cardSha256: string;
  preferred: boolean;
  instructions?: string;
  history?: unknown[];
  trust?: unknown;
};
export type EvolutionView = {
  id: string;
  sourceSkillRef: { skill_id: string; skill_version: number };
  governanceMode?: string;
  revisions?: unknown[];
  preferredSkillRef?: { skill_id: string; skill_version: number } | null;
  activationHistory?: unknown[];
  integrityIssues?: string[];
  [key: string]: unknown;
};
export type ProjectView = {
  id: string;
  name: string;
  capabilities?: Record<string, boolean>;
};
export type ProviderProfile = {
  id: string;
  name: string;
  protocol: string;
  endpoint: string;
  modelId: string;
  credentialRef: string;
  timeout: number;
};
export type Resource<T> = {
  state: "idle" | "loading" | "ready" | "error";
  data: T;
  error?: string;
};

import { validateCoreData } from "./api";
import type { RunView } from "./types";

export type SkillRef = { skill_id: string; skill_version: number };
export type RuntimeCapabilities = {
  enabled: boolean;
  authenticated: boolean;
  projects: { id: string; name: string; skills: SkillRef[] }[];
  allowedTools: string[];
  blockedTools: string[];
  limitations: string[];
  executionMode?: string;
};
export type RuntimeProfile = {
  id: string;
  revision: number;
  configSha256: string;
  name: string;
  protocol: "openai-compatible" | "deepseek-compatible";
  endpoint: string;
  modelId: string;
  credentialRef: string;
  timeout: number;
  credentialConfigured: boolean;
  testStatus: string;
  testedAt: string | null;
};
export type ProfileInput = Pick<RuntimeProfile, "name" | "protocol" | "endpoint" | "modelId" | "credentialRef" | "timeout">;
export type RuntimeProfiles = {
  profiles: RuntimeProfile[];
  activeProfileId: string | null;
  endpoints: string[];
  credentialRefs: { id: string; configured: boolean }[];
  unsupportedOptions: string[];
};
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RuntimeProposal = {
  proposalId: string;
  cardSha256: string;
  taskSpecSha256: string;
  planSha256: string;
  approvedPlanSha256: string | null;
  steps: { step_id: string; tool_name: string; arguments: { [key: string]: JsonValue } }[];
};
export type ThreadStatus = "QUEUED" | "PLANNING" | "AWAITING_APPROVAL" | "DISPATCH_RESERVED" | "EXECUTING" | "FINISHED" | "FAILED" | "UNKNOWN";
export type RuntimeSupervision = {
  jobId: string; jobState: string; dispatchId: string | null; workerIdentity: string | null;
  workerAssigned: boolean; workerRunning: boolean; workerExitObserved: boolean; exitCode: number | null;
  supervisionLost: boolean; coordinatorAvailable: boolean; coreRunExists: boolean;
  coreTerminalObserved: boolean; pendingIntentCount: number; outcomeUnresolved: boolean;
  recoveryAvailable: boolean; observations: { kind: string; detail: JsonValue; observedAt: string }[];
};
export type ProviderHistory = { profileId: string; revisions: RuntimeProfile[]; wireParameters: { stream: boolean; n: number }; inactiveParameters: string[]; providerDefaults: string };
export type RuntimeThreadSummary = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ThreadStatus;
  proposalId: string | null;
  runId: string | null;
};
export type RuntimeThread = RuntimeThreadSummary & {
  prompt: string;
  errorCode: string | null;
  profileSnapshot: RuntimeProfile;
  skillRef: SkillRef;
  proposal: RuntimeProposal | null;
  run: RunView | null;
  supervision?: RuntimeSupervision | null;
};

const RESPONSE_LIMIT = 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 65536;
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 1000;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const nullableText = (v: unknown) => v === null || text(v);
const skillRef = (v: unknown) => object(v) && text(v.skill_id) && integer(v.skill_version) && v.skill_version > 0;
const states: ThreadStatus[] = ["QUEUED", "PLANNING", "AWAITING_APPROVAL", "DISPATCH_RESERVED", "EXECUTING", "FINISHED", "FAILED", "UNKNOWN"];
const profile = (v: unknown) => object(v) && text(v.id) && integer(v.revision) && v.revision > 0 && hash(v.configSha256) && text(v.name) && ["openai-compatible", "deepseek-compatible"].includes(String(v.protocol)) && text(v.endpoint) && text(v.modelId) && text(v.credentialRef) && integer(v.timeout) && v.timeout > 0 && typeof v.credentialConfigured === "boolean" && text(v.testStatus) && nullableText(v.testedAt);
const summary = (v: unknown) => object(v) && text(v.id) && text(v.projectId) && text(v.title) && text(v.createdAt) && text(v.updatedAt) && states.includes(v.status as ThreadStatus) && nullableText(v.proposalId) && nullableText(v.runId);
function jsonTree(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "boolean" || text(value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (list(value)) return value.every((item) => jsonTree(item, depth + 1));
  return object(value) && Object.values(value).every((item) => jsonTree(item, depth + 1));
}
function proposal(value: unknown): boolean {
  return object(value) && text(value.proposalId) && hash(value.cardSha256) && hash(value.taskSpecSha256) && hash(value.planSha256) && (value.approvedPlanSha256 === null || hash(value.approvedPlanSha256)) && list(value.steps) && value.steps.length > 0 && value.steps.length <= 10 && value.steps.every((step) => object(step) && text(step.step_id) && text(step.tool_name) && object(step.arguments) && jsonTree(step.arguments));
}

export class RuntimeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const errorMessages: Record<string, string> = {
  AUTH_REQUIRED: "本地会话尚未开启，请输入终端显示的会话代码。",
  SESSION_REQUIRED: "本地会话已失效，请重新开启。",
  CSRF_INVALID: "当前会话授权已失效，请重新开启本地会话。",
  CSRF_REQUIRED: "请重新开启本地会话以获得本次页面的授权。",
  APPROVAL_MISMATCH: "批准摘要与已存计划不一致，执行被拒绝。",
  INVALID_APPROVAL: "计划批准未通过核验，没有启动执行。",
  PROFILE_CHANGED: "模型配置版本已改变，请重新选择精确版本。",
  CREDENTIAL_UNAVAILABLE: "后端尚未配置对应凭据。请在终端环境中配置。",
  RUNTIME_DISABLED: "真实运行尚未在后端启用。",
  BUSY: "本地运行容量已满，请等待现有任务结束。",
};

export function validateRuntimeData(path: string, data: unknown, mutating = false): void {
  const reject = () => { throw new RuntimeError("INVALID_DATA", "Runtime 响应结构无效，未使用演示数据替代。"); };
  if (path === "/capabilities") {
    if (!object(data) || typeof data.enabled !== "boolean" || typeof data.authenticated !== "boolean" || !list(data.projects) || !data.projects.every((p) => object(p) && text(p.id) && text(p.name) && list(p.skills) && p.skills.every(skillRef)) || !list(data.allowedTools) || !data.allowedTools.every(text) || !list(data.blockedTools) || !data.blockedTools.every(text) || !list(data.limitations) || !data.limitations.every(text)) reject();
  } else if (path === "/session") {
    if (!object(data) || typeof data.csrfToken !== "string" || data.csrfToken.length < 16 || data.csrfToken.length > 256) reject();
  } else if (path === "/providers" && !mutating) {
    if (!object(data) || !list(data.profiles) || !data.profiles.every(profile) || !nullableText(data.activeProfileId) || !list(data.endpoints) || !data.endpoints.every(text) || !list(data.credentialRefs) || !data.credentialRefs.every((ref) => object(ref) && text(ref.id) && typeof ref.configured === "boolean") || !list(data.unsupportedOptions) || !data.unsupportedOptions.every(text)) reject();
  } else if (/^\/providers\/[^/]+\/history$/.test(path)) {
    if (!object(data) || !text(data.profileId) || !list(data.revisions) || !data.revisions.every(profile) || !object(data.wireParameters) || data.wireParameters.stream !== false || data.wireParameters.n !== 1 || !list(data.inactiveParameters) || !data.inactiveParameters.every(text) || !text(data.providerDefaults)) reject();
    if (object(data) && text(data.profileId) && list(data.revisions) && (encodeURIComponent(data.profileId) !== path.split('/')[2] || data.revisions.length < 1 || data.revisions.length > 100 || !data.revisions.every((revision, index) => object(revision) && revision.id === data.profileId && revision.revision === index + 1))) reject();
  } else if (path === "/providers" || /^\/providers\/[^/]+\/(?:revisions|activate)$/.test(path)) {
    if (!profile(data)) reject();
  } else if (/^\/providers\/[^/]+\/revisions\/\d+\/test$/.test(path)) {
    if (!object(data) || !text(data.id) || !integer(data.revision) || !hash(data.configSha256) || !["CONNECTED", "FAILED"].includes(String(data.testStatus)) || !text(data.testedAt) || !text(data.category) || !(data.httpStatus === null || integer(data.httpStatus))) reject();
  } else if (/\/threads$/.test(path) && !mutating) {
    const project = path.split('/')[2];
    if (!list(data) || !data.every((item) => summary(item) && object(item) && encodeURIComponent(String(item.projectId)) === project)) reject();
  } else if (/\/threads(?:\/|$)/.test(path)) {
    if (!summary(data) || !object(data) || !text(data.prompt) || !nullableText(data.errorCode) || !profile(data.profileSnapshot) || !skillRef(data.skillRef) || !(data.proposal === null || proposal(data.proposal)) || !(data.run === null || object(data.run))) { reject(); return; }
    const route = path.split('/');
    if (encodeURIComponent(String(data.projectId)) !== route[2] || route[4] !== undefined && encodeURIComponent(String(data.id)) !== route[4]) reject();
    const health = data.supervision;
    if (health !== undefined && health !== null && (!object(health) || !text(health.jobId) || !text(health.jobState) || !nullableText(health.dispatchId) || !nullableText(health.workerIdentity) || !['workerAssigned', 'workerRunning', 'workerExitObserved', 'supervisionLost', 'coordinatorAvailable', 'coreRunExists', 'coreTerminalObserved', 'outcomeUnresolved', 'recoveryAvailable'].every((key) => typeof health[key] === 'boolean') || !integer(health.pendingIntentCount) || !(health.exitCode === null || Number.isSafeInteger(health.exitCode)) || !list(health.observations) || !health.observations.every((o) => object(o) && text(o.kind) && text(o.observedAt) && jsonTree(o.detail)))) reject();
    if (object(health) && (health.jobId !== data.id || ![...states, 'OUTCOME_UNKNOWN'].includes(String(health.jobState)) || health.coreRunExists !== (data.run !== null) || health.workerExitObserved === false && health.exitCode !== null)) reject();
    if (object(health) && (health.workerRunning === true && health.workerExitObserved === true || health.coreTerminalObserved === true && (!object(data.run) || !['COMPLETED', 'FAILED'].includes(String(data.run.status))))) reject();
    if (object(health) && (health.workerAssigned !== (typeof health.workerIdentity === 'string' && health.workerIdentity.length > 0) || (health.workerRunning === true || health.workerExitObserved === true) && health.workerAssigned !== true || health.workerExitObserved === true && health.exitCode === null)) reject();
    if (data.run !== null) {
      try { validateCoreData(`/projects/selected/runs/${String(data.runId)}`, data.run); }
      catch { reject(); }
      if (!object(data.run) || data.run.id !== data.runId) reject();
    }
    if (data.proposal !== null && object(data.proposal) && data.proposal.proposalId !== data.proposalId) reject();
  }
}

export async function runtimeRequest<T>(path: string, options: { body?: unknown; csrfToken?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.csrfToken) headers["X-Axis-CSRF"] = options.csrfToken;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20000);
  let response: Response;
  try {
    response = await fetch(`/api/runtime${path}`, { method: options.body === undefined ? "GET" : "POST", credentials: "same-origin", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  } catch {
    throw new RuntimeError("CONNECTION_FAILED", "本地 Runtime 连接中断。状态尚不确定，请读取已记录事实；不会自动重试执行。");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new RuntimeError("INVALID_RESPONSE", "本地 Runtime 返回了非 JSON 响应。");
  const reader = response.body?.getReader();
  if (!reader) throw new RuntimeError("INVALID_RESPONSE", "本地 Runtime 没有返回数据。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new RuntimeError("RESPONSE_LIMIT", "Runtime 响应超过大小上限。"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RuntimeError("INVALID_RESPONSE", "Runtime 响应格式无效。"); }
  if (!response.ok) {
    const code = object(payload) && object(payload.error) && typeof payload.error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code) ? payload.error.code : "REQUEST_REJECTED";
    throw new RuntimeError(code, errorMessages[code] ?? "Runtime 拒绝了当前操作。请检查权限与已记录状态；未自动重试。");
  }
  if (!object(payload) || payload.schema_version !== 1 || payload.mode !== "runtime" || !("data" in payload)) throw new RuntimeError("INVALID_SOURCE", "响应不属于真实 Runtime 数据源。");
  validateRuntimeData(path, payload.data, options.body !== undefined);
  return payload.data as T;
}

const encoded = encodeURIComponent;
export const runtimeApi = {
  capabilities: (signal?: AbortSignal) => runtimeRequest<RuntimeCapabilities>("/capabilities", { signal }),
  session: (code: string) => runtimeRequest<{ csrfToken: string }>("/session", { body: { code } }),
  restoreSession: (signal?: AbortSignal) => runtimeRequest<{ csrfToken: string }>("/session", { signal }),
  profiles: (signal?: AbortSignal) => runtimeRequest<RuntimeProfiles>("/providers", { signal }),
  profileHistory: (id: string, signal?: AbortSignal) => runtimeRequest<ProviderHistory>(`/providers/${encoded(id)}/history`, { signal }),
  saveProfile: (input: ProfileInput, token: string, id?: string) => runtimeRequest<RuntimeProfile>(id ? `/providers/${encoded(id)}/revisions` : "/providers", { body: input, csrfToken: token }),
  activateProfile: (id: string, token: string) => runtimeRequest<RuntimeProfile>(`/providers/${encoded(id)}/activate`, { body: {}, csrfToken: token }),
  testProfile: (profile: RuntimeProfile, token: string) => runtimeRequest<unknown>(`/providers/${encoded(profile.id)}/revisions/${profile.revision}/test`, { body: {}, csrfToken: token, timeoutMs: Math.min(305000, (profile.timeout + 5) * 1000) }),
  threads: (project: string, signal?: AbortSignal) => runtimeRequest<RuntimeThreadSummary[]>(`/projects/${encoded(project)}/threads`, { signal }),
  thread: (project: string, id: string, signal?: AbortSignal) => runtimeRequest<RuntimeThread>(`/projects/${encoded(project)}/threads/${encoded(id)}`, { signal }),
  plan: (project: string, input: { prompt: string; profileId: string; profileRevision: number; skillRef: SkillRef }, token: string) => runtimeRequest<RuntimeThread>(`/projects/${encoded(project)}/threads`, { body: input, csrfToken: token }),
  approve: (thread: RuntimeThread, token: string) => runtimeRequest<RuntimeThread>(`/projects/${encoded(thread.projectId)}/threads/${encoded(thread.id)}/approve`, { body: { proposalId: thread.proposal!.proposalId, approvedPlanSha256: thread.proposal!.planSha256 }, csrfToken: token }),
};

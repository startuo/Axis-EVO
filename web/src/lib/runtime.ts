import { validateCoreData } from "./api";
import { createSessionInitializer } from './runtimeSession';
import {validateFeedbackData} from './feedbackData';
import type { RunView } from "./types";

export type SkillRef = { skill_id: string; skill_version: number };
export type ReadPolicyIdentity = { policySha256:string; authorityId:number };
export type RuntimeCapabilities = {
  enabled: boolean;
  authenticated: boolean;
  projects: { id: string; name: string; skills: SkillRef[]; taskTemplates?: { id: string; name: string; readPolicy?:ReadPolicyIdentity & {allowedPaths:string[]} }[] }[];
  allowedTools: string[];
  blockedTools: string[];
  limitations: string[];
  executionMode?: string;
  supportsConversations?: boolean;
  supportsReplies?: boolean;
  maximumPromptCodepoints?: number;
  promptLengthUnit?: string;
};
export type RuntimeProfile = {
  id: string;
  revision: number;
  configSha256: string;
  name: string;
  protocol: "openai-compatible" | "deepseek-compatible" | "local-gateway";
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
  localGateways?: { endpoint: string; modelIds: string[] }[];
  credentialRefs: { id: string; configured: boolean }[];
  unsupportedOptions: string[];
  credentialEnrollment?: {
    available:boolean;storage:'WINDOWS_CREDENTIAL_MANAGER'|'UNAVAILABLE';
    presets:{id:'deepseek';name:string;protocol:'deepseek-compatible';endpoint:string;credentialRef:string;models:string[]}[];
  };
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
export type ProviderTestResult = Pick<RuntimeProfile, 'id' | 'revision' | 'configSha256' | 'testStatus' | 'testedAt'> & { category: string; httpStatus: number | null };
export type ModelDiscovery = Pick<RuntimeProfile, 'id' | 'revision' | 'configSha256'> & { status: 'DISCOVERED'; modelIds: string[]; excludedCount: number; planningVerified: false; executionVerified: false };
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
  readPolicy?:ReadPolicyIdentity & {allowedPaths:string[];approvalSource:'POLICY'|null;dispatchId?:string;approvedPlanSha256?:string;autoApprovalPending?:boolean;planningWorker?:string;planningExitObservationId?:number};
};
export type RuntimeInvocation = {threadId:string;runId:string;toolCallId:string;stepId:string;toolName:string;
  arguments:Record<string,JsonValue>;intentEventId:string;intentSeq:number;source:'COMMITTED_CORE_EVENTS';
  result:null|{eventId:string;seq:number;payloadSha256:string;status:'SUCCESS'|'FAILED'|'TIMEOUT';message:string;data:Record<string,JsonValue>}};
export type RuntimeConversationSummary = { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; status: ThreadStatus; turnCount: number; threadIds: string[]; conversationOnly?: boolean };
export type RuntimeTurnSummary = { id: string; number: number; threadId: string; reservedRunId: string; prompt: string; webStatus: ThreadStatus; coreOutcome: string | null; outcomeObservedAt: string | null; proposalId: string | null; approvalIdentity: string | null; contextSha256: string; taskTemplateId: string; profileSnapshot: RuntimeProfile; skillRef: SkillRef };
export type RuntimeReply = {
  id: string; conversationId: string; projectId: string; prompt: string; createdAt: string;
  profileSnapshot: RuntimeProfile; status: 'QUEUED' | 'RESPONDING' | 'REPLIED' | 'FAILED' | 'INTERRUPTED';
  response: { text: string; sha256: string; source: 'MODEL_AUTHORED_UNVERIFIED' } | null;
  errorCode: string | null; requestSha256: string; toolsAuthorized: false;
};
export type ConversationItem = { seq: number; kind: 'CHAT' | 'TASK'; sourceId: string };
export type RuntimeConversation = { id: string; projectId: string; title: string; createdAt: string; turns: RuntimeTurnSummary[]; sequential: true; maximumTurns: number; canContinue: boolean; continuationPolicy: string; items?: ConversationItem[]; replies?: RuntimeReply[]; canChat?: boolean };
export type RuntimeTurn = { id: string; conversationId: string; number: number; thread: RuntimeThread; contextSha256: string; messages: JsonValue[]; observations: JsonValue[] };
export type RuntimeContext = { turnId: string; conversationId: string; sha256: string; canonicalJson: string; manifest: JsonValue; semanticLocation: string };
export type TurnInput = { prompt: string; messageId: string; profileId: string; profileRevision: number; skillRef: SkillRef; taskTemplateId: string; readPolicy?:ReadPolicyIdentity };

const RESPONSE_LIMIT = 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 65536;
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 1000;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const readScope = (v:unknown) => object(v)&&hash(v.policySha256)&&integer(v.authorityId)&&v.authorityId>0&&list(v.allowedPaths)&&v.allowedPaths.length>0&&v.allowedPaths.length<=32&&v.allowedPaths.every(text)&&new Set(v.allowedPaths).size===v.allowedPaths.length;
const nullableText = (v: unknown) => v === null || text(v);
const skillRef = (v: unknown) => object(v) && text(v.skill_id) && integer(v.skill_version) && v.skill_version > 0;
const states: ThreadStatus[] = ["QUEUED", "PLANNING", "AWAITING_APPROVAL", "DISPATCH_RESERVED", "EXECUTING", "FINISHED", "FAILED", "UNKNOWN"];
const identity = (value: unknown, prefix: string) => typeof value === 'string' && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value);
const turnSummary = (v: unknown) => object(v) && identity(v.id, 'turn') && integer(v.number) && v.number > 0 && v.number <= 16 && identity(v.threadId, 'thread') && identity(v.reservedRunId, 'run') && text(v.prompt) && states.includes(v.webStatus as ThreadStatus) && (v.coreOutcome === null || ['COMPLETED', 'FAILED'].includes(String(v.coreOutcome))) && nullableText(v.outcomeObservedAt) && nullableText(v.proposalId) && nullableText(v.approvalIdentity) && hash(v.contextSha256) && text(v.taskTemplateId) && profile(v.profileSnapshot) && skillRef(v.skillRef);
const profile = (v: unknown) => object(v) && text(v.id) && integer(v.revision) && v.revision > 0 && hash(v.configSha256) && text(v.name) && ["openai-compatible", "deepseek-compatible", "local-gateway"].includes(String(v.protocol)) && text(v.endpoint) && text(v.modelId) && text(v.credentialRef) && integer(v.timeout) && v.timeout > 0 && typeof v.credentialConfigured === "boolean" && text(v.testStatus) && nullableText(v.testedAt);
const summary = (v: unknown) => object(v) && text(v.id) && text(v.projectId) && text(v.title) && text(v.createdAt) && text(v.updatedAt) && states.includes(v.status as ThreadStatus) && nullableText(v.proposalId) && nullableText(v.runId);
const reply = (v: unknown) => object(v) && identity(v.id, 'chat') && identity(v.conversationId, 'conversation') && text(v.projectId) && text(v.prompt) && text(v.createdAt) && profile(v.profileSnapshot) && ['QUEUED','RESPONDING','REPLIED','FAILED','INTERRUPTED'].includes(String(v.status)) && nullableText(v.errorCode) && hash(v.requestSha256) && v.toolsAuthorized === false && (v.status === 'REPLIED' ? object(v.response) && text(v.response.text) && !!v.response.text.trim() && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v.response.text) && new TextEncoder().encode(v.response.text).length <= 32768 && hash(v.response.sha256) && v.response.source === 'MODEL_AUTHORED_UNVERIFIED' : v.response === null);
function conversationFeed(data: Record<string, unknown>): boolean {
  if (data.items === undefined && data.replies === undefined && data.canChat === undefined) return list(data.turns) && data.turns.length > 0;
  if (!list(data.items) || !data.items.length || data.items.length > 64 || !list(data.replies) || data.replies.length > 64 || !data.replies.every(reply) || typeof data.canChat !== 'boolean' || !list(data.turns)) return false;
  if (!data.items.every((item,i)=>object(item) && item.seq===i+1 && ['CHAT','TASK'].includes(String(item.kind)) && identity(item.sourceId,item.kind==='CHAT'?'chat':'turn'))) return false;
  const ids=data.items.map(item=>(item as ConversationItem).sourceId);
  const expected=[...data.turns.map(t=>(t as RuntimeTurnSummary).id),...data.replies.map(r=>(r as RuntimeReply).id)];
  if (new Set(ids).size!==ids.length || expected.length!==ids.length || !expected.every(id=>ids.includes(id))) return false;
  if (!data.replies.every(r=>object(r) && r.conversationId===data.id && r.projectId===data.projectId)) return false;
  return !data.replies.some(r=>object(r) && ['QUEUED','RESPONDING'].includes(String(r.status))) || data.canChat===false && data.canContinue===false;
}
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
  AUTH_REQUIRED: "正在恢复本地连接；没有重发操作。",
  SESSION_REQUIRED: "本地连接已更新，请查看真实记录后继续；没有重发操作。",
  CSRF_INVALID: "当前页面连接已更新；没有重发操作。",
  CSRF_REQUIRED: "当前页面连接需要更新；没有重发操作。",
  CSRF_REJECTED: "当前页面连接已更新，请查看真实记录后继续；没有重发操作。",
  SESSION_ORIGIN_REJECTED: "会话与当前页面地址不一致，请使用启动终端给出的地址重新连接。",
  MODEL_DISCOVERY_FAILED: "模型发现失败。请检查本地网关、端口与后端凭据；没有更换模型或重试。",
  MODEL_DISCOVERY_UNSUPPORTED: "当前配置不支持模型发现，请选择已授权的本地网关。",
  APPROVAL_MISMATCH: "批准摘要与已存计划不一致，执行被拒绝。",
  INVALID_APPROVAL: "计划批准未通过核验，没有启动执行。",
  PROFILE_CHANGED: "模型配置版本已改变，请重新选择精确版本。",
  CREDENTIAL_UNAVAILABLE: "未配置 API Key，请打开模型设置完成连接。",
  CREDENTIAL_STORE_UNAVAILABLE: '安全凭据存储不可用。请确认当前 Windows 用户可使用凭据管理器，并已安装 Web 依赖。',
  CREDENTIAL_REPLACEMENT_REJECTED: '此服务已保存不同的 API Key，本次没有替换。请使用现有配置。',
  INVALID_API_KEY: 'API Key 格式无效，请去除空格或换行后重试。',
  READ_POLICY_CHANGED: "读取授权范围已更新，请刷新后重新查看；没有启动执行。",
  READ_POLICY_REJECTED: "读取策略已撤回或范围不匹配，没有启动新执行。",
  RUNTIME_DISABLED: "真实运行尚未在后端启用。",
  BUSY: "本地运行容量已满，请等待现有任务结束。",
};

export function validateRuntimeData(path: string, data: unknown, mutating = false): void {
  const reject = () => { throw new RuntimeError("INVALID_DATA", "Runtime 响应结构无效，未使用演示数据替代。"); };
  if (path === "/capabilities") {
    if (!object(data) || typeof data.enabled !== "boolean" || typeof data.authenticated !== "boolean" || !list(data.projects) || !data.projects.every((p) => object(p) && text(p.id) && text(p.name) && list(p.skills) && p.skills.every(skillRef)) || !list(data.allowedTools) || !data.allowedTools.every(text) || !list(data.blockedTools) || !data.blockedTools.every(text) || !list(data.limitations) || !data.limitations.every(text)) reject();
    if (object(data) && (data.supportsConversations !== undefined && typeof data.supportsConversations !== 'boolean' || data.supportsReplies !== undefined && typeof data.supportsReplies !== 'boolean' || data.maximumPromptCodepoints !== undefined && (!integer(data.maximumPromptCodepoints) || data.maximumPromptCodepoints < 1 || data.maximumPromptCodepoints > 8192) || list(data.projects) && !data.projects.every(p => object(p) && (p.taskTemplates === undefined || list(p.taskTemplates) && p.taskTemplates.length <= 9 && p.taskTemplates.every(t => object(t) && text(t.id) && text(t.name) && (t.readPolicy === undefined || readScope(t.readPolicy))))))) reject();
  } else if (path === "/session" || path === '/session/bootstrap') {
    if (!object(data) || typeof data.csrfToken !== "string" || data.csrfToken.length < 16 || data.csrfToken.length > 256) reject();
  } else if (path === "/providers" && !mutating) {
    if (!object(data) || !list(data.profiles) || !data.profiles.every(profile) || !nullableText(data.activeProfileId) || !list(data.endpoints) || !data.endpoints.every(text) || !list(data.credentialRefs) || !data.credentialRefs.every((ref) => object(ref) && text(ref.id) && typeof ref.configured === "boolean") || !list(data.unsupportedOptions) || !data.unsupportedOptions.every(text)) reject();
    if (object(data) && data.localGateways !== undefined && (!list(data.localGateways) || data.localGateways.length > 8 || !data.localGateways.every(item => object(item) && text(item.endpoint) && list(item.modelIds) && item.modelIds.length > 0 && item.modelIds.length <= 64 && item.modelIds.every(text) && new Set(item.modelIds).size === item.modelIds.length))) reject();
    if(object(data)&&data.credentialEnrollment!==undefined){
      const value=data.credentialEnrollment;
      if(!object(value)||typeof value.available!=='boolean'||!['WINDOWS_CREDENTIAL_MANAGER','UNAVAILABLE'].includes(String(value.storage))||!list(value.presets)||value.presets.length>1||!value.presets.every(p=>object(p)&&p.id==='deepseek'&&text(p.name)&&p.protocol==='deepseek-compatible'&&p.endpoint==='https://api.deepseek.com/chat/completions'&&p.credentialRef==='managed_deepseek'&&list(p.models)&&p.models.length>0&&p.models.every(text)))reject();
    }
  } else if(path==='/credentials/enroll') {
    if(!object(data)||data.presetId!=='deepseek'||data.configured!==true||data.storage!=='WINDOWS_CREDENTIAL_MANAGER'||Object.keys(data).length!==3)reject();
  } else if (/^\/providers\/[^/]+\/history$/.test(path)) {
    if (!object(data) || !text(data.profileId) || !list(data.revisions) || !data.revisions.every(profile) || !object(data.wireParameters) || data.wireParameters.stream !== false || data.wireParameters.n !== 1 || !list(data.inactiveParameters) || !data.inactiveParameters.every(text) || !text(data.providerDefaults)) reject();
    if (object(data) && text(data.profileId) && list(data.revisions) && (encodeURIComponent(data.profileId) !== path.split('/')[2] || data.revisions.length < 1 || data.revisions.length > 100 || !data.revisions.every((revision, index) => object(revision) && revision.id === data.profileId && revision.revision === index + 1))) reject();
  } else if (path === "/providers" || /^\/providers\/[^/]+\/(?:revisions|activate)$/.test(path)) {
    if (!profile(data)) reject();
  } else if (/^\/providers\/[^/]+\/revisions\/\d+\/test$/.test(path)) {
    if (!object(data) || !text(data.id) || !integer(data.revision) || !hash(data.configSha256) || !["CONNECTED", "FAILED"].includes(String(data.testStatus)) || !text(data.testedAt) || !text(data.category) || !(data.httpStatus === null || integer(data.httpStatus))) reject();
    if (object(data) && (encodeURIComponent(String(data.id)) !== path.split('/')[2] || data.revision !== Number(path.split('/')[4]))) reject();
  } else if (/^\/providers\/[^/]+\/revisions\/\d+\/models$/.test(path)) {
    if (!object(data) || encodeURIComponent(String(data.id)) !== path.split('/')[2] || data.revision !== Number(path.split('/')[4]) || !hash(data.configSha256) || data.status !== 'DISCOVERED' || !list(data.modelIds) || data.modelIds.length > 64 || !data.modelIds.every(text) || new Set(data.modelIds).size !== data.modelIds.length || !integer(data.excludedCount) || data.planningVerified !== false || data.executionVerified !== false) reject();
  } else if (/\/replies(?:\/|$)/.test(path)) {
    const route=path.split('/');
    if (!reply(data) || !object(data) || encodeURIComponent(String(data.projectId))!==route[2] || route[3]==='replies' && route[4] && encodeURIComponent(String(data.id))!==route[4] || route[3]==='conversations' && encodeURIComponent(String(data.conversationId))!==route[4]) reject();
  } else if (/\/conversations(?:\/|$)/.test(path)) {
    const route = path.split('/');
    if (route.length === 4 && !mutating) {
      if (!list(data) || data.length > 100 || !data.every(c => object(c) && identity(c.id, 'conversation') && encodeURIComponent(String(c.projectId)) === route[2] && text(c.title) && text(c.createdAt) && text(c.updatedAt) && states.includes(c.status as ThreadStatus) && integer(c.turnCount) && (c.turnCount > 0 || c.conversationOnly===true) && c.turnCount <= 16 && list(c.threadIds) && c.threadIds.length === c.turnCount && c.threadIds.every(id => identity(id, 'thread')) && new Set(c.threadIds).size === c.threadIds.length)) reject();
      return;
    }
    if (!object(data)) { reject(); return; }
    if (route[5] === 'turns' && route[6]) {
      if (data.conversationId !== decodeURIComponent(route[4]) || (data.id ?? data.turnId) !== decodeURIComponent(route[6])) reject();
      if (route[7] === 'context') {
        if (!hash(data.sha256) || !text(data.canonicalJson) || !jsonTree(data.manifest) || data.semanticLocation !== 'Core planning request.task_spec.goal' || !object(data.manifest) || data.manifest.turn_id !== data.turnId || data.manifest.conversation_id !== data.conversationId || encodeURIComponent(String(data.manifest.project_id)) !== route[2]) reject();
      } else {
        if (!integer(data.number) || data.number < 1 || !hash(data.contextSha256) || !object(data.thread) || !list(data.messages) || !data.messages.every(item => jsonTree(item)) || !list(data.observations) || !data.observations.every(item => jsonTree(item))) { reject(); return; }
        validateRuntimeData(`/projects/${route[2]}/threads/${encodeURIComponent(String(data.thread.id))}`, data.thread);
        if (object(data.thread.run) && data.thread.run.taskId !== data.thread.id) reject();
        const messages = data.messages;
        if (!messages.every(m => object(m) && text(m.id) && ['USER_MESSAGE', 'MODEL_PLANNING_RESULT', 'SYSTEM_ACTIVITY', 'TOOL_EVIDENCE', 'VALIDATION_RESULT', 'ASSISTANT_PRESENTATION'].includes(String(m.type)) && ['IMMUTABLE_WEB_MESSAGE', 'CORE_PLAN_PROPOSAL', 'PERSISTED_CORE_EVENT', 'DERIVED_FROM_PERSISTED_FACTS'].includes(String(m.source)))) reject();
      }
    } else {
      if (!identity(data.id, 'conversation') || route[4] && route[4] !== 'turns' && data.id !== decodeURIComponent(route[4]) || encodeURIComponent(String(data.projectId)) !== route[2] || !text(data.title) || !text(data.createdAt) || !list(data.turns) || data.turns.length > 16 || !data.turns.every(turnSummary) || data.sequential !== true || data.maximumTurns !== 16 || typeof data.canContinue !== 'boolean' || !text(data.continuationPolicy) || !conversationFeed(data)) { reject(); return; }
      if (new Set(data.turns.map(t => (t as RuntimeTurnSummary).id)).size !== data.turns.length || !data.turns.every((t, i) => (t as RuntimeTurnSummary).number === i + 1)) reject();
      for (const key of ['threadId', 'reservedRunId'] as const) if (new Set(data.turns.map(t => (t as RuntimeTurnSummary)[key])).size !== data.turns.length) reject();
      const approvals = data.turns.map(t => (t as RuntimeTurnSummary).approvalIdentity).filter(Boolean);
      if (new Set(approvals).size !== approvals.length) reject();
    }
  } else if (/\/feedback(?:\/|$)|\/feedback-revisions\//.test(path)) {
    validateFeedbackData(path,data,mutating);
  } else if (/\/threads\/[^/]+\/invocations\/[^/]+$/.test(path)) {
    const route=path.split('/');
    if(!object(data)||encodeURIComponent(String(data.threadId))!==route[4]||encodeURIComponent(String(data.toolCallId))!==route[6]||!identity(data.runId,'run')||!text(data.stepId)||!['read_file','write_file','patch_file'].includes(String(data.toolName))||!object(data.arguments)||!jsonTree(data.arguments)||!text(data.intentEventId)||!integer(data.intentSeq)||data.intentSeq<1||data.source!=='COMMITTED_CORE_EVENTS') {reject();return;}
    if(data.result!==null&&(!object(data.result)||!text(data.result.eventId)||!integer(data.result.seq)||data.result.seq<=data.intentSeq||!hash(data.result.payloadSha256)||!['SUCCESS','FAILED','TIMEOUT'].includes(String(data.result.status))||!text(data.result.message)||!object(data.result.data)||!jsonTree(data.result.data)))reject();
  } else if (/\/threads$/.test(path) && !mutating) {
    const project = path.split('/')[2];
    if (!list(data) || !data.every((item) => summary(item) && object(item) && encodeURIComponent(String(item.projectId)) === project)) reject();
  } else if (/\/threads(?:\/|$)/.test(path)) {
    if (!summary(data) || !object(data) || !text(data.prompt) || !nullableText(data.errorCode) || !profile(data.profileSnapshot) || !skillRef(data.skillRef) || !(data.proposal === null || proposal(data.proposal)) || !(data.run === null || object(data.run))) { reject(); return; }
    const route = path.split('/');
    if (encodeURIComponent(String(data.projectId)) !== route[2] || route[4] !== undefined && encodeURIComponent(String(data.id)) !== route[4]) reject();
    if (data.readPolicy !== undefined && (!readScope(data.readPolicy) || !object(data.readPolicy) || data.readPolicy.autoApprovalPending !== undefined && typeof data.readPolicy.autoApprovalPending !== "boolean" || ![null,"POLICY"].includes(data.readPolicy.approvalSource as null|"POLICY") || data.readPolicy.approvalSource === "POLICY" && (!hash(data.readPolicy.approvedPlanSha256) || !text(data.readPolicy.dispatchId) || !object(data.proposal) || data.proposal.planSha256 !== data.readPolicy.approvedPlanSha256))) reject();
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
    if(object(data.readPolicy)&&object(data.proposal)&&list(data.proposal.steps)&&!data.proposal.steps.every(step=>object(step)&&step.tool_name==='read_file'&&object(step.arguments)&&Object.keys(step.arguments).length===1&&typeof step.arguments.path==='string'&&(data.readPolicy as {allowedPaths:string[]}).allowedPaths.includes(step.arguments.path)))reject();
  }
}

export function validateTurnBinding(summary: RuntimeTurnSummary, turn: RuntimeTurn): void {
  const thread = turn.thread;
  if (turn.id !== summary.id || thread.id !== summary.threadId || turn.contextSha256 !== summary.contextSha256 || turn.number !== summary.number ||
      thread.runId !== null && thread.runId !== summary.reservedRunId || thread.run !== null && thread.run.taskId !== thread.id ||
      thread.profileSnapshot.id !== summary.profileSnapshot.id || thread.profileSnapshot.revision !== summary.profileSnapshot.revision || thread.profileSnapshot.configSha256 !== summary.profileSnapshot.configSha256 ||
      thread.skillRef.skill_id !== summary.skillRef.skill_id || thread.skillRef.skill_version !== summary.skillRef.skill_version || thread.prompt !== summary.prompt ||
      summary.proposalId !== null && thread.proposalId !== summary.proposalId) {
    throw new RuntimeError('INVALID_DATA', '轮次、固定身份与执行记录不一致。');
  }
}

export async function runtimeRequest<T>(path: string, options: { body?: unknown; csrfToken?: string; signal?: AbortSignal; timeoutMs?: number } = {}, recoverSession = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (path === '/session/bootstrap') headers['X-Axis-Bootstrap'] = '1';
  else if (options.body !== undefined) {
    // Check the session BEFORE submitting a mutation, never replay it afterward.
    const session = await initializeLocalSession();
    headers['X-Axis-CSRF'] = session.csrfToken;
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20000);
  let response: Response;
  try {
    response = await fetch(`/api/runtime${path}`, { method: options.body === undefined ? "GET" : "POST", credentials: "same-origin", redirect: 'error', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  } catch {
    throw new RuntimeError("CONNECTION_FAILED", "无法连接本地服务。请确认服务已启动；已提交操作的结果请查看真实记录，不会自动重发。");
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
    if (response.status === 401 && code === 'SESSION_REQUIRED' && options.body === undefined && recoverSession && path !== '/session' && path !== '/capabilities') {
      await initializeLocalSession();
      return runtimeRequest<T>(path, options, false);
    }
    throw new RuntimeError(code, errorMessages[code] ?? "Runtime 拒绝了当前操作。请检查权限与已记录状态；未自动重试。");
  }
  if (!object(payload) || payload.schema_version !== 1 || payload.mode !== "runtime" || !("data" in payload)) throw new RuntimeError("INVALID_SOURCE", "响应不属于真实 Runtime 数据源。");
  validateRuntimeData(path, payload.data, options.body !== undefined);
  return payload.data as T;
}

const encoded = encodeURIComponent;
const initializeLocalSession = createSessionInitializer(() => runtimeRequest<{ csrfToken: string }>('/session/bootstrap', { body: {}, timeoutMs: 5000 }));
function verifyProfileResult<T extends { id: string; revision: number; configSha256: string }>(profile: RuntimeProfile, result: T): T {
  if (result.id !== profile.id || result.revision !== profile.revision || result.configSha256 !== profile.configSha256) throw new RuntimeError('INVALID_DATA', '连接证据与所选配置版本不一致。');
  return result;
}
export const runtimeApi = {
  sendReply: (project:string, conversation:string|null, input:Pick<TurnInput,'prompt'|'messageId'|'profileId'|'profileRevision'>, token:string) => runtimeRequest<RuntimeReply>(`/projects/${encoded(project)}/${conversation ? `conversations/${encoded(conversation)}/replies` : 'replies'}`, {body:input,csrfToken:token}),
  conversations: (project: string, signal?: AbortSignal) => runtimeRequest<RuntimeConversationSummary[]>(`/projects/${encoded(project)}/conversations`, { signal }),
  conversation: (project: string, id: string, signal?: AbortSignal) => runtimeRequest<RuntimeConversation>(`/projects/${encoded(project)}/conversations/${encoded(id)}`, { signal }),
  turn: (project: string, id: string, turn: string, signal?: AbortSignal) => runtimeRequest<RuntimeTurn>(`/projects/${encoded(project)}/conversations/${encoded(id)}/turns/${encoded(turn)}`, { signal }),
  context: (project: string, id: string, turn: string, signal?: AbortSignal) => runtimeRequest<RuntimeContext>(`/projects/${encoded(project)}/conversations/${encoded(id)}/turns/${encoded(turn)}/context`, { signal }),
  planTurn: (project: string, id: string | null, input: TurnInput, token: string) => runtimeRequest<RuntimeConversation>(`/projects/${encoded(project)}/conversations${id ? `/${encoded(id)}/turns` : ''}`, { body: input, csrfToken: token }),
  approveTurn: (project: string, id: string, turn: RuntimeTurn, token: string) => runtimeRequest<RuntimeTurn>(`/projects/${encoded(project)}/conversations/${encoded(id)}/turns/${encoded(turn.id)}/approve`, { body: { proposalId: turn.thread.proposal!.proposalId, approvedPlanSha256: turn.thread.proposal!.planSha256 }, csrfToken: token }),
  capabilities: (signal?: AbortSignal) => runtimeRequest<RuntimeCapabilities>("/capabilities", { signal }),
  initializeSession: initializeLocalSession,
  profiles: (signal?: AbortSignal) => runtimeRequest<RuntimeProfiles>("/providers", { signal }),
  enrollCredential:(presetId:string,apiKey:string,token:string)=>runtimeRequest<{presetId:'deepseek';configured:true;storage:'WINDOWS_CREDENTIAL_MANAGER'}>('/credentials/enroll',{body:{presetId,apiKey},csrfToken:token}),
  profileHistory: (id: string, signal?: AbortSignal) => runtimeRequest<ProviderHistory>(`/providers/${encoded(id)}/history`, { signal }),
  saveProfile: (input: ProfileInput, token: string, id?: string) => runtimeRequest<RuntimeProfile>(id ? `/providers/${encoded(id)}/revisions` : "/providers", { body: input, csrfToken: token }),
  activateProfile: (id: string, token: string) => runtimeRequest<RuntimeProfile>(`/providers/${encoded(id)}/activate`, { body: {}, csrfToken: token }),
  testProfile: async (profile: RuntimeProfile, token: string) => verifyProfileResult(profile, await runtimeRequest<ProviderTestResult>(`/providers/${encoded(profile.id)}/revisions/${profile.revision}/test`, { body: {}, csrfToken: token, timeoutMs: Math.min(305000, (profile.timeout + 5) * 1000) })),
  discoverModels: async (profile: RuntimeProfile, token: string) => verifyProfileResult(profile, await runtimeRequest<ModelDiscovery>(`/providers/${encoded(profile.id)}/revisions/${profile.revision}/models`, { body: {}, csrfToken: token, timeoutMs: Math.min(305000, (profile.timeout + 5) * 1000) })),
  threads: (project: string, signal?: AbortSignal) => runtimeRequest<RuntimeThreadSummary[]>(`/projects/${encoded(project)}/threads`, { signal }),
  thread: (project: string, id: string, signal?: AbortSignal) => runtimeRequest<RuntimeThread>(`/projects/${encoded(project)}/threads/${encoded(id)}`, { signal }),
  invocation:(project:string,id:string,callId:string,signal?:AbortSignal)=>runtimeRequest<RuntimeInvocation>(`/projects/${encoded(project)}/threads/${encoded(id)}/invocations/${encoded(callId)}`,{signal}),
  plan: (project: string, input: { prompt: string; profileId: string; profileRevision: number; skillRef: SkillRef }, token: string) => runtimeRequest<RuntimeThread>(`/projects/${encoded(project)}/threads`, { body: input, csrfToken: token }),
  approve: (thread: RuntimeThread, token: string) => runtimeRequest<RuntimeThread>(`/projects/${encoded(thread.projectId)}/threads/${encoded(thread.id)}/approve`, { body: { proposalId: thread.proposal!.proposalId, approvedPlanSha256: thread.proposal!.planSha256 }, csrfToken: token }),
};

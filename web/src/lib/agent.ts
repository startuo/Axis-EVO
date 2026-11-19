import { runtimeRequest } from './runtime';

export type AgentPolicy = { writeMode: 'read' | 'write'; evolutionMode: 'off' | 'observe' | 'auto'; style: 'concise' | 'balanced' | 'detailed' };
export type AgentSource = { id: string; name: string; kind: 'knowledge' | 'skills'; path: string; enabled: boolean };
export type AgentWorkspace = { id: string; name: string; path: string; revision: number; policy: AgentPolicy; sources: AgentSource[] };
export type AgentTool = { name: string; description: string; mutating: boolean; available: boolean };
export type AgentState = { prepared: boolean; workspaces: AgentWorkspace[]; tools: AgentTool[] };
export type AgentSummary = { id: string; title: string; updatedAt: string; status: string };
export type AgentEvent = { id: string; kind: string; createdAt: string; payload: Record<string, unknown> };
export type AgentArtifact = { id: string; path: string; filename: string; sha256: string; sizeBytes: number; verified: boolean; historicalVerified?: boolean; content: string };
export type AgentFeedback = { rating: 'positive' | 'negative'; comment: string; [key: string]: unknown };
export type AgentSkillUse = { skillId: string; version: number; cardSha256: string; name?: string };
export type AgentUsage = { modelRequests: number; totalTokens: number; usageComplete: boolean; modelDurationMs: number };
export type AgentTurn = { usage?: AgentUsage; id: string; workspaceId?: string; conversationId?: string; prompt: string; status: string; code?: string | null; answer: string | null; events: AgentEvent[]; artifacts: AgentArtifact[]; feedback: AgentFeedback[]; skillUses?: AgentSkillUse[] };
export type AgentConversation = { id: string; workspaceId: string; title: string; turns: AgentTurn[] };
export type AgentTurnInput = { workspaceId: string; conversationId?: string; requestId: string; prompt: string; profileId: string; profileRevision: number; browserBindingId?: string; continueFrom?: string };
export type AgentCheck = { kind: 'contains' | 'not_contains' | 'heading'; value: string; path?: string };
export type ExecutionPolicy = { id?: string | null; enabled: boolean; imageId: string | null; timeoutSeconds: number; checks: { name: string; argv: string[] }[]; protectedPaths: string[] };
export type ExecutionSettings = { policy: ExecutionPolicy; environment: { available: boolean; images: { id: string; name: string }[]; reason?: string } };
export type ProjectChanges = { turnId: string; workspaceId: string; atomic: false; directoriesCreated?: string[]; files: { path: string; diff: string; matchesCurrentFile: boolean; beforeSha256: string | null; afterSha256: string | null }[] };
export type AgentFeedbackInput = { rating: 'positive' | 'negative'; comment: string; checks?: AgentCheck[]; submissionId: string; skillId?: string; scope?: 'TASK_ONLY' | 'REUSABLE_PREFERENCE' };
export type AgentEvolutionPolicyInput = { mode: 'OFF' | 'OBSERVE' | 'AUTO'; revisionProfileId: string | null; revisionProfileRevision: number | null; reviewerProfileId: string | null; reviewerProfileRevision: number | null };
export type AgentEvolutionPolicy = AgentEvolutionPolicyInput & { id: string | null; gatePolicyId: string };
export type AgentEvolutionCycle = { id: string; workspaceId: string; feedbackId: string; status: string; workerActive: boolean; policy: AgentEvolutionPolicy; facts: AgentEvent[]; result: Record<string, unknown> | null };
export type AgentEvolution = { policy: AgentEvolutionPolicy; cycles: AgentEvolutionCycle[] };
export type AgentSkill = AgentSkillUse & { name: string; state: string; source: { sourceId: string; path: string; sha256: string }; permissionsGranted: false; rollbackVersions?: number[] };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 65536): value is string => typeof value === 'string' && value.length <= limit;
const id = (value: unknown) => text(value, 160) && value.length > 0;
const list = (value: unknown, limit = 1000): value is unknown[] => Array.isArray(value) && value.length <= limit;
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const source = (value: unknown) => object(value) && id(value.id) && text(value.name, 200) && ['knowledge', 'skills'].includes(String(value.kind)) && text(value.path, 4096) && typeof value.enabled === 'boolean';
const policy = (value: unknown) => object(value) && ['read', 'write'].includes(String(value.writeMode)) && ['off', 'observe', 'auto'].includes(String(value.evolutionMode)) && ['concise', 'balanced', 'detailed'].includes(String(value.style));
const workspace = (value: unknown) => object(value) && id(value.id) && text(value.name, 200) && text(value.path, 4096) && integer(value.revision) && policy(value.policy) && list(value.sources, 64) && value.sources.every(source);
const artifact = (value: unknown) => object(value) && id(value.id) && text(value.path, 4096) && text(value.filename, 512) && hash(value.sha256) && integer(value.sizeBytes) && typeof value.verified === 'boolean' && (value.historicalVerified === undefined || typeof value.historicalVerified === 'boolean') && text(value.content, 262144);
const event = (value: unknown) => object(value) && id(value.id) && text(value.kind, 100) && text(value.createdAt, 100) && object(value.payload);
const skillUse = (value: unknown) => object(value) && id(value.skillId) && integer(value.version) && Number(value.version) > 0 && hash(value.cardSha256) && (value.name === undefined || text(value.name, 512));
const usage = (v: unknown) => object(v) && integer(v.modelRequests) && Number(v.modelRequests) >= 0 && integer(v.totalTokens) && Number(v.totalTokens) >= 0 && typeof v.usageComplete === 'boolean' && typeof v.modelDurationMs === 'number' && Number.isFinite(v.modelDurationMs) && v.modelDurationMs >= 0;
const turn = (value: unknown) => object(value) && (value.usage === undefined || usage(value.usage)) && id(value.id) && text(value.prompt) && text(value.status, 64) && (value.code === undefined || value.code === null || text(value.code, 128)) && (value.answer === null || text(value.answer, 262144)) && list(value.events) && value.events.every(event) && list(value.artifacts, 128) && value.artifacts.every(artifact) && list(value.feedback, 128) && value.feedback.every(f => object(f) && ['positive', 'negative'].includes(String(f.rating)) && text(f.comment)) && (value.skillUses === undefined || list(value.skillUses, 64) && value.skillUses.every(skillUse));
const conversation = (value: unknown) => object(value) && id(value.id) && id(value.workspaceId) && text(value.title, 512) && list(value.turns, 128) && value.turns.every(turn);
const profileRef = (value: Record<string, unknown>, prefix: string) => value[`${prefix}ProfileId`] === null && value[`${prefix}ProfileRevision`] === null || id(value[`${prefix}ProfileId`]) && integer(value[`${prefix}ProfileRevision`]) && Number(value[`${prefix}ProfileRevision`]) > 0;
const evolutionPolicy = (value: unknown) => object(value) && ['OFF', 'OBSERVE', 'AUTO'].includes(String(value.mode)) && profileRef(value, 'revision') && profileRef(value, 'reviewer') && (value.id === null || id(value.id)) && id(value.gatePolicyId);
const evolutionCycle = (value: unknown) => object(value) && id(value.id) && id(value.workspaceId) && id(value.feedbackId) && text(value.status, 64) && typeof value.workerActive === 'boolean' && evolutionPolicy(value.policy) && list(value.facts, 128) && value.facts.every(event) && (value.result === null || object(value.result));

export function validateAgentData(path: string, data: unknown, mutating: boolean): boolean {
  if (/\/workspaces\/[^/]+\/execution$/.test(path) && !mutating) return object(data) && object(data.policy) && typeof data.policy.enabled === 'boolean' && (data.policy.imageId === null || text(data.policy.imageId, 80)) && integer(data.policy.timeoutSeconds) && list(data.policy.checks, 8) && data.policy.checks.every(c => object(c) && text(c.name, 80) && list(c.argv, 64) && c.argv.every(a => text(a, 4096))) && list(data.policy.protectedPaths, 64) && data.policy.protectedPaths.every(p => text(p, 512)) && object(data.environment) && typeof data.environment.available === 'boolean' && list(data.environment.images, 64) && data.environment.images.every(i => object(i) && text(i.id, 80) && text(i.name, 512));
  if (/\/turns\/[^/]+\/changes$/.test(path)) return object(data) && id(data.turnId) && encodeURIComponent(String(data.turnId)) === path.split('/')[3] && id(data.workspaceId) && data.atomic === false && list(data.files, 128) && data.files.every(f => object(f) && text(f.path, 512) && text(f.diff, 262144) && typeof f.matchesCurrentFile === 'boolean' && (f.afterSha256 === null || hash(f.afterSha256)));
  if (path === '/agent/state') return object(data) && typeof data.prepared === 'boolean' && list(data.workspaces, 128) && data.workspaces.every(workspace) && list(data.tools, 256) && data.tools.every(t => object(t) && id(t.name) && text(t.description) && typeof t.mutating === 'boolean' && typeof t.available === 'boolean');
  if (/\/workspaces\/[^/]+\/conversations$/.test(path)) return object(data) && list(data.conversations, 256) && data.conversations.every(c => object(c) && id(c.id) && text(c.title, 512) && text(c.updatedAt, 100) && text(c.status, 64));
  if (/\/workspaces\/[^/]+\/evolution$/.test(path)) return object(data) && evolutionPolicy(data.policy) && list(data.cycles, 100) && data.cycles.every(c => evolutionCycle(c) && object(c) && encodeURIComponent(String(c.workspaceId)) === path.split('/')[3]);
  if (/\/workspaces\/[^/]+\/skills$/.test(path)) return object(data) && list(data.skills, 200) && data.skills.every(s => skillUse(s) && object(s) && text(s.name, 512) && text(s.state, 64) && s.permissionsGranted === false && object(s.source) && id(s.source.sourceId) && text(s.source.path, 4096) && hash(s.source.sha256));
  if (/^\/agent\/turns\/[^/]+$/.test(path)) return turn(data) && object(data) && encodeURIComponent(String(data.id)) === path.split('/')[3] && id(data.workspaceId) && id(data.conversationId);
  if (path === '/agent/turns' || path.startsWith('/agent/conversations/')) return conversation(data) && object(data) && (path === '/agent/turns' || encodeURIComponent(String(data.id)) === path.split('/')[3]);
  // Mutations are followed by a fresh GET; their response cannot grant scope.
  return mutating && object(data);
}

export function agentRunning(status: string) { return ['QUEUED', 'RUNNING', 'PLANNING', 'EXECUTING', 'RESPONDING', 'STOPPING'].includes(status); }
export function agentStatus(status: string) {
  const labels: Record<string, string> = { QUEUED: '等待开始', RUNNING: '正在处理', PLANNING: '正在规划', EXECUTING: '正在执行', RESPONDING: '正在回复', COMPLETED: '已完成', FINISHED: '已结束', FAILED: '未完成', UNKNOWN: '结果待确认', OUTCOME_UNKNOWN: '结果待确认', CANCELLED: '已停止', STOPPED: '已停止', STOPPING: '正在停止', INTERRUPTED: '已中断', AWAITING_APPROVAL: '等待授权', LIMIT_REACHED: '已到达本轮上限', BLOCKED: '需要补充条件' };
  return labels[status] ?? `状态：${status}`;
}

export function agentStopReason(code?: string | null) {
  if (!code) return null;
  const reasons: Record<string, string> = {
    COORDINATOR_RESTARTED: '服务重启前的执行结果尚未确认。已停止该操作，保留文件和执行记录。',
    COORDINATOR_UNCONFIRMED: '这次执行未能确认。请查看已保存的文件和过程记录，系统不会自动重做未知操作。',
    TOOL_OUTCOME_UNKNOWN: '工具没有返回可以确认的执行结果。相关路径保持停止，其他工作可以继续。',
    FIXED_CHECKS_FAILED: '固定检查未通过，本轮未完成。已保存的改动和检查结果可供继续修复。',
    FIXED_CHECK_OUTCOME_UNKNOWN: '固定检查的结果无法确认。已保存改动和检查记录，未自动重试。',
    WORKSPACE_POLICY_CHANGED: '工作区设置已变化，本轮已停止。之后的任务使用新设置。',
    WORKSPACE_ROOT_CHANGED: '工作区文件夹身份已变化，需要在设置中重新选择。',
    SOURCE_NOT_AUTHORIZED: '任务需要的资料来源已撤销或尚未授权，请在知识与 Skills 设置中检查。',
    STOP_REQUESTED: '已按请求停止。此前保存的交付物仍可查看。',
    TURN_DEADLINE: '本轮已达到运行时间上限，已保存的成果保留在这里。',
    ROUND_LIMIT: '本轮已达到工具协作轮数上限，可以依据现有成果补充下一步。',
    CALL_LIMIT_OR_DUPLICATE: '本轮工具调用已达到上限或返回了重复标识，后续操作已停止。',
    AGENT_CONTEXT_LIMIT: '本轮必要上下文已达到预算，已执行的事实和交付物保留。请缩小材料范围后继续。',
    AGENT_CONTEXT_HISTORY_LIMIT: '本会话原始要求和反馈超过上下文预算，请新建对话并明确带入仍需遵守的要求。',
  };
  return reasons[code] ?? (code.startsWith('PROVIDER_') ? '模型请求未完成，本轮已停止。已保存的交付物仍可查看；请检查模型连接后继续。' : null);
}

const encoded = encodeURIComponent;
export const agentApi = {
  execution: (workspaceId: string, signal?: AbortSignal) => runtimeRequest<ExecutionSettings>(`/agent/workspaces/${encoded(workspaceId)}/execution`, { signal }),
  executionPolicy: (workspaceId: string, body: ExecutionPolicy) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/execution`, { body }),
  changes: (turnId: string, signal?: AbortSignal) => runtimeRequest<ProjectChanges>(`/agent/turns/${encoded(turnId)}/changes`, { signal }),
  rollback: (workspaceId: string, body: { skillId: string; version: number; reason: string }) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/evolution/rollback`, { body }),
  state: (signal?: AbortSignal) => runtimeRequest<AgentState>('/agent/state', { signal }),
  addWorkspace: (body: { name: string; path: string; writeMode: AgentPolicy['writeMode']; shareWithProvider: true }) => runtimeRequest<unknown>('/agent/workspaces', { body }),
  settings: (workspaceId: string, body: AgentPolicy) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/settings`, { body }),
  addSource: (workspaceId: string, body: { name: string; path: string; kind: AgentSource['kind']; shareWithProvider: true }) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/sources`, { body }),
  revokeSource: (workspaceId: string, sourceId: string) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/sources/${encoded(sourceId)}/revoke`, { body: {} }),
  conversations: (workspaceId: string, signal?: AbortSignal) => runtimeRequest<{ conversations: AgentSummary[] }>(`/agent/workspaces/${encoded(workspaceId)}/conversations`, { signal }),
  conversation: (id: string, signal?: AbortSignal) => runtimeRequest<AgentConversation>(`/agent/conversations/${encoded(id)}`, { signal }),
  turn: (id: string, signal?: AbortSignal) => runtimeRequest<AgentTurn>(`/agent/turns/${encoded(id)}`, { signal }),
  send: (body: AgentTurnInput) => runtimeRequest<AgentConversation>('/agent/turns', { body }),
  feedback: (turnId: string, body: AgentFeedbackInput) => runtimeRequest<unknown>(`/agent/turns/${encoded(turnId)}/feedback`, { body }),
  cancel: (turnId: string) => runtimeRequest<unknown>(`/agent/turns/${encoded(turnId)}/cancel`, { body: {} }),
  evolution: (workspaceId: string, signal?: AbortSignal) => runtimeRequest<AgentEvolution>(`/agent/workspaces/${encoded(workspaceId)}/evolution`, { signal }),
  evolutionPolicy: (workspaceId: string, body: AgentEvolutionPolicyInput) => runtimeRequest<unknown>(`/agent/workspaces/${encoded(workspaceId)}/evolution/policy`, { body }),
  skills: (workspaceId: string, signal?: AbortSignal) => runtimeRequest<{ skills: AgentSkill[] }>(`/agent/workspaces/${encoded(workspaceId)}/skills`, { signal }),
};

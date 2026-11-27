/**
 * @axis/protocol — the single contract between runtime, server and web.
 * Every cross-package message is validated here. Subagents MUST NOT invent
 * parallel shapes; extend this package through the lead architect.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Identifiers & enums
// ---------------------------------------------------------------------------
export const id = z.string().min(1).max(128);
export type Id = z.infer<typeof id>;

export const permissionMode = z.enum(['read-only', 'workspace-write', 'full-access']);
export type PermissionMode = z.infer<typeof permissionMode>;

export const toolKind = z.enum([
  'shell', 'file', 'patch', 'git', 'search', 'web', 'browser', 'skill', 'task', 'subagent', 'mcp',
]);
export type ToolKind = z.infer<typeof toolKind>;

export const toolStatus = z.enum(['pending', 'running', 'success', 'failed', 'unknown', 'rejected']);
export type ToolStatus = z.infer<typeof toolStatus>;

export const turnStatus = z.enum(['running', 'completed', 'failed', 'cancelled', 'unknown', 'limit-reached', 'blocked']);
export type TurnStatus = z.infer<typeof turnStatus>;

export const sessionStatus = z.enum(['idle', 'running', 'error']);
export type SessionStatus = z.infer<typeof sessionStatus>;

export const taskStatus = z.enum(['pending', 'running', 'done', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof taskStatus>;

export const skillStatus = z.enum(['active', 'candidate', 'observing', 'archived']);
export type SkillStatus = z.infer<typeof skillStatus>;

export const agentStatus = z.enum(['starting', 'running', 'done', 'failed', 'cancelled']);
export type AgentStatus = z.infer<typeof agentStatus>;

export const reasoningEffort = z.enum(['off', 'low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof reasoningEffort>;
export const providerProtocol = z.enum(['openai-compatible', 'deepseek-compatible', 'anthropic-compatible', 'local-gateway']);
export type ProviderProtocol = z.infer<typeof providerProtocol>;

export const journalEvent = z.object({
  id, kind: z.string(), workspaceId: id, parentId: id, createdAt: z.string(),
  seq: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export type JournalEvent = z.infer<typeof journalEvent>;

export const turnDecision = z.object({
  status: z.enum(['UNKNOWN', 'TRIPPED']),
  code: z.string(),
  tool: z.string().optional(),
  hint: z.string().optional(),
  consecutiveFailures: z.number().optional(),
  lastCallId: z.string().optional(),
});
export type TurnDecision = z.infer<typeof turnDecision>;

// ---------------------------------------------------------------------------
// Core records
// ---------------------------------------------------------------------------
export const profile = z.object({
  id,
  name: z.string().min(1).max(80),
  endpoint: z.string().url(),
  modelId: z.string().min(1).max(128),
  credentialEnv: z.string().min(1).max(120),
  credentialConfigured: z.boolean(),
  reasoningEffort: reasoningEffort.optional(),
  timeoutSeconds: z.number().int().min(1).max(600).default(120),
  credentialRef: id.optional(),
  protocol: providerProtocol.optional(),
  revision: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  proxy: z.string().nullable().optional(),
  testStatus: z.string().optional(),
  diagnosticCode: z.string().nullable().optional(),
});
export type Profile = z.infer<typeof profile>;

export const workspace = z.object({
  id,
  path: z.string().min(1),
  name: z.string().min(1).max(80),
  mode: permissionMode,
  authorizedAt: z.string(),
  evolutionPolicy: z.enum(['off', 'observe', 'auto']).optional(),
});
export type Workspace = z.infer<typeof workspace>;

export const session = z.object({
  id,
  title: z.string().max(200),
  workspaceId: id,
  workspacePath: z.string(),
  mode: permissionMode,
  profileId: z.string().max(128),
  status: sessionStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  parentAgentId: id.optional(),
  tokenUsage: z.object({ input: z.number(), output: z.number() }).optional(),
  contextTokens: z.number().nonnegative().nullable().optional(),
  contextLimit: z.number().positive().nullable().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  cacheHitTokens: z.number().nonnegative().nullable().optional(),
  cacheWriteTokens: z.number().nonnegative().nullable().optional(),
  cacheMissTokens: z.number().nonnegative().nullable().optional(),
});
export type Session = z.infer<typeof session>;

export const planStep = z.object({
  id,
  title: z.string().max(300),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
});
export type PlanStep = z.infer<typeof planStep>;

/** One durable, append-only fact in a session transcript. */
export const agentCommand = z.enum(['plan', 'goal', 'review', 'compact']);
export const imageMediaType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const turnImage = z.object({
  turnId: z.string().regex(/^turn_[A-Za-z0-9_-]{8,80}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(120), mediaType: imageMediaType, sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
});
export type AgentCommand = z.infer<typeof agentCommand>;
export type TurnImage = z.infer<typeof turnImage>;

export const item = z.object({
  id,
  sessionId: id,
  seq: z.number().int().nonnegative(),
  kind: z.enum(['message', 'reasoning', 'tool_call', 'tool_result', 'diff', 'plan', 'error']),
  createdAt: z.string(),
  // message
  role: z.enum(['user', 'assistant']).optional(),
  text: z.string().optional(),
  // reasoning / streaming
  streaming: z.boolean().optional(),
  // tool_call
  callId: id.optional(),
  tool: z.string().max(120).optional(),
  toolKind: toolKind.optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  status: toolStatus.optional(),
  output: z.string().optional(),
  outputTruncated: z.boolean().optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().optional(),
  // tool_result
  data: z.unknown().optional(),
  error: z.string().optional(),
  // diff
  path: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  // plan
  steps: z.array(planStep).optional(),
  metadata: z.object({
    decision: turnDecision.optional(),
    eventId: id.optional(),
    artifactId: id.optional(),
    turnId: id.optional(),
    command: agentCommand.optional(),
    images: z.array(turnImage).max(4).optional(),
  }).optional(),
});
export type Item = z.infer<typeof item>;

export const approval = z.object({
  id,
  sessionId: id,
  kind: z.enum(['command', 'file-write', 'mcp', 'browser', 'network']),
  risk: z.enum(['low', 'medium', 'high']),
  summary: z.string().max(300),
  detail: z.string().max(8000),
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});
export type Approval = z.infer<typeof approval>;

export const task = z.object({
  id,
  sessionId: id.optional(),
  workspacePath: z.string(),
  title: z.string().max(300),
  status: taskStatus,
  steps: z.array(planStep),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().max(4000).optional(),
});
export type Task = z.infer<typeof task>;

export const skillCheck = z.object({
  kind: z.enum(['contains', 'not_contains', 'heading', 'command-exit-zero']),
  value: z.string().max(512),
});
export type SkillCheck = z.infer<typeof skillCheck>;

export const skill = z.object({
  id,
  name: z.string().max(120),
  description: z.string().max(1000),
  version: z.number().int().positive(),
  status: skillStatus,
  source: z.enum(['workspace', 'global', 'imported', 'evolved']),
  instructions: z.string(),
  path: z.string().optional(),
  cardSha256: z.string().optional(),
  parentVersion: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceId: id.optional(),
  rollbackVersions: z.array(z.number().int().positive()).optional(),
});
export type Skill = z.infer<typeof skill>;

export const skillEvolution = z.object({
  id,
  skillId: id,
  sessionId: id,
  status: z.enum(['proposed', 'evaluating', 'observing', 'adopted', 'rejected', 'stopped']),
  rating: z.enum(['positive', 'negative']),
  comment: z.string().max(4096),
  checks: z.array(skillCheck),
  candidateVersion: z.number().int().positive().optional(),
  referenceItemId: id.optional(),
  candidateItemId: id.optional(),
  reasons: z.array(z.string()),
  review: z.object({ verdict: z.enum(['accept', 'reject', 'uncertain']), reasons: z.array(z.string()), role: z.literal('advisory') }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillEvolution = z.infer<typeof skillEvolution>;

export const agentInfo = z.object({
  id,
  parentId: id.optional(),
  name: z.string().max(120),
  role: z.string().max(300),
  sessionId: id,
  worktree: z.string().optional(),
  status: agentStatus,
  createdAt: z.string(),
  summary: z.string().max(4000).optional(),
});
export type AgentInfo = z.infer<typeof agentInfo>;

export const mcpServer = z.object({
  id,
  name: z.string().max(120),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
  status: z.enum(['connected', 'disconnected', 'error']),
  toolCount: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type McpServer = z.infer<typeof mcpServer>;

const uiStyle = z.enum(['default', 'obsidian-prism']);
const themeMode = z.enum(['dark', 'light', 'system']);
const prismDarkPalette = z.enum(['obsidian', 'warm']);
const prismLightPalette = z.enum(['crystal', 'alabaster']);
const prismAccent = z.enum(['default', 'cobalt', 'iris', 'amber', 'mono']);
const motionTier = z.enum(['standard', 'focus']);
export type UiStyle = z.infer<typeof uiStyle>;
export type ThemeMode = z.infer<typeof themeMode>;
export type PrismPalette = z.infer<typeof prismDarkPalette> | z.infer<typeof prismLightPalette>;
export type PrismAccent = z.infer<typeof prismAccent>;
export type MotionTier = z.infer<typeof motionTier>;

export const appearanceSettings = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  uiStyle: uiStyle.optional(),
  themeMode: themeMode.optional(),
  prismDarkPalette: prismDarkPalette.optional(),
  prismLightPalette: prismLightPalette.optional(),
  prismAccent: prismAccent.optional(),
  prismMascots: z.boolean().optional(),
  prismVial: z.boolean().optional(),
  prismCrystal: z.boolean().optional(),
  prismRim: z.boolean().optional(),
  motionTier: motionTier.optional(),
});

export const settings = appearanceSettings.extend({
  theme: z.enum(['dark', 'light']).default('dark'),
  defaultMode: permissionMode.default('workspace-write'),
  defaultProfileId: id.optional(),
  evolutionPolicy: z.enum(['off', 'observe', 'auto']).default('observe'),
  commandRules: z.array(z.object({
    pattern: z.string().max(300),
    action: z.enum(['allow', 'prompt', 'deny']),
  })).default([]),
  maxTurnSeconds: z.number().int().min(30).max(3600).default(900),
  maxToolCalls: z.number().int().min(1).max(500).default(120),
});
export type Settings = z.infer<typeof settings>;

// ---------------------------------------------------------------------------
// WebSocket envelope: requests, responses, events
// ---------------------------------------------------------------------------
export const wsRequest = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('request'),
  id,
  method: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type WsRequest = z.infer<typeof wsRequest>;

export const wsResponse = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('response'),
  id,
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type WsResponse = z.infer<typeof wsResponse>;

export const serverEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version: z.number(), settings }),
  z.object({ type: z.literal('settings.updated'), settings }),
  z.object({ type: z.literal('session.updated'), session }),
  z.object({ type: z.literal('session.removed'), sessionId: id }),
  z.object({ type: z.literal('item.added'), sessionId: id, item }),
  z.object({ type: z.literal('item.updated'), sessionId: id, itemId: id, patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('turn.started'), sessionId: id, turnId: id }),
  z.object({ type: z.literal('turn.completed'), sessionId: id, turnId: id, status: turnStatus,
    error: z.string().optional(), code: z.string().optional(), circuitBreaker: turnDecision.optional(),
    deliveryValidation: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('approval.requested'), approval }),
  z.object({ type: z.literal('approval.resolved'), approvalId: id, status: approval.shape.status }),
  z.object({ type: z.literal('task.updated'), task }),
  z.object({ type: z.literal('agent.updated'), agent: agentInfo }),
  z.object({ type: z.literal('skill.updated'), skill }),
  z.object({ type: z.literal('evolution.updated'), evolution: skillEvolution }),
  z.object({ type: z.literal('mcp.updated'), server: mcpServer }),
  z.object({ type: z.literal('workspace.updated'), workspace }),
  z.object({ type: z.literal('profile.updated'), profile }),
  z.object({ type: z.literal('profile.removed'), profileId: id }),
  z.object({ type: z.literal('terminal.output'), terminalId: id, data: z.string() }),
  z.object({ type: z.literal('log'), level: z.enum(['info', 'warn', 'error']), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof serverEvent>;

export const wsEvent = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('event'),
  event: serverEvent,
});
export type WsEvent = z.infer<typeof wsEvent>;

export const wsMessage = z.union([wsRequest, wsResponse, wsEvent]);
export type WsMessage = z.infer<typeof wsMessage>;

// ---------------------------------------------------------------------------
// Request params (method -> params). Server validates with these.
// ---------------------------------------------------------------------------
export const requestParams = {
  'session.create': z.object({ workspaceId: id, profileId: id, mode: permissionMode.optional(), title: z.string().max(200).optional(), parentAgentId: id.optional() }),
  'session.list': z.object({ workspaceId: id.optional(), limit: z.number().int().min(1).max(200).default(50) }),
  'session.get': z.object({ sessionId: id, itemLimit: z.number().int().min(1).max(2000).default(500) }),
  'session.delete': z.object({ sessionId: id }),
  'turn.start': z.object({ sessionId: id, text: z.string().min(1).max(32000), attachments: z.array(z.union([
    z.object({ kind: z.enum(['browser-binding', 'file']), value: z.string() }),
    z.object({ kind: z.literal('image'), name: z.string().min(1).max(120), mediaType: imageMediaType,
      data: z.string().min(1).max(2_796_204) }),
  ])).optional() }),
  'turn.cancel': z.object({ sessionId: id }),
  'approval.respond': z.object({ approvalId: id, decision: z.enum(['approve', 'deny']), scope: z.enum(['once', 'session']).default('once') }),
  'workspace.authorize': z.object({ path: z.string().min(1), name: z.string().max(80).optional(), mode: permissionMode }),
  'workspace.list': z.object({}),
  'workspace.setMode': z.object({ workspaceId: id, mode: permissionMode }),
  'workspace.remove': z.object({ workspaceId: id }),
  'profile.list': z.object({}),
  'profile.save': z.object({ id: id.optional(), name: z.string().min(1).max(80), endpoint: z.string().url(), modelId: z.string().min(1).max(120), credentialEnv: z.string().min(1).max(120).optional(), apiKey: z.string().min(1).max(512).optional(), reasoningEffort: reasoningEffort.optional(), timeoutSeconds: z.number().int().min(5).max(600).optional() }),
  'provider.listModels': z.object({ endpoint: z.string().url(), apiKey: z.string().min(1).max(512).optional(), credentialEnv: z.string().min(1).max(120).optional() }),
  'profile.delete': z.object({ profileId: id }),
  'profile.test': z.object({ profileId: id }),
  'task.list': z.object({ workspacePath: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }),
  'task.get': z.object({ taskId: id }),
  'skill.list': z.object({ workspacePath: z.string().optional() }),
  'skill.feedback': z.object({ skillId: id, sessionId: id, rating: z.enum(['positive', 'negative']), comment: z.string().max(4096).default(''), checks: z.array(skillCheck).max(16).default([]) }),
  'skill.setPolicy': z.object({ policy: z.enum(['off', 'observe', 'auto']) }),
  'skill.import': z.object({ path: z.string().min(1) }),
  'agent.list': z.object({}),
  'agent.message': z.object({ agentId: id, text: z.string().max(8000) }),
  'mcp.list': z.object({}),
  'mcp.add': z.object({ name: z.string().min(1).max(120), transport: z.enum(['stdio', 'http']), command: z.string().optional(), args: z.array(z.string()).optional(), url: z.string().optional(), env: z.record(z.string(), z.string()).optional() }),
  'mcp.remove': z.object({ serverId: id }),
  'mcp.toggle': z.object({ serverId: id, enabled: z.boolean() }),
  'settings.get': z.object({}),
  'settings.set': z.object({ patch: z.record(z.string(), z.unknown()) }),
  'fs.list': z.object({ workspaceId: id, path: z.string().default('') }),
  'fs.read': z.object({ workspaceId: id, path: z.string().min(1), maxBytes: z.number().int().min(1).max(2_000_000).default(262144) }),
  'fs.preview': z.object({ workspaceId: id, path: z.string().min(1), sheet: z.string().optional(),
    startRow: z.number().int().positive().optional(), startPage: z.number().int().positive().optional(),
    endPage: z.number().int().positive().optional() }),
  'git.status': z.object({ workspaceId: id }),
  'git.diff': z.object({ workspaceId: id, path: z.string().optional(), staged: z.boolean().default(false) }),
  'git.log': z.object({ workspaceId: id, limit: z.number().int().min(1).max(100).default(20) }),
  // Review pane (S3): branch info, base-branch comparison and explicit user
  // mutations. `paths` stages/unstage/reverts whole files; `patch` (a unified
  // diff) applies a single hunk. At least one of paths/patch is required
  // (enforced by the handler). Additive — existing methods are untouched.
  'git.branch': z.object({ workspaceId: id }),
  'git.compare': z.object({ workspaceId: id, base: z.string().min(1).max(200).optional() }),
  'git.stage': z.object({ workspaceId: id, paths: z.array(z.string().min(1).max(500)).max(500).default([]), patch: z.string().min(1).max(2_000_000).optional() }),
  'git.unstage': z.object({ workspaceId: id, paths: z.array(z.string().min(1).max(500)).max(500).default([]), patch: z.string().min(1).max(2_000_000).optional() }),
  'git.revert': z.object({ workspaceId: id, paths: z.array(z.string().min(1).max(500)).max(500).default([]), patch: z.string().min(1).max(2_000_000).optional() }),
  'git.commit': z.object({ workspaceId: id, message: z.string().min(1).max(8000), paths: z.array(z.string().min(1).max(500)).max(500).optional() }),
  'terminal.open': z.object({ workspaceId: id }),
  'terminal.input': z.object({ terminalId: id, data: z.string().max(8000) }),
  'terminal.close': z.object({ terminalId: id }),
  'browser.status': z.object({}),
  'browser.tabs': z.object({}),
  'browser.bind': z.object({ instanceId: z.string(), tabId: z.number() }),
} as const;
export type RequestMethod = keyof typeof requestParams;

// ---------------------------------------------------------------------------
// Git review results (S3 review pane). Additive result contracts for the
// git.branch / git.compare / git.stage / git.unstage / git.revert / git.commit
// handlers in runtime/server/handlers-git.ts.
// ---------------------------------------------------------------------------
export const gitBranchResult = z.object({
  /** Current branch name; null when HEAD is detached. */
  current: z.string().nullable(),
  detached: z.boolean(),
  /** Local branch names (short form). */
  branches: z.array(z.string()),
});
export type GitBranchResult = z.infer<typeof gitBranchResult>;

export const gitCompareResult = z.object({
  /** Resolved base branch used for the comparison. */
  base: z.string(),
  /** merge-base(base, HEAD) commit hash the diff is taken against. */
  mergeBase: z.string(),
  /** Unified diff of the working tree against mergeBase (bounded). */
  diff: z.string(),
  truncated: z.boolean(),
});
export type GitCompareResult = z.infer<typeof gitCompareResult>;

export const gitMutationResult = z.object({
  ok: z.boolean(),
  /** Workspace-relative paths the mutation targeted (empty for patch-only). */
  paths: z.array(z.string()),
  /** Trimmed git stdout (may be empty). */
  output: z.string(),
});
export type GitMutationResult = z.infer<typeof gitMutationResult>;

export const gitCommitResult = z.object({
  committed: z.boolean(),
  hash: z.string(),
  output: z.string(),
});
export type GitCommitResult = z.infer<typeof gitCommitResult>;

// ---------------------------------------------------------------------------
// REST bootstrap
// ---------------------------------------------------------------------------
export const bootstrapState = z.object({
  version: z.string(),
  protocolVersion: z.number(),
  settings,
  workspaces: z.array(workspace),
  profiles: z.array(profile),
  sessions: z.array(session),
  platform: z.string(),
  dataDir: z.string(),
  capabilities: z.object({ pythonRuntime: z.boolean() }).optional(),
  providerCatalog: z.object({
    endpoints: z.array(z.string()),
    credentialRefs: z.array(z.object({ id, configured: z.boolean() })),
    providerRoutes: z.array(z.object({ endpoint: z.string(), proxy: z.string(), expiresAt: z.number() })),
    localGateways: z.array(z.object({ endpoint: z.string(), modelIds: z.array(z.string()) })),
    credentialEnrollment: z.object({
      available: z.boolean(),
      presets: z.array(z.object({ id, name: z.string(), endpoint: z.string(),
        protocol: providerProtocol, credentialRef: id, models: z.array(z.string()) })),
    }).optional(),
  }).optional(),
});
export type BootstrapState = z.infer<typeof bootstrapState>;

export const conversationSummary = z.object({
  id, workspaceId: id, title: z.string(),
  turnId: id.nullable(), status: z.enum([
    'EMPTY', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'LIMIT_REACHED', 'BLOCKED',
  ]),
  code: z.string().nullable().optional(),
  contextTokens: z.number().nonnegative().nullable().optional(),
  contextLimit: z.number().positive().nullable().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  cacheHitTokens: z.number().nonnegative().nullable().optional(),
  cacheWriteTokens: z.number().nonnegative().nullable().optional(),
  cacheMissTokens: z.number().nonnegative().nullable().optional(),
  events: z.array(journalEvent),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

// ---------------------------------------------------------------------------
// Tool contract (runtime-internal, shared for tests)
// ---------------------------------------------------------------------------
export const toolDefinition = z.object({
  name: z.string().min(1).max(120),
  kind: toolKind,
  description: z.string().max(2000),
  parameters: z.record(z.string(), z.unknown()),
  readOnly: z.boolean(),
});
export type ToolDefinition = z.infer<typeof toolDefinition>;

export const toolEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('output'), data: z.string() }),
  z.object({ type: z.literal('status'), status: toolStatus }),
  z.object({ type: z.literal('result'), status: toolStatus, data: z.unknown().optional(), error: z.string().optional(), exitCode: z.number().int().optional() }),
]);
export type ToolEvent = z.infer<typeof toolEvent>;

export const toolContext = z.object({
  sessionId: id,
  workspacePath: z.string(),
  mode: permissionMode,
  callId: id,
  signal: z.unknown(),
  requestApproval: z.unknown(),
  emit: z.unknown(),
});
export type ToolContext = z.infer<typeof toolContext>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function parseRequest(raw: unknown): WsRequest {
  return wsRequest.parse(raw);
}
export function encodeEvent(event: ServerEvent): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: 'event', event });
}
export function encodeResponse(id: string, result?: unknown, error?: { code: string; message: string }): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: 'response', id, result, error });
}
export function encodeRequest(id: string, method: RequestMethod | string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', id, method, params });
}
export const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID: 'INVALID',
  DENIED: 'DENIED',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
  INTERNAL: 'INTERNAL',
  UNKNOWN_OUTCOME: 'UNKNOWN_OUTCOME',
} as const;

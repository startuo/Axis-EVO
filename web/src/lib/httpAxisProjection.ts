import { agentCommand, turnImage } from '@axis/protocol';
import type {
  ConversationSummary, Item, JournalEvent, Profile, ServerEvent, Session, Skill, Task,
  ToolKind, ToolStatus, TurnDecision, TurnStatus, Workspace,
} from '@axis/protocol';

export type RecordValue = Record<string, unknown>;
export const object = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
export const text = (value: unknown): string => typeof value === 'string' ? value : '';
export const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function workspaceFrom(value: unknown): Workspace {
  const row = object(value);
  const policy = object(row.policy);
  const evolution = text(policy.evolutionMode);
  return { id: text(row.id), name: text(row.name), path: text(row.path),
    mode: policy.writeMode === 'read' ? 'read-only' : 'workspace-write', authorizedAt: text(row.createdAt),
    evolutionPolicy: evolution === 'off' || evolution === 'observe' || evolution === 'auto' ? evolution : undefined };
}

export function profileFrom(value: unknown): Profile {
  const row = object(value);
  const credential = text(row.credentialRef);
  const effort = text(row.reasoningEffort);
  return { id: text(row.id), name: text(row.name), endpoint: text(row.endpoint), modelId: text(row.modelId),
    credentialEnv: credential, credentialRef: credential, credentialConfigured: row.credentialConfigured === true,
    timeoutSeconds: number(row.timeout) ?? 120, revision: number(row.revision),
    protocol: row.protocol as Profile['protocol'], contextWindow: number(row.contextWindow),
    maxOutputTokens: number(row.maxOutputTokens), proxy: row.proxy === null ? null
      : text(row.proxy) || text(object(row.networkRoute).proxy) || undefined,
    reasoningEffort: ['off', 'low', 'medium', 'high'].includes(effort) ? effort as Profile['reasoningEffort'] : undefined,
    testStatus: text(row.testStatus) || undefined, diagnosticCode: text(row.diagnosticCode) || null };
}

export function sessionState(status: string): Session['status'] {
  if (status === 'RUNNING' || status === 'QUEUED') return 'running';
  if (status === 'COMPLETED' || status === 'EMPTY' || status === 'CANCELLED') return 'idle';
  return 'error';
}

const terminalState: Record<string, TurnStatus> = {
  COMPLETED: 'completed', FAILED: 'failed', UNKNOWN: 'unknown', CANCELLED: 'cancelled',
  LIMIT_REACHED: 'limit-reached', BLOCKED: 'blocked',
};

function toolKind(name: string): ToolKind {
  if (name.startsWith('git_')) return 'git';
  if (name.startsWith('browser_')) return 'browser';
  if (name.includes('skill')) return 'skill';
  if (name.startsWith('run_')) return 'shell';
  if (name.startsWith('patch_')) return 'patch';
  if (name === 'search') return 'search';
  if (name === 'update_plan') return 'task';
  return 'file';
}

function toolStatus(status: string): ToolStatus {
  if (status === 'SUCCESS') return 'success';
  if (status === 'UNKNOWN') return 'unknown';
  if (status === 'REJECTED') return 'rejected';
  return 'failed';
}

type TurnRecord = { profileId: string; task: Task; lastAssistant: string;
  decision?: TurnDecision; delivery?: RecordValue };

export class ConversationProjection {
  cursor = 0;
  hasMore = false;
  turnId: string | null = null;
  readonly events: JournalEvent[] = [];
  readonly items = new Map<string, Item>();
  readonly turns = new Map<string, TurnRecord>();
  private readonly toolCalls = new Map<string, string>();
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(public session: Session) {}

  apply(page: ConversationSummary): ServerEvent[] {
    const updates: ServerEvent[] = [];
    for (const event of page.events) {
      if (event.seq <= this.cursor) continue;
      this.events.push(event);
      updates.push(...this.applyEvent(event));
      this.cursor = event.seq;
    }
    this.hasMore = page.hasMore;
    this.turnId = page.turnId;
    const last = this.events.at(-1);
    const first = this.events[0];
    const turn = this.turnId ? this.turns.get(this.turnId) : undefined;
    const next = {
      ...this.session, title: page.title, status: sessionState(page.status),
      profileId: turn?.profileId || this.session.profileId,
      createdAt: first?.createdAt ?? this.session.createdAt,
      updatedAt: last?.createdAt ?? this.session.updatedAt,
      contextTokens: page.contextTokens ?? null, contextLimit: page.contextLimit ?? null,
      cacheHitRate: page.cacheHitRate ?? null, cacheHitTokens: page.cacheHitTokens ?? null,
      cacheWriteTokens: page.cacheWriteTokens ?? null, cacheMissTokens: page.cacheMissTokens ?? null,
      tokenUsage: { input: this.inputTokens, output: this.outputTokens },
    };
    const current = this.session;
    if (updates.length || current.status !== next.status
        || current.contextTokens !== next.contextTokens || current.contextLimit !== next.contextLimit
        || current.cacheHitRate !== next.cacheHitRate || current.cacheHitTokens !== next.cacheHitTokens
        || current.cacheWriteTokens !== next.cacheWriteTokens || current.cacheMissTokens !== next.cacheMissTokens) {
      updates.push({ type: 'session.updated', session: next });
    }
    this.session = next;
    return updates;
  }

  private applyEvent(event: JournalEvent): ServerEvent[] {
    const { id, seq, createdAt, payload, parentId, kind } = event;
    const sessionId = this.session.id;
    const turnId = kind === 'turn' ? id : parentId;
    const start = { id, seq, sessionId, createdAt, metadata: { eventId: id, turnId } };
    const turn = this.turns.get(turnId);
    const output: ServerEvent[] = [];
    const append = (item: Item) => {
      this.items.set(item.id, item);
      output.push({ type: 'item.added', sessionId, item });
    };
    if (kind === 'turn') {
      const prompt = text(payload.prompt);
      const task: Task = { id: turnId, sessionId, workspacePath: this.session.workspacePath,
        title: prompt.slice(0, 300), status: 'pending', steps: [], createdAt, updatedAt: createdAt };
      this.turns.set(turnId, { profileId: text(object(payload.profile).id), task, lastAssistant: '' });
      const command = agentCommand.safeParse(payload.command);
      const images = array(payload.images).slice(0, 4).map(entry => turnImage.safeParse(entry))
        .flatMap(result => result.success && result.data.turnId === turnId ? [result.data] : []);
      append({ ...start, kind: 'message', role: 'user', text: prompt, metadata: { ...start.metadata,
        ...(command.success ? { command: command.data } : {}), ...(images.length ? { images } : {}) } });
      output.push({ type: 'task.updated', task });
    } else if (kind === 'started') {
      if (turn) {
        turn.task = { ...turn.task, status: 'running', updatedAt: createdAt };
        output.push({ type: 'task.updated', task: turn.task });
      }
      output.push({ type: 'turn.started', sessionId, turnId });
    } else if (kind === 'assistant') {
      const answer = text(object(payload.message).content);
      if (answer) {
        if (turn) turn.lastAssistant = answer;
        append({ ...start, kind: 'message', role: 'assistant', text: answer });
      }
    } else if (kind === 'tool_intent') {
      const name = text(payload.tool);
      const callId = text(payload.callId);
      this.toolCalls.set(`${turnId}:${callId}`, id);
      const path = text(payload.path);
      append({ ...start, kind: 'tool_call', callId, tool: name, toolKind: toolKind(name), status: 'running',
        ...(path ? { path, args: { path } } : {}) });
    } else if (kind === 'tool_result') {
      const callId = text(payload.callId);
      const data = object(payload.data);
      const exitCode = number(data.exitCode);
      const error = text(payload.hint) || text(payload.code);
      const status = exitCode !== undefined && exitCode !== 0 ? 'failed' : toolStatus(text(payload.status));
      const patch = { status, data, error: error || undefined, exitCode, durationMs: number(payload.hostDurationMs),
        metadata: { eventId: id, turnId, artifactId: text(data.artifactId) || undefined } };
      const itemId = this.toolCalls.get(`${turnId}:${callId}`);
      const item = itemId ? this.items.get(itemId) : undefined;
      if (item) {
        this.items.set(item.id, { ...item, ...patch });
        output.push({ type: 'item.updated', sessionId, itemId: item.id, patch });
      } else {
        append({ ...start, kind: 'tool_result', ...patch, callId });
      }
    } else if (kind === 'artifact' && payload.document && payload.verification === 'EXACT_BYTES') {
      append({ ...start, kind: 'tool_result', data: { ...payload, artifactId: id },
        metadata: { ...start.metadata, artifactId: id } });
    } else if (kind === 'model_usage') {
      const usage = object(payload.usage);
      this.inputTokens += number(usage.promptTokens ?? usage.prompt_tokens) ?? 0;
      this.outputTokens += number(usage.completionTokens ?? usage.completion_tokens) ?? 0;
    } else if (kind === 'task_plan') {
      const steps = array(payload.steps).map((value, index) => {
        const step = object(value);
        const status: Task['steps'][number]['status'] = step.status === 'completed' ? 'done'
          : step.status === 'in_progress' ? 'running' : 'pending';
        return { id: `${id}-${index}`, title: text(step.title), status };
      });
      append({ ...start, kind: 'plan', steps });
      if (turn) {
        turn.task = { ...turn.task, steps, updatedAt: createdAt };
        output.push({ type: 'task.updated', task: turn.task });
      }
    } else if (kind === 'circuit_breaker' && turn) {
      turn.decision = { status: 'TRIPPED', code: text(payload.code), tool: text(payload.tool),
        hint: text(payload.hint), consecutiveFailures: number(payload.consecutiveFailures), lastCallId: text(payload.lastCallId) };
    } else if (kind === 'host_delivery_check' && turn) {
      turn.delivery = payload;
    } else if (kind === 'terminal') {
      const disposition = text(payload.status);
      const status = terminalState[disposition];
      const code = text(payload.code) || undefined;
      const answer = text(payload.answer);
      const decision: TurnDecision | undefined = status === 'unknown'
        ? { status: 'UNKNOWN', code: code || 'TOOL_OUTCOME_UNKNOWN' }
        : code === 'TOOL_FAILURE_CIRCUIT_BREAKER' ? turn?.decision : undefined;
      if (decision) {
        append({ ...start, kind: 'message', role: 'assistant', text: '',
          metadata: { ...start.metadata, decision } });
      } else if (answer && answer !== turn?.lastAssistant) {
        append({ ...start, kind: 'message', role: 'assistant', text: answer });
      } else if (!answer && code && status !== 'cancelled') {
        append({ ...start, kind: 'error', error: code });
      }
      if (turn) {
        const taskStatus = status === 'completed' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed';
        turn.task = { ...turn.task, status: taskStatus, summary: answer.slice(0, 4000), updatedAt: createdAt };
        output.push({ type: 'task.updated', task: turn.task });
      }
      if (status) output.push({ type: 'turn.completed', sessionId, turnId, status, code,
        circuitBreaker: decision?.status === 'TRIPPED' ? decision : undefined, deliveryValidation: turn?.delivery });
    }
    return output;
  }
}

export function skillFrom(value: unknown, workspaceId: string): Skill {
  const row = object(value);
  const source = object(row.source);
  return { id: text(row.skillId), name: text(row.name), description: text(row.description), workspaceId,
    version: number(row.version) ?? 1, status: 'active', source: source.sourceId === 'workspace' ? 'workspace' : 'imported',
    instructions: text(row.instructions), path: text(source.path) || undefined, cardSha256: text(row.cardSha256) || undefined,
    createdAt: text(row.createdAt), updatedAt: text(row.updatedAt),
    rollbackVersions: array(row.rollbackVersions).map(number).filter((v): v is number => v !== undefined) };
}

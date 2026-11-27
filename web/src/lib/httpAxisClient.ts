import {
  PROTOCOL_VERSION, appearanceSettings, bootstrapState, conversationSummary, settings,
  type BootstrapState, type Profile, type RequestMethod, type ServerEvent,
  type Session, type Settings, type Workspace,
} from '@axis/protocol';
import {
  ConversationProjection, array, number, object, profileFrom, sessionState, skillFrom, text, workspaceFrom,
  type RecordValue,
} from './httpAxisProjection';
import { readTheme, saveTheme } from './themePreference';

export type AxisStatus = 'connecting' | 'open' | 'closed';

export interface AxisClient {
  status: AxisStatus;
  onStatus: ((status: AxisStatus) => void) | null;
  connect(): void;
  close(): void;
  bootstrap(): Promise<BootstrapState>;
  request<T = unknown>(method: RequestMethod | string, params?: RecordValue): Promise<T>;
  subscribe(listener: (event: ServerEvent) => void): () => void;
  watchConversation?(id: string): () => void;
}

export class AxisHttpError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) {
    super(message);
    this.name = 'AxisHttpError';
  }
}

const AGENT = '/api/runtime/agent';
const PROVIDERS = '/api/runtime/providers';
const SESSION = '/api/runtime/session';
const POLL_INTERVAL = 950;
const RETRY_INITIAL = 1000;
const RETRY_MAX = 30_000;
export const isDraftSessionId = (id: string): boolean => id.startsWith('draft-');
const enc = encodeURIComponent;
const workspaceRoute = (id: string) => `${AGENT}/workspaces/${enc(id)}`;
const fail = (code: string, message: string): never => { throw new AxisHttpError(message, code); };

function withQuery(path: string, params: RecordValue, keys: string[]): string {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = params[key];
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  return query.size ? `${path}?${query}` : path;
}

export class HttpAxisClient implements AxisClient {
  status: AxisStatus = 'connecting';
  onStatus: AxisClient['onStatus'] = null;
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly workspaces = new Map<string, Workspace>();
  private readonly profiles = new Map<string, Profile>();
  private readonly sessions = new Map<string, Session>();
  private readonly drafts = new Map<string, Session>();
  private readonly projections = new Map<string, ConversationProjection>();
  private readonly reading = new Map<string, Promise<ConversationProjection>>();
  private readonly watched = new Map<string, number>();
  private readonly active = new Set<string>();
  private csrf: string | null = null;
  private resumeSession = false;
  private handshake: Promise<string> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_INITIAL;
  private probing = false;
  private connected = false;
  private localSettings = settings.parse({});

  constructor(private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  connect(): void {
    this.connected = true;
    if (this.probing) return;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.probing = true;
    const probe = this.csrf ? this.send(SESSION, {}) : this.authenticate();
    void probe.catch(() => this.setStatus('closed')).finally(() => {
      this.probing = false;
      this.schedule();
    });
  }

  close(): void {
    this.connected = false;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.setStatus('closed');
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  watchConversation(id: string): () => void {
    if (isDraftSessionId(id)) return () => undefined;
    this.watched.set(id, (this.watched.get(id) ?? 0) + 1);
    this.schedule();
    return () => {
      const count = this.watched.get(id) ?? 0;
      if (count <= 1) this.watched.delete(id);
      else this.watched.set(id, count - 1);
    };
  }

  async bootstrap(): Promise<BootstrapState> {
    await this.authenticate();
    const [state, providers] = await Promise.all([
      this.get(`${AGENT}/state`), this.get(PROVIDERS),
    ]);
    const workspaces = this.assignWorkspaces(state.workspaces);
    const profiles = this.assignProfiles(providers.profiles);
    this.localSettings = settings.parse({ theme: readTheme(),
      defaultMode: workspaces[0]?.mode ?? 'workspace-write',
      ...(providers.activeProfileId ? { defaultProfileId: providers.activeProfileId } : {}),
      maxToolCalls: number(state.maximumCalls) ?? 96, maxTurnSeconds: 1200 });
    const sessions = await this.listSessions();
    return bootstrapState.parse({
      version: text(state.version), protocolVersion: PROTOCOL_VERSION, settings: this.localSettings,
      workspaces, profiles, sessions, platform: typeof navigator === 'undefined' ? '' : navigator.platform,
      dataDir: '', capabilities: { pythonRuntime: true },
      providerCatalog: {
        endpoints: array(providers.endpoints), credentialRefs: array(providers.credentialRefs),
        localGateways: array(providers.localGateways), providerRoutes: array(providers.providerRoutes),
        credentialEnrollment: providers.credentialEnrollment,
      },
    });
  }

  async request<T = unknown>(method: RequestMethod | string, params: RecordValue = {}): Promise<T> {
    return await this.dispatch(method, params) as T;
  }

  private async dispatch(method: string, params: RecordValue): Promise<unknown> {
    switch (method) {
      case 'workspace.list':
        return this.assignWorkspaces((await this.get(`${AGENT}/state`)).workspaces);
      case 'workspace.sources': {
        const state = await this.get(`${AGENT}/state`);
        const workspace = array(state.workspaces).map(object).find(row => row.id === params.workspaceId);
        if (!workspace) return fail('WORKSPACE_NOT_FOUND', '找不到此工作区。');
        return { sources: array(workspace.sources) };
      }
      case 'workspace.sourceAdd': {
        const { workspaceId, ...body } = params;
        return this.post(`${workspaceRoute(text(workspaceId))}/sources`, body);
      }
      case 'workspace.sourceRevoke':
        return this.post(`${workspaceRoute(text(params.workspaceId))}/sources/${enc(text(params.sourceId))}/revoke`, {});
      case 'workspace.execution':
        return this.get(`${workspaceRoute(text(params.workspaceId))}/execution`);
      case 'workspace.setExecution':
        return this.post(`${workspaceRoute(text(params.workspaceId))}/execution`, object(params.policy));
      case 'workspace.authorize': {
        if (params.shareWithProvider !== true) fail('WORKSPACE_AUTHORITY_REQUIRED', '请先明确授权工作区材料的模型访问。');
        const path = text(params.path);
        const name = text(params.name) || path.split(/[\\/]/).filter(Boolean).at(-1) || '工作区';
        const row = await this.post(`${AGENT}/workspaces`, { path, name, shareWithProvider: true,
          writeMode: this.workspaceWriteMode(params.mode) });
        return this.updateWorkspace(row);
      }
      case 'workspace.setMode': {
        const wid = text(params.workspaceId);
        const policy = await this.workspacePolicy(wid);
        return this.updateWorkspace(await this.post(`${workspaceRoute(wid)}/settings`,
          { ...policy, writeMode: this.workspaceWriteMode(params.mode) }));
      }
      case 'profile.list':
        return this.assignProfiles((await this.get(PROVIDERS)).profiles);
      case 'profile.save':
        return this.saveProfile(params);
      case 'profile.delete': {
        const profileId = text(params.profileId);
        const result = await this.post(`${PROVIDERS}/${enc(profileId)}/archive`, {});
        this.profiles.delete(profileId);
        this.emit({ type: 'profile.removed', profileId });
        return result;
      }
      case 'provider.enroll':
        return this.post('/api/runtime/credentials/enroll', { presetId: params.presetId, apiKey: params.apiKey });
      case 'profile.test':
      case 'provider.listModels': {
        const profileId = text(params.profileId);
        const profile = await this.preferredProfile(profileId);
        const revision = number(params.revision) ?? profile.revision;
        if (!revision) fail('PROVIDER_NOT_FOUND', '没有可测试的模型配置版本。');
        const prefix = `${PROVIDERS}/${enc(profileId)}/revisions/${revision}`;
        if (method === 'provider.listModels') {
          const result = await this.post(`${prefix}/models`, {});
          return { ...result, modelMetadata: array(result.models), models: array(result.modelIds) };
        }
        const started = performance.now();
        const result = await this.post(`${prefix}/test`, {});
        const ok = result.testStatus === 'CONNECTED';
        if (revision === profile.revision) this.updateProfile({ ...profile,
          testStatus: text(result.testStatus), diagnosticCode: text(result.diagnosticCode) || null });
        return { ...result, ok, latencyMs: Math.round(performance.now() - started),
          ...(!ok ? { error: text(result.diagnosticCode) || text(result.category) } : {}) };
      }
      case 'settings.get':
        return this.localSettings;
      case 'settings.set': {
        const patch = object(params.patch);
        if (Object.keys(patch).some((key) => !Object.hasOwn(appearanceSettings.shape, key))) {
          fail('UNSUPPORTED_SETTING', '请在相应工作区或模型配置中修改实际授权和运行选项。');
        }
        this.localSettings = settings.parse({ ...this.localSettings, ...appearanceSettings.parse(patch) });
        saveTheme(this.localSettings.theme);
        this.emit({ type: 'settings.updated', settings: this.localSettings });
        return this.localSettings;
      }
      case 'session.create':
        return this.createDraft(params);
      case 'session.list':
        return { sessions: await this.listSessions(text(params.workspaceId), number(params.limit)) };
      case 'session.get': {
        const id = text(params.sessionId);
        const draft = this.drafts.get(id);
        if (draft) return { session: draft, items: [] };
        const projection = await this.readSummary(id);
        return { session: projection.session, items: [...projection.items.values()].slice(-(number(params.itemLimit) ?? 500)),
          turnRunning: projection.session.status === 'running' };
      }
      case 'session.changes': {
        const id = text(params.sessionId);
        if (isDraftSessionId(id)) return { files: [], directoriesCreated: [] };
        const projection = await this.readSummary(id);
        if (!projection.turnId) return { files: [], directoriesCreated: [] };
        return this.get(`${AGENT}/turns/${enc(projection.turnId)}/changes`);
      }
      case 'turn.start':
        return this.startTurn(params);
      case 'turn.cancel': {
        const id = text(params.sessionId);
        const projection = await this.readSummary(id);
        if (!projection.turnId || projection.session.status !== 'running') {
          fail('TURN_NOT_RUNNING', '当前会话没有正在运行的回合。');
        }
        return this.post(`${AGENT}/turns/${enc(projection.turnId!)}/cancel`, {});
      }
      case 'task.list': {
        const values = [...this.projections.values()].flatMap((entry) => [...entry.turns.values()].map(({ task }) => task));
        const path = text(params.workspacePath);
        return { tasks: values.filter((task) => !path || task.workspacePath === path)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, number(params.limit) ?? 50) };
      }
      case 'task.get': {
        const taskId = text(params.taskId);
        for (const entry of this.projections.values()) {
          const task = entry.turns.get(taskId)?.task;
          if (task) return task;
        }
        return fail('NOT_FOUND', '任务未加载，请先打开对应会话。');
      }
      case 'fs.list':
      case 'fs.read': {
        const suffix = method === 'fs.list' ? 'files' : 'files/read';
        return this.get(withQuery(`${workspaceRoute(text(params.workspaceId))}/${suffix}`, params, ['path', 'maxBytes']));
      }
      case 'fs.preview':
        return this.get(withQuery(`${workspaceRoute(text(params.workspaceId))}/files/preview`, params,
          ['path', 'sheet', 'startRow', 'startPage', 'endPage']));
      case 'git.status': case 'git.diff': case 'git.branch': case 'git.compare': case 'git.log': {
        return this.get(withQuery(`${workspaceRoute(text(params.workspaceId))}/git/${method.slice(4)}`, params,
          ['path', 'staged', 'base', 'limit']));
      }
      case 'git.stage': case 'git.unstage': case 'git.revert': case 'git.commit': {
        const { workspaceId, ...body } = params;
        return this.post(`${workspaceRoute(text(workspaceId))}/git/${method.slice(4)}`, body);
      }
      case 'evidence.list': {
        const projection = await this.readSummary(text(params.sessionId));
        if (params.workspaceId && params.workspaceId !== projection.session.workspaceId) {
          fail('AGENT_WORKSPACE_MISMATCH', '会话属于其他工作区。');
        }
        const events = [...projection.events];
        return { events, artifacts: events.filter((entry) => entry.kind === 'artifact')
          .map((entry) => ({ ...entry.payload, id: entry.id, turnId: entry.parentId, createdAt: entry.createdAt })),
          hooks: events.filter((entry) => entry.kind === 'post_edit_hook') };
      }
      case 'artifact.read':
        return this.get(`${AGENT}/artifacts/${enc(text(params.artifactId))}`);
      case 'event.read':
        return this.get(`${AGENT}/events/${enc(text(params.eventId))}`);
      case 'skill.list':
        return this.listSkills(params);
      case 'skill.versions':
        return this.get(`${workspaceRoute(this.chooseWorkspace(params))}/skills/${enc(text(params.skillId))}/versions`);
      case 'skill.rollback':
        return this.post(`${workspaceRoute(this.chooseWorkspace(params))}/evolution/rollback`,
          { skillId: params.skillId, version: params.version, reason: params.reason });
      case 'skill.import': {
        const wid = this.chooseWorkspace(params);
        const row = skillFrom(await this.post(`${workspaceRoute(wid)}/skills/import`,
          { path: params.path, ...(params.sourceId ? { sourceId: params.sourceId } : {}) }), wid);
        this.emit({ type: 'skill.updated', skill: row });
        return row;
      }
      case 'skill.setPolicy':
        return this.setSkillPolicy(params);
      case 'skill.feedback':
        return this.skillFeedback(params);
      case 'browser.status':
        return this.get(`${AGENT}/browser/status`);
      case 'browser.tabs':
        return this.browserTabs();
      case 'browser.bind':
        return this.post('/api/runtime/browser/bind', { instanceId: params.instanceId, tabId: params.tabId });
      case 'browser.connect':
        return this.post('/api/runtime/browser/connect', {});
      case 'agent.list': case 'mcp.list':
        return [];
      default:
        return fail('UNSUPPORTED_FEATURE', '此功能当前没有可用的工作台后端入口。');
    }
  }

  private async saveProfile(params: RecordValue): Promise<Profile> {
    if (params.apiKey) fail('CREDENTIAL_POLICY', '请通过支持的系统凭据登记或选择已配好的凭据引用。');
    const id = text(params.id);
    const previous = id ? profileFrom(await this.get(`${PROVIDERS}/${enc(id)}`)) : undefined;
    if (previous && params.revision != null && params.revision !== previous.revision) {
      fail('PROVIDER_REVISION_CHANGED', '此模型配置已更新。请重新打开配置后再保存。');
    }
    const body: RecordValue = {
      name: params.name ?? previous?.name, endpoint: params.endpoint ?? previous?.endpoint,
      modelId: params.modelId ?? previous?.modelId,
      credentialRef: params.credentialRef ?? params.credentialEnv ?? previous?.credentialRef,
      protocol: params.protocol ?? previous?.protocol ?? 'openai-compatible',
      timeout: params.timeoutSeconds ?? params.timeout ?? previous?.timeoutSeconds ?? 120,
    };
    for (const key of ['contextWindow', 'maxOutputTokens', 'reasoningEffort', 'promptCache', 'proxy'] as const) {
      const value = key in params ? params[key] : previous?.[key];
      if (value !== undefined && (value !== null || key === 'proxy')) body[key] = value;
    }
    return this.updateProfile(profileFrom(await this.post(id ? `${PROVIDERS}/${enc(id)}/revisions` : PROVIDERS, body)));
  }

  private async preferredProfile(id: string): Promise<Profile> {
    if (!id) return fail('PROVIDER_NOT_CONFIGURED', '请选择已授权模型配置。');
    const profile = profileFrom(await this.get(`${PROVIDERS}/${enc(id)}`));
    this.profiles.set(profile.id, profile);
    return profile;
  }

  private updateProfile(value: Profile): Profile {
    this.profiles.set(value.id, value);
    this.emit({ type: 'profile.updated', profile: value });
    return value;
  }

  private assignProfiles(source: unknown): Profile[] {
    const profiles = array(source).map(profileFrom);
    this.profiles.clear();
    for (const item of profiles) this.profiles.set(item.id, item);
    return profiles;
  }

  private assignWorkspaces(source: unknown): Workspace[] {
    const workspaces = array(source).map(workspaceFrom);
    this.workspaces.clear();
    for (const value of workspaces) this.workspaces.set(value.id, value);
    return workspaces;
  }

  private updateWorkspace(raw: unknown): Workspace {
    const value = workspaceFrom(raw);
    this.workspaces.set(value.id, value);
    this.emit({ type: 'workspace.updated', workspace: value });
    return value;
  }

  private async workspacePolicy(wid: string): Promise<RecordValue> {
    const { workspaces } = await this.get(`${AGENT}/state`);
    const selected = array(workspaces).map(object).find((entry) => entry.id === wid);
    if (!selected) return fail('WORKSPACE_NOT_AUTHORIZED', '工作区未授权。');
    const policy = object(selected.policy);
    return { writeMode: policy.writeMode, evolutionMode: policy.evolutionMode, style: policy.style };
  }

  private workspaceWriteMode(value: unknown): 'read' | 'write' {
    if (value === 'read-only') return 'read';
    if (value === 'workspace-write') return 'write';
    return fail('WORKSPACE_MODE_NOT_AVAILABLE', '请选择只读或工作区读写。');
  }

  private chooseWorkspace(params: RecordValue): string {
    const explicit = text(params.workspaceId);
    if (explicit) return explicit;
    const samePath = [...this.workspaces.values()].find((entry) => entry.path === params.workspacePath);
    if (samePath) return samePath.id;
    if (this.workspaces.size === 1) return this.workspaces.keys().next().value!;
    return fail('WORKSPACE_SELECTION_REQUIRED', '请选择要查看或修改的工作区。');
  }

  private async listSessions(wid = '', limit = 100): Promise<Session[]> {
    const matching = [...this.workspaces.values()].filter((entry) => !wid || entry.id === wid);
    const sessions = await Promise.all(matching.map(async (workspace) => {
      const response = await this.get(`${workspaceRoute(workspace.id)}/conversations`);
      return array(response.conversations).map((value) => {
        const row = object(value);
        const previous = this.sessions.get(text(row.id));
        const next: Session = { ...previous, id: text(row.id), title: text(row.title), workspaceId: workspace.id,
          workspacePath: workspace.path, mode: workspace.mode, profileId: previous?.profileId ?? text(row.profileId),
          status: sessionState(text(row.status)), createdAt: previous?.createdAt || text(row.createdAt),
          updatedAt: text(row.updatedAt) };
        this.sessions.set(next.id, next);
        return next;
      });
    }));
    return sessions.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  private createDraft(params: RecordValue): Session {
    const wid = text(params.workspaceId);
    const workspace = this.workspaces.get(wid);
    if (!workspace) return fail('WORKSPACE_NOT_AUTHORIZED', '请先授权工作区。');
    if (params.mode && params.mode !== workspace.mode) {
      return fail('WORKSPACE_MODE_NOT_AVAILABLE', '回合权限来自当前工作区授权，请先在工作区设置确认。');
    }
    const draft: Session = { id: `draft-${crypto.randomUUID()}`, workspaceId: workspace.id, title: text(params.title),
      workspacePath: workspace.path, mode: workspace.mode, profileId: text(params.profileId), status: 'idle',
      createdAt: '', updatedAt: '' };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  private async startTurn(params: RecordValue): Promise<{ session: Session; turnId: string }> {
    const sid = text(params.sessionId);
    const draft = this.drafts.get(sid);
    const session = draft ?? (await this.readSummary(sid)).session;
    const profile = await this.preferredProfile(text(params.profileId) || session.profileId);
    const attachments = array(params.attachments).map(object);
    const browser = attachments.filter((entry) => entry.kind === 'browser-binding');
    const images = attachments.filter((entry) => entry.kind === 'image');
    if (images.length > 4) fail('IMAGE_COUNT_LIMIT', '每轮最多可附加 4 张图片。');
    if (browser.length > 1) fail('INVALID_ATTACHMENTS', '每轮只能关联一个已选定的网页。');
    const files = attachments.filter((entry) => entry.kind === 'file').map((entry) => text(entry.value));
    if (files.some((path) => !path || /^[\\/]|:|[\u0000-\u001f]/u.test(path) || path.split(/[\\/]/).includes('..'))) {
      fail('WORKSPACE_PATH_DENIED', '附件必须是在授权工作区内的相对文件路径。');
    }
    const prompt = text(params.text) + (files.length ? `\n\n用户选择的工作区文件（在现有授权范围内读取）\n${files.map((path) => `- ${path}`).join('\n')}` : '');
    const requestId = crypto.randomUUID();
    const body = { workspaceId: session.workspaceId, requestId, prompt,
      profileId: profile.id, profileRevision: profile.revision,
      ...(!draft ? { conversationId: sid } : {}), ...(browser[0] ? { browserBindingId: browser[0].value } : {}),
      ...(images.length ? { attachments: images } : {}),
      ...(params.taskContract ? { taskContract: params.taskContract } : {}),
      ...(params.continueFrom ? { continueFrom: params.continueFrom } : {}) };
    const turnId = `turn_${requestId}`;
    let conversation: string;
    let status: Session['status'] = 'running';
    try {
      const sent = await this.post(`${AGENT}/turns`, body);
      conversation = text(sent.id);
      const accepted = array(sent.turns).map(object).find((entry) => entry.id === turnId);
      if (accepted) status = sessionState(text(accepted.status));
    } catch (error) {
      if (!(error instanceof AxisHttpError) || ![0, 500, 502, 504].includes(error.status)) {
        if (draft && !(error instanceof AxisHttpError && ['CSRF_REJECTED', 'SESSION_REQUIRED'].includes(error.code))) {
          this.drafts.delete(sid);
        }
        throw error;
      }
      // Only a read can reconcile an uncertain submission. Never retransmit.
      try {
        const recovered = await this.get(`${AGENT}/turns/${enc(turnId)}`);
        conversation = text(recovered.conversationId);
        if (recovered.status) status = sessionState(text(recovered.status));
      } catch {
        if (draft) this.drafts.delete(sid);
        throw new AxisHttpError(`提交结果未确认。请检查现有会话和回执（${turnId}）。`, 'UNKNOWN_OUTCOME');
      }
    }
    if (draft) this.drafts.delete(sid);
    if (!conversation) fail('UNKNOWN_OUTCOME', `服务未返回会话身份。请检查已有回执（${turnId}）。`);
    const established: Session = { ...session, id: conversation, title: session.title || prompt.slice(0, 80),
      profileId: profile.id, status };
    this.sessions.set(conversation, established);
    if (status === 'running') this.active.add(conversation);
    this.emit({ type: 'session.updated', session: established });
    this.schedule();
    void this.readSummary(conversation).catch(() => undefined);
    return { session: established, turnId };
  }

  private async readSummary(id: string): Promise<ConversationProjection> {
    const inflight = this.reading.get(id);
    if (inflight) return inflight;
    const pending = this.collectSummary(id);
    this.reading.set(id, pending);
    try { return await pending; }
    finally { if (this.reading.get(id) === pending) this.reading.delete(id); }
  }

  private async collectSummary(id: string): Promise<ConversationProjection> {
    let projection = this.projections.get(id);
    for (let index = 0; index < 32; index += 1) {
      const since = projection?.cursor ?? 0;
      const path = `${AGENT}/conversations/${enc(id)}/summary?sinceSeq=${since}`;
      const page = conversationSummary.parse(await this.get(path));
      if (page.id !== id || page.nextSeq !== (page.events.at(-1)?.seq ?? since)
          || page.events.some((event, offset) => event.seq <= (page.events[offset - 1]?.seq ?? since)
            || event.workspaceId !== page.workspaceId)
          || page.hasMore && !page.events.length) {
        fail('AGENT_EVENT_SEQUENCE', '会话增量回执无法核对。');
      }
      if (!projection) {
        const prior = this.sessions.get(id);
        const workspace = this.workspaces.get(page.workspaceId);
        projection = new ConversationProjection(prior ?? { id, workspaceId: page.workspaceId, title: page.title,
          workspacePath: workspace?.path ?? '', mode: workspace?.mode ?? 'read-only', profileId: '',
          createdAt: '', updatedAt: '', status: sessionState(page.status) });
        this.projections.set(id, projection);
      }
      const updates = projection.apply(page);
      this.sessions.set(id, projection.session);
      for (const update of updates) this.emit(update);
      if (!page.hasMore) break;
    }
    return projection!;
  }

  private schedule(): void {
    if (!this.connected) return;
    if (this.status !== 'open') {
      if (this.probing || this.retryTimer !== null) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX);
        this.connect();
      }, this.retryDelay);
      return;
    }
    if (this.timer !== null) return;
    const ids = new Set([...this.active, ...this.watched.keys()]);
    const pending = [...ids].filter((id) => {
      const projection = this.projections.get(id);
      return !projection || projection.hasMore || projection.session.status === 'running' || this.active.has(id);
    });
    if (!pending.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.connected || this.status !== 'open') return;
      // A detached view no longer needs to poll historical or idle sessions.
      void Promise.allSettled(pending.filter((id) => this.watched.has(id) || this.active.has(id)).map(async (id) => {
        const result = await this.readSummary(id);
        if (result.session.status !== 'running' && !result.hasMore) this.active.delete(id);
      })).then(() => this.schedule());
    }, POLL_INTERVAL);
  }

  private async listSkills(params: RecordValue): Promise<RecordValue> {
    if (!params.workspaceId && !params.workspacePath && this.workspaces.size !== 1) {
      return { skills: [], cycles: [], evolutions: [], versions: [], evidence: {}, policy: 'observe' };
    }
    const wid = this.chooseWorkspace(params);
    const value = await this.get(`${workspaceRoute(wid)}/skills`);
    return { skills: array(value.skills).map((entry) => skillFrom(entry, wid)), cycles: array(value.cycles),
      evolutions: [], versions: [], evidence: {}, policy: text(object(value.policy).mode).toLowerCase() };
  }

  private async setSkillPolicy(params: RecordValue): Promise<RecordValue> {
    const wid = this.chooseWorkspace(params);
    const path = `${workspaceRoute(wid)}/evolution/policy`;
    const previous = object((await this.get(`${workspaceRoute(wid)}/evolution`)).policy);
    const value = await this.post(path, { mode: text(params.policy).toUpperCase(),
      revisionProfileId: previous.revisionProfileId ?? null, revisionProfileRevision: previous.revisionProfileRevision ?? null,
      reviewerProfileId: previous.reviewerProfileId ?? null, reviewerProfileRevision: previous.reviewerProfileRevision ?? null });
    const policy = text(value.mode).toLowerCase();
    const current = this.workspaces.get(wid);
    if (current && (policy === 'off' || policy === 'observe' || policy === 'auto')) {
      const next: Workspace = { ...current, evolutionPolicy: policy };
      this.workspaces.set(wid, next);
      this.emit({ type: 'workspace.updated', workspace: next });
    }
    return { evolutionPolicy: policy };
  }

  private async skillFeedback(params: RecordValue): Promise<RecordValue> {
    const projection = await this.readSummary(text(params.sessionId));
    if (!projection.turnId) return fail('TURN_NOT_FOUND', '请先完成一次具有实际回执的会话。');
    return this.post(`${AGENT}/turns/${enc(projection.turnId)}/feedback`, {
      rating: params.rating, comment: params.comment ?? '', checks: params.checks ?? [],
      submissionId: crypto.randomUUID(), skillId: params.skillId, scope: params.scope ?? 'TASK_ONLY',
    });
  }

  private async browserTabs(): Promise<RecordValue> {
    const state = await this.get(`${AGENT}/browser/status`);
    const instances = array(state.instances).map(object);
    const connected = instances.filter((instance) => instance.connected);
    const tabs = await Promise.all(connected.map(async (instance) => {
      const operation = await this.get(withQuery(`${AGENT}/browser/tabs`, { instanceId: instance.id }, ['instanceId']));
      const result = object(operation.result);
      if (operation.state !== 'RESULT' || result.ok !== true) {
        fail(text(result.code) || 'EDGE_RESULT_UNCONFIRMED', 'Edge 标签页查询未得到确认。');
      }
      const data = result.data;
      return (Array.isArray(data) ? data : array(object(data).tabs)).map((entry) => {
        const tab = object(entry);
        return { ...tab, id: number(tab.id ?? tab.tabId), instanceId: instance.id };
      });
    }));
    return { attached: connected.length > 0, instances, tabs: tabs.flat() };
  }

  private emit(event: ServerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private setStatus(next: AxisStatus): void {
    if (this.status === next) return;
    this.status = next;
    if (next === 'open') {
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryDelay = RETRY_INITIAL;
    }
    this.onStatus?.(next);
    this.schedule();
  }

  private async authenticate(): Promise<string> {
    if (this.csrf) return this.csrf;
    if (!this.handshake) {
      const bootstrap = () => this.send(`${SESSION}/bootstrap`, { 'X-Axis-Bootstrap': '1' }, {});
      const restore = this.resumeSession ? this.send(SESSION, {}).catch((error: unknown) => {
        if (error instanceof AxisHttpError && error.status === 401 && error.code === 'SESSION_REQUIRED') return bootstrap();
        throw error;
      }) : bootstrap();
      this.handshake = restore
        .then((value) => text(value.csrfToken)).catch((error: unknown) => {
          this.setStatus('closed');
          throw error;
        }).finally(() => { this.handshake = null; });
    }
    return this.handshake;
  }

  private async get(path: string): Promise<RecordValue> {
    await this.authenticate();
    return this.send(path, {});
  }

  private async post(path: string, data: RecordValue): Promise<RecordValue> {
    const csrf = await this.authenticate();
    return this.send(path, { 'X-Axis-CSRF': csrf }, data);
  }

  private async send(path: string, headers: Record<string, string>, data?: RecordValue): Promise<RecordValue> {
    let response: Response;
    try {
      response = await this.fetcher(path, {
        method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      this.setStatus('closed');
      throw new AxisHttpError('本地工作台连接中断。', 'AXIS_OFFLINE');
    }
    const value = object(await response.json().catch(() => null));
    if (!response.ok) {
      const error = object(value.error);
      if (response.status === 401 && (error.code === 'SESSION_REQUIRED' || path === SESSION)) {
        this.csrf = null;
        this.setStatus('closed');
      } else if (response.status === 403 && error.code === 'CSRF_REJECTED' && headers['X-Axis-CSRF'] === this.csrf) {
        this.csrf = null;
        this.resumeSession = true;
        this.setStatus('closed');
      }
      throw new AxisHttpError(text(error.message) || `工作台请求失败（HTTP ${response.status}）。`,
        text(error.code) || 'HTTP_ERROR', response.status);
    }
    if (value.schema_version !== 1 || value.mode !== 'runtime' || value.data === undefined) {
      this.setStatus('closed');
      throw new AxisHttpError('工作台返回了无法核对的数据。', 'INVALID_RUNTIME_RESPONSE');
    }
    const result = object(value.data);
    if (path === SESSION || path === `${SESSION}/bootstrap`) {
      const token = text(result.csrfToken);
      if (!token) throw new AxisHttpError('本地工作台会话未确认。', 'SESSION_REQUIRED');
      this.csrf = token;
      this.resumeSession = false;
    }
    if (this.csrf) this.setStatus('open');
    return result;
  }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { agentApi, agentRunning, type AgentConversation, type AgentState, type AgentSummary } from '../lib/agent';
import { runtimeApi, RuntimeError, type RuntimeProfiles } from '../lib/runtime';

export function agentRoute(route: string) {
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  return { view: path === '/agent/work' ? 'work' : path === '/agent/settings' ? 'settings' : 'chat', workspaceId: params.get('workspace') ?? '', conversationId: params.get('conversation') ?? '', section: params.get('section') ?? 'workspace' };
}

export function useAgentWorkspace(route: string, navigate: (path: string) => void) {
  const parsed = agentRoute(route);
  const [state, setState] = useState<AgentState | null>(null);
  const [profiles, setProfiles] = useState<RuntimeProfiles | null>(null);
  const [profileKey, setProfileKey] = useState('');
  const [token, setToken] = useState('');
  const [initializing, setInitializing] = useState(true);
  const [error, setErrorMessage] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [busy, setBusy] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState('');
  const [catalog, setCatalog] = useState<{ workspaceId: string; rows: AgentSummary[] }>({ workspaceId: '', rows: [] });
  const [detail, setDetail] = useState<AgentConversation | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [unconfirmed, setUnconfirmed] = useState<Record<string, { requestId: string; prompt: string } | undefined>>({});
  const lock = useRef(false);
  const mounted = useRef(true);
  const routeRef = useRef(route);
  useEffect(() => { routeRef.current = route; }, [route]);
  const workspaceId = parsed.workspaceId || selection || state?.workspaces[0]?.id || '';
  const workspace = state?.workspaces.find(w => w.id === workspaceId) ?? null;
  const profile = profiles?.profiles.find(p => `${p.id}@${p.revision}` === profileKey) ?? null;
  const rows = catalog.workspaceId === workspaceId ? catalog.rows : [];
  const conversation = detail?.id === parsed.conversationId && detail.workspaceId === workspaceId ? detail : null;
  const draftKey = `${workspaceId}:${parsed.conversationId}`;
  const prompt = drafts[draftKey] ?? '';
  const running = conversation?.turns.some(t => agentRunning(t.status)) ?? false;
  const unresolved = conversation?.turns.some(t => ['UNKNOWN', 'OUTCOME_UNKNOWN'].includes(t.status)) ?? false;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const setError = useCallback((message: string) => { setErrorMessage(message); setErrorCode(''); }, []);
  const reportError = useCallback((failure: unknown) => {
    const messages: Record<string, string> = {
      PROVIDER_INTEGRITY: '当前模型配置或网络授权不可用。请检查所选配置版本与后端网络路由的有效期，再继续提交。',
      PROVIDER_NOT_FOUND: '所选模型配置版本已不可用，请刷新并重新选择模型。',
      RUNTIME_REJECTED: '本次操作的结果未能确认。已保留当前内容，请读取提交记录或刷新现有任务。',
    };
    setErrorMessage(failure instanceof RuntimeError ? messages[failure.code] ?? failure.message : '本次操作未能确认，请读取最新记录。');
    setErrorCode(failure instanceof RuntimeError && /^[A-Z][A-Z0-9_]{0,79}$/.test(failure.code) ? failure.code : '');
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Scope every read and clean up stale requests on workspace changes.
  // https://react.dev/reference/react/useEffect#fetching-data-with-effects
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const session = await runtimeApi.initializeSession();
        if (abort.signal.aborted) return;
        setToken(session.csrfToken);
        const [nextState, nextProfiles] = await Promise.all([agentApi.state(abort.signal), runtimeApi.profiles(abort.signal)]);
        if (abort.signal.aborted) return;
        setState(nextState); setProfiles(nextProfiles);
        setProfileKey(current => nextProfiles.profiles.some(p => `${p.id}@${p.revision}` === current) ? current : (() => {
          const chosen = nextProfiles.profiles.find(p => p.id === nextProfiles.activeProfileId) ?? nextProfiles.profiles[0];
          return chosen ? `${chosen.id}@${chosen.revision}` : '';
        })());
      } catch (failure) { if (!abort.signal.aborted) reportError(failure); }
      finally { if (!abort.signal.aborted) setInitializing(false); }
    })();
    return () => abort.abort();
  }, [revision, reportError]);

  useEffect(() => {
    if (!token || !workspaceId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await agentApi.conversations(workspaceId, abort.signal);
        if (abort.signal.aborted) return;
        setCatalog({ workspaceId, rows: result.conversations });
        if (result.conversations.some(c => agentRunning(c.status))) timer = setTimeout(() => void read(), 1500);
      } catch (failure) { if (!abort.signal.aborted) reportError(failure); }
    };
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [workspaceId, token, revision, reportError]);

  useEffect(() => {
    if (!token || !workspaceId || !parsed.conversationId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoadingConversation(true);
    const read = async () => {
      try {
        const result = await agentApi.conversation(parsed.conversationId, abort.signal);
        if (abort.signal.aborted) return;
        if (result.workspaceId !== workspaceId) throw new RuntimeError('INVALID_DATA', '此对话不属于当前工作区。');
        setDetail(result); setLoadingConversation(false);
        if (result.turns.some(t => agentRunning(t.status))) timer = setTimeout(() => void read(), 1000);
      } catch (failure) { if (!abort.signal.aborted) { setLoadingConversation(false); reportError(failure); } }
    };
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [workspaceId, parsed.conversationId, token, revision, reportError]);

  const go = (view: string, options: { workspaceId?: string; conversationId?: string; section?: string } = {}) => {
    const params = new URLSearchParams();
    const selectedWorkspace = options.workspaceId ?? workspaceId;
    if (selectedWorkspace) params.set('workspace', selectedWorkspace);
    if (options.conversationId) params.set('conversation', options.conversationId);
    if (options.section) params.set('section', options.section);
    navigate(`/agent${view === 'chat' ? '' : `/${view}`}${params.size ? `?${params}` : ''}`);
  };
  const setPrompt = (value: string) => setDrafts(current => ({ ...current, [draftKey]: value }));
  const selectWorkspace = (id: string) => { setSelection(id); setError(''); go('chat', { workspaceId: id }); };

  async function mutate(label: string, operation: () => Promise<unknown>): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(label); setError('');
    try { await operation(); if (mounted.current) reload(); return true; }
    catch (failure) { if (mounted.current) { reportError(failure); reload(); } return false; }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function send(browserBindingId?: string) {
    if (!workspace || !profile?.credentialConfigured || !prompt.trim() || running || unconfirmed[draftKey] || lock.current) return false;
    const requestedRoute = routeRef.current;
    const savedPrompt = prompt;
    const requestId = crypto.randomUUID();
    return mutate('send', async () => {
      try {
        const result = await agentApi.send({ workspaceId, ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}), requestId, prompt, profileId: profile.id, profileRevision: profile.revision, ...(browserBindingId ? { browserBindingId } : {}) });
        if (result.workspaceId !== workspaceId) throw new RuntimeError('INVALID_DATA', '任务返回了不同工作区的记录。');
        if (!mounted.current) return;
        setDrafts(current => current[draftKey] === savedPrompt ? { ...current, [draftKey]: '' } : current);
        setDetail(result);
        if (requestedRoute === routeRef.current) go('chat', { conversationId: result.id });
      } catch (failure) {
        if (!(failure instanceof RuntimeError) || ['CONNECTION_FAILED', 'INVALID_RESPONSE', 'RESPONSE_LIMIT', 'INVALID_DATA', 'INVALID_SOURCE', 'REQUEST_REJECTED', 'RUNTIME_REJECTED', 'RUNTIME_UNAVAILABLE', 'INTERNAL_ERROR', 'SERVER_ERROR', 'ARTIFACT_INTEGRITY', 'AGENT_STORAGE_LIMIT', 'AGENT_STORAGE_UNAVAILABLE', 'AGENT_STORE_INTEGRITY'].includes(failure.code)) setUnconfirmed(current => ({ ...current, [draftKey]: { requestId, prompt: savedPrompt } }));
        throw failure;
      }
    });
  }
  async function recoverSubmission() {
    const pending = unconfirmed[draftKey];
    if (!pending) return false;
    const requestedRoute = routeRef.current;
    return mutate('recover-send', async () => {
      // Read the exact request identity. A missing record is not permission to repeat it.
      const recorded = await agentApi.turn(`turn_${pending.requestId}`);
      if (recorded.workspaceId !== workspaceId || !recorded.conversationId || recorded.prompt !== pending.prompt) throw new RuntimeError('INVALID_DATA', '提交记录与本次请求不一致。');
      const result = await agentApi.conversation(recorded.conversationId);
      if (result.workspaceId !== workspaceId || !result.turns.some(turn => turn.id === recorded.id)) throw new RuntimeError('INVALID_DATA', '提交记录与对话不一致。');
      if (!mounted.current) return;
      setUnconfirmed(current => ({ ...current, [draftKey]: undefined }));
      setDrafts(current => current[draftKey] === pending.prompt ? { ...current, [draftKey]: '' } : current);
      setDetail(result);
      if (requestedRoute === routeRef.current) go('chat', { conversationId: result.id });
    });
  }
  return { parsed, state, profiles, token, initializing, error, errorCode, setError, busy, revision, workspaceId, workspace, rows, conversation, loadingConversation, prompt, setPrompt, profileKey, setProfileKey, profile, running, unresolved, unconfirmed: !!unconfirmed[draftKey], reload, reportError, go, selectWorkspace, mutate, send, recoverSubmission };
}

export type AgentWorkspaceController = ReturnType<typeof useAgentWorkspace>;

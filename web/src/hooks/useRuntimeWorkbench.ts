import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeApi, RuntimeError, validateTurnBinding, type RuntimeCapabilities, type RuntimeProfiles, type RuntimeThread, type RuntimeThreadSummary, type RuntimeConversation, type RuntimeTurn } from "../lib/runtime";

const active = (status: string) => ["QUEUED", "PLANNING", "DISPATCH_RESERVED", "EXECUTING"].includes(status);

export function parseRuntimeRoute(route: string) {
  try {
    const url = new URL(route, "http://runtime.local");
    const id = url.pathname.startsWith("/runtime/thread/") ? decodeURIComponent(url.pathname.slice(16)) : null;
    const conversationId = url.pathname.startsWith('/runtime/conversation/') ? decodeURIComponent(url.pathname.slice(22)) : null;
    return { id: id || null, conversationId: conversationId || null, turnId: url.searchParams.get('turn'), project: url.searchParams.get("project"), path: url.pathname };
  } catch { return { id: null, conversationId: null, turnId: null, project: null, path: "/runtime/invalid" }; }
}

export function useRuntimeWorkbench(route: string, navigate: (path: string) => void) {
  const parsed = parseRuntimeRoute(route);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const projectId = parsed.project ?? selectedProject;
  const [profiles, setProfiles] = useState<RuntimeProfiles | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [catalog, setCatalog] = useState<{ project: string; data: RuntimeThreadSummary[] }>({ project: "", data: [] });
  const [detail, setDetail] = useState<{ scope: string; data: RuntimeThread | null }>({ scope: "", data: null });
  const [loadingThread, setLoadingThread] = useState(false);
  const [revision, setRevision] = useState(0);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [conversationData, setConversationData] = useState<{ scope: string; data: RuntimeConversation | null; turn: RuntimeTurn | null }>({ scope: '', data: null, turn: null });
  const [selectedTemplate, setSelectedTemplate] = useState('default');
  const [conversation, setConversation] = useState(0);
  const epoch = useRef(0);
  const mutations = useRef(new Set<string>());
  const mounted = useRef(true);
  const project = capabilities?.projects.find(item => item.id === projectId);
  const rows = catalog.project === projectId && token ? catalog.data : [];
  const scope = `${projectId}:${parsed.conversationId ?? parsed.id ?? ""}:${parsed.turnId ?? ''}`;
  const thread = detail.scope === scope && token ? detail.data : null;
  const sessionConversation = conversationData.scope === scope && token ? conversationData.data : null;
  const selectedTurn = conversationData.scope === scope && token ? conversationData.turn : null;
  const profile = profiles?.profiles.find(item => `${item.id}@${item.revision}` === selectedProfile);
  const skill = project?.skills.find(item => `${item.skill_id}@${item.skill_version}` === selectedSkill);
  const draftKey = `${projectId}:${parsed.conversationId ?? `home:${conversation}`}`;
  const prompt = drafts[draftKey] ?? "";
  const promptLimit = capabilities?.maximumPromptCodepoints ?? 8192;
  const promptLength = Array.from(prompt).length;
  const promptValid = promptLength <= promptLimit && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(prompt);
  const reportError = useCallback((failure: unknown) => {
    setError(failure instanceof RuntimeError ? `${failure.code} · ${failure.message}` : "REQUEST_FAILED · 操作未能确认完成。请重新读取真实记录，不会自动重试。");
  }, []);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const refresh = useCallback(() => { setConnectionRevision(value => value + 1); setRevision(value => value + 1); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Browser history changes invalidate pending UI work just like explicit navigation.
  useEffect(() => { epoch.current++; setBusy(""); setError(""); }, [route]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await runtimeApi.capabilities(controller.signal);
        if (controller.signal.aborted) return;
        setCapabilities(current);
        setSelectedProject(selected => selected || current.projects[0]?.id || "");
        if (!current.enabled || !current.authenticated) setToken(null);
        if (current.enabled && current.authenticated) {
          try { const restored = await runtimeApi.restoreSession(controller.signal); if (!controller.signal.aborted) setToken(restored.csrfToken); }
          catch { /* An unopened or expired session stays explicitly locked. */ }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setCapabilities({ enabled: false, authenticated: false, projects: [], allowedTools: [], blockedTools: ["run_tests"], limitations: ["当前服务未启用 Runtime，或无法连接。"] });
          reportError(failure);
        }
      } finally { if (!controller.signal.aborted) setInitializing(false); }
    })();
    return () => controller.abort();
  }, [connectionRevision, reportError]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    runtimeApi.profiles(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setProfiles(data);
      setSelectedProfile(current => {
        if (data.profiles.some(item => `${item.id}@${item.revision}` === current)) return current;
        const chosen = data.profiles.find(item => item.id === data.activeProfileId) ?? data.profiles[0];
        return chosen ? `${chosen.id}@${chosen.revision}` : "";
      });
    }).catch(failure => { if (!controller.signal.aborted) reportError(failure); });
    return () => controller.abort();
  }, [token, revision, reportError]);
  useEffect(() => { setSelectedSkill(""); setSelectedTemplate('default'); }, [projectId]);
  useEffect(() => { if (parsed.project && capabilities?.projects.some(item => item.id === parsed.project)) setSelectedProject(parsed.project); }, [parsed.project, capabilities]);
  useEffect(() => {
    if (!token || !project) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        let data = await runtimeApi.threads(project.id, controller.signal);
        if (capabilities?.supportsConversations) {
          const conversations = await runtimeApi.conversations(project.id, controller.signal);
          const children = new Set(conversations.flatMap(c => c.threadIds));
          data = [...conversations.map(c => ({ ...c, proposalId: null, runId: null })), ...data.filter(t => !children.has(t.id))];
        }
        if (controller.signal.aborted) return;
        setCatalog({ project: project.id, data });
        if (data.some(item => active(item.status))) timer = setTimeout(() => void read(), 1000);
      } catch (failure) { if (!controller.signal.aborted) reportError(failure); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, project, revision, reportError, capabilities?.supportsConversations]);
  useEffect(() => {
    if (!token || !project || (!parsed.id && !parsed.conversationId)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoadingThread(true);
    const read = async () => {
      try {
        let data: RuntimeThread;
        let live = false;
        if (parsed.conversationId) {
          const c = await runtimeApi.conversation(project.id, parsed.conversationId, controller.signal);
          const turnId = parsed.turnId ?? c.turns.at(-1)!.id;
          const summary = c.turns.find(t => t.id === turnId);
          if (!summary) throw new RuntimeError('TURN_NOT_FOUND', '本轮不属于当前对话。');
          const t = await runtimeApi.turn(project.id, c.id, turnId, controller.signal);
          validateTurnBinding(summary, t);
          if (controller.signal.aborted) return;
          setConversationData({ scope, data: c, turn: t }); data = t.thread;
          live = c.turns.some(t => active(t.webStatus));
        } else data = await runtimeApi.thread(project.id, parsed.id!, controller.signal);
        if (controller.signal.aborted) return;
        setDetail({ scope, data }); setLoadingThread(false);
        if (active(data.status) || live) timer = setTimeout(() => void read(), 1000);
      } catch (failure) { if (!controller.signal.aborted) { setLoadingThread(false); setDetail({ scope, data: null }); reportError(failure); } }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, project, parsed.id, parsed.conversationId, parsed.turnId, scope, revision, reportError]);

  const invalidate = useCallback(() => { epoch.current++; setBusy(""); setError(""); }, []);
  const go = useCallback((path: string) => { invalidate(); navigate(path); }, [invalidate, navigate]);
  function openThread(id: string, currentProject = projectId) { setSelectedProject(currentProject); go(`/runtime/${id.startsWith('conversation_') ? 'conversation' : 'thread'}/${encodeURIComponent(id)}?project=${encodeURIComponent(currentProject)}`); }
  function openTurn(id: string) { if (parsed.conversationId) go(`/runtime/conversation/${encodeURIComponent(parsed.conversationId)}?project=${encodeURIComponent(projectId)}&turn=${encodeURIComponent(id)}`); }
  function newConversation() {
    invalidate(); setConversation(value => value + 1);
    setDetail({ scope: "", data: null });
    navigate("/runtime");
  }
  function selectProject(id: string) { setSelectedProject(id); go("/runtime"); }
  async function unlock(code: string) {
    if (mutations.current.has("session")) return;
    mutations.current.add("session"); const requestEpoch = epoch.current;
    setBusy("session"); setError("");
    try {
      const data = await runtimeApi.session(code);
      if (!mounted.current) return;
      setToken(data.csrfToken); setCapabilities(current => current ? { ...current, authenticated: true } : current); reload();
      if (epoch.current === requestEpoch) go("/runtime");
    } catch (failure) { if (mounted.current && epoch.current === requestEpoch) reportError(failure); }
    finally { mutations.current.delete("session"); if (mounted.current && epoch.current === requestEpoch) setBusy(""); }
  }
  async function plan() {
    if (!token || !profile?.credentialConfigured || !skill || !project || !prompt.trim() || !promptValid || parsed.conversationId && !sessionConversation?.canContinue) return;
    const requestEpoch = epoch.current;
    const key = `plan:${requestEpoch}:${project.id}`;
    if (mutations.current.has(key)) return;
    mutations.current.add(key); setBusy("planning"); setError("");
    try {
      if (capabilities?.supportsConversations) {
        const created = await runtimeApi.planTurn(project.id, parsed.conversationId, { prompt, messageId: 'msg_' + crypto.randomUUID().replaceAll('-', ''), profileId: profile.id, profileRevision: profile.revision, skillRef: skill, taskTemplateId: selectedTemplate }, token);
        if (!mounted.current) return;
        reload();
        setDrafts(current => current[draftKey] === prompt ? { ...current, [draftKey]: '' } : current);
        if (epoch.current === requestEpoch) openThread(created.id, created.projectId);
        return;
      }
      const created = await runtimeApi.plan(project.id, { prompt, profileId: profile.id, profileRevision: profile.revision, skillRef: skill }, token);
      if (!mounted.current) return;
      // A committed job is kept in the catalog even if its originating view was reset.
      reload();
      if (epoch.current !== requestEpoch) return;
      setDetail({ scope: `${created.projectId}:${created.id}:`, data: created });
      setDrafts(current => current[draftKey] === prompt ? { ...current, [draftKey]: '' } : current);
      openThread(created.id, created.projectId);
    } catch (failure) { if (mounted.current && epoch.current === requestEpoch) reportError(failure); }
    finally { mutations.current.delete(key); if (mounted.current && epoch.current === requestEpoch) setBusy(""); }
  }
  async function approve() {
    if (!token || !thread?.proposal || thread.status !== "AWAITING_APPROVAL" || thread.runId || thread.proposal.approvedPlanSha256) return;
    const key = `approve:${thread.id}`;
    if (mutations.current.has(key)) return;
    const requestEpoch = epoch.current;
    mutations.current.add(key); setBusy("approval"); setError("");
    try {
      let updated: RuntimeThread;
      if (parsed.conversationId && selectedTurn && sessionConversation) {
        const approved = await runtimeApi.approveTurn(projectId, parsed.conversationId, selectedTurn, token);
        const pinned = sessionConversation.turns.find(t => t.id === selectedTurn.id);
        if (!pinned) throw new RuntimeError('INVALID_DATA', '批准返回的轮次无法核验。');
        validateTurnBinding(pinned, approved);
        updated = approved.thread;
        if (mounted.current && epoch.current === requestEpoch) setConversationData({ scope, data: sessionConversation, turn: approved });
      } else updated = await runtimeApi.approve(thread, token);
      if (!mounted.current) return;
      reload(); if (epoch.current === requestEpoch) setDetail({ scope, data: updated });
    } catch (failure) { if (mounted.current && epoch.current === requestEpoch) reportError(failure); }
    finally { mutations.current.delete(key); if (mounted.current && epoch.current === requestEpoch) setBusy(""); }
  }
  const canPlan = !!token && !!project && !!profile?.credentialConfigured && !!skill && !!prompt.trim() && promptValid && !busy && (!parsed.conversationId || !!sessionConversation?.canContinue);
  return { parsed, capabilities, initializing, token, error, setError, busy, projectId, project, profiles, selectedProfile, setSelectedProfile, selectedSkill, setSelectedSkill, selectedTemplate, setSelectedTemplate, rows, thread, sessionConversation, selectedTurn, openTurn, loadingThread, prompt, promptLength, promptLimit, promptValid, setPrompt: (value: string) => setDrafts(current => ({ ...current, [draftKey]: value })), conversation, reportError, reload, refresh, go, openThread, newConversation, selectProject, unlock, plan, approve, canPlan, profile, skill };
}

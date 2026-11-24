/** Model connections and the selected runtime's credential and discovery capabilities. */
import { useRef, useState } from 'react';
import { Check, CircleAlert, Eye, EyeOff, LoaderCircle, Pencil, Plug, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { Profile, ProviderProtocol, ReasoningEffort } from '@axis/protocol';
import { EffortGauge } from '../../../components/ui/effort-gauge';
import { ModelCombobox } from '../../../components/ui/model-combobox';
import { useToast } from '../../../components/Toasts';
import { EFFORT_LABEL, errorMessage } from '../../../lib/format';
import type { useSocket } from '../../../hooks/useSocket';
import { diagnosticFromError, diagnosticMessage, type ModelMetadata, type ProviderCatalog } from '../native';
import { ConfirmButton, EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';
import './profiles.css';

export const DEFAULT_ENDPOINT = 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1';

export interface ProfilesSectionProps {
  profiles: Profile[];
  request: ReturnType<typeof useSocket>['request'];
  catalog?: ProviderCatalog;
  pythonRuntime?: boolean;
}

interface ProfileForm {
  id?: string;
  revision?: number;
  name: string;
  endpoint: string;
  modelId: string;
  /** Never prefilled from storage; sent only when the user types one. */
  apiKey: string;
  /** Carried over from the edited profile so existing credentials survive. */
  credentialEnv: string;
  credentialConfigured: boolean;
  reasoningEffort: ReasoningEffort;
  timeoutSeconds: number;
  contextWindow: string;
  maxOutputTokens: string;
  proxy: string;
}

interface TestResult { ok: boolean; latencyMs?: number; reply?: string; error?: string; diagnosticCode?: string }

interface ModelList {
  models: string[];
  modelMetadata?: ModelMetadata[];
  status?: string;
}

type FetchState = 'idle' | 'loading' | 'done' | 'error';

const newForm = (native: boolean): ProfileForm => ({
  name: '', endpoint: native ? '' : DEFAULT_ENDPOINT, modelId: '', apiKey: '', credentialEnv: '', credentialConfigured: false,
  reasoningEffort: 'medium', timeoutSeconds: 120, contextWindow: '', maxOutputTokens: '', proxy: '',
});

function endpointProtocol(endpoint: string, catalog?: ProviderCatalog): ProviderProtocol {
  if (catalog?.localGateways.some((gateway) => gateway.endpoint === endpoint)) return 'local-gateway';
  if (endpoint.endsWith('/apps/anthropic/v1/messages')) return 'anthropic-compatible';
  if (new URL(endpoint).hostname === 'api.deepseek.com') return 'deepseek-compatible';
  return 'openai-compatible';
}

function probeKey(profile: Profile): string {
  return profile.revision === undefined ? profile.id : `${profile.id}@${profile.revision}`;
}

function friendlyFetchError(e: unknown): string {
  const msg = errorMessage(e);
  if (msg.includes('401')) return '密钥被端点拒绝（HTTP 401）。请检查 API 密钥是否正确、是否过期。';
  if (msg.includes('403')) return '端点拒绝访问（HTTP 403）。请确认密钥权限或套餐是否支持该端点。';
  if (msg.includes('required to list models')) return '请先填写 API 密钥（或编辑已配置凭据的连接），再获取模型列表。';
  return `获取模型列表失败：${msg}`;
}

export function ProfilesSection({ profiles, request, catalog, pythonRuntime = false }: ProfilesSectionProps) {
  const toast = useToast();
  const [form, setForm] = useState<ProfileForm>(() => newForm(pythonRuntime));
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<ModelMetadata[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState('');
  const [manualModels, setManualModels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<Record<string, TestResult | 'pending'>>({});
  const fetchEpoch = useRef(0);

  const visible = profiles.filter((p) => !removedIds.has(p.id));
  const endpoints = [...(catalog?.endpoints ?? []), ...(catalog?.localGateways ?? []).map((item) => item.endpoint)];
  const routes = catalog?.providerRoutes.filter((route) => route.endpoint === form.endpoint && route.expiresAt > Date.now() / 1000) ?? [];
  const presets = catalog?.credentialEnrollment?.presets ?? [];
  const refs = catalog?.credentialRefs.filter((ref) => {
    const preset = presets.find((item) => item.credentialRef === ref.id);
    return !preset || preset.endpoint === form.endpoint;
  }) ?? [];
  const enrollment = catalog?.credentialEnrollment?.available
    ? presets.find((item) => item.endpoint === form.endpoint && item.credentialRef === form.credentialEnv)
    : undefined;
  const currentRef = refs.find((ref) => ref.id === form.credentialEnv);
  const configured = !!currentRef?.configured || enrolled.includes(form.credentialEnv) || form.credentialConfigured;
  const saved = visible.find((p) => p.id === form.id && p.revision === form.revision);
  const discoveryReady = !!saved && saved.endpoint === form.endpoint
    && (saved.credentialRef ?? saved.credentialEnv) === form.credentialEnv
    && (saved.proxy ?? '') === form.proxy;

  const resetFetch = () => {
    fetchEpoch.current++;
    setModels([]); setMetadata([]); setFetchState('idle'); setFetchError(''); setManualModels(false);
  };

  const openEdit = (p: Profile) => {
    setForm({
      id: p.id, revision: p.revision, name: p.name, endpoint: p.endpoint, modelId: p.modelId, apiKey: '',
      credentialEnv: p.credentialRef ?? p.credentialEnv, credentialConfigured: p.credentialConfigured,
      reasoningEffort: p.reasoningEffort ?? 'medium', timeoutSeconds: p.timeoutSeconds,
      contextWindow: p.contextWindow?.toString() ?? '', maxOutputTokens: p.maxOutputTokens?.toString() ?? '',
      proxy: p.proxy ?? '',
    });
    setShowKey(false);
    resetFetch();
  };

  const cancelEdit = () => { setForm(newForm(pythonRuntime)); setShowKey(false); resetFetch(); };

  const pickModel = (modelId: string) => {
    const model = metadata.find((item) => item.id === modelId);
    setForm((current) => ({ ...current, modelId,
      ...(model?.contextWindow ? { contextWindow: String(model.contextWindow) } : {}),
      ...(model?.maxOutputTokens ? { maxOutputTokens: String(model.maxOutputTokens) } : {}),
    }));
  };

  const fetchModels = async () => {
    if (fetchState === 'loading') return;
    const endpoint = form.endpoint.trim();
    const key = form.apiKey.trim();
    if (pythonRuntime && !discoveryReady) return;
    if (!endpoint) { setFetchState('error'); setFetchError('请先填写端点 URL。'); return; }
    if (!pythonRuntime && !key && !form.credentialEnv) {
      setFetchState('error'); setFetchError('请先填写 API 密钥，再获取模型列表。'); return;
    }
    const epoch = ++fetchEpoch.current;
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await request<ModelList>('provider.listModels', pythonRuntime ? {
        profileId: form.id, revision: form.revision,
      } : {
        endpoint,
        ...(key ? { apiKey: key } : {}),
        ...(!key && form.credentialEnv ? { credentialEnv: form.credentialEnv } : {}),
      });
      if (epoch !== fetchEpoch.current) return;
      const list = Array.isArray(res?.models) ? res.models.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
      setModels(list);
      setMetadata(res.modelMetadata ?? []);
      setManualModels(res.status === 'MANUAL_CONFIGURATION');
      setFetchState('done');
      if (!pythonRuntime && list.length > 0) setForm((f) => ({ ...f, modelId: list[0] ?? f.modelId }));
    } catch (e) {
      if (epoch !== fetchEpoch.current) return;
      setModels([]);
      setFetchState('error');
      setFetchError(diagnosticFromError(e) ?? friendlyFetchError(e));
    }
  };

  const save = async () => {
    if (busy) return;
    const name = form.name.trim();
    const endpoint = form.endpoint.trim();
    const modelId = form.modelId.trim();
    if (!name || !endpoint || !modelId) { toast.push('warn', '请填写名称、端点 URL 与模型 ID'); return; }
    try { new URL(endpoint); } catch { toast.push('warn', '端点 URL 格式无效，需以 http(s):// 开头'); return; }
    const key = form.apiKey.trim();
    if (pythonRuntime && !form.credentialEnv) { toast.push('warn', '请选择已授权的凭据引用'); return; }
    if (!pythonRuntime && !key && !form.credentialEnv) {
      toast.push('warn', '请填写 API 密钥（密钥仅存于本机，不上传）'); return;
    }
    const minTimeout = pythonRuntime ? 1 : 5;
    const maxTimeout = pythonRuntime ? 300 : 600;
    if (!Number.isInteger(form.timeoutSeconds) || form.timeoutSeconds < minTimeout || form.timeoutSeconds > maxTimeout) {
      toast.push('warn', `超时需为 ${minTimeout}–${maxTimeout} 之间的整数秒`);
      return;
    }
    const contextWindow = form.contextWindow.trim() ? Number(form.contextWindow) : undefined;
    const maxOutputTokens = form.maxOutputTokens.trim() ? Number(form.maxOutputTokens) : undefined;
    if (pythonRuntime && ((contextWindow !== undefined && (!Number.isInteger(contextWindow) || contextWindow < 256 || contextWindow > 16_000_000))
      || (maxOutputTokens !== undefined && (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 1_000_000))
      || (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens >= contextWindow))) {
      toast.push('warn', '请填写有效的整数令牌限额，且最大输出须小于上下文窗口');
      return;
    }
    setBusy(true);
    try {
      await request('profile.save', {
        ...(form.id ? { id: form.id, ...(pythonRuntime ? { revision: form.revision } : {}) } : {}),
        name, endpoint, modelId,
        reasoningEffort: form.reasoningEffort,
        timeoutSeconds: form.timeoutSeconds,
        ...(pythonRuntime ? {
          credentialRef: form.credentialEnv,
          protocol: (saved?.endpoint === endpoint && saved.protocol) || endpointProtocol(endpoint, catalog),
          contextWindow: contextWindow ?? null,
          maxOutputTokens: maxOutputTokens ?? null,
          proxy: form.proxy || null,
        } : key ? { apiKey: key } : { credentialEnv: form.credentialEnv }),
      });
      toast.push('success', form.id ? '连接已更新' : '连接已创建');
      cancelEdit();
    } catch (e) {
      toast.push('error', `保存失败：${diagnosticFromError(e) ?? errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const enroll = async () => {
    if (!enrollment || !form.apiKey.trim() || enrolling) return;
    setEnrolling(true);
    try {
      await request('provider.enroll', { presetId: enrollment.id, apiKey: form.apiKey.trim() });
      setEnrolled((previous) => [...previous, enrollment.credentialRef]);
      setForm((current) => current.credentialEnv === enrollment.credentialRef
        ? { ...current, apiKey: '' }
        : current);
      toast.push('success', '密钥已保存到 Windows 凭据管理器');
    } catch (e) {
      toast.push('error', `凭据登记失败：${diagnosticFromError(e) ?? errorMessage(e)}`);
    } finally {
      setEnrolling(false);
    }
  };

  const remove = async (profileId: string) => {
    try {
      await request('profile.delete', { profileId });
      setRemovedIds((cur) => new Set([...cur, profileId]));
      toast.push('success', '连接已删除');
    } catch (e) {
      toast.push('error', `删除失败：${errorMessage(e)}`);
    }
  };

  const test = async (profile: Profile) => {
    const key = probeKey(profile);
    setTests((cur) => ({ ...cur, [key]: 'pending' }));
    try {
      const result = await request<TestResult>('profile.test', {
        profileId: profile.id, ...(pythonRuntime ? { revision: profile.revision } : {}),
      });
      const error = diagnosticMessage(result.diagnosticCode) ?? result.error ?? '端点未返回成功响应';
      setTests((cur) => ({ ...cur, [key]: result.ok ? result : { ...result, error } }));
      if (result.ok) toast.push('success', result.latencyMs === undefined ? '连接正常' : `连接正常（${result.latencyMs}ms）`);
      else toast.push('error', `连接失败：${error}`);
    } catch (e) {
      const error = diagnosticFromError(e) ?? errorMessage(e);
      setTests((cur) => ({ ...cur, [key]: { ok: false, error } }));
      toast.push('error', `测试失败：${error}`);
    }
  };

  const keyHint = form.id && form.credentialConfigured && !form.apiKey.trim()
    ? '此连接已存有密钥，留空则继续使用已存密钥。'
    : '密钥仅存于本机，不上传';

  return (
    <section className="set-section" aria-label="模型连接">
      <SectionHeader icon={Plug} title="API 接入" description={pythonRuntime
        ? '选择已授权的端点和本机凭据引用。填写模型 ID 后可保存并测试连接。'
        : '自由接入任意 OpenAI 兼容端点。密钥仅存于本机，不上传；模型列表可一键获取，也可手动填写。'} />

      <div className="set-card" aria-label="API 接入表单">
        <div className="set-card-head">
          <h3 className="set-card-title">{form.id ? '编辑连接' : '接入新 API'}</h3>
          {form.id && <button className="text-button" onClick={cancelEdit}>取消编辑</button>}
        </div>
        <div className="set-form-grid">
          <div className="api-span2">
            <Field label="端点 URL">
              {pythonRuntime ? (
                <Select value={form.endpoint} aria-label="端点 URL" onChange={(e) => {
                  setForm({
                    ...form, endpoint: e.target.value, proxy: '', credentialEnv: '', credentialConfigured: false, apiKey: '',
                  });
                  setShowKey(false);
                  resetFetch();
                }}>
                  <option value="">选择已授权的端点</option>
                  {form.endpoint && !endpoints.includes(form.endpoint) && <option value={form.endpoint}>{form.endpoint}（已撤销授权）</option>}
                  {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
                </Select>
              ) : (
                <TextInput
                  value={form.endpoint}
                  onChange={(e) => { setForm({ ...form, endpoint: e.target.value }); resetFetch(); }}
                  placeholder={DEFAULT_ENDPOINT}
                  aria-label="端点 URL"
                />
              )}
            </Field>
          </div>
          {pythonRuntime && (
            <div className="api-span2">
              <Field label="凭据引用" hint="引用由本机启动配置提供。">
                <Select aria-label="凭据引用" value={form.credentialEnv} onChange={(e) => {
                  setForm({ ...form, credentialEnv: e.target.value, credentialConfigured: false, apiKey: '' });
                  setShowKey(false);
                  resetFetch();
                }}>
                  <option value="">选择凭据引用</option>
                  {form.credentialEnv && !currentRef && <option value={form.credentialEnv}>{form.credentialEnv}（已撤销授权）</option>}
                  {refs.map((item) => (
                    <option key={item.id} value={item.id}>{item.id}{item.configured || enrolled.includes(item.id) ? '' : '（未配置）'}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {(!pythonRuntime || (enrollment && !configured)) && (
            <div className="api-span2">
            <Field label="API 密钥" hint={pythonRuntime ? '可将这项凭据保存到 Windows 凭据管理器。' : keyHint}>
              <span className="api-key-wrap">
                <TextInput
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={form.id && form.credentialConfigured ? '留空则沿用已存密钥' : 'sk-…'}
                  aria-label="API 密钥"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="icon-button api-key-toggle"
                  aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                </button>
              </span>
            </Field>
            {pythonRuntime && (
              <button type="button" className="button api-enroll" onClick={() => void enroll()} disabled={enrolling || !form.apiKey.trim()}>
                {enrolling && <LoaderCircle className="spin" size={14} aria-hidden />} 登记本机密钥
              </button>
            )}
            </div>
          )}
          {pythonRuntime && (
            <Field label="本机代理" hint={routes.length ? '选择为该端点授权的 HTTP CONNECT 代理。' : '当前端点没有已授权的本机代理。'}>
              <Select aria-label="本机代理" value={form.proxy} onChange={(e) => {
                setForm({ ...form, proxy: e.target.value });
                resetFetch();
              }}>
                <option value="">直连</option>
                {form.proxy && !routes.some((route) => route.proxy === form.proxy) && (
                  <option value={form.proxy}>{form.proxy}（授权不可用）</option>
                )}
                {routes.map((route) => <option key={route.proxy} value={route.proxy}>{route.proxy}</option>)}
              </Select>
            </Field>
          )}
          <div className="api-span2 api-fetch-row">
            <button className="button" onClick={() => void fetchModels()}
              disabled={fetchState === 'loading' || (pythonRuntime && !discoveryReady)}>
              {fetchState === 'loading' ? <LoaderCircle size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
              获取模型列表
            </button>
            {fetchState === 'done' && (
              <span className="api-models-hint" role="status">
                {manualModels ? '此端点不提供模型目录，请手动填写模型 ID。'
                  : models.length === 0 ? '端点未返回模型，可手动填写模型 ID'
                  : pythonRuntime ? `已获取 ${models.length} 个模型`
                  : `已获取 ${models.length} 个模型，自动选中第一个`}
              </span>
            )}
            {pythonRuntime && !discoveryReady && <span className="api-models-hint">保存连接后可查询端点提供的模型目录。</span>}
          </div>
          {fetchState === 'error' && <div className="api-error api-span2" role="alert">{fetchError}</div>}
          <Field label="模型 ID" hint="展开可搜索/选择全部模型，也可手动输入。">
            <ModelCombobox
              value={form.modelId}
              onChange={pickModel}
              models={models}
              ariaLabel="模型 ID"
            />
          </Field>
          <Field label="名称">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如 Qwen Token Plan" aria-label="名称" />
          </Field>
          <div className="api-span2">
            <EffortGauge value={form.reasoningEffort} onChange={(v) => setForm({ ...form, reasoningEffort: v })} label="推理强度" />
          </div>
          <Field label="超时（秒）">
            <TextInput type="number" min={pythonRuntime ? 1 : 5} max={pythonRuntime ? 300 : 600}
              value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: Number(e.target.value) })} aria-label="超时秒数" />
          </Field>
          {pythonRuntime && (
            <>
              <Field label="上下文窗口（Token）" hint="可选。选择模型后可使用目录提供的值。">
                <TextInput type="number" min={256} max={16_000_000} value={form.contextWindow}
                  onChange={(e) => setForm({ ...form, contextWindow: e.target.value })} aria-label="上下文窗口" />
              </Field>
              <Field label="最大输出（Token）" hint="可选。留空采用后端默认值。">
                <TextInput type="number" min={1} max={1_000_000} value={form.maxOutputTokens}
                  onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} aria-label="最大输出 Token" />
              </Field>
            </>
          )}
        </div>
        <div className="set-form-actions">
          <button className="button primary api-save" onClick={() => void save()} disabled={busy}>
            {busy && <LoaderCircle size={14} className="spin" aria-hidden />} 保存
          </button>
          {form.id && <button className="button" onClick={cancelEdit}>取消</button>}
        </div>
      </div>

      <div className="set-list" aria-label="模型连接列表">
        {visible.length === 0 && <EmptyHint>尚未配置模型连接。在上方表单接入你的第一个 API。</EmptyHint>}
        {visible.map((p) => {
          const liveTest = tests[probeKey(p)];
          const t: TestResult | 'pending' | undefined = liveTest ?? (p.testStatus === 'FAILED'
            ? { ok: false, error: diagnosticMessage(p.diagnosticCode) ?? '端点未返回成功响应' }
            : p.testStatus === 'CONNECTED' ? { ok: true } : undefined);
          return (
            <div key={p.id} className="set-row set-row-col">
              <div className="set-row-line">
                <div className="set-row-main">
                  <div className="set-row-title">{p.name}</div>
                  <div className="set-row-sub"><code>{p.modelId}</code>　{p.endpoint}</div>
                </div>
                <div className="set-row-actions">
                  <button className="button" onClick={() => void test(p)} disabled={t === 'pending'}>
                    {t === 'pending' ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Zap size={14} aria-hidden />} 测试连接
                  </button>
                  <button className="icon-button" aria-label={`编辑 ${p.name}`} onClick={() => openEdit(p)}><Pencil size={15} aria-hidden /></button>
                  <ConfirmButton onConfirm={() => void remove(p.id)} className="icon-button set-danger" confirmLabel="确认删除" label={`删除连接 ${p.name}`}>
                    <Trash2 size={15} aria-hidden />
                  </ConfirmButton>
                </div>
              </div>
              <div className="set-row-meta">
                <span className={`chip ${p.credentialConfigured ? 'success' : 'warn'}`} title={p.credentialEnv}>
                  {p.credentialConfigured ? <Check size={12} aria-hidden /> : <CircleAlert size={12} aria-hidden />}
                  {p.credentialConfigured ? '已配置' : '未配置'}
                </span>
                {p.reasoningEffort && <span className="chip muted">推理：{EFFORT_LABEL[p.reasoningEffort]}</span>}
                <span className="chip muted">超时 {p.timeoutSeconds}s</span>
                {p.contextWindow && <span className="chip muted">上下文 {p.contextWindow.toLocaleString()} Token</span>}
                {p.proxy && <span className="chip muted">已启用代理</span>}
              </div>
              {t && t !== 'pending' && (
                <div className={`set-test-result ${t.ok ? 'ok' : 'fail'}`} role="status">
                  {t.ok
                    ? pythonRuntime
                      ? <>{liveTest ? '连接正常' : '最近一次连接测试通过'}{t.latencyMs === undefined ? '' : `（${t.latencyMs} 毫秒）`}</>
                      : <>连接正常 · {t.latencyMs ?? 0}ms{t.reply ? ` · 回复：${t.reply}` : ''}</>
                    : <>连接失败：{t.error}</>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

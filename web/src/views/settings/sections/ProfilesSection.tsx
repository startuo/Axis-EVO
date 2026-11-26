/** Model connections and the selected runtime's credential and discovery capabilities. */
import { useRef, useState } from 'react';
import { Check, CircleAlert, Eye, EyeOff, LoaderCircle, Pencil, Plug, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { Profile, ProviderProtocol, ReasoningEffort } from '@axis/protocol';
import { EffortGauge } from '../../../components/ui/effort-gauge';
import { ModelCombobox } from '../../../components/ui/model-combobox';
import { useToast } from '../../../components/Toasts';
import { EFFORT_LABEL, errorMessage } from '../../../lib/format';
import { DEFAULT_ENDPOINT, PROVIDER_PRESETS, endpointDisplayName, groupProfilesByEndpoint, normalizeEndpoint, type ProfileGroup } from '../../../lib/providers';
import type { useSocket } from '../../../hooks/useSocket';
import { diagnosticFromError, diagnosticMessage, type ModelMetadata, type ProviderCatalog } from '../native';
import { ConfirmButton, EmptyHint, Field, SectionHeader, Select, TextInput } from '../ui';
import { parseModelIds, ProfileModelPicker } from './ProfileModelPicker';
import './profiles.css';

export { DEFAULT_ENDPOINT } from '../../../lib/providers';

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

interface BatchFailure { modelId: string; message: string }
type FetchState = 'idle' | 'loading' | 'done' | 'error';

const newForm = (native: boolean): ProfileForm => ({
  name: '', endpoint: native ? '' : DEFAULT_ENDPOINT, modelId: '', apiKey: '', credentialEnv: '', credentialConfigured: false,
  reasoningEffort: 'medium', timeoutSeconds: 120, contextWindow: '', maxOutputTokens: '', proxy: '',
});

function endpointProtocol(endpoint: string, catalog?: ProviderCatalog): ProviderProtocol {
  const preset = catalog?.credentialEnrollment?.presets.find((item) => item.endpoint === endpoint);
  if (preset) return preset.protocol;
  if (catalog?.localGateways.some((gateway) => gateway.endpoint === endpoint)) return 'local-gateway';
  const url = new URL(endpoint);
  if (url.pathname.replace(/\/+$/, '').endsWith('/apps/anthropic/v1/messages')) return 'anthropic-compatible';
  if (url.hostname === 'api.deepseek.com') return 'deepseek-compatible';
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
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<Record<string, TestResult | 'pending'>>({});
  const fetchEpoch = useRef(0);
  const formHeading = useRef<HTMLHeadingElement>(null);

  const visible = profiles.filter((p) => !removedIds.has(p.id));
  const groups = groupProfilesByEndpoint(visible);
  const endpoints = [...new Set([...(catalog?.endpoints ?? []), ...(catalog?.localGateways ?? []).map((item) => item.endpoint)])];
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
  const canReuse = (p: Profile) => p.credentialConfigured && (!pythonRuntime || (p.revision !== undefined
    && endpoints.includes(p.endpoint)
    && catalog?.credentialRefs.some((ref) => ref.id === (p.credentialRef ?? p.credentialEnv))
    && (!p.proxy || catalog?.providerRoutes.some((route) => route.endpoint === p.endpoint
      && route.proxy === p.proxy && route.expiresAt > Date.now() / 1000))));
  const matchesDiscovery = (p: Profile, values: ProfileForm) => p.revision !== undefined && p.endpoint === values.endpoint
    && (p.credentialRef ?? p.credentialEnv) === values.credentialEnv
    && (p.proxy ?? '') === values.proxy;
  const discovery = form.id ? (saved && matchesDiscovery(saved, form) ? saved : undefined)
    : visible.find((p) => canReuse(p) && matchesDiscovery(p, form));
  const connected = new Set(groups.find((group) => group.key === normalizeEndpoint(form.endpoint))?.profiles.map((p) => p.modelId));
  const batchModels = [...new Set([...selectedModels, ...parseModelIds(manualInput)])].filter((modelId) => !connected.has(modelId));
  const suggestedModels = [...new Set([
    ...(catalog?.localGateways.find((gateway) => gateway.endpoint === form.endpoint)?.modelIds ?? []),
    ...presets.filter((preset) => preset.endpoint === form.endpoint && preset.credentialRef === form.credentialEnv).flatMap((preset) => preset.models),
  ])];
  const quickPresets = pythonRuntime ? endpoints.map((endpoint) => ({
    endpoint, label: presets.find((preset) => preset.endpoint === endpoint)?.name ?? endpointDisplayName(endpoint),
  })) : PROVIDER_PRESETS;

  const resetFetch = () => {
    fetchEpoch.current++;
    setModels([]); setMetadata([]); setFetchState('idle'); setFetchError(''); setManualModels(false);
  };

  const resetSelection = () => {
    setSelectedModels([]); setQuery(''); setManualInput(''); setFailures([]);
  };

  const changeEndpoint = (endpoint: string, usePreset = false) => {
    const preset = usePreset ? presets.find((item) => item.endpoint === endpoint) : undefined;
    setForm((current) => ({ ...current, endpoint, proxy: '', credentialEnv: preset?.credentialRef ?? '',
      credentialConfigured: false, ...(pythonRuntime ? { apiKey: '' } : {}) }));
    setShowKey(false);
    resetFetch();
    resetSelection();
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
    resetSelection();
    formHeading.current?.focus();
  };

  const resetForm = () => { setForm(newForm(pythonRuntime)); setShowKey(false); resetFetch(); resetSelection(); };

  const pickModel = (modelId: string) => {
    const model = metadata.find((item) => item.id === modelId);
    setForm((current) => ({ ...current, modelId,
      ...(model?.contextWindow ? { contextWindow: String(model.contextWindow) } : {}),
      ...(model?.maxOutputTokens ? { maxOutputTokens: String(model.maxOutputTokens) } : {}),
    }));
  };

  const fetchModels = async (values: ProfileForm, source?: Profile) => {
    const endpoint = values.endpoint.trim();
    const key = values.apiKey.trim();
    if (pythonRuntime && !source) return;
    if (!endpoint) { setFetchState('error'); setFetchError('请先填写端点 URL。'); return; }
    if (!pythonRuntime && !key && !values.credentialEnv) {
      setFetchState('error'); setFetchError('请先填写 API 密钥，再获取模型列表。'); return;
    }
    const epoch = ++fetchEpoch.current;
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await request<ModelList>('provider.listModels', source && pythonRuntime ? {
        profileId: source.id, revision: source.revision,
      } : {
        endpoint,
        ...(key ? { apiKey: key } : {}),
        ...(!key && values.credentialEnv ? { credentialEnv: values.credentialEnv } : {}),
      });
      if (epoch !== fetchEpoch.current) return;
      const list = Array.isArray(res?.models) ? res.models.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
      setModels([...new Set(list)]);
      setMetadata(res.modelMetadata ?? []);
      setManualModels(res.status === 'MANUAL_CONFIGURATION');
      setFetchState('done');
    } catch (e) {
      if (epoch !== fetchEpoch.current) return;
      setModels([]);
      setFetchState('error');
      setFetchError(diagnosticFromError(e) ?? friendlyFetchError(e));
    }
  };

  const addMore = (group: ProfileGroup) => {
    const source = group.profiles.find(canReuse);
    const next = { ...newForm(pythonRuntime), endpoint: source?.endpoint ?? group.endpoint,
      credentialEnv: source?.credentialRef ?? source?.credentialEnv ?? '',
      credentialConfigured: source?.credentialConfigured ?? false,
      proxy: source?.proxy ?? '', timeoutSeconds: source?.timeoutSeconds ?? 120 };
    setForm(next);
    setShowKey(false);
    resetFetch();
    resetSelection();
    formHeading.current?.focus();
    if (source) void fetchModels(next, source);
  };

  const save = async () => {
    if (busy) return;
    const name = form.name.trim();
    const endpoint = form.endpoint.trim();
    const modelIds = form.id ? [form.modelId.trim()].filter(Boolean) : batchModels;
    if (!endpoint || modelIds.length === 0 || (form.id && !name)) {
      toast.push('warn', '请填写端点 URL、模型 ID 与编辑所需的名称');
      return;
    }
    try {
      if (!['http:', 'https:'].includes(new URL(endpoint).protocol)) throw new TypeError();
    } catch {
      toast.push('warn', '端点 URL 格式无效，需以 http(s):// 开头');
      return;
    }
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
    const source = form.id ? saved : discovery;
    const protocol = pythonRuntime && ((source?.endpoint === endpoint && source.protocol) || endpointProtocol(endpoint, catalog));
    const failed: BatchFailure[] = [];
    setBusy(true);
    setFailures([]);
    if (!form.id) setProgress({ done: 0, total: modelIds.length });
    try {
      for (const [index, modelId] of modelIds.entries()) {
        const discovered = form.id ? undefined : metadata.find((item) => item.id === modelId);
        const modelContextWindow = contextWindow ?? discovered?.contextWindow ?? null;
        const modelMaxOutputTokens = maxOutputTokens ?? discovered?.maxOutputTokens ?? null;
        try {
          if (modelId.length > 128) throw new Error('模型 ID 须在 128 个字符内');
          if (modelContextWindow !== null && modelMaxOutputTokens !== null && modelMaxOutputTokens >= modelContextWindow) {
            throw new Error('最大输出须小于上下文窗口，请调整令牌限额');
          }
          await request('profile.save', {
            ...(form.id ? { id: form.id, ...(pythonRuntime ? { revision: form.revision } : {}) } : {}),
            name: modelIds.length === 1 && name ? name : modelId.slice(0, 80), endpoint, modelId,
            reasoningEffort: form.reasoningEffort,
            timeoutSeconds: form.timeoutSeconds,
            ...(pythonRuntime ? {
              credentialRef: form.credentialEnv,
              protocol,
              contextWindow: modelContextWindow,
              maxOutputTokens: modelMaxOutputTokens,
              proxy: form.proxy || null,
            } : key ? { apiKey: key } : { credentialEnv: form.credentialEnv }),
          });
        } catch (error) {
          failed.push({ modelId, message: diagnosticFromError(error) ?? errorMessage(error) });
        }
        if (!form.id) setProgress({ done: index + 1, total: modelIds.length });
      }
      if (failed.length === 0) {
        toast.push('success', form.id ? '连接已更新' : `已接入 ${modelIds.length} 个模型`);
        resetForm();
      } else if (form.id) {
        toast.push('error', `保存失败：${failed[0]?.message}`);
      } else {
        const completed = modelIds.length - failed.length;
        setFailures(failed);
        setSelectedModels(failed.map((item) => item.modelId));
        setManualInput('');
        if (modelIds.length > 1) setForm((current) => ({ ...current, name: '' }));
        toast.push(completed > 0 ? 'warn' : 'error', `已接入 ${completed} 个模型，${failed.length} 个保存失败`);
      }
    } finally {
      setBusy(false);
      setProgress(null);
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

  const keyHint = form.credentialConfigured && !form.apiKey.trim()
    ? '此连接已存有密钥，留空则继续使用已存密钥。'
    : '密钥仅存于本机，不上传';

  return (
    <section className="set-section" aria-label="模型连接">
      <SectionHeader icon={Plug} title="API 接入" description={pythonRuntime
        ? '选择已授权的端点和本机凭据，一次接入多个模型。'
        : '接入 OpenAI 兼容端点，密钥仅存于本机，不上传。'} />

      <div className="set-card" aria-label="API 接入表单">
        <div className="set-card-head">
          <h3 className="set-card-title" ref={formHeading} tabIndex={-1}>{form.id ? '编辑连接' : '接入模型'}</h3>
          {form.id && <button type="button" className="text-button" onClick={resetForm} disabled={busy || enrolling}>取消编辑</button>}
        </div>
        <fieldset className="set-form-grid api-fields" disabled={busy || enrolling}>
          {!form.id && quickPresets.length > 0 && (
            <div className="api-span2 api-presets" role="group" aria-label="提供商快捷预设">
              {quickPresets.map(({ label, endpoint }) => (
                <button key={endpoint} type="button" className="button" title={endpoint}
                  aria-pressed={normalizeEndpoint(form.endpoint) === normalizeEndpoint(endpoint)}
                  onClick={() => { if (endpoint !== form.endpoint) changeEndpoint(endpoint, true); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="api-span2">
            <Field label="端点 URL">
              {pythonRuntime ? (
                <Select value={form.endpoint} aria-label="端点 URL" onChange={(e) => changeEndpoint(e.target.value)}>
                  <option value="">选择已授权的端点</option>
                  {form.endpoint && !endpoints.includes(form.endpoint) && <option value={form.endpoint}>{form.endpoint}（已撤销授权）</option>}
                  {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
                </Select>
              ) : (
                <TextInput
                  value={form.endpoint}
                  onChange={(e) => changeEndpoint(e.target.value)}
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
                  onChange={(e) => {
                    setForm({ ...form, apiKey: e.target.value });
                    if (!pythonRuntime) resetFetch();
                  }}
                  placeholder={form.credentialConfigured ? '留空则沿用已存密钥' : '输入 API 密钥'}
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
            <button type="button" className="button" onClick={() => void fetchModels(form, discovery)}
              disabled={fetchState === 'loading' || (pythonRuntime && !discovery)}>
              {fetchState === 'loading' ? <LoaderCircle size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
              获取模型列表
            </button>
            {fetchState === 'done' && (
              <span className="api-models-hint" role="status">
                {manualModels ? '此端点不提供模型目录，请手动填写模型 ID。'
                  : models.length === 0 ? '端点未返回模型，可手动填写模型 ID'
                    : `已获取 ${models.length} 个模型`}
              </span>
            )}
            {pythonRuntime && !discovery && (
              <span className="api-models-hint">{suggestedModels.length > 0 && !form.id
                ? '下方可选本机已登记的模型。保存连接后可查询端点目录。'
                : '首次使用此连接时，先输入模型 ID 并保存，再获取端点目录。'}</span>
            )}
          </div>
          {fetchState === 'error' && <div className="api-error api-span2" role="alert">{fetchError}</div>}
          {form.id ? (
            <Field label="模型 ID" hint="搜索现有模型，或手动输入。">
              <ModelCombobox value={form.modelId} onChange={pickModel} models={models} disabled={busy || enrolling} ariaLabel="模型 ID" />
            </Field>
          ) : (
            <ProfileModelPicker models={models.length > 0 ? models : suggestedModels} connected={connected}
              selected={selectedModels.filter((id) => !connected.has(id))} onSelect={setSelectedModels}
              query={query} onQuery={setQuery} manualInput={manualInput} onManualInput={setManualInput} />
          )}
          {(form.id || batchModels.length <= 1) && (
            <Field label="名称" hint={form.id ? undefined : '可选。留空时使用模型 ID。'}>
              <TextInput value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如 Qwen Token Plan" aria-label="名称" />
            </Field>
          )}
          <div className="api-span2">
            <EffortGauge value={form.reasoningEffort} onChange={(v) => setForm({ ...form, reasoningEffort: v })}
              disabled={busy || enrolling} label="推理强度" />
          </div>
          <Field label="超时（秒）">
            <TextInput type="number" min={pythonRuntime ? 1 : 5} max={pythonRuntime ? 300 : 600}
              value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: Number(e.target.value) })} aria-label="超时秒数" />
          </Field>
          {pythonRuntime && (
            <>
              <Field label="上下文窗口（Token）" hint={form.id ? '可选。选择模型时使用目录提供的值。'
                : '可选。留空时先使用单个模型的目录值。'}>
                <TextInput type="number" min={256} max={16_000_000} value={form.contextWindow}
                  onChange={(e) => setForm({ ...form, contextWindow: e.target.value })} aria-label="上下文窗口" />
              </Field>
              <Field label="最大输出（Token）" hint={form.id ? '可选。留空采用后端默认值。' : '可选。留空时先使用单个模型的目录值。'}>
                <TextInput type="number" min={1} max={1_000_000} value={form.maxOutputTokens}
                  onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })} aria-label="最大输出 Token" />
              </Field>
            </>
          )}
        </fieldset>
        {failures.length > 0 && (
          <div className="api-error api-save-errors" role="alert">
            <p>以下模型保存失败。修改配置后可重试所选模型。</p>
            <ul>{failures.map(({ modelId, message }) => <li key={modelId}><code>{modelId}</code> {message}</li>)}</ul>
          </div>
        )}
        <div className="set-form-actions">
          <button type="button" className="button primary api-save" onClick={() => void save()} disabled={busy || enrolling}>
            {busy && <LoaderCircle size={14} className="spin" aria-hidden />}
            {form.id ? '保存' : batchModels.length > 0 ? `保存 ${batchModels.length} 个模型` : '批量保存'}
          </button>
          {progress && <span className="api-models-hint" role="status">正在保存 {progress.done}/{progress.total}</span>}
          {form.id && <button type="button" className="button" onClick={resetForm} disabled={busy || enrolling}>取消</button>}
        </div>
      </div>

      <div className="set-list" aria-label="模型连接列表">
        {visible.length === 0 && <EmptyHint>尚未配置模型连接。在上方表单接入你的第一个 API。</EmptyHint>}
        {groups.map((group) => (
          <section key={group.key} className="api-provider-group" aria-label={group.label}>
            <header className="api-provider-head">
              <div className="api-provider-title">
                <h3>{group.label}</h3>
                <code title={group.endpoint}>{group.endpoint}</code>
              </div>
              <button type="button" className="button" onClick={() => addMore(group)} disabled={busy || enrolling}>
                <Plus size={14} aria-hidden /> 添加更多模型
              </button>
            </header>
            {group.profiles.map((p) => {
              const liveTest = tests[probeKey(p)];
              const t: TestResult | 'pending' | undefined = liveTest ?? (p.testStatus === 'FAILED'
                ? { ok: false, error: diagnosticMessage(p.diagnosticCode) ?? '端点未返回成功响应' }
                : p.testStatus === 'CONNECTED' ? { ok: true } : undefined);
              return (
                <div key={p.id} className="set-row set-row-col">
                  <div className="set-row-line">
                    <div className="set-row-main">
                      <div className="set-row-title">{p.name}</div>
                      {p.name !== p.modelId && <div className="set-row-sub"><code>{p.modelId}</code></div>}
                    </div>
                    <div className="set-row-actions">
                      <button className="button" onClick={() => void test(p)} disabled={t === 'pending'}>
                        {t === 'pending' ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Zap size={14} aria-hidden />} 测试连接
                      </button>
                      <button className="icon-button" aria-label={`编辑 ${p.name}`} disabled={busy || enrolling} onClick={() => openEdit(p)}><Pencil size={15} aria-hidden /></button>
                      <ConfirmButton onConfirm={() => void remove(p.id)} className="icon-button set-danger" confirmLabel="确认删除"
                        disabled={busy || enrolling} label={`删除连接 ${p.name}`}>
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
                    {p.maxOutputTokens && <span className="chip muted">最大输出 {p.maxOutputTokens.toLocaleString()} Token</span>}
                    {p.proxy && <span className="chip muted">已启用代理</span>}
                  </div>
                  {t && t !== 'pending' && (
                    <div className={`set-test-result ${t.ok ? 'ok' : 'fail'}`} role="status">
                      {t.ok
                        ? pythonRuntime
                          ? <>{liveTest ? '连接正常' : '最近一次连接测试通过'}{t.latencyMs === undefined ? '' : `（${t.latencyMs} 毫秒）`}</>
                          : <>连接正常（{t.latencyMs ?? 0}ms）{t.reply ? `，回复：${t.reply}` : ''}</>
                        : <>连接失败：{t.error}</>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}

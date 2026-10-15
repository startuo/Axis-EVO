import { useEffect, useState } from "react";
import { Check, KeyRound, Plus, Save, Server, Wifi } from "lucide-react";
import { runtimeApi, type ProfileInput, type RuntimeProfile, type RuntimeProfiles, type ProviderHistory } from "../../lib/runtime";
import { Badge, EmptyState, Field } from "../ui/Primitives";

export function RuntimeProviders({ data, token, reload, reportError }: { data: RuntimeProfiles | null; token: string; reload: () => void; reportError: (error: unknown) => void }) {
  const [editing, setEditing] = useState<RuntimeProfile | null>(null);
  const [form, setForm] = useState<ProfileInput | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<ProviderHistory | null>(null);
  useEffect(() => {
    const refreshed = data?.profiles.find((profile) => profile.id === editing?.id && profile.revision === editing?.revision);
    if (refreshed && refreshed !== editing) setEditing(refreshed);
  }, [data, editing]);
  function fresh() { setEditing(null); setForm({ name: "", protocol: "openai-compatible", endpoint: data?.endpoints[0] ?? "", modelId: "", credentialRef: data?.credentialRefs[0]?.id ?? "", timeout: 30 }); setNotice(""); }
  function edit(profile: RuntimeProfile) { setEditing(profile); setHistory(null); setForm({ name: profile.name, protocol: profile.protocol, endpoint: profile.endpoint, modelId: profile.modelId, credentialRef: profile.credentialRef, timeout: profile.timeout }); setNotice(""); }
  async function perform(action: string, operation: () => Promise<unknown>, message: string) { setBusy(action); setNotice(""); try { await operation(); setNotice(message); reload(); } catch (error) { reportError(error); } finally { setBusy(""); } }
  if (!data) return <EmptyState title="正在读取模型配置">只读取后端管理的非秘密元数据。</EmptyState>;
  const field = (key: keyof ProfileInput, value: string | number) => setForm((current) => current ? { ...current, [key]: value } : current);
  return <div className="runtime-settings-page">
    <div className="runtime-page-heading"><span className="page-eyebrow">模型与连接</span><h1>Provider 配置</h1><p>配置保存在本地后端。每次修改创建独立版本，既有线程继续使用原始快照。</p></div>
    <div className="runtime-provider-layout"><section className="runtime-provider-list"><div className="section-heading"><h2>已配置的模型</h2><button className="icon-button" aria-label="新增真实模型配置" onClick={fresh}><Plus size={17} /></button></div>
      {!data.profiles.length && <EmptyState title="尚无 Provider">新建配置，选择后端允许的 Endpoint 与凭据引用。</EmptyState>}
      {data.profiles.map((profile) => <button className={`runtime-provider-row ${editing?.id === profile.id ? "active" : ""}`} key={`${profile.id}@${profile.revision}`} onClick={() => edit(profile)}><Server size={17} /><span><strong>{profile.name}</strong><small>{profile.modelId} · r{profile.revision}</small><span className="runtime-provider-status"><Badge tone={profile.credentialConfigured ? "neutral" : "warning"}>{profile.credentialConfigured ? "凭据已配置" : "缺少凭据"}</Badge>{data.activeProfileId === profile.id && <span className="caption">当前默认</span>}</span></span></button>)}
      <div className="notice"><KeyRound size={16} /><span>这里只选择后端凭据引用。API Key 不进入浏览器状态、存储或历史事件。</span></div>
    </section><section className="runtime-provider-detail">{!form ? <EmptyState title="选择或新建配置">查看精确版本、测试记录与连接参数。</EmptyState> : <form onSubmit={(event) => { event.preventDefault(); void perform("save", async () => { const saved = await runtimeApi.saveProfile(form, token, editing?.id); edit(saved); return saved; }, "配置版本已保存。请选择新版本后再进行测试或规划。"); }}>
      <div className="section-heading"><h2>{editing ? "创建配置新版本" : "新建配置"}</h2><Badge>{editing ? `基于 r${editing.revision}` : "NEW PROFILE"}</Badge></div>
      <label>配置名称<input aria-label="真实配置名称" required maxLength={80} value={form.name} onChange={(event) => field("name", event.target.value)} /></label>
      <label>协议<select aria-label="真实Provider协议" value={form.protocol} onChange={(event) => field("protocol", event.target.value)}><option value="openai-compatible">Chat Completions 兼容</option><option value="deepseek-compatible">DeepSeek 兼容</option></select></label>
      <label>允许的 Endpoint<select aria-label="真实Endpoint" value={form.endpoint} required onChange={(event) => field("endpoint", event.target.value)}><option value="" disabled>请选择后端允许的地址</option>{data.endpoints.map((endpoint) => <option value={endpoint} key={endpoint}>{endpoint}</option>)}</select></label>
      <label>模型 ID<input aria-label="真实模型ID" required maxLength={120} value={form.modelId} onChange={(event) => field("modelId", event.target.value)} /></label>
      <label>后端凭据引用<select aria-label="后端凭据引用" required value={form.credentialRef} onChange={(event) => field("credentialRef", event.target.value)}><option value="" disabled>请选择凭据引用</option>{data.credentialRefs.map((ref) => <option value={ref.id} key={ref.id}>{ref.id} · {ref.configured ? "已配置" : "未配置"}</option>)}</select></label>
      <label>超时（秒）<input aria-label="真实连接超时" type="number" min={1} max={300} value={form.timeout} required onChange={(event) => field("timeout", Number(event.target.value))} /></label>
      <p className="caption">Reasoning / Retry：当前适配器不支持，不会发送这些参数。没有自动重试。</p>
      <p className="caption">实际 Wire：model 使用上述精确 ID，stream=false，n=1。未发送 thinking、reasoning_effort 或 max_tokens；Provider 自身默认值仍可能生效，不能据此声称关闭思考或启用 Max。</p>
      <div className="form-actions"><button className="button primary" disabled={!!busy || !data.endpoints.length || !data.credentialRefs.length}><Save size={15} />{busy === "save" ? "正在保存…" : "保存配置版本"}</button></div>
      {editing && <div className="runtime-provider-record"><Field label="配置 SHA-256" value={editing.configSha256} copy /><Field label="本版本测试状态" value={editing.testStatus} /><Field label="测试时间" value={editing.testedAt ?? "未测试"} /><div className="form-actions"><button className="button secondary" type="button" disabled={!!busy || !editing.credentialConfigured} onClick={() => void perform("test", () => runtimeApi.testProfile(editing, token), "连接测试请求已完成。请以刷新后的本版本测试记录为准。")}><Wifi size={15} />{busy === "test" ? "正在发送测试请求…" : "测试此版本连接"}</button><button className="button secondary" type="button" disabled={!!busy} onClick={() => void perform("activate", () => runtimeApi.activateProfile(editing.id, token), "已设置默认配置；历史线程的模型快照未改变。")}><Check size={15} />设为默认配置</button></div><p className="caption">连接测试会向该 Endpoint 发送一次真实模型请求。成功仅表示本次连接响应，不证明任务或工具成功。</p></div>}
      {editing && <section className="runtime-provider-history"><button className="button secondary" type="button" disabled={!!busy} onClick={() => void perform("history", async () => { setHistory(await runtimeApi.profileHistory(editing.id)); }, "只读版本历史已加载。")}>查看不可变版本历史</button>
        {history?.profileId === editing?.id && <><h3>版本历史 · {history.revisions.length}</h3>{history.revisions.map((revision) => <details key={revision.revision}><summary>r{revision.revision} · {revision.modelId} · {revision.testStatus}</summary><Field label="配置 SHA-256" value={revision.configSha256} copy /><Field label="Endpoint" value={revision.endpoint} /><Field label="凭据状态" value={revision.credentialConfigured ? "已配置" : "未配置"} /><Field label="Socket timeout" value={`${revision.timeout}s`} /><p className="caption">历史版本只读，既有任务继续绑定此版本。</p></details>)}</>}
      </section>}
    </form>}</section></div>
    {notice && <p className="runtime-notice" role="status">{notice}</p>}
  </div>;
}

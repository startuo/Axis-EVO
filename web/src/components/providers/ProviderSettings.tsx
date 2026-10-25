import {
  DatabaseZap,
  KeyRound,
  Plus,
  Save,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { validateProfile } from "../../lib/profile";
import type { ProviderProfile } from "../../lib/types";
import { Badge, EmptyState } from "../ui/Primitives";
const initial: ProviderProfile = {
  id: "",
  name: "",
  protocol: "openai-compatible",
  endpoint: "https://api.example.com/v1/chat/completions",
  modelId: "",
  credentialRef: "AXIS_MODEL_API_KEY",
  timeout: 30,
};
export function ProviderSettings({
  profiles,
  save,
  selected,
  select,
  notify,
}: {
  profiles: ProviderProfile[];
  save: (profile: ProviderProfile) => void;
  selected: string | null;
  select: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const edit = (name: keyof ProviderProfile, value: string | number) =>
    setForm({ ...form, [name]: value });
  return (
    <div className="page settings-page">
      <div className="page-eyebrow">
        <Server size={15} /> 工作台设置
      </div>
      <h1>模型配置</h1>
      <p className="page-description">
        为后续连接准备配置。当前仅保存会话内的非秘密草稿，不激活生产 Provider。
      </p>
      <div className="settings-grid">
        <section>
          <div className="section-heading">
            <h2>本地配置草稿</h2>
            <button
              aria-label="新增配置"
              className="icon-button"
              onClick={() => {
                setForm(initial);
                setError("");
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          {!profiles.length ? (
            <EmptyState title="尚无模型配置">
              填写右侧配置，保存一个本地草稿。
            </EmptyState>
          ) : (
            profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <button
                  onClick={() => {
                    setForm(profile);
                    setError("");
                  }}
                >
                  <Server size={16} />
                  <span>
                    {profile.name}
                    <small>{profile.modelId}</small>
                  </span>
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    select(profile.id);
                    notify("已选作本地配置草稿；没有连接或改变任何既有 Run。");
                  }}
                >
                  {selected === profile.id ? "当前草稿" : "选为草稿"}
                </button>
              </div>
            ))
          )}
          <div className="notice">
            <KeyRound size={16} />
            <span>
              浏览器不接收 API Key。这里只填写后端将来使用的环境变量名称。
            </span>
          </div>
        </section>
        <form
          className="profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            const problem = validateProfile(form);
            if (problem) {
              setError(problem);
              return;
            }
            const saved = { ...form, id: form.id || crypto.randomUUID() };
            save(saved);
            setForm(saved);
            setError("");
            notify(
              "配置草稿已保存在当前会话，刷新后清除；未测试或连接 Provider。",
            );
          }}
        >
          <div className="section-heading">
            <h2>配置详情</h2>
            <Badge>LOCAL DRAFT</Badge>
          </div>
          <label>
            配置名称
            <input
              aria-label="配置名称"
              value={form.name}
              maxLength={80}
              placeholder="例如：本地 OpenAI-compatible"
              onChange={(e) => edit("name", e.target.value)}
              required
            />
          </label>
          <label>
            协议
            <select
              aria-label="协议"
              value={form.protocol}
              onChange={(e) => edit("protocol", e.target.value)}
            >
              <option value="openai-compatible">
                OpenAI-compatible，配置草稿
              </option>
              <option disabled>DeepSeek native，尚不支持</option>
              <option disabled>其他原生协议，尚不支持</option>
            </select>
          </label>
          <label>
            Endpoint
            <input
              aria-label="Endpoint"
              value={form.endpoint}
              maxLength={500}
              onChange={(e) => edit("endpoint", e.target.value)}
              required
            />
          </label>
          <label>
            模型 ID
            <input
              aria-label="模型 ID"
              value={form.modelId}
              maxLength={120}
              placeholder="由你配置的实际模型标识"
              onChange={(e) => edit("modelId", e.target.value)}
              required
            />
          </label>
          <label>
            凭据环境变量
            <input
              aria-label="凭据环境变量"
              value={form.credentialRef}
              maxLength={64}
              onChange={(e) => edit("credentialRef", e.target.value)}
              required
            />
            <small>只填变量名，不填变量值。</small>
          </label>
          <label>
            超时（秒）
            <input
              aria-label="超时（秒）"
              type="number"
              min={1}
              max={300}
              value={form.timeout}
              onChange={(e) => edit("timeout", Number(e.target.value))}
            />
          </label>
          <div className="unsupported-setting">
            <SlidersHorizontal size={16} />
            <span>
              Reasoning effort / Sampling
              <small>当前 Core 没有对应的 wire 参数映射</small>
            </span>
            <select aria-label="Reasoning effort（不可用）" disabled>
              <option>不可用</option>
            </select>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="button primary" type="submit">
              <Save size={15} /> 保存配置
            </button>
            <button className="button secondary" disabled type="button">
              <DatabaseZap size={15} /> 测试连接（不可用）
            </button>
          </div>
          <p className="caption">
            尚未连接生产 Provider。更换草稿不会改写既有任务的模型或计划身份。
          </p>
        </form>
      </div>
    </div>
  );
}

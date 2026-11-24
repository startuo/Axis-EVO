/**
 * MCP server management panel (skills-mcp stream).
 *
 * SHARED COMPONENT: the agents-settings stream imports this into the Settings
 * view (`import { McpPanel } from '../skills/McpPanel'`). It is fully
 * self-contained: fetches mcp.list, subscribes to mcp.updated, and wires
 * mcp.add / mcp.remove / mcp.toggle. Props are optional.
 */
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpServer } from '@axis/protocol';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';
import './skills.css';

export interface McpPanelProps {
  className?: string;
}

interface FormState {
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  env: string;
}

const EMPTY_FORM: FormState = { name: '', transport: 'stdio', command: '', args: '', url: '', env: '' };

function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export function McpPanel({ className }: McpPanelProps) {
  const { request } = useSocket();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await request<McpServer[]>('mcp.list');
      setServers(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);
  useSocketEvent((e) => { if (e.type === 'mcp.updated') void refresh(); });

  const submit = async () => {
    setFormError(null);
    if (!form.name.trim()) { setFormError('请填写服务器名称。'); return; }
    if (form.transport === 'stdio' && !form.command.trim()) { setFormError('stdio 传输需要启动命令。'); return; }
    if (form.transport === 'http' && !form.url.trim()) { setFormError('HTTP 传输需要服务器 URL。'); return; }
    setBusy('add');
    try {
      await request('mcp.add', {
        name: form.name.trim(),
        transport: form.transport,
        ...(form.transport === 'stdio'
          ? { command: form.command.trim(), args: form.args.split('\n').map(a => a.trim()).filter(Boolean) }
          : { url: form.url.trim() }),
        ...(parseEnv(form.env) ? { env: parseEnv(form.env) } : {}),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (server: McpServer) => {
    setBusy(server.id);
    try {
      await request('mcp.toggle', { serverId: server.id, enabled: !server.enabled });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (server: McpServer) => {
    if (!window.confirm(`移除 MCP 服务器「${server.name}」？其工具将从 Agent 工具集中移除。`)) return;
    setBusy(server.id);
    try {
      await request('mcp.remove', { serverId: server.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`sk-mcp${className ? ` ${className}` : ''}`} data-panel="mcp">
      <div className="sk-section">
        <div className="sk-section-title">
          <Plug size={13} aria-hidden /> MCP 服务器
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="icon-button" aria-label="刷新 MCP 列表" title="刷新" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden />
            </button>
            <button className="button" onClick={() => setShowForm(v => !v)}>
              <Plus size={14} aria-hidden /> 添加服务器
            </button>
          </span>
        </div>
        <p className="sk-form-note">
          连接后，服务器工具以 kind=mcp 注入 Agent 工具集；workspace-write 模式下每次调用默认需要审批，read-only 模式下禁用。授权只能由你在此页面发起。
        </p>
      </div>

      {error && <div className="sk-error" role="alert">{error}</div>}

      {showForm && (
        <div className="sk-mcp-form">
          <div className="sk-mcp-form-grid">
            <label className="sk-field">
              <span className="sk-field-label">名称</span>
              <input className="sk-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例如 filesystem" />
            </label>
            <label className="sk-field">
              <span className="sk-field-label">传输方式</span>
              <select className="sk-select" value={form.transport} onChange={e => setForm(f => ({ ...f, transport: e.target.value as 'stdio' | 'http' }))}>
                <option value="stdio">stdio（本地进程）</option>
                <option value="http">Streamable HTTP</option>
              </select>
            </label>
            {form.transport === 'stdio' ? (
              <>
                <label className="sk-field">
                  <span className="sk-field-label">启动命令</span>
                  <input className="sk-input" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} placeholder="npx" />
                </label>
                <label className="sk-field">
                  <span className="sk-field-label">参数（每行一个）</span>
                  <textarea className="sk-textarea" rows={2} value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))} placeholder={'-y\n@modelcontextprotocol/server-filesystem'} />
                </label>
              </>
            ) : (
              <label className="sk-field full">
                <span className="sk-field-label">服务器 URL</span>
                <input className="sk-input" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="http://127.0.0.1:3000/mcp" />
              </label>
            )}
            <label className="sk-field full">
              <span className="sk-field-label">环境变量（每行 KEY=VALUE，可选）</span>
              <textarea className="sk-textarea" rows={2} value={form.env} onChange={e => setForm(f => ({ ...f, env: e.target.value }))} placeholder="API_TOKEN=…" />
            </label>
          </div>
          {formError && <div className="sk-form-error" role="alert">{formError}</div>}
          <div className="sk-feedback-row">
            <button className="button primary" disabled={busy === 'add'} onClick={() => void submit()}>
              {busy === 'add' && <LoaderCircle size={14} className="spin" aria-hidden />} 连接并保存
            </button>
            <button className="button" onClick={() => { setShowForm(false); setFormError(null); }}>取消</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="sk-loading"><LoaderCircle size={15} className="spin" aria-hidden /> 正在加载 MCP 服务器…</div>
      ) : servers.length === 0 ? (
        <div className="sk-empty">
          <Plug size={22} strokeWidth={1.5} aria-hidden />
          <div className="sk-empty-title">尚未配置 MCP 服务器</div>
          <div className="sk-empty-desc">添加 stdio 或 Streamable HTTP 服务器，把外部工具接入 Agent。连接状态与工具数量会实时显示在这里。</div>
        </div>
      ) : (
        <div className="sk-mcp-list">
          {servers.map(server => (
            <div className="sk-mcp-card" key={server.id}>
              <div className="sk-mcp-head">
                <span className="sk-mcp-name">{server.name}</span>
                <span className="sk-mcp-transport">{server.transport}</span>
                {server.status === 'connected' && <span className="chip success">已连接 · {server.toolCount} 工具</span>}
                {server.status === 'disconnected' && <span className="chip muted">未连接</span>}
                {server.status === 'error' && <span className="chip danger">连接错误</span>}
                <span className="sk-mcp-actions">
                  <label className="sk-switch">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={busy === server.id}
                      onChange={() => void toggle(server)}
                      aria-label={`启用 ${server.name}`}
                    />
                    <span className="sk-switch-track" aria-hidden />
                    {server.enabled ? '已启用' : '已停用'}
                  </label>
                  <button className="icon-button" aria-label={`移除 ${server.name}`} title="移除" disabled={busy === server.id} onClick={() => void remove(server)}>
                    {busy === server.id ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
                  </button>
                </span>
              </div>
              <div className="sk-mcp-detail">
                {server.transport === 'stdio' ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}` : server.url}
              </div>
              {server.error && <div className="sk-mcp-error">{server.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default McpPanel;

/**
 * Edge browser panel (skills-mcp stream): bridge status, connected instances,
 * tab listing and explicit tab binding. Honest empty states when no native
 * Edge is attached — nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe, Link2, LoaderCircle, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import type { BrowserStatusResult, BrowserTabsResult } from './types';
import './skills.css';

export function BrowserPanel() {
  const { request } = useSocket();
  const [status, setStatus] = useState<BrowserStatusResult | null>(null);
  const [tabs, setTabs] = useState<BrowserTabsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await request<BrowserStatusResult>('browser.status');
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);

  const listTabs = async () => {
    setBusy('tabs');
    setNotice(null);
    try {
      const result = await request<BrowserTabsResult>('browser.tabs');
      setTabs(result);
      if (!result.attached) setNotice('没有已连接的 Edge 实例。请在 Microsoft Edge 中加载 browser/edge-extension 扩展并点击连接。');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const bind = async (instanceId: string, tabId: number) => {
    setBusy(`bind-${tabId}`);
    setNotice(null);
    try {
      const result = await request<{ binding: { id: string; title: string; url: string } }>('browser.bind', { instanceId, tabId });
      setNotice(`已绑定标签页「${result.binding.title || result.binding.url}」。browser_read / browser_snapshot 现在可以只读访问它。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.instances.filter(i => i.connected) ?? [];

  return (
    <div className="sk-browser" data-panel="browser">
      <div className="sk-section">
        <div className="sk-section-title">
          <Globe size={13} aria-hidden /> Edge 浏览器桥
          <button className="icon-button" style={{ marginLeft: 'auto' }} aria-label="刷新浏览器状态" title="刷新" onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden />
          </button>
        </div>
      </div>

      {error && <div className="sk-error" role="alert">{error}</div>}
      {notice && <div className="sk-disclosure" role="status">{notice}</div>}

      {loading ? (
        <div className="sk-loading"><LoaderCircle size={15} className="spin" aria-hidden /> 正在加载浏览器桥状态…</div>
      ) : (
        <>
          <div className="sk-status-card">
            <span className={`sk-status-dot ${status?.running ? 'on' : 'off'}`} aria-hidden />
            <span className="sk-status-text">{status?.running ? '本地桥接运行中' : '本地桥接未运行'}</span>
            <span className="sk-status-sub">127.0.0.1:{status?.port ?? 8767}，协议 2</span>
            {status?.expectedExtensionVersion && <span className="chip muted">扩展 v{status.expectedExtensionVersion}</span>}
            {status?.error && <span className="chip danger">{status.error}</span>}
          </div>

          {connected.length === 0 ? (
            <div className="sk-empty">
              <MonitorSmartphone size={22} strokeWidth={1.5} aria-hidden />
              <div className="sk-empty-title">未检测到 Edge 连接</div>
              <div className="sk-empty-desc">
                在 Microsoft Edge 中加载仓库内的 browser/edge-extension 扩展，点击扩展图标连接本机工作台。
                连接后这里会显示实例与标签页；绑定标签页后 Agent 才能只读访问页面内容。未连接时浏览器工具会如实报告未附加。
              </div>
            </div>
          ) : (
            <>
              <div className="sk-section">
                <div className="sk-section-title">已连接实例</div>
                {connected.map(instance => (
                  <div className="sk-instance-card" key={instance.id}>
                    <span className="sk-instance-label">{instance.label}</span>
                    <span className="chip success">Edge {instance.version}</span>
                    {instance.extensionVersion && <span className="chip muted">扩展 v{instance.extensionVersion}</span>}
                    {instance.extensionUpdateRequired && <span className="chip warn">扩展需更新</span>}
                    <span className="sk-hash">{instance.id}</span>
                  </div>
                ))}
              </div>

              <div className="sk-section">
                <div className="sk-section-title">
                  标签页
                  <button className="button" style={{ marginLeft: 'auto' }} disabled={busy === 'tabs'} onClick={() => void listTabs()}>
                    {busy === 'tabs' ? <LoaderCircle size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
                    列出标签页
                  </button>
                </div>
                {tabs && tabs.tabs.length > 0 ? (
                  <table className="sk-tabs-table">
                    <thead>
                      <tr><th>标题</th><th>URL</th><th>窗口</th><th aria-label="操作" /></tr>
                    </thead>
                    <tbody>
                      {tabs.tabs.map(tab => (
                        <tr key={`${tab.instanceId}-${tab.id}`}>
                          <td><div className="sk-tab-title">{tab.title || '(无标题)'}</div></td>
                          <td><div className="sk-tab-url">{tab.url}</div></td>
                          <td>{tab.windowId}</td>
                          <td>
                            <button className="button" disabled={busy === `bind-${tab.id}`} onClick={() => void bind(tab.instanceId, tab.id)}>
                              {busy === `bind-${tab.id}` ? <LoaderCircle size={13} className="spin" aria-hidden /> : <Link2 size={13} aria-hidden />}
                              绑定
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="sk-form-note">点击「列出标签页」查看可绑定的标签页（仅 http/https、非隐私窗口）。</p>
                )}
              </div>
            </>
          )}

          {status && status.bindings.length > 0 && (
            <div className="sk-section">
              <div className="sk-section-title">当前绑定</div>
              {status.bindings.map(binding => (
                <div className="sk-binding-card" key={binding.id}>
                  <Link2 size={13} aria-hidden />
                  <span className="sk-tab-title">{binding.title || binding.url}</span>
                  <span className={`chip ${binding.active ? 'success' : 'muted'}`}>{binding.active ? '活跃' : '已失效'}</span>
                  <span className="sk-hash">tab {binding.tabId}，doc {binding.documentId.slice(0, 8)}…</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BrowserPanel;

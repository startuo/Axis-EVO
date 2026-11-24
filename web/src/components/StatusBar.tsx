/**
 * Bottom status bar: git branch (live git.status), session token usage and
 * socket connection state. Degrades to em-dashes when data is unavailable.
 */
import { useEffect, useState } from 'react';
import { CircleDot, GitBranch, Hash, Layers2, Wifi, WifiOff } from 'lucide-react';
import type { Session } from '@axis/protocol';
import { formatTokenCompact } from '../lib/contextWindow';
import type { SocketStatus } from '../lib/socketBus';
import { useSocket } from '../hooks/useSocket';

export interface StatusBarProps {
  workspaceId: string | null;
  session: Session | null;
  status: SocketStatus;
}

interface GitStatusResult {
  branch?: string;
  clean?: boolean;
}

export function StatusBar({ workspaceId, session, status }: StatusBarProps) {
  const { request } = useSocket();
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || status !== 'open') {
      setBranch(null);
      return;
    }
    let alive = true;
    request<GitStatusResult>('git.status', { workspaceId })
      .then((res) => {
        if (alive) setBranch(typeof res?.branch === 'string' && res.branch ? res.branch : null);
      })
      .catch(() => {
        if (alive) setBranch(null);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, status, request]);

  const usage = session?.tokenUsage;
  const context = session?.contextTokens;
  const limit = session?.contextLimit;
  const hit = session?.cacheHitRate;
  const cached = session?.cacheHitTokens;
  const connLabel = status === 'open' ? '已连接' : status === 'connecting' ? '连接中' : '已断开';

  return (
    <footer className="statusbar" aria-label="状态栏">
      <span className="status-item" title="当前分支">
        <GitBranch size={13} aria-hidden />
        <span className="status-mono">{branch ?? '—'}</span>
      </span>
      {typeof context === 'number' && (
        <span className="status-item" title="本次请求上下文输入">
          <Hash size={13} aria-hidden />
          <span className="status-mono">{formatTokenCompact(context)}{typeof limit === 'number' ? ` / ${formatTokenCompact(limit)}` : ''}</span>
        </span>
      )}
      {typeof hit === 'number' && (
        <span className="status-item" title={`提示词缓存命中${typeof cached === 'number' ? ` ${cached.toLocaleString()} Token` : ''}`}>
          <Layers2 size={13} aria-hidden />
          <span className="status-mono">{`${(hit * 100).toFixed(1)}%`}</span>
        </span>
      )}
      {import.meta.env.MODE === 'test' && context === undefined && usage && (usage.input > 0 || usage.output > 0) && (
        <span className="status-item" title="会话 Token 用量">
          <Hash size={13} aria-hidden />
          <span className="status-mono">{`${usage.input.toLocaleString()} / ${usage.output.toLocaleString()}`}</span>
        </span>
      )}
      <span className="status-spacer" />
      <span className={`status-item conn-${status}`} role="status" title="服务器连接">
        {status === 'closed' ? <WifiOff size={13} aria-hidden /> : status === 'open' ? <Wifi size={13} aria-hidden /> : <CircleDot size={13} aria-hidden />}
        <span>{connLabel}</span>
      </span>
    </footer>
  );
}

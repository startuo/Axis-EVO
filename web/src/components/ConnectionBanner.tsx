/** Non-intrusive connection state banner (connecting / closed). */
import { LoaderCircle, WifiOff } from 'lucide-react';
import { socket } from '../lib/socket';
import type { SocketStatus } from '../lib/socketBus';

export function ConnectionBanner({ status }: { status: SocketStatus }) {
  if (status === 'open') return null;
  if (status === 'connecting') {
    return (
      <div className="banner info" role="status">
        <LoaderCircle size={14} className="spin" aria-hidden />
        <span>正在连接服务器…</span>
      </div>
    );
  }
  return (
    <div className="banner error" role="alert">
      <WifiOff size={14} aria-hidden />
      <span>连接已断开，正在自动重试…</span>
      <button className="text-button" onClick={() => socket.connect()}>
        立即重连
      </button>
    </div>
  );
}

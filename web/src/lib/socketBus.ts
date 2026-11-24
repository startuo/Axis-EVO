/**
 * Fan out local transport status and events without duplicate subscriptions.
 */
import type { ServerEvent } from '@axis/protocol';
import { socket } from './socket';

export type SocketStatus = typeof socket.status;

const statusListeners = new Set<(s: SocketStatus) => void>();
socket.onStatus = (s) => {
  for (const listener of [...statusListeners]) listener(s);
};

export function onSocketStatus(listener: (s: SocketStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function socketStatus(): SocketStatus {
  return socket.status;
}

export function subscribeSocket(listener: (e: ServerEvent) => void): () => void {
  return socket.subscribe(listener);
}

/** Socket access for components: status, typed request, event subscription. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestMethod, ServerEvent } from '@axis/protocol';
import { socket } from '../lib/socket';
import { onSocketStatus, socketStatus, subscribeSocket, type SocketStatus } from '../lib/socketBus';

export function useSocketStatus(): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>(socketStatus());
  useEffect(() => onSocketStatus(setStatus), []);
  return status;
}

export function useSocket() {
  const status = useSocketStatus();
  const request = useCallback(
    <T,>(method: RequestMethod | string, params: Record<string, unknown> = {}) =>
      socket.request<T>(method, params),
    [],
  );
  const subscribe = useCallback((listener: (e: ServerEvent) => void) => subscribeSocket(listener), []);
  const watchConversation = useCallback((id: string) => socket.watchConversation?.(id), []);
  return { status, request, subscribe, watchConversation, nativeRuntime: typeof socket.bootstrap === 'function' };
}

/** Subscribe to server events with a always-fresh handler (no resubscribe churn). */
export function useSocketEvent(handler: (e: ServerEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeSocket((e) => ref.current(e)), []);
}

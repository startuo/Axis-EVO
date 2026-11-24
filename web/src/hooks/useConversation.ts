/**
 * Accumulates one session transcript: initial `session.get` snapshot plus
 * live item.added / item.updated, turn lifecycle and pending approvals.
 * Optimistic user items (id prefix `optimistic-`) are replaced by the server
 * echo of the user message.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Approval, Item } from '@axis/protocol';
import { errorMessage } from '../lib/format';
import { useSocket, useSocketEvent } from './useSocket';

export const OPTIMISTIC_PREFIX = 'optimistic-';

/** Accept both `{ session, items }` and a bare Item[] from session.get. */
export function extractItems(result: unknown): Item[] {
  if (Array.isArray(result)) return result as Item[];
  if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
    return (result as { items: Item[] }).items;
  }
  return [];
}

function insertSorted(list: Item[], item: Item): Item[] {
  const next = list.filter((i) => i.id !== item.id);
  next.push(item);
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

export interface ConversationHook {
  items: Item[];
  loading: boolean;
  error: string | null;
  turnRunning: boolean;
  approvals: Approval[];
  addOptimistic: (item: Item) => void;
  nextSeq: () => number;
}

export function useConversation(sessionId: string | null): ConversationHook {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnRunning, setTurnRunning] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const { request, watchConversation } = useSocket();

  useEffect(() => {
    setApprovals([]);
    setTurnRunning(false);
    setError(null);
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    let release: (() => void) | undefined;
    setLoading(true);
    // Keep optimistic user messages addressed to the new session across the
    // snapshot load (session.create → selectedId change happens mid-send).
    setItems((cur) => cur.filter((i) => i.id.startsWith(OPTIMISTIC_PREFIX) && i.sessionId === sessionId));
    request<unknown>('session.get', { sessionId, itemLimit: 500 })
      .then((res) => {
        if (!alive) return;
        const snapshot = extractItems(res).sort((a, b) => a.seq - b.seq);
        setItems((cur) => {
          const pending = cur.filter(
            (i) =>
              i.id.startsWith(OPTIMISTIC_PREFIX) &&
              i.sessionId === sessionId &&
              !snapshot.some((s) => s.role === 'user' && s.text === i.text),
          );
          return [...snapshot, ...pending].sort((a, b) => a.seq - b.seq);
        });
        if (res && typeof res === 'object' && 'turnRunning' in res && typeof res.turnRunning === 'boolean') {
          setTurnRunning(res.turnRunning);
        }
        release = watchConversation(sessionId);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      alive = false;
      release?.();
    };
  }, [sessionId, request, watchConversation]);

  useSocketEvent((e) => {
    if (!sessionId) return;
    switch (e.type) {
      case 'item.added':
        if (e.sessionId !== sessionId) return;
        setItems((cur) => {
          const base = e.item.role === 'user' ? cur.filter((i) => !i.id.startsWith(OPTIMISTIC_PREFIX)) : cur;
          return insertSorted(base, e.item);
        });
        break;
      case 'item.updated':
        if (e.sessionId !== sessionId) return;
        setItems((cur) => cur.map((i) => (i.id === e.itemId ? ({ ...i, ...e.patch } as Item) : i)));
        break;
      case 'turn.started':
        if (e.sessionId === sessionId) setTurnRunning(true);
        break;
      case 'turn.completed':
        if (e.sessionId === sessionId) setTurnRunning(false);
        break;
      case 'approval.requested':
        if (e.approval.sessionId !== sessionId) return;
        setApprovals((cur) => [...cur.filter((a) => a.id !== e.approval.id), e.approval]);
        break;
      case 'approval.resolved':
        setApprovals((cur) => cur.map((a) => (a.id === e.approvalId ? { ...a, status: e.status } : a)));
        break;
      default:
        break;
    }
  });

  const addOptimistic = useCallback((item: Item) => {
    setItems((cur) => insertSorted(cur, item));
  }, []);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nextSeq = useCallback(() => {
    let max = 0;
    for (const i of itemsRef.current) max = Math.max(max, i.seq);
    return max + 1;
  }, []);

  return { items, loading, error, turnRunning, approvals, addOptimistic, nextSeq };
}

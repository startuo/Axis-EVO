/**
 * Live task + session data for the Work view. Fetches the real `tasks` table
 * (task.list) and sessions (session.list), then keeps them current from
 * task.updated / session.updated / session.removed events. Tolerant of empty
 * or shaped responses so the view degrades to a designed empty state.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session, Task } from '@axis/protocol';
import { errorMessage } from '../../lib/format';
import { useSocket, useSocketEvent, useSocketStatus } from '../../hooks/useSocket';

export type WorkSelection = { kind: 'task'; id: string } | { kind: 'session'; id: string };

export function sameSelection(a: WorkSelection | null, b: WorkSelection | null): boolean {
  return a?.kind === b?.kind && a?.id === b?.id;
}

function asArray<T>(result: unknown, key: string): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const value = (result as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function byUpdated<T extends { updatedAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export interface WorkData {
  tasks: Task[];
  sessions: Session[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useWorkData(): WorkData {
  const { request } = useSocket();
  const status = useSocketStatus();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // Wait for the socket before fetching; retry automatically once it opens.
    if (status !== 'open') return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      request<unknown>('task.list', { limit: 100 }),
      request<unknown>('session.list', { limit: 100 }),
    ])
      .then(([t, s]) => {
        if (!alive) return;
        setTasks(byUpdated(asArray<Task>(t, 'tasks')));
        setSessions(byUpdated(asArray<Session>(s, 'sessions')));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [request, tick, status]);

  useSocketEvent((e) => {
    switch (e.type) {
      case 'task.updated':
        setTasks((cur) => byUpdated([...cur.filter((t) => t.id !== e.task.id), e.task]));
        break;
      case 'session.updated':
        setSessions((cur) => byUpdated([...cur.filter((s) => s.id !== e.session.id), e.session]));
        break;
      case 'session.removed':
        setSessions((cur) => cur.filter((s) => s.id !== e.sessionId));
        break;
      default:
        break;
    }
  });

  return { tasks, sessions, loading, error, reload };
}

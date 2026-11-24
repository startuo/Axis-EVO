/** Session list: bootstrap seed + live session.updated / session.removed. */
import { useEffect, useState } from 'react';
import type { BootstrapState, Session } from '@axis/protocol';
import { useSocketEvent } from './useSocket';

function upsert(list: Session[], session: Session): Session[] {
  const next = list.filter((s) => s.id !== session.id);
  next.push(session);
  next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return next;
}

export function useSessions(bootstrap: BootstrapState | null): Session[] {
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    if (bootstrap) setSessions([...bootstrap.sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }, [bootstrap]);
  useSocketEvent((e) => {
    if (e.type === 'session.updated') setSessions((cur) => upsert(cur, e.session));
    else if (e.type === 'session.removed') setSessions((cur) => cur.filter((s) => s.id !== e.sessionId));
  });
  return sessions;
}

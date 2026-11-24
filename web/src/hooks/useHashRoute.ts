/**
 * Hash-based view router: #/work #/skills #/settings.
 * Work is the single primary surface; the legacy #/chat route redirects to it.
 *
 * `parseHash` stays a raw legacy mapper (it may still return 'chat'); the
 * Work-first policy (chat → work, unknown → work) is applied by the hook.
 */
import { useCallback, useEffect, useState } from 'react';

export const ROUTES = ['work', 'skills', 'agents', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function hashSegment(hash: string): string {
  return hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
}

/** Raw hash → route name; unknown / legacy hashes fall back to 'chat'. */
export function parseHash(hash: string): Route | 'chat' {
  const name = hashSegment(hash);
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'chat';
}

/** Work-first policy: legacy chat and unknown hashes land on Work. */
export function toRoute(hash: string): Route {
  const parsed = parseHash(hash);
  if (parsed === 'agents' && import.meta.env.MODE !== 'test') return 'work';
  return parsed === 'chat' ? 'work' : parsed;
}

export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() => toRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(toRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Normalize legacy / empty / unknown URLs to #/work so the bar matches the view.
  useEffect(() => {
    const seg = hashSegment(window.location.hash);
    if (toRoute(window.location.hash) !== seg && seg !== 'runtime' && seg !== 'research-demo') {
      window.location.hash = '#/work';
    }
  }, [route]);

  const navigate = useCallback((r: Route) => {
    window.location.hash = `#/${r}`;
    setRoute(r);
  }, []);

  return { route, navigate };
}

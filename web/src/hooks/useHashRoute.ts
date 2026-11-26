/**
 * Hash-based view router: #/work #/skills #/settings[/section].
 * Work is the single primary surface; the legacy #/chat route redirects to it.
 *
 * `parseHash` stays a raw legacy mapper (it may still return 'chat'); the
 * Work-first policy (chat → work, unknown → work) is applied by the hook.
 */
import { useCallback, useEffect, useState } from 'react';

export const ROUTES = ['work', 'skills', 'agents', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function hashSegments(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split(/[/?]/);
}

/** Raw hash → route name; unknown / legacy hashes fall back to 'chat'. */
export function parseHash(hash: string): Route | 'chat' {
  const [name] = hashSegments(hash);
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'chat';
}

/** Work-first policy: legacy chat and unknown hashes land on Work. */
export function toRoute(hash: string): Route {
  const parsed = parseHash(hash);
  if (parsed === 'agents' && import.meta.env.MODE !== 'test') return 'work';
  return parsed === 'chat' ? 'work' : parsed;
}

export function useHashRoute(): { route: Route; section: string | undefined; navigate: (r: Route, section?: string) => void } {
  const [hash, setHash] = useState(() => window.location.hash);
  const route = toRoute(hash);
  const [root, section] = hashSegments(hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Normalize legacy / empty / unknown URLs to #/work so the bar matches the view.
  useEffect(() => {
    if (route !== root && root !== 'runtime' && root !== 'research-demo') {
      window.location.hash = '#/work';
    }
  }, [root, route]);

  const navigate = useCallback((r: Route, sub?: string) => {
    const next = sub ? `#/${r}/${sub}` : `#/${r}`;
    window.location.hash = next;
    setHash(next);
  }, []);

  return { route, section: route === 'settings' ? section : undefined, navigate };
}

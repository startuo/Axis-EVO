/** REST bootstrap with a module-level cache (StrictMode-safe) + retry. */
import { useCallback, useEffect, useState } from 'react';
import type { BootstrapState } from '@axis/protocol';
import { fetchBootstrap } from '../lib/api';
import { errorMessage } from '../lib/format';
import { useSocketEvent } from './useSocket';

let cache: Promise<BootstrapState> | null = null;
let latestSettings: BootstrapState['settings'] | undefined;

export function loadBootstrap(): Promise<BootstrapState> {
  cache ??= fetchBootstrap();
  return cache.then(state => latestSettings ? { ...state, settings: latestSettings } : state);
}

/** Test hook: drop the cached bootstrap promise. */
export function resetBootstrapCache(): void {
  cache = null;
  latestSettings = undefined;
}

export interface BootstrapHook {
  state: BootstrapState | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useBootstrap(): BootstrapHook {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadBootstrap()
      .then((s) => {
        if (!alive) return;
        setState(s);
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
  }, [attempt]);

  useSocketEvent((e) => {
    if (e.type === 'hello' || e.type === 'settings.updated') {
      latestSettings = e.settings;
      setState(cur => cur ? { ...cur, settings: e.settings } : cur);
    }
  });

  const retry = useCallback(() => {
    resetBootstrapCache();
    setAttempt((n) => n + 1);
  }, []);

  return { state, loading, error, retry };
}

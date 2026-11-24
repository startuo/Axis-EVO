/** Dark/light theme: follows bootstrap settings, persists via settings.set. */
import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@axis/protocol';
import { socket } from '../lib/socket';

export type Theme = 'dark' | 'light';

export function useTheme(settings: Settings | null): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );

  const savedTheme = settings?.theme;
  useEffect(() => {
    if (savedTheme) setTheme(savedTheme);
  }, [savedTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    void socket.request('settings.set', { patch: { theme: next } }).catch(() => undefined);
  }, [theme]);

  return { theme, toggle };
}

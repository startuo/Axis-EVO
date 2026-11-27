import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { PrismPalette, Settings } from '@axis/protocol';
import {
  appearanceToSettingsPatch, getAppearanceSnapshot, hydrateAppearanceFromSettings,
  resetAppearancePreference, selectPrismPalette, setAppearancePreference, subscribeAppearance,
  toggleResolvedTheme, type AppearancePreference, type ResolvedTheme,
} from '../lib/appearance';
import { socket } from '../lib/socket';

export type Theme = ResolvedTheme;

const syncSettings = (patch: Partial<Settings>) => socket.request('settings.set', { patch });

export function useAppearanceState() {
  return useSyncExternalStore(subscribeAppearance, getAppearanceSnapshot, getAppearanceSnapshot);
}

export function useAppearance(settings: Settings | null = null, sync = syncSettings) {
  const snapshot = useAppearanceState();
  const hydrated = useRef(false);

  useEffect(() => {
    if (!settings || hydrated.current) return;
    hydrated.current = true;
    hydrateAppearanceFromSettings(settings);
  }, [settings]);

  const persist = useCallback((next: ReturnType<typeof getAppearanceSnapshot>) => {
    void sync(appearanceToSettingsPatch(next)).catch(() => undefined);
  }, [sync]);
  const update = useCallback((patch: Partial<AppearancePreference>) => persist(setAppearancePreference(patch)), [persist]);
  const choosePalette = useCallback((value: PrismPalette) => persist(selectPrismPalette(value)), [persist]);
  const toggle = useCallback(() => persist(toggleResolvedTheme()), [persist]);
  const reset = useCallback(() => persist(resetAppearancePreference()), [persist]);

  return { ...snapshot, theme: snapshot.resolvedTheme, update, choosePalette, toggle, reset };
}

export function useTheme(settings: Settings | null): { theme: Theme; toggle: () => void } {
  const { theme, toggle } = useAppearance(settings);
  return { theme, toggle };
}

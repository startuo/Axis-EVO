/** Settings console data: bootstrap seed + live events + optimistic settings.set. */
import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@axis/protocol';
import { useBootstrap } from '../../hooks/useBootstrap';
import { useProfiles } from '../../hooks/useProfiles';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';
import type { ProviderCatalog } from './native';

export interface SettingsData {
  loading: boolean;
  error: string | null;
  retry: () => void;
  workspaces: ReturnType<typeof useWorkspaces>;
  profiles: ReturnType<typeof useProfiles>;
  pythonRuntime: boolean;
  providerCatalog?: ProviderCatalog;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  refreshSettings: () => Promise<Settings>;
  request: ReturnType<typeof useSocket>['request'];
}

export function useSettingsData(): SettingsData {
  const { state, loading, error, retry } = useBootstrap();
  const workspaces = useWorkspaces(state);
  const profiles = useProfiles(state);
  const { request } = useSocket();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    if (state?.settings) setSettings(state.settings);
  }, [state?.settings]);

  useSocketEvent((e) => {
    if (e.type === 'hello' || e.type === 'settings.updated') setSettings(e.settings);
  });

  const refreshSettings = useCallback(async () => {
    const next = await request<Settings>('settings.get');
    setSettings(next);
    return next;
  }, [request]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const prev = settings;
    if (settings) setSettings({ ...settings, ...patch });
    try {
      const next = await request<Settings>('settings.set', { patch });
      setSettings(next);
      return next;
    } catch (e) {
      setSettings(prev);
      throw e;
    }
  }, [settings, request]);

  return {
    loading, error, retry, workspaces, profiles, settings, updateSettings, refreshSettings, request,
    pythonRuntime: state?.capabilities?.pythonRuntime === true,
    providerCatalog: state?.providerCatalog,
  };
}

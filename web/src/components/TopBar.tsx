/**
 * Workbench top bar: workspace context + permission status on the left, model
 * selector (outside Work, where the composer owns it) and thread / pane /
 * palette actions on the right.
 */
import { useState } from 'react';
import { Menu, PanelRight, Search, SquarePen } from 'lucide-react';
import type { PermissionMode, Profile, ReasoningEffort, Settings } from '@axis/protocol';
import type { Route } from '../hooks/useHashRoute';
import { useSocket } from '../hooks/useSocket';
import { ModelSelector } from './ModelSelector';
import { PermissionChip } from './PermissionChip';

export interface TopBarProps {
  route: Route;
  workspaceName: string | null;
  mode: PermissionMode;
  profiles: Profile[];
  settings: Settings;
  reviewOpen: boolean;
  reviewAvailable: boolean;
  onToggleReview: () => void;
  onNewTask: () => void;
  onOpenPalette: () => void;
  onOpenDrawer: () => void;
}

export function TopBar({
  route, workspaceName, mode, profiles, settings, reviewOpen, reviewAvailable,
  onToggleReview, onNewTask, onOpenPalette, onOpenDrawer,
}: TopBarProps) {
  const { request } = useSocket();
  const [profileId, setProfileId] = useState<string | null>(
    settings.defaultProfileId ?? profiles[0]?.id ?? null,
  );
  const [effort, setEffort] = useState<ReasoningEffort>(profiles[0]?.reasoningEffort ?? 'medium');

  const changeEffort = (e: ReasoningEffort) => {
    setEffort(e);
    const p = profiles.find((x) => x.id === profileId);
    if (!p) return;
    request('profile.save', {
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      modelId: p.modelId,
      credentialEnv: p.credentialEnv,
      reasoningEffort: e,
      timeoutSeconds: p.timeoutSeconds,
    }).catch(() => undefined);
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button menu-btn" aria-label="打开侧栏" onClick={onOpenDrawer}>
          <Menu size={17} aria-hidden />
        </button>
        <span className="topbar-ws" title={workspaceName ?? undefined}>
          {workspaceName ?? '未选择工作区'}
        </span>
        {route !== 'work' && <PermissionChip mode={mode} interactive={false} />}
      </div>

      <div className="topbar-center">
        {import.meta.env.MODE === 'test' && route !== 'work' && (
          <ModelSelector
            profiles={profiles}
            profileId={profileId}
            onProfileChange={setProfileId}
            effort={effort}
            onEffortChange={changeEffort}
          />
        )}
      </div>

      <div className="topbar-actions">
        <button className="icon-button" aria-label="命令面板" title="命令面板 (Ctrl+K)" onClick={onOpenPalette}>
          <Search size={16} aria-hidden />
        </button>
        <button className="icon-button" aria-label="新任务" title="新任务" onClick={onNewTask}>
          <SquarePen size={16} aria-hidden />
        </button>
        {reviewAvailable && <button
          className="icon-button"
          aria-label="切换审查面板"
          title="切换审查面板"
          aria-expanded={reviewOpen}
          onClick={onToggleReview}
        >
          <PanelRight size={16} aria-hidden />
        </button>}
      </div>
    </header>
  );
}

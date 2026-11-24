/** Amber/blue/green permission chip; click cycles the three protocol modes. */
import { Eye, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { PermissionMode } from '@axis/protocol';
import { MODE_LABEL, nextMode } from '../lib/format';

const META: Record<PermissionMode, { cls: string; icon: LucideIcon }> = {
  'read-only': { cls: 'info', icon: Eye },
  'workspace-write': { cls: 'success', icon: ShieldCheck },
  'full-access': { cls: 'warn', icon: ShieldAlert },
};

export interface PermissionChipProps {
  mode: PermissionMode;
  onChange?: (m: PermissionMode) => void;
  /** When false the chip is a read-only status (existing session). */
  interactive?: boolean;
}

export function PermissionChip({ mode, onChange, interactive = true }: PermissionChipProps) {
  const meta = META[mode];
  const Icon = meta.icon;
  const label = MODE_LABEL[mode];
  if (!interactive || !onChange) {
    return (
      <span className={`chip ${meta.cls} perm-chip`} title={`会话权限：${label}`}>
        <Icon size={13} aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <button
      className={`chip ${meta.cls} perm-chip`}
      title={`权限模式：${label}（点击切换）`}
      aria-label={`权限模式：${label}，点击切换`}
      onClick={() => onChange(nextMode(mode))}
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
}

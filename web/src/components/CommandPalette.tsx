/**
 * ⌘K / Ctrl+K command palette (cmdk): jump between views, open a thread, or
 * start a new task. Esc closes (radix dialog); fully keyboard navigable.
 */
import { Command } from 'cmdk';
import { ListTodo, Map, MessageCircle, Settings, SquarePen, User } from 'lucide-react';
import type { Session } from '@axis/protocol';
import type { Route } from '../hooks/useHashRoute';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  onNavigate: (r: Route) => void;
  onSelectSession: (id: string) => void;
  onNewTask: () => void;
}

const NAV: { route: Route; label: string; icon: typeof Map }[] = [
  { route: 'skills', label: '技能', icon: Map },
  ...(import.meta.env.MODE === 'test' ? [{ route: 'agents' as const, label: '代理', icon: User }] : []),
  { route: 'settings', label: '设置', icon: Settings },
];

export function CommandPalette({ open, onOpenChange, sessions, onNavigate, onSelectSession, onNewTask }: CommandPaletteProps) {
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="命令面板"
      className="cmdk-dialog"
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
    >
      <Command.Input placeholder="搜索命令、会话…" autoFocus />
      <Command.List>
        <Command.Empty>没有匹配的命令</Command.Empty>

        <Command.Group heading="导航">
          {NAV.map((n) => (
            <Command.Item key={n.route} value={`nav-${n.label}`} onSelect={() => run(() => onNavigate(n.route))}>
              <n.icon size={15} aria-hidden />
              <span>{n.label}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="任务">
          <Command.Item value="new-task" onSelect={() => run(onNewTask)}>
            <SquarePen size={15} aria-hidden />
            <span>新任务</span>
          </Command.Item>
        </Command.Group>

        {sessions.length > 0 && (
          <Command.Group heading="会话">
            {sessions.slice(0, 40).map((s) => (
              <Command.Item
                key={s.id}
                value={`session-${s.id}-${s.title}`}
                keywords={[s.title]}
                onSelect={() => run(() => onSelectSession(s.id))}
              >
                {s.status === 'running' ? <ListTodo size={15} aria-hidden /> : <MessageCircle size={15} aria-hidden />}
                <span>{s.title || '未命名会话'}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

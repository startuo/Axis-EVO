/**
 * ModelCombobox — shadcn/Radix Popover + cmdk searchable listbox.
 * Fixes the datalist defect: opening always shows the FULL model list (scrollable,
 * searchable), not just the current value. Manual ids supported via a synthetic
 * "use manual input" item. Keyboard: type to filter, ↑/↓ navigate, Enter select,
 * Esc close. Shows a live count.
 */
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModelComboboxProps {
  value: string;
  onChange: (value: string) => void;
  models: string[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ModelCombobox({ value, onChange, models, placeholder = '选择或输入模型 ID', disabled, ariaLabel = '模型 ID' }: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const manual = query.trim().length > 0 && !models.includes(query.trim());

  const select = (m: string) => { onChange(m); setOpen(false); setQuery(''); };

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-left text-sm text-foreground',
            'transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
          )}
        >
          <span className={cn('truncate font-mono', !value && 'text-faint')}>{value || placeholder}</span>
          <span className="flex items-center gap-1.5 text-faint">
            {models.length > 0 && <span className="text-xs tabular-nums">{models.length}</span>}
            <ChevronDown size={15} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
        >
          <Command className="flex flex-col" loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={14} aria-hidden className="text-faint" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="搜索模型…"
                className="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
              />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-faint">无匹配模型</Command.Empty>
              {manual && (
                <Command.Item
                  value={`__manual__${query.trim()}`}
                  onSelect={() => select(query.trim())}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground data-[selected=true]:bg-surface-2"
                >
                  <span className="text-faint">使用手动输入：</span>
                  <span className="font-mono">{query.trim()}</span>
                </Command.Item>
              )}
              {models.map((m) => (
                <Command.Item
                  key={m}
                  value={m}
                  onSelect={() => select(m)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 font-mono text-sm text-foreground data-[selected=true]:bg-surface-2"
                >
                  <span className="truncate">{m}</span>
                  {m === value && <Check size={14} aria-hidden className="shrink-0 text-primary" />}
                </Command.Item>
              ))}
            </Command.List>
            <div className="border-t border-border px-3 py-1.5 text-xs text-faint">
              {models.length > 0 ? `共 ${models.length} 个模型，↑/↓ 选择，Enter 确认` : '尚未获取模型列表'}
            </div>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

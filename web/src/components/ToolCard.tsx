/** Collapsible tool-activity card: kind icon, status chip, streaming output, exit code. */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot, ChevronDown, FileDiff, FileText, GitBranch, Globe, ListTodo, Monitor, Plug,
  Search, Sparkles, Terminal, Wrench, type LucideIcon,
} from 'lucide-react';
import type { Item, ToolKind, ToolStatus } from '@axis/protocol';
import { formatDuration, TOOL_STATUS_LABEL, toolArgSummary } from '../lib/format';
import { TurnError } from './TurnError';

export const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  shell: Terminal,
  file: FileText,
  patch: FileDiff,
  git: GitBranch,
  search: Search,
  web: Globe,
  browser: Monitor,
  skill: Sparkles,
  task: ListTodo,
  subagent: Bot,
  mcp: Plug,
};

const STATUS_CHIP: Record<ToolStatus, string> = {
  pending: 'muted',
  running: 'info',
  success: 'success',
  failed: 'danger',
  unknown: 'warn',
  rejected: 'muted',
};

export function ToolCard({ item }: { item: Item }) {
  const status: ToolStatus = item.status ?? 'pending';
  const [open, setOpen] = useState(status === 'running' || status === 'pending');
  const preRef = useRef<HTMLPreElement>(null);
  const Icon = TOOL_ICONS[item.toolKind ?? 'task'] ?? Wrench;

  useEffect(() => {
    if (status === 'running' || status === 'pending') setOpen(true);
  }, [status]);

  useEffect(() => {
    const pre = preRef.current;
    if (pre && (status === 'running' || item.streaming)) pre.scrollTop = pre.scrollHeight;
  }, [item.output, status, item.streaming]);

  const summary = toolArgSummary(item.args);

  return (
    <div className={`card tool-card status-${status}`}>
      <button className="tool-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon size={15} className="tool-icon" aria-hidden />
        <span className="tool-name">{item.tool ?? 'tool'}</span>
        {summary && <span className="tool-arg">{summary}</span>}
        <span className={`chip ${STATUS_CHIP[status]}`}>
          {status === 'running' && <span className="pulse-dot" aria-hidden />}
          {TOOL_STATUS_LABEL[status]}
        </span>
        {item.exitCode !== undefined && (
          <span className={`chip ${item.exitCode === 0 ? 'muted' : 'danger'}`}>exit {item.exitCode}</span>
        )}
        {item.durationMs !== undefined && <span className="tool-dur">{formatDuration(item.durationMs)}</span>}
        <ChevronDown size={14} className={`chev${open ? ' open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="tool-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <pre ref={preRef}>
              {item.output ?? ''}
              {(status === 'running' || item.streaming) && <span className="stream-cursor" aria-hidden />}
            </pre>
            {item.outputTruncated && <div className="tool-trunc">输出已截断</div>}
            {item.error && <TurnError error={item.error} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

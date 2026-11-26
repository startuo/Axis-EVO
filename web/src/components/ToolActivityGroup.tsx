/**
 * Codex / Claude Code 风格的紧凑工具与文件操作折叠组：
 * - 单行极简呈现：动词 + 等宽路径/命令 + 精简状态/耗时
 * - 多步操作自动归拢为单行摘要（运行中展开、全部完成后平滑收起，失败项保持可见）
 * - 点击任意单行可展开查看截断后的输出或 Diff 预览
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bot, Check, ChevronRight, CircleAlert, FileDiff, FilePenLine, FileText,
  FolderOpen, Globe, LoaderCircle, Search, Sparkles, Terminal, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Item, ToolStatus } from '@axis/protocol';
import { diffLines } from '../lib/diff';
import { workspaceFileLink } from '../lib/filePreview';
import { TurnError } from './TurnError';
import { formatDuration, toolArgSummary, truncate } from '../lib/format';
import { extractToolTargetPath, type ActivityEntry, type PairedToolEntry } from '../lib/transcript';

interface ActionDescriptor {
  verb: string;
  target: string;
  icon: LucideIcon;
  category: 'read' | 'edit' | 'shell' | 'search' | 'other';
}

function describeTool(call: Item): ActionDescriptor {
  const name = (call.tool ?? '').toLowerCase();
  const path = extractToolTargetPath(call);

  if (name === 'read_document' || name === 'read_file' || name === 'fs.read' || name === 'view_file' || name === 'cat') {
    return { verb: '读取', target: path ?? toolArgSummary(call.args), icon: FileText, category: 'read' };
  }
  if (name === 'write_document' || name === 'write_file' || name === 'fs.write' || name === 'create_file') {
    return { verb: '写入', target: path ?? toolArgSummary(call.args), icon: FilePenLine, category: 'edit' };
  }
  if (name === 'apply_patch' || name === 'edit_file' || name === 'patch' || call.toolKind === 'patch') {
    return { verb: '编辑', target: path ?? toolArgSummary(call.args), icon: FileDiff, category: 'edit' };
  }
  if (name === 'list_files' || name === 'fs.list' || name === 'list_dir') {
    return { verb: '浏览', target: path ?? '.', icon: FolderOpen, category: 'read' };
  }
  if (name.includes('search') || name.includes('grep') || name === 'glob' || call.toolKind === 'search') {
    return { verb: '检索', target: toolArgSummary(call.args) || path || '', icon: Search, category: 'search' };
  }
  if (name === 'shell' || name === 'bash' || name === 'exec' || name === 'run_command' || call.toolKind === 'shell') {
    return { verb: '运行', target: toolArgSummary(call.args), icon: Terminal, category: 'shell' };
  }
  if (name.includes('agent') || call.toolKind === 'subagent') {
    const label = typeof call.args?.name === 'string' ? call.args.name : toolArgSummary(call.args);
    return { verb: '子代理', target: label, icon: Bot, category: 'other' };
  }
  if (call.toolKind === 'web' || call.toolKind === 'browser') {
    return { verb: '访问', target: toolArgSummary(call.args), icon: Globe, category: 'other' };
  }
  if (call.toolKind === 'skill') {
    return { verb: '技能', target: toolArgSummary(call.args), icon: Sparkles, category: 'other' };
  }
  return { verb: call.tool ?? '工具', target: path ?? toolArgSummary(call.args), icon: Wrench, category: 'other' };
}

function summarizeGroup(entries: ActivityEntry[], isRunning: boolean): string {
  let reads = 0;
  let edits = 0;
  let shells = 0;
  let searches = 0;
  let others = 0;

  for (const entry of entries) {
    if (entry.kind === 'diff') {
      edits += 1;
      continue;
    }
    const cat = describeTool(entry.call).category;
    if (cat === 'read') reads += 1;
    else if (cat === 'edit') edits += 1;
    else if (cat === 'shell') shells += 1;
    else if (cat === 'search') searches += 1;
    else others += 1;
  }

  const parts: string[] = [];
  if (reads > 0) parts.push(`读取 ${reads} 个文件`);
  if (edits > 0) parts.push(`编辑 ${edits} 处文件`);
  if (searches > 0) parts.push(`检索 ${searches} 次`);
  if (shells > 0) parts.push(`运行 ${shells} 条命令`);
  if (others > 0) parts.push(`${others} 项操作`);

  if (parts.length === 0) return isRunning ? '正在执行操作…' : `已执行 ${entries.length} 项操作`;
  const joined = parts.join('，');
  return isRunning ? `正在执行：${joined}` : `已${joined}`;
}

function formatResultPayload(call: Item, result?: Item): string {
  if (call.output && call.output.trim()) return call.output;
  if (!result || result.data === undefined) return '';
  if (typeof result.data === 'string') return truncate(result.data, 1200);
  try {
    return truncate(JSON.stringify(result.data, null, 2), 1200);
  } catch {
    return '';
  }
}

function CompactDiffPreview({ item }: { item: Item }) {
  const lines = useMemo(() => diffLines(item.before ?? '', item.after ?? ''), [item.before, item.after]);
  const visible = lines.slice(0, 120);
  return (
    <div className="act-diff-lines" role="table" aria-label={`差异预览 ${item.path ?? ''}`}>
      {visible.map((l, i) => (
        <div key={i} className={`diff-line ${l.type}`} role="row">
          <span className="diff-sign" aria-hidden>{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
          <span className="diff-text">{l.text || ' '}</span>
        </div>
      ))}
      {lines.length > 120 && <div className="tool-trunc">仅展示前 120 行变更</div>}
    </div>
  );
}

type OpenFile = (path: string) => void;

function CompactToolRow({ entry, onOpenFile }: { entry: PairedToolEntry; onOpenFile?: OpenFile }) {
  const reduce = useReducedMotion();
  const { call, result, diff } = entry;
  const status: ToolStatus = call.status ?? (result?.error ? 'failed' : result ? 'success' : 'pending');
  const errorText = call.error ?? result?.error;
  const isRunning = status === 'running' || status === 'pending';
  const [open, setOpen] = useState(status === 'failed');

  const desc = useMemo(() => describeTool(call), [call]);
  const payload = useMemo(() => formatResultPayload(call, result), [call, result]);
  const diffStats = useMemo(() => {
    if (!diff) return null;
    const lines = diffLines(diff.before ?? '', diff.after ?? '');
    return {
      added: lines.filter((l) => l.type === 'add').length,
      removed: lines.filter((l) => l.type === 'del').length,
    };
  }, [diff]);

  const hasDetail = Boolean(payload || diff || errorText);
  const Icon = desc.icon;
  const path = onOpenFile && workspaceFileLink(extractToolTargetPath(call) ?? undefined);

  return (
    <div className={`act-item status-${status}`}>
      <div className={path ? 'act-file-row' : undefined}>
      <button
        type="button"
        className={`act-row${hasDetail ? ' expandable' : ''}`}
        aria-expanded={hasDetail ? open : undefined}
        onClick={() => { if (hasDetail) setOpen((v) => !v); }}
      >
        <span className="act-glyph" aria-hidden>
          {isRunning ? (
            <LoaderCircle size={13} className="spin act-glyph-run" />
          ) : status === 'failed' ? (
            <CircleAlert size={13} className="act-glyph-err" />
          ) : (
            <Icon size={13} />
          )}
        </span>
        <span className={`act-verb${isRunning ? ' shimmer-text' : ''}`}>{desc.verb}</span>
        {desc.target && !path && <span className="act-target" title={desc.target}>{desc.target}</span>}
        {diffStats && (
          <span className="act-diff-stat" aria-label={`新增 ${diffStats.added} 行，删除 ${diffStats.removed} 行`}>
            <span className="stat-add">+{diffStats.added}</span>
            <span className="stat-del">−{diffStats.removed}</span>
          </span>
        )}
        {call.exitCode !== undefined && call.exitCode !== 0 && (
          <span className="act-exit-err">exit {call.exitCode}</span>
        )}
        {call.durationMs !== undefined && (
          <span className="act-dur">{formatDuration(call.durationMs)}</span>
        )}
        {hasDetail && (
          <ChevronRight size={12} className={`act-chev${open ? ' open' : ''}`} aria-hidden />
        )}
      </button>
      {path && <button type="button" className="act-target workspace-file-link" title={path}
        onClick={() => onOpenFile?.(path)}>{path}</button>}
      </div>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            className="act-detail"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {diff && <CompactDiffPreview item={diff} />}
            {payload && (
              <pre className="act-pre">
                {payload}
                {(isRunning || call.streaming) && <span className="stream-cursor" aria-hidden />}
              </pre>
            )}
            {call.outputTruncated && <div className="tool-trunc">输出已截断</div>}
            {errorText && <TurnError error={errorText} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompactDiffRow({ item, onOpenFile }: { item: Item; onOpenFile?: OpenFile }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => diffLines(item.before ?? '', item.after ?? ''), [item.before, item.after]);
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  const path = onOpenFile && workspaceFileLink(item.path);

  return (
    <div className="act-item">
      <div className={path ? 'act-file-row' : undefined}>
      <button type="button" className="act-row expandable" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="act-glyph" aria-hidden><FileDiff size={13} /></span>
        <span className="act-verb">变更</span>
        {!path && <span className="act-target" title={item.path}>{item.path ?? 'diff'}</span>}
        <span className="act-diff-stat">
          <span className="stat-add">+{added}</span>
          <span className="stat-del">−{removed}</span>
        </span>
        <ChevronRight size={12} className={`act-chev${open ? ' open' : ''}`} aria-hidden />
      </button>
      {path && <button type="button" className="act-target workspace-file-link" title={path}
        onClick={() => onOpenFile?.(path)}>{path}</button>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="act-detail"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <CompactDiffPreview item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ToolActivityGroup({ entries, onOpenFile }: { entries: ActivityEntry[]; onOpenFile?: OpenFile }) {
  const reduce = useReducedMotion();
  const isRunning = entries.some((e) => e.kind === 'tool' && (e.call.status === 'running' || e.call.status === 'pending'));
  const hasError = entries.some((e) => e.kind === 'tool' && (e.call.status === 'failed' || Boolean(e.call.error) || Boolean(e.result?.error)));

  const userToggledRef = useRef(false);
  const [expanded, setExpanded] = useState(() => isRunning || hasError);

  useEffect(() => {
    if (userToggledRef.current) return;
    setExpanded(isRunning || hasError);
  }, [isRunning, hasError]);

  // 单条操作直接以超紧凑单行呈现，避免套娃折叠
  if (entries.length === 1) {
    const only = entries[0]!;
    return (
      <div className="act-single">
        {only.kind === 'tool' ? <CompactToolRow entry={only} onOpenFile={onOpenFile} />
          : <CompactDiffRow item={only.item} onOpenFile={onOpenFile} />}
      </div>
    );
  }

  const summary = summarizeGroup(entries, isRunning);

  return (
    <div className={`act-group${isRunning ? ' running' : ''}${hasError ? ' has-error' : ''}`}>
      <button
        type="button"
        className="act-group-toggle"
        aria-expanded={expanded}
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((v) => !v);
        }}
      >
        <span className="act-group-icon" aria-hidden>
          {isRunning ? (
            <LoaderCircle size={13} className="spin act-glyph-run" />
          ) : hasError ? (
            <CircleAlert size={13} className="act-glyph-err" />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className={`act-group-summary${isRunning ? ' shimmer-text' : ''}`}>{summary}</span>
        <ChevronRight size={13} className={`act-chev${expanded ? ' open' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="act-group-list"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {entries.map((entry) =>
              entry.kind === 'tool' ? (
                <CompactToolRow key={entry.id} entry={entry} onOpenFile={onOpenFile} />
              ) : (
                <CompactDiffRow key={entry.id} item={entry.item} onOpenFile={onOpenFile} />
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

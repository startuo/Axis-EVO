/**
 * 将平铺的会话记录 Item[] 按轮次归组，用于 Codex / Claude Code 风格渲染：
 * 1. 每轮助手输出中，所有 `reasoning`（思考过程）强制置顶，位于工具调用与正文回答之前；
 * 2. 将 `tool_call` 与同 `callId` 的 `tool_result` 配对，避免为每次文件操作重复输出原始 JSON 大卡片；
 * 3. 将连续的 `tool_call` 与 `diff` 合并为可折叠的紧凑活动组（ToolRunGroup）。
 */
import type { Item } from '@axis/protocol';
import { extractArtifacts, type Artifact } from './artifacts';

export interface PairedToolEntry {
  kind: 'tool';
  id: string;
  call: Item;
  result?: Item;
  diff?: Item;
}

export interface StandaloneDiffEntry {
  kind: 'diff';
  id: string;
  item: Item;
}

export type ActivityEntry = PairedToolEntry | StandaloneDiffEntry;

export type TurnBlock =
  | { kind: 'activity_group'; id: string; entries: ActivityEntry[] }
  | { kind: 'item'; id: string; item: Item }
  | { kind: 'artifacts'; id: string; artifacts: Artifact[] };

export type TranscriptTurn =
  | { kind: 'user'; id: string; item: Item }
  | { kind: 'assistant'; id: string; reasonings: Item[]; blocks: TurnBlock[] };

/** 从 apply_patch 或常见文件工具参数里提取目标路径。 */
export function extractToolTargetPath(item: Item): string | null {
  const args = item.args;
  if (!args) return null;
  for (const key of ['path', 'file_path', 'filePath', 'file', 'target']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const patch = args.patch;
  if (typeof patch === 'string') {
    const m = patch.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/m);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** 判断工具调用是否属于“会修改文件”的操作（用于精准挂载 diff，避免把 diff 挂到 read_file 上）。 */
function isMutatingFileTool(item: Item): boolean {
  const name = (item.tool ?? '').toLowerCase();
  if (item.toolKind === 'patch') return true;
  return (
    name === 'apply_patch' ||
    name === 'edit_file' ||
    name === 'write_file' ||
    name === 'create_file' ||
    name === 'patch' ||
    name === 'fs.write'
  );
}

/** 常规文件读写/编辑工具返回自身路径不应重复生成大张 ArtifactCard 打断压缩列表。 */
function isRoutineFileTool(item: Item): boolean {
  const name = (item.tool ?? '').toLowerCase();
  if (item.toolKind === 'file' || item.toolKind === 'patch') return true;
  return (
    name === 'read_file' ||
    name === 'write_file' ||
    name === 'apply_patch' ||
    name === 'edit_file' ||
    name === 'list_files' ||
    name === 'fs.read' ||
    name === 'fs.write' ||
    name === 'fs.list'
  );
}

function buildAssistantTurn(slice: Item[], turnIndex: number): TranscriptTurn {
  const reasonings: Item[] = [];
  const rest: Item[] = [];
  for (const it of slice) {
    if (it.kind === 'reasoning') reasonings.push(it);
    else rest.push(it);
  }

  // 建立 callId -> tool_result 索引（同时支持紧邻配对兜底）
  const resultByCallId = new Map<string, Item>();
  const pairedResultIds = new Set<string>();
  const callIds = new Set<string>();
  for (const it of rest) {
    if (it.kind === 'tool_call' && it.callId) callIds.add(it.callId);
  }
  for (const it of rest) {
    if (it.kind === 'tool_result' && it.callId && callIds.has(it.callId)) {
      resultByCallId.set(it.callId, it);
      pairedResultIds.add(it.id);
    }
  }

  // 仅把 diff 吸附到同路径的“修改/写入/补丁”类工具上，避免误挂到先前的 read_file
  const diffByToolId = new Map<string, Item>();
  const pairedDiffIds = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const it = rest[i]!;
    if (it.kind !== 'tool_call' || !isMutatingFileTool(it)) continue;
    const targetPath = extractToolTargetPath(it);
    if (!targetPath) continue;
    for (let j = i + 1; j < rest.length; j++) {
      const cand = rest[j]!;
      if (cand.kind === 'message') break;
      if (cand.kind === 'diff' && cand.path === targetPath && !pairedDiffIds.has(cand.id)) {
        diffByToolId.set(it.id, cand);
        pairedDiffIds.add(cand.id);
        break;
      }
    }
  }

  const blocks: TurnBlock[] = [];
  let pendingEntries: ActivityEntry[] = [];
  let deferredArtifacts: { id: string; artifacts: Artifact[] }[] = [];

  const flushActivities = () => {
    if (pendingEntries.length > 0) {
      blocks.push({
        kind: 'activity_group',
        id: `act-${pendingEntries[0]!.id}`,
        entries: pendingEntries,
      });
      pendingEntries = [];
    }
    if (deferredArtifacts.length > 0) {
      for (const batch of deferredArtifacts) {
        blocks.push({ kind: 'artifacts', id: batch.id, artifacts: batch.artifacts });
      }
      deferredArtifacts = [];
    }
  };

  for (let i = 0; i < rest.length; i++) {
    const it = rest[i]!;

    if (it.kind === 'tool_call') {
      let result = it.callId ? resultByCallId.get(it.callId) : undefined;
      // 若协议未填 callId，尝试配对紧随其后的 tool_result
      if (!result) {
        const next = rest[i + 1];
        if (next && next.kind === 'tool_result' && !next.callId && !next.metadata?.artifactId && !pairedResultIds.has(next.id)) {
          result = next;
          pairedResultIds.add(next.id);
        }
      }
      pendingEntries.push({
        kind: 'tool',
        id: it.id,
        call: it,
        result,
        diff: diffByToolId.get(it.id),
      });
      // 非日常文件读写工具产出的明确交付产物（如报告/导出文件）才延后展示在活动组之后
      if (result && !isRoutineFileTool(it)) {
        const artifacts = extractArtifacts(result.data);
        if (artifacts.length > 0) {
          deferredArtifacts.push({ id: `art-${result.id}`, artifacts });
        }
      }
      continue;
    }

    if (it.kind === 'tool_result' && pairedResultIds.has(it.id)) {
      continue;
    }

    if (it.kind === 'diff') {
      if (pairedDiffIds.has(it.id)) continue;
      pendingEntries.push({ kind: 'diff', id: it.id, item: it });
      continue;
    }

    flushActivities();
    blocks.push({ kind: 'item', id: it.id, item: it });
  }

  flushActivities();

  const firstId = slice[0]?.id ?? `turn-${turnIndex}`;
  return {
    kind: 'assistant',
    id: `turn-${firstId}`,
    reasonings,
    blocks,
  };
}

export function groupTranscriptTurns(items: Item[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let buffer: Item[] = [];

  const flushAssistant = () => {
    if (buffer.length === 0) return;
    turns.push(buildAssistantTurn(buffer, turns.length));
    buffer = [];
  };

  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') {
      flushAssistant();
      turns.push({ kind: 'user', id: item.id, item });
    } else {
      buffer.push(item);
    }
  }
  flushAssistant();
  return turns;
}

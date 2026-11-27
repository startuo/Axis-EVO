/**
 * Obsidian Prism 0fps 语义边缘余晖：
 * - 待审批（暖琥珀）/ 异常与错误（低饱和赤红）/ 运行中（克制光谱流光）/ 完成回执（沉静松绿 2.4s 淡出）
 * - 静态定格后维持 0fps 零重绘；专注省电与减少动态效果下退化为静态 1px 语义细线
 * - 仅在 `obsidian-prism` 主题下渲染，绝不介入 Axis 默认界面
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { Approval, Item, Session } from '@axis/protocol';
import { useAppearanceState } from '../../hooks/useTheme';

export type SemanticGlowState = 'idle' | 'running' | 'approval' | 'error' | 'completed';

export interface SemanticEdgeGlowProps {
  session: Session | null;
  approvals?: Approval[];
  items?: Item[];
}

export function resolveSemanticGlowState(
  session: Session | null,
  approvals: Approval[] = [],
  items: Item[] = [],
  justCompleted = false,
): SemanticGlowState {
  if (approvals.some((a) => a.status === 'pending')) return 'approval';
  if (session?.status === 'error') return 'error';
  const tail = items[items.length - 1];
  if (tail && tail.kind === 'error') return 'error';
  if (session?.status === 'running') return 'running';
  if (justCompleted) return 'completed';
  return 'idle';
}

export function SemanticEdgeGlow({ session, approvals = [], items = [] }: SemanticEdgeGlowProps) {
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();
  const prevStatusRef = useRef<Session['status'] | null>(session?.status ?? null);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = session?.status ?? null;
    prevStatusRef.current = cur;
    if (prev === 'running' && cur === 'idle') {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 2400);
      return () => clearTimeout(timer);
    }
    if (cur === 'running' || cur === 'error') {
      setJustCompleted(false);
    }
  }, [session?.status, session?.id]);

  if (appearance.uiStyle !== 'obsidian-prism') return null;

  const state = resolveSemanticGlowState(session, approvals, items, justCompleted);
  const staticOnly = Boolean(reduce) || appearance.motionTier === 'focus';

  return (
    <div
      className={`prism-edge-glow state-${state}${staticOnly ? ' static-only' : ''}`}
      data-glow-state={state}
      aria-hidden="true"
    />
  );
}

/**
 * Obsidian Prism 五级水墨流式淡入（基于 CSS Custom Highlight API）：
 * - 零额外 DOM 节点包裹，不触发回流；仅在 Obsidian Prism 标准档 + 流式输出期间生效
 * - 不支持 CSS.highlights 或流式结束时自动清空 Range，零静态残留开销
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAppearanceState } from '../../hooks/useTheme';

const LEVELS = ['axis-prism-f0', 'axis-prism-f1', 'axis-prism-f2', 'axis-prism-f3', 'axis-prism-f4'] as const;

function collectTailTextNodes(root: HTMLElement, maxChars: number): Array<{ node: Text; start: number; end: number }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeValue && cur.nodeValue.length > 0) nodes.push(cur as Text);
    cur = walker.nextNode();
  }
  let remaining = maxChars;
  const picked: Array<{ node: Text; start: number; end: number }> = [];
  for (let i = nodes.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const node = nodes[i]!;
    const len = node.nodeValue?.length ?? 0;
    const take = Math.min(len, remaining);
    picked.unshift({ node, start: len - take, end: len });
    remaining -= take;
  }
  return picked;
}

function clearHighlights(): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  for (const name of LEVELS) {
    try { CSS.highlights.delete(name); } catch { /* ignore */ }
  }
}

export function useInkStream(containerRef: RefObject<HTMLElement | null>, text: string, streaming: boolean): void {
  const appearance = useAppearanceState();
  const reduce = useReducedMotion();
  const prevLenRef = useRef(0);
  const active =
    streaming &&
    appearance.uiStyle === 'obsidian-prism' &&
    appearance.motionTier === 'standard' &&
    !reduce &&
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight !== 'undefined';

  useEffect(() => {
    if (!active || !containerRef.current) {
      prevLenRef.current = text.length;
      clearHighlights();
      return;
    }

    const delta = Math.max(0, Math.min(36, text.length - prevLenRef.current));
    prevLenRef.current = text.length;
    if (delta === 0) return;

    const slices = collectTailTextNodes(containerRef.current, Math.min(25, Math.max(10, delta)));
    if (slices.length === 0) return;

    let step = 0;
    const paint = () => {
      clearHighlights();
      if (step >= LEVELS.length) return;
      const total = slices.reduce((sum, s) => sum + (s.end - s.start), 0);
      const bucket = Math.max(1, Math.ceil(total / LEVELS.length));
      let offset = 0;
      const groups: Range[][] = LEVELS.map(() => []);

      for (const slice of slices) {
        let pos = slice.start;
        while (pos < slice.end) {
          const bIdx = Math.min(LEVELS.length - 1, Math.floor(offset / bucket));
          const levelIdx = Math.min(LEVELS.length - 1, (LEVELS.length - 1 - bIdx) + step);
          const nextBreak = Math.min(slice.end, pos + (bucket - (offset % bucket)));
          if (levelIdx < LEVELS.length - 1) {
            const range = document.createRange();
            range.setStart(slice.node, pos);
            range.setEnd(slice.node, nextBreak);
            groups[levelIdx]!.push(range);
          }
          offset += nextBreak - pos;
          pos = nextBreak;
        }
      }

      groups.forEach((ranges, idx) => {
        if (ranges.length > 0) {
          try { CSS.highlights.set(LEVELS[idx]!, new Highlight(...ranges)); } catch { /* ignore */ }
        }
      });
    };

    paint();
    const timer = window.setInterval(() => {
      step += 1;
      paint();
      if (step >= LEVELS.length) window.clearInterval(timer);
    }, 55);

    return () => {
      window.clearInterval(timer);
      clearHighlights();
    };
  }, [active, containerRef, text]);

  useEffect(() => () => clearHighlights(), []);
}

export function PrismInkStream({ containerRef, text }: { containerRef: RefObject<HTMLElement | null>; text: string }) {
  useInkStream(containerRef, text, true);
  return null;
}

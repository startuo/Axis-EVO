/**
 * 长对话右侧会话大纲导轨 + Alt+↑ / Alt+↓ 上下轮次快跳：
 * - 当用户轮次 >= 2 时在对话区右侧呈现极细刻度导轨（零遮挡）
 * - 悬停预展、点击钉住展开紧凑提问大纲浮层，Esc 或点击外部收回
 * - 焦点位于输入框（input / textarea / contenteditable）时放行 Alt+↑/↓，绝不抢编辑快捷键
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ListTree } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { truncate } from '../lib/format';
import type { TranscriptTurn } from '../lib/transcript';

export interface ThreadOutlineRailProps {
  turns: TranscriptTurn[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

interface OutlineEntry {
  id: string;
  index: number;
  label: string;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable || Boolean(target.closest('[role="textbox"]'));
}

function turnElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-turn-id]')];
}

export function ThreadOutlineRail({ turns, scrollRef }: ThreadOutlineRailProps) {
  const reduce = useReducedMotion();
  const railRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const open = hovered || pinned;

  useClickOutside(railRef, () => setPinned(false), pinned);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (railRef.current?.contains(document.activeElement)) railRef.current.querySelector('button')?.focus();
        setPinned(false);
        setHovered(false);
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [open]);

  const entries = useMemo<OutlineEntry[]>(() => {
    const out: OutlineEntry[] = [];
    for (const turn of turns) {
      if (turn.kind !== 'user') continue;
      const firstLine = (turn.item.text ?? '').trim().split(/\r?\n/)[0] || '用户提问';
      out.push({
        id: turn.id,
        index: out.length,
        label: truncate(firstLine, 46),
      });
    }
    return out;
  }, [turns]);

  const jumpTo = useCallback(
    (entryIndex: number) => {
      const container = scrollRef.current;
      const target = entries[entryIndex];
      if (!container || !target) return;
      const node = turnElements(container).find(element => element.dataset.turnId === target.id);
      if (!node) return;
      setActiveIndex(entryIndex);
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
    },
    [entries, reduce, scrollRef],
  );

  // 滚读时同步高亮当前可视区域最接近顶部的用户轮次
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || entries.length < 2) return;
    const nodes = turnElements(container);
    const onScroll = () => {
      const top = container.getBoundingClientRect().top + 44;
      let best = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        if (nodes[i].getBoundingClientRect().top <= top) best = i;
        else break;
      }
      setActiveIndex(best);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [entries, scrollRef]);

  // 非输入焦点下 Alt+↑ / Alt+↓ 快速切换上下提问轮次
  useEffect(() => {
    if (entries.length < 2) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isEditableElement(e.target)) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        jumpTo(Math.max(0, activeIndex - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        jumpTo(Math.min(entries.length - 1, activeIndex + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entries.length, activeIndex, jumpTo]);

  if (entries.length < 2) return null;

  return (
    <aside
      ref={railRef}
      className={`thread-outline-rail${open ? ' open' : ''}`}
      aria-label="会话大纲导轨"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="thread-outline-trigger"
        aria-label={`会话大纲（共 ${entries.length} 轮）`}
        aria-expanded={open}
        title="会话大纲（Alt+↑ / Alt+↓ 跳轮）"
        onClick={() => setPinned((v) => !v)}
      >
        <ListTree size={12} aria-hidden />
        <span className="thread-outline-ticks" aria-hidden="true">
          {entries.map((item) => (
            <span
              key={item.id}
              className={`thread-outline-tick${item.index === activeIndex ? ' active' : ''}`}
            />
          ))}
        </span>
      </button>

      {open && (
        <div className="thread-outline-popover" role="navigation" aria-label="提问轮次跳转">
          <div className="thread-outline-head">
            <span>会话大纲</span>
            <span className="thread-outline-shortcut">Alt+↑/↓</span>
          </div>
          <div className="thread-outline-list">
            {entries.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`thread-outline-item${item.index === activeIndex ? ' active' : ''}`}
                aria-current={item.index === activeIndex ? 'step' : undefined}
                onClick={() => {
                  jumpTo(item.index);
                  setPinned(false);
                  setHovered(false);
                }}
              >
                <span className="thread-outline-num">{item.index + 1}</span>
                <span className="thread-outline-text">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

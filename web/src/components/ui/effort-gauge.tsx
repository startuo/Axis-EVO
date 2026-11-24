/**
 * EffortGauge — Codex / Claude Code 桌面端风格的离散刻度可拖拽推理强度滑轨：
 * - 真实水平轨道 + 进度填充 + 4 个物理刻度停靠点（关闭 / 低 / 中 / 高）
 * - 支持 Pointer 跟手连续拖拽与松手阻尼弹簧磁吸回最近刻度、点击轨道跳档、刻度文字点击、键盘方向键/Home/End
 * - 同轴对齐 4 枚刻度标签与 3 阶信号条图标，无中点 · 符号
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ReasoningEffort } from '@axis/protocol';
import { EFFORT_LABEL, EFFORT_ORDER } from '../../lib/format';
import { cn } from '../../lib/utils';
import './effort-gauge.css';

const LEVEL_BARS: Record<ReasoningEffort, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const TIER_TAG: Record<ReasoningEffort, string> = {
  off: '直出',
  low: '轻量',
  medium: '均衡',
  high: '深度',
};

const DESCRIPTION: Record<ReasoningEffort, string> = {
  off: '关闭扩展思考，直接输出回答',
  low: '轻量推理，适合明确简短的任务',
  medium: '均衡模式，兼顾响应速度与思考深度',
  high: '深度推演，适合复杂架构与多步调试',
};

export function EffortSignalIcon({ value, className }: { value: ReasoningEffort; className?: string }) {
  const activeBars = LEVEL_BARS[value];
  return (
    <svg
      width="13"
      height="12"
      viewBox="0 0 13 12"
      fill="none"
      className={cn('eg-signal', value === 'off' && 'is-off', className)}
      aria-hidden="true"
    >
      <rect x="1" y="7.5" width="2.4" height="3.5" rx="0.9" className={activeBars >= 1 ? 'bar-on' : 'bar-dim'} />
      <rect x="5.3" y="4.5" width="2.4" height="6.5" rx="0.9" className={activeBars >= 2 ? 'bar-on' : 'bar-dim'} />
      <rect x="9.6" y="1.5" width="2.4" height="9.5" rx="0.9" className={activeBars >= 3 ? 'bar-on' : 'bar-dim'} />
    </svg>
  );
}

export interface EffortGaugeProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  label?: string;
  disabled?: boolean;
}

const LAST = EFFORT_ORDER.length - 1;

export function EffortGauge({ value, onChange, label = '思考强度', disabled = false }: EffortGaugeProps) {
  const id = useId();
  const reduce = useReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const index = Math.min(LAST, Math.max(0, EFFORT_ORDER.indexOf(value)));
  const snapPct = (index / LAST) * 100;
  const activePct = dragRatio !== null ? dragRatio * 100 : snapPct;

  const setIndex = (next: number) => {
    if (disabled) return;
    const clamped = Math.min(LAST, Math.max(0, next));
    const effort = EFFORT_ORDER[clamped];
    if (effort && effort !== value) onChange(effort);
  };

  const ratioFromClientX = (clientX: number): number => {
    const el = railRef.current;
    if (!el) return index / LAST;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return index / LAST;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const el = railRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom fallback */ }
    }
    draggingRef.current = true;
    const r = ratioFromClientX(e.clientX);
    setDragRatio(r);
    setIndex(Math.round(r * LAST));
    el?.focus();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    const r = ratioFromClientX(e.clientX);
    setDragRatio(r);
    setIndex(Math.round(r * LAST));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const el = railRef.current;
    if (el && typeof el.releasePointerCapture === 'function') {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    draggingRef.current = false;
    setDragRatio(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        setIndex(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        setIndex(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        setIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setIndex(LAST);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onChange(value);
        break;
      default:
    }
  };

  return (
    <div className={cn('eg', disabled && 'eg-disabled')}>
      <div className="eg-head">
        <span id={id} className="eg-label">{label}</span>
        <span className="eg-current">
          <EffortSignalIcon value={value} />
          <span className="eg-current-val">{EFFORT_LABEL[value]}</span>
          <span className="eg-tier-tag">{TIER_TAG[value]}</span>
        </span>
      </div>

      <div className="eg-slider-box">
        <div
          ref={railRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={id}
          aria-valuemin={0}
          aria-valuemax={LAST}
          aria-valuenow={index}
          aria-valuetext={EFFORT_LABEL[value]}
          aria-disabled={disabled}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn('eg-rail-hit', dragRatio !== null && 'dragging')}
        >
          <div className="eg-rail-bg" aria-hidden="true">
            <motion.div
              className="eg-rail-fill"
              animate={{ width: `${activePct}%` }}
              transition={
                dragRatio !== null || reduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 460, damping: 36, mass: 0.65 }
              }
            />
          </div>

          {EFFORT_ORDER.map((stop, i) => {
            const pct = (i / LAST) * 100;
            return (
              <span
                key={stop}
                className={cn('eg-notch', i <= index && 'reached', i === index && 'current')}
                style={{ left: `${pct}%` }}
                aria-hidden="true"
              />
            );
          })}

          <motion.div
            className="eg-handle"
            aria-hidden="true"
            animate={{ left: `${activePct}%` }}
            transition={
              dragRatio !== null || reduce
                ? { duration: 0 }
                : { type: 'spring', stiffness: 460, damping: 34, mass: 0.65 }
            }
          >
            <span className="eg-handle-core" />
          </motion.div>
        </div>

        <div className="eg-stops" role="group" aria-label={`${label}档位`}>
          {EFFORT_ORDER.map((stop, i) => {
            const active = i === index;
            const pct = (i / LAST) * 100;
            return (
              <button
                key={stop}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => setIndex(i)}
                style={{ left: `${pct}%` }}
                className={cn('eg-stop', active && 'active')}
              >
                {EFFORT_LABEL[stop]}
              </button>
            );
          })}
        </div>
      </div>

      <p className="eg-desc" aria-live="polite">{DESCRIPTION[value]}</p>
    </div>
  );
}

/**
 * Claude-Code-style reasoning-effort slider (api-connect-ui stream).
 * Four discrete stops — 关闭/低/中/高 ↔ off/low/medium/high — on a horizontal
 * pink-accent track with tick dots, a live current-value label and clickable
 * stop labels. Keyboard accessible (arrows / Home / End) with aria-valuetext.
 * Colors come exclusively from styles/tokens.css variables.
 */
import type { CSSProperties, KeyboardEvent } from 'react';
import type { ReasoningEffort } from '@axis/protocol';
import { EFFORT_LABEL, EFFORT_ORDER } from '../lib/format';
import './reasoning-slider.css';

export interface ReasoningSliderProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  /** Visible header + accessible name of the control. */
  label?: string;
  disabled?: boolean;
}

const LAST = EFFORT_ORDER.length - 1;

export function ReasoningSlider({ value, onChange, label = '思考强度', disabled = false }: ReasoningSliderProps) {
  const index = Math.min(LAST, Math.max(0, EFFORT_ORDER.indexOf(value)));
  const fill = `${(index / LAST) * 100}%`;

  const setIndex = (next: number) => {
    const clamped = Math.min(LAST, Math.max(0, next));
    const effort = EFFORT_ORDER[clamped];
    if (effort && effort !== value) onChange(effort);
  };

  // Explicit key handling so behavior is identical across browsers (and testable).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
      default:
    }
  };

  return (
    <div className={`rs${disabled ? ' rs-disabled' : ''}`}>
      <div className="rs-head">
        <span className="rs-label">{label}</span>
        <span className="rs-current">{EFFORT_LABEL[value]}</span>
      </div>
      <div className="rs-track">
        <input
          type="range"
          className="rs-input"
          min={0}
          max={LAST}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={EFFORT_LABEL[value]}
          style={{ '--rs-fill': fill } as CSSProperties}
          onChange={(e) => setIndex(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
        <div className="rs-ticks" aria-hidden>
          {EFFORT_ORDER.map((stop, i) => (
            <span key={stop} className={`rs-tick${i <= index ? ' on' : ''}`} />
          ))}
        </div>
      </div>
      <div className="rs-stops" role="group" aria-label={`${label}档位`}>
        {EFFORT_ORDER.map((stop, i) => (
          <button
            key={stop}
            type="button"
            className={`rs-stop${i === index ? ' on' : ''}`}
            disabled={disabled}
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
          >
            {EFFORT_LABEL[stop]}
          </button>
        ))}
      </div>
    </div>
  );
}

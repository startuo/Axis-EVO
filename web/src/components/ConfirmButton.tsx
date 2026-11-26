import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { iconSwap, motionProps, transitionInstant } from '../lib/motion';

export interface ConfirmButtonProps {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  confirmAriaLabel?: string;
  className?: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  timeoutMs?: number;
}

export function ConfirmButton({
  onConfirm, children, confirmLabel = '确认删除', confirmAriaLabel,
  className = 'button danger', label, title, disabled, timeoutMs = 3500,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [armed, timeoutMs]);

  return (
    <button
      type="button"
      disabled={disabled}
      title={armed ? `${confirmLabel}（按 Esc 取消）` : (title ?? label)}
      aria-label={armed ? confirmAriaLabel ?? confirmLabel : label}
      className={armed ? 'button danger armed confirm-armed' : className}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && armed) {
          event.preventDefault();
          setArmed(false);
        }
        // Holding Enter must never perform both steps of a confirmation.
        if (event.repeat && event.key === 'Enter') event.preventDefault();
      }}
      onClick={() => {
        setArmed(!armed);
        if (armed) onConfirm();
      }}
    >
      <motion.span key={armed ? 'confirm' : 'idle'} className="confirm-btn-inner"
        {...motionProps(reduce || !armed, iconSwap, transitionInstant)}>
        {armed ? confirmLabel : children}
      </motion.span>
    </button>
  );
}

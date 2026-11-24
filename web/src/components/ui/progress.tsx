/** Progress — ARIA progressbar with a spring-driven token-pink indicator. */
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { springSoft } from '../../lib/motion';

export interface ProgressProps extends React.ComponentProps<'div'> {
  /** 0–max (clamped). */
  value?: number;
  max?: number;
  /** Accessible name; falls back to aria-labelledby when omitted. */
  label?: string;
  indicatorClassName?: string;
}

export function Progress({ className, value = 0, max = 100, label, indicatorClassName, ...props }: ProgressProps) {
  const reduce = useReducedMotion();
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(safeMax, Math.max(0, value));
  const pct = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-label={label}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
      {...props}
    >
      <motion.div
        className={cn('h-full rounded-full bg-primary', indicatorClassName)}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduce ? { duration: 0 } : springSoft}
      />
    </div>
  );
}

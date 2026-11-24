/** Skeleton — token-gradient shimmer; frozen under prefers-reduced-motion. */
import { cn } from '../../lib/utils';
import './animations.css';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-md bg-[linear-gradient(90deg,var(--color-surface-2)_25%,var(--color-border)_50%,var(--color-surface-2)_75%)]',
        'bg-[length:200%_100%] animate-[ax-shimmer_1.6s_linear_infinite] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

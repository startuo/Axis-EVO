/** Input — house field geometry (rounded-md, surface-2, hairline border).
 *  `text-foreground!` because tokens.css `input { color: inherit }` is unlayered. */
import { cn } from '../../lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-border bg-surface-2 px-3 py-1 text-sm text-foreground! shadow-none transition-colors',
        'placeholder:text-faint',
        'focus-visible:border-border-strong focus-visible:outline-2! focus-visible:outline-ring!',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

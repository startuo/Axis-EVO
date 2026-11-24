/** Textarea — same field language as Input, roomy vertical resize. */
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full min-w-0 resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground! shadow-none transition-colors',
        'placeholder:text-faint',
        'focus-visible:border-border-strong focus-visible:outline-2! focus-visible:outline-ring!',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

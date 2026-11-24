/** Tooltip — Radix Tooltip; small elevated bubble, pop motion, token colors. */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';
import './animations.css';

export function TooltipProvider({ delayDuration = 250, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'ax-pop z-50 max-w-64 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground shadow-[var(--shadow-pop)]',
          'origin-[var(--radix-tooltip-content-transform-origin)] outline-none!',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

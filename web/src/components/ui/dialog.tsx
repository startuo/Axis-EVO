/**
 * Dialog — Radix Dialog with blurred overlay + fade/zoom motion.
 * Motion is CSS (animations.css) so Radix Presence observes animationend and
 * plays real exit animations; prefers-reduced-motion collapses them to 1ms.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import './animations.css';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('ax-overlay fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px]', className)}
      {...props}
    />
  );
}

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'ax-content fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
          'rounded-lg border border-border bg-surface p-6 text-foreground shadow-[var(--shadow-pop)] outline-none!',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="关闭"
          className={cn(
            'absolute right-4 top-4 rounded-md p-1 text-faint! transition-colors',
            'hover:bg-surface-2! hover:text-foreground!',
            'focus-visible:outline-2! focus-visible:outline-ring! disabled:pointer-events-none',
          )}
        >
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold leading-snug text-foreground', className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

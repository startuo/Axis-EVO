/**
 * Sheet — side panel built on Radix Dialog; `side` picks left/right via cva.
 * Slide motion lives in animations.css (Radix Presence drives the exit).
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import './animations.css';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

const sheetSides = cva(
  [
    'fixed inset-y-0 z-50 flex flex-col gap-4 bg-surface p-6 text-foreground shadow-[var(--shadow-pop)] outline-none!',
  ],
  {
    variants: {
      side: {
        left: 'ax-sheet-left left-0 w-full max-w-md border-r border-border',
        right: 'ax-sheet-right right-0 w-full max-w-md border-l border-border',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetSides> {}

export function SheetContent({ className, side, children, ...props }: SheetContentProps) {
  return (
    <SheetPortal>
      <DialogPrimitive.Overlay className="ax-overlay fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px]" />
      <DialogPrimitive.Content className={cn(sheetSides({ side }), className)} {...props}>
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
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold leading-snug text-foreground', className)}
      {...props}
    />
  );
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

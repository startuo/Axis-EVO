/** Accordion — Radix accordion; height animation via --radix-accordion-content-height. */
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import './animations.css';

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn('border-b border-border', className)} {...props} />;
}

export function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'flex flex-1 items-center justify-between gap-2 rounded-md py-3 text-left text-sm font-medium text-foreground! transition-colors',
          'hover:text-primary! focus-visible:outline-2! focus-visible:outline-ring!',
          'disabled:pointer-events-none disabled:opacity-50',
          '[&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-200 motion-reduce:transition-none" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className={cn('ax-accordion overflow-hidden text-sm text-muted-foreground', className)}
      {...props}
    >
      <div className="pb-3 pt-0">{children}</div>
    </AccordionPrimitive.Content>
  );
}

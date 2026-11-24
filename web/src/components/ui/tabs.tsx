/** Tabs — pill segmented control like the design-ref 聊天/工作 toggle. */
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-1 rounded-full bg-surface-2 p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground! transition-colors',
        'hover:text-foreground! focus-visible:outline-2! focus-visible:outline-ring!',
        'data-[state=active]:bg-surface! data-[state=active]:text-foreground! data-[state=active]:shadow-[var(--shadow-card)]',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('mt-3 focus-visible:outline-2! focus-visible:outline-ring!', className)}
      {...props}
    />
  );
}

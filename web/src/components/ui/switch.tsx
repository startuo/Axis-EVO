/** Switch — Radix switch; pink track when checked, high-contrast thumb both ways. */
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-2! focus-visible:outline-ring! disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary! data-[state=unchecked]:bg-surface-2!',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full shadow-[var(--shadow-card)] transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
          'data-[state=checked]:bg-background data-[state=unchecked]:bg-foreground',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

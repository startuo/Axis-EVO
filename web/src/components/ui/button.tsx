/**
 * Button — cva variants on Axis semantic tokens.
 * CASCADE NOTE: styles/tokens.css is unlayered, so its element rules
 * (`button { background:none; border:none; color:inherit; cursor:pointer }`,
 * `a { color:info }`, `:focus-visible { outline:info }`) outrank Tailwind's
 * layered utilities. Utilities that must win therefore carry the v4 `!`
 * important suffix (bg/border/text on buttons, focus outline everywhere).
 */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
    'focus-visible:outline-2! focus-visible:outline-ring!',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface-2! text-foreground! hover:bg-border-strong!',
        primary: 'bg-primary! text-background! hover:bg-primary/90!',
        outline: 'border! border-border! bg-transparent! text-foreground! hover:border-border-strong! hover:bg-surface-2!',
        ghost: 'bg-transparent! text-muted-foreground! hover:bg-surface-2! hover:text-foreground!',
        destructive: 'bg-danger! text-background! hover:bg-danger/90!',
        link: 'bg-transparent! text-primary! underline-offset-4 hover:underline!',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'size-9 shrink-0 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  /** Render the single child element instead of a <button> (Radix Slot). */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and disables interaction. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  // Slot demands exactly one element child: keep the spinner out of the tree
  // entirely when composing via asChild.
  const content =
    loading && !asChild ? (
      <>
        <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        {children}
      </>
    ) : (
      children
    );
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </Comp>
  );
}

export { buttonVariants };

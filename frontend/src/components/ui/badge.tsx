import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Badge, extended with the status tones this app actually uses.
 *
 * Stock shadcn ships default/secondary/destructive/outline only. An ERP labels
 * things CONFIRMED, PARTIAL, UNPAID, low-stock — so `success` and `warning` are
 * added here, drawn from the app's own --success / --warning tokens rather than
 * invented colours, and rendered on the `subtle` background the rest of the app
 * already uses for status chips.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-token-sm px-1.5 py-0.5 text-[10.5px] font-bold ' +
    'leading-none transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground',
        secondary:   'bg-secondary text-secondary-foreground',
        destructive: 'bg-danger-subtle text-danger',
        success:     'bg-success-subtle text-success',
        warning:     'bg-warning-subtle text-warning',
        info:        'bg-info-subtle text-info',
        outline:     'border border-border text-content-secondary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    variant: {
      high: 'bg-cobalt text-white',
      medium: 'bg-cobalt-soft text-cobalt',
      low: 'border border-border bg-muted text-muted-foreground',
      outline: 'border border-border text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'outline' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

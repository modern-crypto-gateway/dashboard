import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium tracking-[0.01em] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 transition-[color,background-color]',
  {
    variants: {
      variant: {
        default:
          'border-border bg-[var(--muted-bg)] text-[var(--muted-fg)]',
        success:
          'border-[var(--success-border)] bg-[var(--success-bg)] text-success',
        warn:
          'border-[var(--warn-border)] bg-[var(--warn-bg)] text-warn',
        danger:
          'border-[var(--danger-border)] bg-[var(--danger-bg)] text-destructive',
        accent:
          'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { badgeVariants }

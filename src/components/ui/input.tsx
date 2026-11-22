import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        data-slot="input"
        className={cn(
          'flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1.5 text-base transition-[color,box-shadow,border-color] duration-150 hover:border-[var(--fg-3)]',
          'placeholder:text-[var(--fg-3)] selection:bg-primary selection:text-primary-foreground',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'focus-visible:border-ring focus-visible:ring-ring/20 focus-visible:ring-[3px] focus-visible:outline-none',
          'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

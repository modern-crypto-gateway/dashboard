import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: number
  current: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {Array.from({ length: steps }).map((_, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-grid size-[22px] place-items-center rounded-full border font-mono text-[11px] font-semibold',
                done && 'border-primary bg-primary text-primary-foreground',
                active &&
                  'border-primary bg-[var(--accent-bg)] text-primary',
                !done && !active && 'border-border bg-[var(--bg-2)] text-[var(--fg-2)]',
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {i < steps - 1 && (
              <span
                className={cn(
                  'h-px w-10 md:w-14',
                  done ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-[var(--fg-2)]">
        Step {Math.min(current + 1, steps)} of {steps}
      </span>
    </div>
  )
}

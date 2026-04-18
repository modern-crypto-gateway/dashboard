import { cn } from '@/lib/utils'

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <span
        aria-hidden
        className="grid place-items-center rounded-[7px] bg-foreground text-background font-mono"
        style={{ width: size, height: size, fontSize: size - 15 }}
      >
        ◆
      </span>
      <span className="text-[15px]">
        Gateway<span className="text-[var(--fg-2)]"> Dashboard</span>
      </span>
    </span>
  )
}

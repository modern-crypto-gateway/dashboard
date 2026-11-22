import { cn } from '@/lib/utils'

/** Ledger mark: three rules of decreasing length, the last one in accent. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[7px] bg-foreground', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2.5" width="12" height="2.4" rx="1.2" className="fill-background" />
        <rect x="2" y="6.8" width="9" height="2.4" rx="1.2" className="fill-background" opacity="0.75" />
        <rect x="2" y="11.1" width="6" height="2.4" rx="1.2" fill="var(--accent)" />
      </svg>
    </span>
  )
}

export function Logo({
  className,
  size = 28,
  compact = false,
}: {
  className?: string
  size?: number
  compact?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-base font-semibold tracking-[-0.01em]">Gateway</span>
          <span className="mt-0.5 text-2xs text-[var(--fg-2)]">Operator console</span>
        </span>
      )}
    </span>
  )
}

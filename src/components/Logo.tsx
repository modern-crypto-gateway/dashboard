import { cn } from '@/lib/utils'

/** Mark: a signal-coloured tile with an ink "G" built from a ledger rule. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[9px] bg-signal shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 20 20" fill="none">
        <path
          d="M15.5 6.2A6.5 6.5 0 1 0 16.5 11H10.5"
          stroke="#111112"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        <span className="text-[15px] font-semibold tracking-[-0.02em]">Gateway</span>
      )}
    </span>
  )
}

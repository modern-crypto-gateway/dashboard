import { chainInfo } from '@/lib/chains'
import { cn } from '@/lib/utils'

/** Chain name with its colour dot. Chain hue appears only as this dot. */
export function ChainPill({
  chainId,
  className,
}: {
  chainId: number
  className?: string
}) {
  const info = chainInfo(chainId)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--fg-1)]', className)}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: info.color }}
      />
      <span className="truncate">{info.name}</span>
    </span>
  )
}

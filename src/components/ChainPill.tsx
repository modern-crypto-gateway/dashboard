import { chainInfo } from '@/lib/chains'
import { cn } from '@/lib/utils'
import { ChainIcon } from './CryptoIcon'

/** Network logo + name. `iconOnly` keeps the name in the tooltip. */
export function ChainPill({
  chainId,
  className,
  iconOnly,
  size = 18,
}: {
  chainId: number
  className?: string
  iconOnly?: boolean
  size?: number
}) {
  const info = chainInfo(chainId)
  return (
    <span
      title={info.name}
      className={cn('inline-flex min-w-0 items-center gap-2 text-sm text-[var(--fg-1)]', className)}
    >
      <ChainIcon chainId={chainId} size={size} />
      {!iconOnly && <span className="truncate">{info.name}</span>}
    </span>
  )
}

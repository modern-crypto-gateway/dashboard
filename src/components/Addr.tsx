import { explorerAddressUrl, explorerTxUrl } from '@/lib/chains'
import { cn } from '@/lib/utils'
import { CopyButton } from './CopyButton'
import { ExternalLink } from './icons'

const truncate = (s: string, a = 6, b = 4) =>
  s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s

/**
 * Address or tx hash in mono with copy, plus an explorer link icon when the
 * chain has a known public explorer (pass `chainId`, and `kind="tx"` for hashes).
 */
export function Addr({
  value,
  truncated = true,
  chainId,
  kind = 'address',
  className,
}: {
  value: string
  truncated?: boolean
  chainId?: number
  kind?: 'address' | 'tx'
  className?: string
}) {
  const href =
    chainId != null
      ? kind === 'tx'
        ? explorerTxUrl(chainId, value)
        : explorerAddressUrl(chainId, value)
      : null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5', className)}>
      <span className="mr-1 truncate font-mono text-xs" title={value}>
        {truncated ? truncate(value) : value}
      </span>
      <CopyButton value={value} />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          title={kind === 'tx' ? 'Open transaction in explorer' : 'Open address in explorer'}
          aria-label={kind === 'tx' ? 'Open transaction in explorer' : 'Open address in explorer'}
          className="inline-grid size-6 shrink-0 place-items-center rounded-md text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  )
}

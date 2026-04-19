import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'

import { api } from '@/lib/api'
import type { ChainInventoryEntry, ChainToken } from '@/lib/types'

import { Field } from '@/components/Field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type ChainTokenSelection = {
  chainId: number
  token: string
  chain: ChainInventoryEntry
  tokenMeta: ChainToken
}

type Props = {
  chainId: string
  token: string
  onChange: (next: {
    chainId: string
    token: string
    chain?: ChainInventoryEntry
    tokenMeta?: ChainToken
  }) => void
  /** Filter predicate for chains. Defaults to wired chains. */
  filter?: (c: ChainInventoryEntry) => boolean
  emptyHint?: string
  chainLabel?: string
  tokenLabel?: string
}

export function ChainTokenPicker({
  chainId,
  token,
  onChange,
  filter = (c) => c.wired,
  emptyHint = 'No chains available.',
  chainLabel = 'Chain',
  tokenLabel = 'Token',
}: Props) {
  const q = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  })

  const chains = React.useMemo(
    () =>
      (q.data?.chains ?? [])
        .filter(filter)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [q.data, filter],
  )

  const selectedChain = React.useMemo(
    () => chains.find((c) => String(c.chainId) === chainId),
    [chains, chainId],
  )

  const tokens = selectedChain?.tokens ?? []
  const selectedToken = tokens.find(
    (t) => t.symbol.toUpperCase() === token.toUpperCase(),
  )

  // When the chain list loads, auto-pick the first chain if the current id isn't in it.
  React.useEffect(() => {
    if (q.isLoading || chains.length === 0) return
    if (selectedChain) return
    const first = chains[0]
    const firstTok = first.tokens[0]
    onChange({
      chainId: String(first.chainId),
      token: firstTok?.symbol ?? '',
      chain: first,
      tokenMeta: firstTok,
    })
  }, [q.isLoading, chains, selectedChain, onChange])

  // If the selected token doesn't exist on the selected chain, snap to the chain's first token.
  React.useEffect(() => {
    if (!selectedChain) return
    if (selectedToken) return
    const first = selectedChain.tokens[0]
    if (!first) return
    onChange({
      chainId: String(selectedChain.chainId),
      token: first.symbol,
      chain: selectedChain,
      tokenMeta: first,
    })
  }, [selectedChain, selectedToken, onChange])

  const handleChainChange = (next: string) => {
    const chain = chains.find((c) => String(c.chainId) === next)
    const firstTok = chain?.tokens[0]
    onChange({
      chainId: next,
      token: firstTok?.symbol ?? '',
      chain,
      tokenMeta: firstTok,
    })
  }

  const handleTokenChange = (sym: string) => {
    const tokenMeta = tokens.find((t) => t.symbol === sym)
    onChange({
      chainId,
      token: sym,
      chain: selectedChain,
      tokenMeta,
    })
  }

  if (q.isError) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="size-3.5" />
        Could not load chains. Check admin key in settings.
      </div>
    )
  }

  if (!q.isLoading && chains.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        <AlertTriangle className="size-3.5" />
        {emptyHint}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={chainLabel}>
          <Select
            value={chainId}
            onValueChange={handleChainChange}
            disabled={q.isLoading}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={q.isLoading ? 'Loading…' : 'Select chain'}
              />
            </SelectTrigger>
            <SelectContent>
              {chains.map((c) => (
                <SelectItem key={c.chainId} value={String(c.chainId)}>
                  <span className="flex items-center gap-2">
                    <span>{c.displayName}</span>
                    <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
                      {c.chainId}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={tokenLabel}>
          <Select
            value={token}
            onValueChange={handleTokenChange}
            disabled={!selectedChain || tokens.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select token" />
            </SelectTrigger>
            <SelectContent>
              {tokens.map((t) => (
                <SelectItem key={t.symbol} value={t.symbol}>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{t.symbol}</span>
                    {t.isStable && (
                      <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-success">
                        stable
                      </span>
                    )}
                    <span className="text-[11px] text-[var(--fg-3)]">
                      {t.displayName}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {selectedChain && selectedToken && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-2)]">
          <span>
            decimals{' '}
            <span className="font-mono text-[var(--fg-1)]">
              {selectedToken.decimals}
            </span>
          </span>
          {selectedToken.contractAddress && (
            <span className="truncate">
              contract{' '}
              <span className="font-mono text-[var(--fg-1)]">
                {selectedToken.contractAddress}
              </span>
            </span>
          )}
          {!selectedChain.bootstrapReady && (
            <span className="inline-flex items-center gap-1 text-warn">
              <AlertTriangle className="size-3" />
              not bootstrap-ready
            </span>
          )}
        </div>
      )}
    </div>
  )
}

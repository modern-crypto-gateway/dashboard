import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  Search,
  Split,
  X,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import {
  decimalPlaces,
  fmtLocal,
  fmtNum,
  fmtRel,
  fmtUsd,
  formatUnits,
  truncateAddr,
} from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import type {
  BalancesSnapshot,
  ChainInventoryEntry,
  ChainToken,
  FeeTier,
  GatewayPayout,
  Merchant,
  PayoutEstimate,
  PayoutListResponse,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainTokenPicker } from '@/components/ChainTokenPicker'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'

import { StatusBadge } from './Invoices'

function useTokenAvailable(
  chainId: number | null,
  token: string,
  enabled: boolean,
) {
  const q = useQuery({
    enabled,
    queryKey: ['gw', 'balances', 'db'] as const,
    queryFn: () =>
      api<{ snapshot: BalancesSnapshot; cached: boolean }>(
        '/api/gw/admin/balances',
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const match = React.useMemo(() => {
    if (!chainId || !token || !q.data) return null
    for (const f of q.data.snapshot.families) {
      for (const c of f.chains) {
        if (c.chainId !== chainId) continue
        const tok = c.tokens.find(
          (t) => t.token.toUpperCase() === token.toUpperCase(),
        )
        if (tok) return tok
      }
    }
    return null
  }, [chainId, token, q.data])

  return { match, loading: q.isLoading }
}

function useChainTokenLookup() {
  const q = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  })
  const lookup = React.useCallback(
    (chainId: number, symbol: string): ChainToken | undefined => {
      const chain = q.data?.chains.find((c) => c.chainId === chainId)
      return chain?.tokens.find(
        (t) => t.symbol.toUpperCase() === symbol.toUpperCase(),
      )
    },
    [q.data],
  )
  return lookup
}

type PayoutFilter = 'all' | 'pending' | 'confirmed' | 'failed'

const STATUS_CSV: Record<PayoutFilter, string | undefined> = {
  all: undefined,
  pending: 'planned,reserved,submitted',
  confirmed: 'confirmed',
  failed: 'failed,canceled',
}

const PAGE_SIZE = 50

const payoutsQueryKey = (
  merchantId: string | null,
  filter: PayoutFilter,
  batchId: string | null,
) => ['payouts', 'list', merchantId, filter, batchId] as const

export function PayoutsPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const [searchParams, setSearchParams] = useSearchParams()
  const batchIdFilter = searchParams.get('batchId')
  const setBatchIdFilter = React.useCallback(
    (bid: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (bid) next.set('batchId', bid)
          else next.delete('batchId')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<PayoutFilter>('all')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  const list = useInfiniteQuery({
    enabled: canList,
    queryKey: payoutsQueryKey(active?.id ?? null, filter, batchIdFilter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      })
      const s = STATUS_CSV[filter]
      if (s) qs.set('status', s)
      if (batchIdFilter) qs.set('batchId', batchIdFilter)
      return api<PayoutListResponse>(
        `/api/mg/${encodeURIComponent(active!.id)}/payouts?${qs}`,
      )
    },
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    refetchInterval: 30_000,
  })

  const all = React.useMemo(
    () => list.data?.pages.flatMap((p) => p.payouts) ?? [],
    [list.data],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (po) =>
        po.id.toLowerCase().includes(q) ||
        po.destinationAddress.toLowerCase().includes(q) ||
        po.token.toLowerCase().includes(q),
    )
  }, [all, query])

  if (merchants.isLoading) {
    return <PageSkeleton />
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchants />
  }

  return (
    <div className="fade-in space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payouts</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Plan payouts and watch them land. The gateway signs and broadcasts
            on its own schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MerchantSwitcher />
          <Button
            size="sm"
            variant="outline"
            disabled={!canList}
            asChild={canList}
          >
            {canList ? (
              <Link to="/payouts/batch">
                <Layers className="size-3.5" /> Batch create
              </Link>
            ) : (
              <span>
                <Layers className="size-3.5" /> Batch create
              </span>
            )}
          </Button>
          <Button size="sm" disabled={!canList} onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> Plan payout
          </Button>
        </div>
      </div>

      {!canList && active ? (
        <NoApiKeyCard merchant={active} />
      ) : (
        <>
          <Toolbar
            query={query}
            setQuery={setQuery}
            filter={filter}
            setFilter={setFilter}
            batchIdFilter={batchIdFilter}
            clearBatchFilter={() => setBatchIdFilter(null)}
            loaded={all.length}
          />

          {list.isLoading ? (
            <ListSkeleton />
          ) : list.isError ? (
            <ErrorCard message={list.error instanceof Error ? list.error.message : 'Could not load'} />
          ) : all.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : filtered.length === 0 ? (
            <NoMatch />
          ) : (
            <>
              <PayoutList rows={filtered} onOpen={setDetailId} />
              {list.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => list.fetchNextPage()}
                    disabled={list.isFetchingNextPage}
                  >
                    {list.isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Loading…
                      </>
                    ) : (
                      <>Load more</>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {active && canList && (
        <>
          <CreatePayoutDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            merchantId={active.id}
            onCreated={(id) => setDetailId(id)}
          />
          <PayoutDetailSheet
            merchantId={active.id}
            payoutId={detailId}
            onOpenChange={(v) => !v && setDetailId(null)}
            onOpenBatch={(bid) => {
              setBatchIdFilter(bid)
              setFilter('all')
              setDetailId(null)
            }}
          />
        </>
      )}
    </div>
  )
}

/* ── toolbar / list / row ──────────────────────────────── */

function Toolbar({
  query,
  setQuery,
  filter,
  setFilter,
  batchIdFilter,
  clearBatchFilter,
  loaded,
}: {
  query: string
  setQuery: (v: string) => void
  filter: PayoutFilter
  setFilter: (v: PayoutFilter) => void
  batchIdFilter: string | null
  clearBatchFilter: () => void
  loaded: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--fg-3)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search loaded by id, destination, token…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as PayoutFilter)}>
            <SelectTrigger className="h-9 w-[150px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <div className="hidden text-xs text-[var(--fg-3)] sm:block">
            {loaded} loaded
          </div>
        </div>
      </div>
      {batchIdFilter && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-1.5 text-[11.5px]">
          <Layers className="size-3.5 text-primary" />
          <span className="text-[var(--fg-2)]">Scoped to batch</span>
          <span className="font-mono text-primary">
            {truncateAddr(batchIdFilter, 10, 6)}
          </span>
          <CopyButton value={batchIdFilter} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearBatchFilter}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
          >
            <X className="size-3" /> Clear
          </button>
        </div>
      )}
    </div>
  )
}

function PayoutList({
  rows,
  onOpen,
}: {
  rows: GatewayPayout[]
  onOpen: (id: string) => void
}) {
  const lookup = useChainTokenLookup()
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[1fr_120px_160px_170px_100px_90px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)] sm:grid">
        <div>Payout</div>
        <div>Chain</div>
        <div>Amount</div>
        <div>Destination</div>
        <div>Status</div>
        <div>Updated</div>
      </div>
      <ul>
        {rows.map((po) => (
          <PayoutRow
            key={po.id}
            po={po}
            lookup={lookup}
            onOpen={() => onOpen(po.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function unixOf(iso: string): number {
  const t = Date.parse(iso)
  return isFinite(t) ? Math.floor(t / 1000) : 0
}

function PayoutRow({
  po,
  lookup,
  onOpen,
}: {
  po: GatewayPayout
  lookup: (chainId: number, symbol: string) => ChainToken | undefined
  onOpen: () => void
}) {
  const meta = lookup(po.chainId, po.token)
  const formatted = meta ? formatUnits(po.amountRaw, meta.decimals) : po.amountRaw
  return (
    <li className="border-b border-border last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="grid w-full cursor-pointer grid-cols-1 items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[1fr_120px_160px_170px_100px_90px] sm:gap-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12.5px]">
              {truncateAddr(po.id, 8, 6)}
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              <CopyButton value={po.id} />
            </span>
            {po.feeTier && <FeeTierBadge tier={po.feeTier} />}
            {po.allowMultiSource && (
              <span
                className="inline-flex items-center text-[var(--fg-3)]"
                title="allowMultiSource: may split across wallets"
              >
                <Split className="size-3" />
              </span>
            )}
            {po.batchId && (
              <span
                className="inline-flex items-center text-[var(--fg-3)]"
                title={`batch ${po.batchId}`}
              >
                <Layers className="size-3" />
              </span>
            )}
          </div>
        </div>

        <ChainPill chainId={po.chainId} />

        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px] tabular-nums">
            {formatted}{' '}
            <span className="text-[var(--fg-3)]">{po.token}</span>
          </div>
          {po.quotedAmountUsd && (
            <div className="font-mono text-[11px] text-[var(--fg-3)]">
              quoted {fmtUsd(po.quotedAmountUsd)}
            </div>
          )}
        </div>

        <div className="min-w-0 font-mono text-[12.5px] text-[var(--fg-2)]">
          <span className="truncate">{truncateAddr(po.destinationAddress, 6, 4)}</span>
        </div>

        <div>
          <StatusBadge status={po.status} />
        </div>

        <div className="text-xs text-[var(--fg-3)]">
          {fmtRel(unixOf(po.updatedAt))}
        </div>
      </div>
    </li>
  )
}

function FeeTierBadge({ tier }: { tier: FeeTier }) {
  const label = tier === 'low' ? 'low' : tier === 'medium' ? 'med' : 'high'
  const variant =
    tier === 'high' ? 'warn' : tier === 'low' ? 'outline' : 'default'
  return (
    <Badge variant={variant} className="px-1.5 py-0 text-[9.5px] tracking-wider uppercase">
      {label}
    </Badge>
  )
}

function ChainPill({ chainId }: { chainId: number }) {
  const info = chainInfo(chainId)
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--fg-2)]">
      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: info.color }}
      />
      <span className="truncate">{info.name}</span>
    </span>
  )
}

/* ── detail sheet ──────────────────────────────────────── */

function PayoutDetailSheet({
  merchantId,
  payoutId,
  onOpenChange,
  onOpenBatch,
}: {
  merchantId: string
  payoutId: string | null
  onOpenChange: (open: boolean) => void
  onOpenBatch: (batchId: string) => void
}) {
  const open = payoutId !== null
  const lookup = useChainTokenLookup()
  const detail = useQuery({
    enabled: open,
    queryKey: ['payout', merchantId, payoutId] as const,
    queryFn: () =>
      api<{ payout: GatewayPayout }>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts/${encodeURIComponent(payoutId!)}`,
      ),
    refetchInterval: open ? 10_000 : false,
  })

  const po = detail.data?.payout
  const meta = po ? lookup(po.chainId, po.token) : undefined

  // Multi-leg: prefer explicit txHashes[]; fall back to the single-leg txHash scalar.
  const legHashes = po
    ? po.txHashes && po.txHashes.length > 0
      ? po.txHashes
      : po.txHash
        ? [po.txHash]
        : []
    : []
  const legSources = po
    ? po.sourceAddresses && po.sourceAddresses.length > 0
      ? po.sourceAddresses
      : po.sourceAddress
        ? [po.sourceAddress]
        : []
    : []
  const isMultiLeg = legHashes.length > 1 || legSources.length > 1
  const orphanLegs =
    po?.status === 'failed' && (po.txHashes?.length ?? 0) > 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <SheetTitle className="truncate font-mono text-base">
              {payoutId ? truncateAddr(payoutId, 10, 8) : ''}
            </SheetTitle>
            {payoutId && <CopyButton value={payoutId} />}
            {po && <StatusBadge status={po.status} />}
            {po?.feeTier && <FeeTierBadge tier={po.feeTier} />}
          </div>
        </SheetHeader>

        <SheetBody>
          {detail.isLoading ? (
            <DetailSkeleton />
          ) : !po ? (
            <div className="py-8 text-center text-sm text-destructive">
              {detail.error instanceof Error ? detail.error.message : 'Not found'}
            </div>
          ) : (
            <div className="space-y-5">
              {orphanLegs && (
                <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="size-4 shrink-0" />
                    <div className="text-sm font-semibold">
                      Orphan on-chain legs detected
                    </div>
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-destructive/90">
                    This payout failed, but {po.txHashes!.length} leg
                    {po.txHashes!.length === 1 ? ' was' : 's were'} already
                    broadcast on-chain. Manual reconciliation required —{' '}
                    <span className="font-semibold">do not retry</span>.
                  </div>
                </div>
              )}

              <KV>
                <KVItem label="Chain">
                  <ChainPill chainId={po.chainId} />
                </KVItem>
                <KVItem label="Token">
                  <span className="font-mono">{po.token}</span>
                </KVItem>
                <KVItem label="Amount">
                  <div className="space-y-0.5">
                    <div className="font-mono tabular-nums">
                      {meta
                        ? `${formatUnits(po.amountRaw, meta.decimals)} ${po.token}`
                        : `${po.amountRaw} (raw)`}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--fg-3)]">
                      raw {po.amountRaw}
                    </div>
                  </div>
                </KVItem>
                {po.quotedAmountUsd && (
                  <KVItem label="Quoted" wide>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-mono font-semibold">
                        {fmtUsd(po.quotedAmountUsd)}
                      </span>
                      {po.quotedRate && (
                        <span className="text-[11px] text-[var(--fg-2)]">
                          quoted at{' '}
                          <span className="font-mono">
                            ${po.quotedRate}/{po.token}
                          </span>{' '}
                          at create time
                        </span>
                      )}
                    </div>
                  </KVItem>
                )}

                <KVItem label="Fee tier">
                  {po.feeTier ? (
                    <FeeTierBadge tier={po.feeTier} />
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </KVItem>
                <KVItem label="Multi-source">
                  <span className="font-mono text-xs">
                    {po.allowMultiSource ? 'enabled' : 'off'}
                  </span>
                </KVItem>

                <KVItem label="Fee estimate">
                  <span className="font-mono">
                    {po.feeEstimateNative ?? '—'}
                  </span>
                </KVItem>
                <KVItem label="Fee quoted">
                  <span className="font-mono">
                    {po.feeQuotedNative ?? '—'}
                  </span>
                </KVItem>
                {po.feeQuotedNative &&
                  po.feeEstimateNative &&
                  po.feeQuotedNative !== po.feeEstimateNative && (
                    <KVItem label="Gas drift" wide>
                      <FeeDrift
                        quoted={po.feeQuotedNative}
                        actual={po.feeEstimateNative}
                      />
                    </KVItem>
                  )}

                <KVItem label="Destination" wide>
                  <Addr value={po.destinationAddress} truncated={false} />
                </KVItem>

                <KVItem label={isMultiLeg ? 'Source wallets' : 'Source'} wide>
                  {legSources.length === 0 ? (
                    <span className="text-[var(--fg-2)]">—</span>
                  ) : legSources.length === 1 ? (
                    <Addr value={legSources[0]} truncated={false} />
                  ) : (
                    <ul className="space-y-1">
                      {legSources.map((a, i) => (
                        <li key={`${a}-${i}`} className="flex items-center gap-2">
                          <span className="text-[11px] text-[var(--fg-3)]">
                            #{i + 1}
                          </span>
                          <Addr value={a} truncated={false} />
                        </li>
                      ))}
                    </ul>
                  )}
                </KVItem>

                <KVItem label={isMultiLeg ? 'Tx hashes' : 'Tx hash'} wide>
                  {legHashes.length === 0 ? (
                    <span className="text-[var(--fg-2)]">pending</span>
                  ) : legHashes.length === 1 ? (
                    <Addr value={legHashes[0]} truncated={false} />
                  ) : (
                    <ul className="space-y-1">
                      {legHashes.map((h, i) => (
                        <li key={`${h}-${i}`} className="flex items-center gap-2">
                          <span className="text-[11px] text-[var(--fg-3)]">
                            #{i + 1}
                          </span>
                          <Addr value={h} truncated={false} />
                        </li>
                      ))}
                    </ul>
                  )}
                </KVItem>

                <KVItem label="Created">
                  <span className="font-mono text-xs">{fmtLocal(po.createdAt)}</span>
                </KVItem>
                <KVItem label="Broadcast attempt">
                  <span className="font-mono text-xs">
                    {po.broadcastAttemptedAt
                      ? fmtLocal(po.broadcastAttemptedAt)
                      : '—'}
                  </span>
                </KVItem>
                <KVItem label="Submitted">
                  <span className="font-mono text-xs">
                    {po.submittedAt ? fmtLocal(po.submittedAt) : '—'}
                  </span>
                </KVItem>
                <KVItem label="Confirmed">
                  <span className="font-mono text-xs">
                    {po.confirmedAt ? fmtLocal(po.confirmedAt) : '—'}
                  </span>
                </KVItem>

                {po.batchId && (
                  <KVItem label="Batch" wide>
                    <button
                      type="button"
                      onClick={() => onOpenBatch(po.batchId!)}
                      className="group inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
                    >
                      <Layers className="size-3.5" />
                      {truncateAddr(po.batchId, 10, 6)}
                      <span className="text-[10px] uppercase tracking-wider text-[var(--fg-3)] group-hover:text-primary">
                        view batch
                      </span>
                    </button>
                  </KVItem>
                )}
              </KV>

              {po.lastError && (
                <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
                  <div className="eyebrow mb-1 text-destructive">last error</div>
                  <div className="whitespace-pre-wrap break-all font-mono text-xs text-destructive">
                    {po.lastError}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function FeeDrift({ quoted, actual }: { quoted: string; actual: string }) {
  const q = parseFloat(quoted)
  const a = parseFloat(actual)
  if (!isFinite(q) || !isFinite(a) || q <= 0) {
    return (
      <span className="font-mono text-xs text-[var(--fg-2)]">
        {quoted} → {actual}
      </span>
    )
  }
  const pct = ((a - q) / q) * 100
  const up = pct > 0
  const color = Math.abs(pct) < 10 ? 'text-[var(--fg-2)]' : up ? 'text-warn' : 'text-success'
  return (
    <span className={`font-mono text-xs ${color}`}>
      {quoted} → {actual}
      <span className="ml-1.5 text-[10.5px]">
        ({up ? '+' : ''}
        {pct.toFixed(1)}%)
      </span>
    </span>
  )
}

function KV({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
      {children}
    </dl>
  )
}

function KVItem({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/* ── skeletons / empty / error ──────────────────────────── */

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_120px_160px_170px_100px_90px] items-center gap-4 border-b border-border px-5 py-3 last:border-0"
        >
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-10" />
          </div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="fade-in space-y-5">
      <div>
        <div className="eyebrow">Money</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payouts</h1>
      </div>
      <ListSkeleton />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <ArrowUpDown className="size-5 text-[var(--fg-2)]" />
      </div>
      <div>
        <div className="text-sm font-medium">No payouts yet</div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          Plan your first payout to move funds to a destination address.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="size-3.5" /> Plan payout
      </Button>
    </div>
  )
}

function NoMatch() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-[var(--fg-2)]">
      No loaded payouts match your search.
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  )
}

function NoApiKeyCard({ merchant }: { merchant: Merchant }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <KeyRound className="size-5 text-[var(--fg-2)]" />
      </div>
      <div>
        <div className="text-sm font-medium">
          No API key for <span className="font-mono text-xs">{merchant.name}</span>
        </div>
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-2)]">
          The gateway sees this merchant, but no sealed API key is held here.
          Rotate or import the key from Merchants to list payouts.
        </p>
      </div>
      <Button size="sm" asChild>
        <Link to="/merchants">
          <KeyRound className="size-3.5" /> Set up API key
        </Link>
      </Button>
    </div>
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">Money</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payouts</h1>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
          <ArrowUpDown className="size-5 text-[var(--fg-2)]" />
        </div>
        <div className="text-sm font-medium">Add a merchant first</div>
        <p className="text-xs text-[var(--fg-2)]">
          Payouts are scoped to a merchant's API key.
        </p>
        <Button size="sm" asChild>
          <Link to="/merchants">
            <ChevronDown className="size-3.5 -rotate-90" /> Go to Merchants
          </Link>
        </Button>
      </div>
    </div>
  )
}

/* ── create payout ──────────────────────────────────────── */

type PayoutAmountMode = 'raw' | 'amount' | 'usd'

const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d+)?$/
const RAW_RE = /^\d+$/

function FeeTierPicker({
  estimate,
  nativeDecimals,
  loading,
  error,
  errorMessage,
  ready,
  selected,
  onSelect,
}: {
  estimate: PayoutEstimate | null
  nativeDecimals: number | null
  loading: boolean
  error: string | null | undefined
  errorMessage: string | null
  ready: boolean
  selected: FeeTier
  onSelect: (t: FeeTier) => void
}) {
  if (!ready) {
    return (
      <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] px-3 py-2.5 text-[11.5px] text-[var(--fg-3)]">
        Fill chain, token, amount, and destination to see fee tiers.
      </div>
    )
  }

  if (loading && !estimate) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5 text-[11.5px] text-[var(--fg-2)]">
        <Loader2 className="size-3 animate-spin" />
        Estimating fees…
      </div>
    )
  }

  if (error || !estimate) {
    const retriable = error === 'FEE_ESTIMATE_FAILED'
    return (
      <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-[11.5px] text-warn">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-3.5" />
          {errorMessage ?? 'Could not estimate fees.'}
        </div>
        <div className="mt-1 text-[var(--fg-2)]">
          {retriable
            ? 'The planned payout can still go through — the gateway will estimate at broadcast time.'
            : 'Submitting without an estimate; the gateway will try its default tier.'}
        </div>
      </div>
    )
  }

  const { tiers } = estimate
  const fmtNative = (raw: string) =>
    nativeDecimals == null
      ? `${raw} (raw)`
      : `${formatUnits(raw, nativeDecimals)} ${tiers.nativeSymbol}`

  if (!tiers.tieringSupported) {
    const t = tiers.medium
    return (
      <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5">
        <div className="eyebrow mb-1">Network fee</div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12.5px] tabular-nums">
            {fmtNative(t.nativeAmountRaw)}
          </span>
          {t.usdAmount && (
            <span className="text-[11px] text-[var(--fg-3)]">
              ~{fmtUsd(t.usdAmount)}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-[var(--fg-3)]">
          This chain does not support fee tiering.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Fee tier</div>
        {loading && (
          <Loader2 className="size-3 animate-spin text-[var(--fg-3)]" />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['low', 'medium', 'high'] as const).map((t) => {
          const q = tiers[t]
          const active = selected === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={
                'rounded-md border px-2.5 py-2 text-left transition-colors ' +
                (active
                  ? 'border-primary bg-[var(--accent-bg)] ring-1 ring-primary'
                  : 'border-border bg-[var(--bg-2)] hover:border-[var(--fg-3)]')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--fg-2)]">
                  {t}
                </span>
                {q.usdAmount && (
                  <span className="font-mono text-[11px] text-[var(--fg-2)]">
                    {fmtUsd(q.usdAmount)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11.5px] tabular-nums">
                {fmtNative(q.nativeAmountRaw)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return v
}

/**
 * Build the request body for /payouts and /payouts/estimate. Shared because
 * both endpoints take the same amount-input / destination fields.
 */
function buildPayoutBody(args: {
  chainId: string
  token: string
  mode: PayoutAmountMode
  amount: string
  destinationAddress: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chainId: parseInt(args.chainId, 10),
    token: args.token.toUpperCase(),
    destinationAddress: args.destinationAddress.trim(),
  }
  if (args.mode === 'raw') body.amountRaw = args.amount
  else if (args.mode === 'amount') body.amount = args.amount
  else body.amountUSD = args.amount
  return body
}

function payoutErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_FEE_TIER':
        return 'Unsupported fee tier for this chain — picking medium.'
      case 'FEE_ESTIMATE_FAILED':
        return 'Fee estimate temporarily unavailable. Try again in a moment.'
      case 'BATCH_TOO_LARGE':
        return 'Batch exceeds 100 rows. Split the file and retry.'
      case 'INSUFFICIENT_TOTAL_BALANCE':
        return 'Even the sum of every fee wallet falls short. Top up before retrying.'
      case 'ORACLE_FAILED':
        return 'Price oracle unreachable — USD pegging unavailable right now.'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : 'Could not plan payout'
}

function CreatePayoutDialog({
  open,
  onOpenChange,
  merchantId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  merchantId: string
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const lookup = useChainTokenLookup()
  const [chainId, setChainId] = React.useState('')
  const [token, setToken] = React.useState('')
  const [tokenMeta, setTokenMeta] = React.useState<ChainToken | null>(null)
  const [mode, setMode] = React.useState<PayoutAmountMode>('amount')
  const [amount, setAmount] = React.useState('')
  const [destinationAddress, setDestinationAddress] = React.useState('')
  const [feeTier, setFeeTier] = React.useState<FeeTier>('medium')
  const [allowMultiSource, setAllowMultiSource] = React.useState(false)
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')

  const webhookMismatch =
    (webhookUrl.trim() !== '' && webhookSecret.trim() === '') ||
    (webhookUrl.trim() === '' && webhookSecret.trim() !== '')
  const webhookSecretValid =
    webhookUrl.trim() === '' ||
    (webhookSecret.trim().length >= 16 && webhookSecret.trim().length <= 512)

  const amountFormatError = React.useMemo(() => {
    if (amount === '') return null
    if (mode === 'raw') {
      return RAW_RE.test(amount)
        ? null
        : 'Raw amount must be a non-negative integer.'
    }
    if (!DECIMAL_RE.test(amount)) {
      return 'Enter a non-negative decimal (e.g. 1.5).'
    }
    if (mode === 'amount' && tokenMeta) {
      const places = decimalPlaces(amount)
      if (places > tokenMeta.decimals) {
        return `${token} allows at most ${tokenMeta.decimals} decimal places.`
      }
    }
    return null
  }, [amount, mode, tokenMeta, token])

  const showRateDrift =
    mode === 'usd' && tokenMeta != null && !tokenMeta.isStable

  const available = useTokenAvailable(
    chainId ? parseInt(chainId, 10) : null,
    token,
    open && !!chainId && !!token,
  )

  /* ── fee estimate ───────────────────────────────────── */

  const debouncedAmount = useDebouncedValue(amount, 500)
  const debouncedDest = useDebouncedValue(destinationAddress.trim(), 500)
  const estimateReady =
    open &&
    RAW_RE.test(chainId) &&
    /^[A-Z0-9]+$/.test(token) &&
    debouncedAmount !== '' &&
    amountFormatError === null &&
    debouncedDest.length > 0

  const estimate = useQuery<PayoutEstimate>({
    enabled: estimateReady,
    queryKey: [
      'payouts',
      'estimate',
      merchantId,
      chainId,
      token,
      mode,
      debouncedAmount,
      debouncedDest,
    ] as const,
    queryFn: () =>
      api<PayoutEstimate>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts/estimate`,
        {
          method: 'POST',
          body: JSON.stringify(
            buildPayoutBody({
              chainId,
              token,
              mode,
              amount: debouncedAmount,
              destinationAddress: debouncedDest,
            }),
          ),
        },
      ),
    retry: false,
    staleTime: 10_000,
  })

  // If the estimate says the chain doesn't tier, the submit body uses this
  // derived value instead of whatever is in `feeTier` — belt & braces in case
  // the user flipped tier before the estimate came back.
  const tieringSupported = estimate.data?.tiers.tieringSupported !== false
  const effectiveFeeTier: FeeTier = tieringSupported ? feeTier : 'medium'

  const nativeDecimals = React.useMemo(() => {
    const tiers = estimate.data?.tiers
    if (!tiers) return null
    if (typeof tiers.nativeDecimals === 'number') return tiers.nativeDecimals
    const cid = parseInt(chainId, 10)
    if (!isFinite(cid)) return null
    const meta = lookup(cid, tiers.nativeSymbol)
    return meta?.decimals ?? null
  }, [estimate.data, chainId, lookup])

  /* ── submit ──────────────────────────────────────────── */

  const create = useMutation({
    mutationFn: () => {
      const body = buildPayoutBody({
        chainId,
        token,
        mode,
        amount,
        destinationAddress,
      })
      // Only send a tier when the chain actually supports tiering; otherwise
      // the backend would reject it or quietly ignore it.
      if (tieringSupported) {
        body.feeTier = effectiveFeeTier
      }
      if (allowMultiSource) body.allowMultiSource = true
      if (webhookUrl.trim()) {
        body.webhookUrl = webhookUrl.trim()
        body.webhookSecret = webhookSecret.trim()
      }
      return api<{ payout: { id: string } }>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: (res) => {
      toast.success('Payout planned')
      qc.invalidateQueries({ queryKey: ['payouts', 'list', merchantId] })
      setAmount('')
      setDestinationAddress('')
      onOpenChange(false)
      onCreated(res.payout.id)
    },
    onError: (e: unknown) => toast.error(payoutErrorMessage(e)),
  })

  const canSubmit =
    RAW_RE.test(chainId) &&
    /^[A-Z0-9]+$/.test(token) &&
    amount !== '' &&
    amountFormatError === null &&
    destinationAddress.trim().length > 0 &&
    !webhookMismatch &&
    webhookSecretValid

  const amountLabel =
    mode === 'raw'
      ? `Amount (raw integer${tokenMeta ? `, ${tokenMeta.decimals} decimals` : ''})`
      : mode === 'amount'
        ? `Amount (${token || 'token'})`
        : 'Amount (USD)'

  const amountHint =
    mode === 'raw'
      ? 'Smallest on-chain unit (wei / satoshi-equivalent).'
      : mode === 'amount'
        ? tokenMeta
          ? `Human decimal. Max ${tokenMeta.decimals} decimal places.`
          : 'Human decimal.'
        : 'USD value. Gateway locks the rate at create time via the price oracle.'

  const placeholder =
    mode === 'raw' ? '1000000' : mode === 'amount' ? '1.5' : '10.00'

  const useMax = () => {
    const m = available.match
    if (!m) return
    if (mode === 'raw') setAmount(m.amountRaw)
    else if (mode === 'amount') setAmount(m.amountDecimal)
    else setAmount(m.usd)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan payout</DialogTitle>
          <DialogDescription>
            Creates the payout in <span className="font-mono">planned</span>{' '}
            state. The gateway will reserve a fee wallet, sign, and broadcast on
            its next scheduler tick.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <ChainTokenPicker
            chainId={chainId}
            token={token}
            onChange={({ chainId: c, token: t, tokenMeta: m }) => {
              setChainId(c)
              setToken(t)
              setTokenMeta(m ?? null)
            }}
            filter={(c) => c.bootstrapReady}
            emptyHint="No bootstrap-ready chains. Register a fee wallet from Chains first."
          />

          <Field label="Amount mode">
            <div className="inline-flex rounded-md border border-border bg-[var(--bg-2)] p-0.5">
              {(
                [
                  { k: 'amount', label: 'Token amount' },
                  { k: 'raw', label: 'Raw' },
                  { k: 'usd', label: 'USD' },
                ] as Array<{ k: PayoutAmountMode; label: string }>
              ).map((opt) => {
                const active = mode === opt.k
                return (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => {
                      setMode(opt.k)
                      setAmount('')
                    }}
                    className={
                      'rounded px-3 py-1 text-xs font-medium transition-colors ' +
                      (active
                        ? 'bg-card text-[var(--fg-1)] shadow-sm'
                        : 'text-[var(--fg-2)] hover:text-[var(--fg-1)]')
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={amountLabel} hint={amountHint}>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={placeholder}
              inputMode={mode === 'raw' ? 'numeric' : 'decimal'}
              className="font-mono"
            />
          </Field>
          {available.match ? (
            <div className="-mt-2 flex items-center justify-between gap-2 text-[11.5px] text-[var(--fg-2)]">
              <span>
                Available{' '}
                <span className="font-mono tabular-nums">
                  {fmtNum(available.match.amountDecimal)} {token}
                </span>
                <span className="ml-1 text-[var(--fg-3)]">
                  (~{fmtUsd(available.match.usd)})
                </span>
              </span>
              <button
                type="button"
                onClick={useMax}
                className="font-medium text-primary hover:underline"
              >
                Use max
              </button>
            </div>
          ) : available.loading ? (
            <div className="-mt-2 text-[11.5px] text-[var(--fg-3)]">
              Checking available balance…
            </div>
          ) : chainId && token ? (
            <div className="-mt-2 text-[11.5px] text-[var(--fg-3)]">
              No {token} balance on this chain in the gateway pool.
            </div>
          ) : null}
          {amountFormatError && (
            <div className="-mt-2 text-[11.5px] text-destructive">
              {amountFormatError}
            </div>
          )}
          {showRateDrift && (
            <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              USD pegging snapshots at create time; {token} price can drift
              before broadcast.
            </div>
          )}

          <Field label="Destination address">
            <Input
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder="0x…"
              className="font-mono"
            />
          </Field>

          <FeeTierPicker
            estimate={estimate.data ?? null}
            nativeDecimals={nativeDecimals}
            loading={estimate.isFetching}
            error={estimate.isError ? (estimate.error as ApiError)?.code : null}
            errorMessage={
              estimate.isError ? payoutErrorMessage(estimate.error) : null
            }
            ready={estimateReady}
            selected={feeTier}
            onSelect={setFeeTier}
          />

          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5 text-[12px]">
            <input
              type="checkbox"
              checked={allowMultiSource}
              onChange={(e) => setAllowMultiSource(e.target.checked)}
              className="mt-0.5 size-3.5 cursor-pointer accent-primary"
            />
            <div>
              <div className="font-medium text-[var(--fg-1)]">
                Split across fee wallets if needed
              </div>
              <div className="mt-0.5 text-[11.5px] text-[var(--fg-2)]">
                When no single wallet has enough balance, draw from multiple.
                Recipient sees one on-chain tx per contributing wallet. Leaves
                an audit trail even on partial failure.
              </div>
            </div>
          </label>

          <details className="rounded-md border border-border bg-[var(--bg-2)] open:pb-3">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--fg-2)]">
              Advanced — per-payout webhook override
            </summary>
            <div className="space-y-3 px-3 pt-1">
              <Field
                label="Webhook URL"
                hint="Events for this payout dispatch here instead of the merchant default. Requires a secret."
              >
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://merchant.example.com/hooks/payout"
                  type="url"
                  className="font-mono"
                />
              </Field>
              <Field
                label="Webhook secret"
                hint="16–512 chars. Paired HMAC secret — required when URL is set."
              >
                <Input
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="whs_…"
                  className="font-mono"
                  minLength={16}
                  maxLength={512}
                />
              </Field>
              {webhookMismatch && (
                <div className="-mt-1 text-[11.5px] text-destructive">
                  Webhook URL and secret must be provided together.
                </div>
              )}
            </div>
          </details>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? 'Planning…' : 'Plan payout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

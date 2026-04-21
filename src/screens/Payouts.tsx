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
  Ban,
  ChevronDown,
  Fuel,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
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
  PayoutEstimateSource,
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
  // v2.2: the gateway reserves synchronously at create time, so `planned` is
  // no longer inserted. `topping-up` is the intermediate state between
  // `reserved` and `submitted` when gas auto-sponsoring kicks in.
  pending: 'reserved,topping-up,submitted',
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
        // v2.2: the gateway can insert internal `gas_top_up` sibling rows that
        // are merchant-noise by default. Filtering to `standard` matches the
        // merchant API's default and keeps the dashboard's list legible.
        kind: 'standard',
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
            {po.topUpTxHash && (
              <span
                className="inline-flex items-center text-[var(--fg-3)]"
                title="Gas auto-sponsored by another HD address"
              >
                <Fuel className="size-3" />
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

  const qc = useQueryClient()
  const cancel = useMutation({
    mutationFn: () =>
      api<{ payout: GatewayPayout }>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts/${encodeURIComponent(payoutId!)}/cancel`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Payout canceled')
      void detail.refetch()
      qc.invalidateQueries({ queryKey: ['payouts', 'list', merchantId] })
    },
    onError: (e: unknown) => toast.error(payoutErrorMessage(e)),
  })

  const canCancel = po?.status === 'reserved'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate font-mono text-base">
              {payoutId ? truncateAddr(payoutId, 10, 8) : ''}
            </SheetTitle>
            {payoutId && <CopyButton value={payoutId} />}
            {po && <StatusBadge status={po.status} />}
            {po?.feeTier && <FeeTierBadge tier={po.feeTier} />}
            {po?.kind === 'gas_top_up' && (
              <Badge variant="outline" className="uppercase tracking-wider">
                <Fuel className="size-3" /> gas top-up
              </Badge>
            )}
            <div className="flex-1" />
            {po && canCancel && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                <Ban className="size-3.5" />
                {cancel.isPending ? 'Canceling…' : 'Cancel'}
              </Button>
            )}
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
                <KVItem label="Kind">
                  <span className="font-mono text-xs">{po.kind}</span>
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

                <KVItem label="Source" wide>
                  {po.sourceAddress ? (
                    <Addr value={po.sourceAddress} truncated={false} />
                  ) : (
                    <span className="text-[var(--fg-2)]">—</span>
                  )}
                </KVItem>

                <KVItem label="Tx hash" wide>
                  {po.txHash ? (
                    <Addr value={po.txHash} truncated={false} />
                  ) : (
                    <span className="text-[var(--fg-2)]">pending</span>
                  )}
                </KVItem>

                {po.topUpTxHash && (
                  <KVItem label="Gas top-up" wide>
                    <div className="space-y-1.5 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-[11.5px]">
                      <div className="flex items-center gap-1.5 text-[var(--fg-2)]">
                        <Fuel className="size-3.5 text-[var(--fg-3)]" />
                        <span>
                          Auto-sponsored before broadcast. Sibling rows of kind{' '}
                          <span className="font-mono">gas_top_up</span> carry
                          the full detail.
                        </span>
                      </div>
                      {po.topUpSponsorAddress && (
                        <div className="flex items-center gap-2">
                          <span className="eyebrow">sponsor</span>
                          <Addr
                            value={po.topUpSponsorAddress}
                            truncated={false}
                          />
                        </div>
                      )}
                      {po.topUpAmountRaw && (
                        <div className="flex items-center gap-2">
                          <span className="eyebrow">amount</span>
                          <span className="font-mono text-xs">
                            {po.topUpAmountRaw} (raw)
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="eyebrow">tx</span>
                        <Addr value={po.topUpTxHash} truncated={false} />
                      </div>
                    </div>
                  </KVItem>
                )}

                {po.parentPayoutId && (
                  <KVItem label="Parent payout" wide>
                    <span className="font-mono text-xs">
                      {truncateAddr(po.parentPayoutId, 10, 6)}
                    </span>
                  </KVItem>
                )}

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
  errorMessage,
  ready,
  selected,
  onSelect,
  onRefresh,
}: {
  estimate: PayoutEstimate | null
  nativeDecimals: number | null
  loading: boolean
  errorMessage: string | null
  ready: boolean
  selected: FeeTier
  onSelect: (t: FeeTier) => void
  onRefresh: () => void
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

  // Real ApiError (400 VALIDATION_FAILED / 503 ORACLE_FAILED / 429 / etc).
  // v2.1 made operational issues into `warnings` on a 200, so hitting this
  // branch now means a genuine input or auth problem.
  if (!estimate) {
    return (
      <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-[11.5px] text-warn">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-3.5" />
          {errorMessage ?? 'Could not estimate fees.'}
        </div>
        <div className="mt-1 text-[var(--fg-2)]">
          Submitting without an estimate; the gateway will try its default tier.
        </div>
      </div>
    )
  }

  const { tiers, warnings } = estimate
  const fmtNative = (raw: string) =>
    nativeDecimals == null
      ? `${raw} (raw)`
      : `${formatUnits(raw, nativeDecimals)} ${tiers.nativeSymbol}`

  // Operational fallback: RPC couldn't quote tiers. The gateway will still
  // estimate at broadcast time, so submit is allowed; the tier picker is not.
  if (warnings.includes('fee_quote_unavailable')) {
    return (
      <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--fg-3)]" />
          <div className="flex-1 text-[11.5px]">
            <div className="font-medium text-[var(--fg-1)]">
              Fee will be calculated at broadcast
            </div>
            <div className="mt-0.5 text-[var(--fg-2)]">
              The chain&rsquo;s RPC couldn&rsquo;t quote tiers right now. The
              executor will pick a reasonable default when it picks this payout
              up. Safe to submit; only the preview is missing.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} />
            Retry
          </Button>
        </div>
      </div>
    )
  }

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

/**
 * `MAX_AMOUNT_EXCEEDS_NET_SPENDABLE` carries a ready-to-use suggestion in
 * the error `details`. Pulls it out regardless of which endpoint threw.
 * Returns null when the error doesn't match or the payload is malformed.
 */
type AmountSuggestion = {
  raw: string
  decimal: string | null
  usd: string | null
}

function readAmountSuggestion(err: unknown): AmountSuggestion | null {
  if (!(err instanceof ApiError)) return null
  if (err.code !== 'MAX_AMOUNT_EXCEEDS_NET_SPENDABLE') return null
  const d = err.details as
    | {
        suggestedAmountRaw?: unknown
        suggestedAmount?: unknown
        suggestedAmountUsd?: unknown
      }
    | undefined
  const raw = typeof d?.suggestedAmountRaw === 'string' ? d.suggestedAmountRaw : null
  if (!raw) return null
  return {
    raw,
    decimal: typeof d?.suggestedAmount === 'string' ? d.suggestedAmount : null,
    usd: typeof d?.suggestedAmountUsd === 'string' ? d.suggestedAmountUsd : null,
  }
}

function payoutErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_FEE_TIER':
        return 'Unsupported fee tier for this chain — picking medium.'
      case 'BATCH_TOO_LARGE':
        return 'Batch exceeds 100 rows. Split the file and retry.'
      case 'INSUFFICIENT_BALANCE_ANY_SOURCE':
        return 'Not enough balance on any source address. Fund one of your HD addresses before retrying.'
      case 'NO_GAS_SPONSOR_AVAILABLE':
        return 'The source has the token but no gas sponsor has native. Fund a sponsor address with native gas.'
      case 'MAX_AMOUNT_EXCEEDS_NET_SPENDABLE':
        return 'Amount leaves no room for gas. Try the suggested amount or lower it manually.'
      case 'FEE_ESTIMATE_FAILED':
        return 'Chain gas estimator is flaky right now — please retry in a few seconds.'
      case 'PAYOUT_NOT_CANCELABLE':
        return 'This payout is past the cancelable window — it has already been broadcast.'
      case 'ORACLE_FAILED':
        return 'Price oracle unreachable — USD pegging unavailable right now.'
      case 'TOKEN_NOT_SUPPORTED':
        return 'That token is not registered on the selected chain.'
      case 'INVALID_DESTINATION':
        return 'Destination address failed the chain\u2019s validator.'
      case 'BAD_AMOUNT':
        return 'Amount has more decimals than the token supports.'
      case 'VALIDATION_FAILED':
        return e.message || 'Request validation failed.'
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
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  // Operator explicitly opted in to submit despite a funding shortfall. Scoped
  // to the estimate's identity (see the estimateSignature below) so it resets
  // automatically whenever inputs change and a fresh quote arrives.
  const [proceedAnywaySignature, setProceedAnywaySignature] = React.useState<
    string | null
  >(null)

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

  const debouncedAmount = useDebouncedValue(amount, 300)
  const debouncedDest = useDebouncedValue(destinationAddress.trim(), 300)
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
    staleTime: 30_000,
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

  /* ── v2.2 source / top-up / warnings ───────────────────── */

  // Stable reference so downstream useMemos (estimateSignature below) don't
  // churn on every render when no estimate has landed yet.
  const warnings = React.useMemo(
    () => estimate.data?.warnings ?? [],
    [estimate.data?.warnings],
  )
  const source = estimate.data?.source ?? null
  const topUp = estimate.data?.topUp ?? null
  const alternatives = estimate.data?.alternatives ?? []
  const noSourceBalance = warnings.includes(
    'no_source_address_has_sufficient_token_balance',
  )
  const noGasSponsor = warnings.includes('no_gas_sponsor_available')
  const amountExceedsSpendable = warnings.includes(
    'max_amount_exceeds_net_spendable',
  )

  // Identity of the estimate snapshot the operator has acknowledged. Scoped
  // tight so fresh math always re-prompts the "proceed anyway" decision.
  const estimateSignature = React.useMemo(() => {
    if (!estimate.data) return null
    return [
      source?.address ?? '',
      source?.nativeBalance ?? '',
      source?.tokenBalance ?? '',
      topUp?.amountRaw ?? '',
      topUp?.sponsor?.address ?? '',
      warnings.join(','),
    ].join('|')
  }, [estimate.data, source, topUp, warnings])

  const proceedAnyway =
    proceedAnywaySignature !== null &&
    proceedAnywaySignature === estimateSignature

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

  // MAX_AMOUNT_EXCEEDS_NET_SPENDABLE can fire from either /estimate or the
  // real POST. Either way the backend returns a ready-to-apply suggestion —
  // prefer the create error (most recent) but fall back to the estimate.
  const suggestion =
    readAmountSuggestion(create.error) ??
    readAmountSuggestion(estimate.error)

  const applySuggestion = () => {
    if (!suggestion) return
    if (mode === 'raw') {
      setAmount(suggestion.raw)
    } else if (mode === 'amount') {
      setAmount(
        suggestion.decimal ??
          (tokenMeta ? formatUnits(suggestion.raw, tokenMeta.decimals) : suggestion.raw),
      )
    } else {
      // USD mode: use the USD-pegged suggestion if the backend supplied it;
      // otherwise fall back to raw mode since we can't safely reverse-convert.
      if (suggestion.usd) {
        setAmount(suggestion.usd)
      } else {
        setMode('raw')
        setAmount(suggestion.raw)
      }
    }
    create.reset()
  }

  // Block submit on warnings that make the plan unambiguously impossible.
  // `no_source_address_has_sufficient_token_balance` and `no_gas_sponsor_available`
  // are gates; `max_amount_exceeds_net_spendable` requires operator ack.
  const hardBlocked = noSourceBalance || noGasSponsor
  const needsAckMaxAmount = amountExceedsSpendable && !proceedAnyway

  const canSubmit =
    RAW_RE.test(chainId) &&
    /^[A-Z0-9]+$/.test(token) &&
    amount !== '' &&
    amountFormatError === null &&
    destinationAddress.trim().length > 0 &&
    !webhookMismatch &&
    webhookSecretValid &&
    !hardBlocked &&
    !needsAckMaxAmount

  // Guard against stale fee tiers. If the estimate is older than 60s,
  // refetch before submitting so the operator sees any delta before planning.
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const age = estimate.dataUpdatedAt
      ? Date.now() - estimate.dataUpdatedAt
      : Infinity
    if (estimate.data && age > 60_000 && estimateReady) {
      await estimate.refetch()
    }
    create.mutate()
  }

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
      <DialogContent className="sm:!max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plan payout</DialogTitle>
          <DialogDescription>
            Creates the payout in <span className="font-mono">planned</span>{' '}
            state. The gateway will reserve a fee wallet, sign, and broadcast on
            its next scheduler tick.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
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
          {suggestion && (
            <SuggestedAmountCard
              suggestion={suggestion}
              mode={mode}
              tokenSymbol={token}
              tokenMeta={tokenMeta}
              errorMessage={
                create.error instanceof ApiError
                  ? create.error.message
                  : estimate.error instanceof ApiError
                    ? estimate.error.message
                    : null
              }
              onApply={applySuggestion}
            />
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
            errorMessage={
              estimate.isError ? payoutErrorMessage(estimate.error) : null
            }
            ready={estimateReady}
            selected={feeTier}
            onSelect={setFeeTier}
            onRefresh={() => {
              void estimate.refetch()
            }}
          />

          {noSourceBalance && (
            <NoSourceBalanceBanner token={token || 'this token'} />
          )}

          {noGasSponsor && <NoGasSponsorBanner />}

          {amountExceedsSpendable && !suggestion && source && (
            // No concrete suggestion yet (warning without details) — keep the
            // soft-gate so the operator can acknowledge and submit.
            <MaxAmountPanel
              source={source}
              tokenMeta={tokenMeta}
              proceedAnyway={proceedAnyway}
              onToggleProceed={(v) =>
                setProceedAnywaySignature(v ? estimateSignature : null)
              }
            />
          )}

          {source && !noSourceBalance && (
            <SourcePanel
              source={source}
              topUp={topUp}
              alternatives={alternatives}
              tokenMeta={tokenMeta}
              nativeDecimals={nativeDecimals}
            />
          )}

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

/* ── v2.2 estimate panels ───────────────────────────────── */

function NoSourceBalanceBanner({ token }: { token: string }) {
  return (
    <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            No source address has enough {token}
          </div>
          <div className="mt-0.5 text-[11.5px] text-destructive/90">
            Fund one of your HD addresses with {token} before planning this
            payout. Any pool address auto-qualifies as a source — see Balances
            for current holdings.
          </div>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to="/balances">
            <Fuel className="size-3.5" /> Open balances
          </Link>
        </Button>
      </div>
    </div>
  )
}

function NoGasSponsorBanner() {
  return (
    <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">No gas sponsor available</div>
          <div className="mt-0.5 text-[11.5px] text-destructive/90">
            A source has enough token, but no other HD address has enough
            native to cover gas. Fund a pool address with native before the
            executor can auto-sponsor the top-up.
          </div>
        </div>
      </div>
    </div>
  )
}

function MaxAmountPanel({
  source,
  tokenMeta,
  proceedAnyway,
  onToggleProceed,
}: {
  source: PayoutEstimateSource
  tokenMeta: ChainToken | null
  proceedAnyway: boolean
  onToggleProceed: (v: boolean) => void
}) {
  const bal = tokenMeta
    ? formatUnits(source.tokenBalance, tokenMeta.decimals)
    : source.tokenBalance
  return (
    <div className="space-y-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-3 text-[11.5px]">
      <div className="flex items-start gap-2 text-warn">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Amount exceeds net spendable</div>
          <div className="mt-0.5 text-[var(--fg-2)]">
            Sending this much would leave the source unable to cover gas.
            Either lower the amount or proceed and let the backend reject with
            a suggested value. Source holds{' '}
            <span className="font-mono tabular-nums">{bal}</span>{' '}
            {source.tokenSymbol}.
          </div>
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-warn/40 bg-card px-3 py-2">
        <input
          type="checkbox"
          checked={proceedAnyway}
          onChange={(e) => onToggleProceed(e.target.checked)}
          className="mt-0.5 size-3.5 cursor-pointer accent-warn"
        />
        <span className="text-[var(--fg-1)]">
          I understand — submit anyway and apply the backend&rsquo;s suggested
          amount if it rejects.
        </span>
      </label>
    </div>
  )
}

function SourcePanel({
  source,
  topUp,
  alternatives,
  tokenMeta,
  nativeDecimals,
}: {
  source: PayoutEstimateSource
  topUp: PayoutEstimate['topUp']
  alternatives: PayoutEstimateSource[]
  tokenMeta: ChainToken | null
  nativeDecimals: number | null
}) {
  const fmtToken = (raw: string) =>
    tokenMeta ? formatUnits(raw, tokenMeta.decimals) : raw
  const fmtNative = (raw: string) =>
    nativeDecimals != null ? formatUnits(raw, nativeDecimals) : raw

  const sponsorMissing = topUp && topUp.sponsor === null
  const sponsorNeeded = topUp !== null && !sponsorMissing

  return (
    <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-3 text-[11.5px]">
      <div className="eyebrow mb-1.5">Picked source</div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Addr value={source.address} truncated={false} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--fg-2)]">
          <span>
            <span className="font-mono tabular-nums text-[var(--fg-1)]">
              {fmtToken(source.tokenBalance)}
            </span>{' '}
            {source.tokenSymbol}
          </span>
          <span className="text-[var(--fg-3)]">·</span>
          <span>
            <span className="font-mono tabular-nums text-[var(--fg-1)]">
              {fmtNative(source.nativeBalance)}
            </span>{' '}
            {source.nativeSymbol}
          </span>
        </div>
      </div>

      {sponsorNeeded && topUp && topUp.sponsor && (
        <div className="mt-2.5 space-y-1.5 rounded-md border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-1.5 text-[var(--fg-2)]">
            <Fuel className="size-3.5 text-[var(--fg-3)]" />
            <span>
              Gas auto-sponsored:{' '}
              <span className="font-mono tabular-nums">
                {fmtNative(topUp.amountRaw)}
              </span>{' '}
              {source.nativeSymbol} moved from sponsor before broadcast.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">sponsor</span>
            <Addr value={topUp.sponsor.address} truncated={false} />
          </div>
        </div>
      )}

      {sponsorMissing && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Source lacks gas and no other HD address has enough native to
            sponsor. Submit will fail with{' '}
            <span className="font-mono">NO_GAS_SPONSOR_AVAILABLE</span>.
          </span>
        </div>
      )}

      {alternatives.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer select-none text-[var(--fg-3)] hover:text-[var(--fg-2)]">
            {alternatives.length} alternative source
            {alternatives.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {alternatives.map((alt) => (
              <li
                key={alt.address}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
              >
                <span className="font-mono text-[10.5px] text-[var(--fg-2)]">
                  {truncateAddr(alt.address, 8, 6)}
                </span>
                <span className="text-[10.5px] text-[var(--fg-3)]">
                  <span className="font-mono tabular-nums">
                    {fmtToken(alt.tokenBalance)}
                  </span>{' '}
                  {alt.tokenSymbol}
                  {' · '}
                  <span className="font-mono tabular-nums">
                    {fmtNative(alt.nativeBalance)}
                  </span>{' '}
                  {alt.nativeSymbol}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function SuggestedAmountCard({
  suggestion,
  mode,
  tokenSymbol,
  tokenMeta,
  errorMessage,
  onApply,
}: {
  suggestion: AmountSuggestion
  mode: PayoutAmountMode
  tokenSymbol: string
  tokenMeta: ChainToken | null
  errorMessage: string | null
  onApply: () => void
}) {
  // Show the value in the same unit the user is typing in, so clicking
  // "Use" is predictable. Keep token + USD on the line regardless as extra
  // context.
  const primary = (() => {
    if (mode === 'raw') {
      return { value: suggestion.raw, suffix: `${tokenSymbol} raw` }
    }
    if (mode === 'usd' && suggestion.usd) {
      return { value: suggestion.usd, suffix: 'USD' }
    }
    const decimal =
      suggestion.decimal ??
      (tokenMeta ? formatUnits(suggestion.raw, tokenMeta.decimals) : suggestion.raw)
    return { value: decimal, suffix: tokenSymbol || 'token' }
  })()

  return (
    <div className="rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--fg-1)]">
            Amount leaves no room for gas
          </div>
          {errorMessage && (
            <div className="mt-0.5 text-[11.5px] text-[var(--fg-2)]">
              {errorMessage}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-0.5">Suggested</div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono text-lg font-semibold tabular-nums text-[var(--fg-1)]">
              {primary.value}
            </span>
            <span className="text-[11.5px] text-[var(--fg-2)]">
              {primary.suffix}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--fg-3)]">
            {suggestion.decimal && mode !== 'amount' && (
              <span>
                <span className="font-mono tabular-nums">
                  {suggestion.decimal}
                </span>{' '}
                {tokenSymbol}
              </span>
            )}
            {suggestion.usd && mode !== 'usd' && (
              <span>
                ~
                <span className="font-mono tabular-nums">
                  ${suggestion.usd}
                </span>
              </span>
            )}
            {mode !== 'raw' && (
              <span>
                raw{' '}
                <span className="font-mono tabular-nums">
                  {suggestion.raw}
                </span>
              </span>
            )}
          </div>
        </div>
        <Button type="button" onClick={onApply}>
          Use suggested amount
        </Button>
      </div>
    </div>
  )
}

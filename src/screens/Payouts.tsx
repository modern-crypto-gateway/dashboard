import * as React from 'react'
import { Link } from 'react-router-dom'
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
  Loader2,
  Plus,
  Search,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import {
  decimalPlaces,
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
  GatewayPayout,
  Merchant,
  PayoutListResponse,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainTokenPicker } from '@/components/ChainTokenPicker'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
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

const payoutsQueryKey = (merchantId: string | null, filter: PayoutFilter) =>
  ['payouts', 'list', merchantId, filter] as const

export function PayoutsPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<PayoutFilter>('all')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  const list = useInfiniteQuery({
    enabled: canList,
    queryKey: payoutsQueryKey(active?.id ?? null, filter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      })
      const s = STATUS_CSV[filter]
      if (s) qs.set('status', s)
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
  loaded,
}: {
  query: string
  setQuery: (v: string) => void
  filter: PayoutFilter
  setFilter: (v: PayoutFilter) => void
  loaded: number
}) {
  return (
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
}: {
  merchantId: string
  payoutId: string | null
  onOpenChange: (open: boolean) => void
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
                <KVItem label="Fee estimate">
                  <span className="font-mono">
                    {po.feeEstimateNative ?? '—'}
                  </span>
                </KVItem>
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
                <KVItem label="Created">
                  <span className="font-mono text-xs">
                    {new Date(po.createdAt).toISOString().slice(0, 19)}Z
                  </span>
                </KVItem>
                <KVItem label="Confirmed">
                  <span className="font-mono text-xs">
                    {po.confirmedAt
                      ? new Date(po.confirmedAt).toISOString().slice(0, 19) + 'Z'
                      : '—'}
                  </span>
                </KVItem>
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
  const [chainId, setChainId] = React.useState('')
  const [token, setToken] = React.useState('')
  const [tokenMeta, setTokenMeta] = React.useState<ChainToken | null>(null)
  const [mode, setMode] = React.useState<PayoutAmountMode>('amount')
  const [amount, setAmount] = React.useState('')
  const [destinationAddress, setDestinationAddress] = React.useState('')
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

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        chainId: parseInt(chainId, 10),
        token: token.toUpperCase(),
        destinationAddress: destinationAddress.trim(),
      }
      if (mode === 'raw') body.amountRaw = amount
      else if (mode === 'amount') body.amount = amount
      else body.amountUSD = amount
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
    onError: (e: ApiError) => toast.error(e.message || 'Could not plan payout'),
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

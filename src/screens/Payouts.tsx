import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  ArrowsLeftRight,
  Ban,
  Calendar,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Dollar,
  ExternalLink,
  Fuel,
  Gauge,
  Hash,
  Info,
  KeyRound,
  Layers,
  ListBullets,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Tag,
  Target,
  Timer,
  Wallet,
  Webhook,
  X,
  Zap,
} from '@/components/icons'

import { useUrlParam } from '@/lib/useUrlParam'
import { api, ApiError } from '@/lib/api'
import { chainInfo, nativeMeta } from '@/lib/chains'
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
  BumpFeeResponse,
  ChainInventoryEntry,
  ChainToken,
  FeeTier,
  GatewayPayout,
  Merchant,
  PayoutEstimate,
  PayoutEstimateSource,
  PayoutListResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { ChainTokenPicker } from '@/components/ChainTokenPicker'
import { ConsolidateDialog } from '@/components/ConsolidateDialog'
import { TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { ListFilterBar } from '@/components/ListFilterBar'
import {
  cleanFilterValues,
  useDebouncedValue,
  useFilterOptions,
  type FilterSection,
  type FilterValues,
  type SortConfig,
} from '@/lib/listFilters'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { ChainPill } from '@/components/ChainPill'
import { PageHeader } from '@/components/PageHeader'
import {
  Callout,
  EmptyState as SharedEmptyState,
  ErrorState,
} from '@/components/States'
import { SegmentedBar } from '@/components/charts'
import { Pager, RowAvatar, TableCard } from '@/components/DataTable'
import { StatusPill } from '@/components/StatusPill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  SheetFooter,
  SheetHero,
  SheetSection,
  SheetTabs,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'

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

const PAGE_SIZE = 25

/* Filter spec for payouts — keys are the gateway's query-param names. */

const PAYOUT_SECTIONS: FilterSection[] = [
  {
    title: 'Status',
    icon: Activity,
    fields: [
      {
        kind: 'enumSet',
        key: 'status',
        label: 'Payout status',
        options: [
          { value: 'reserved', label: 'Reserved' },
          { value: 'topping-up', label: 'Topping-up' },
          { value: 'submitted', label: 'Submitted' },
          { value: 'confirmed', label: 'Confirmed' },
          { value: 'failed', label: 'Failed' },
          { value: 'canceled', label: 'Canceled' },
          { value: 'planned', label: 'Planned' },
        ],
      },
    ],
  },
  {
    title: 'Execution',
    icon: Gauge,
    fields: [
      {
        kind: 'enumSet',
        key: 'feeTier',
        label: 'Fee tier',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
      {
        kind: 'tri',
        key: 'hasError',
        label: 'Error state',
        yes: 'Has error',
        no: 'Clean',
      },
      {
        kind: 'numberRange',
        keyMin: 'amountUsdMin',
        keyMax: 'amountUsdMax',
        label: 'Quoted amount (USD)',
        prefix: '$',
      },
    ],
  },
  {
    title: 'Identity',
    icon: Hash,
    fields: [
      { kind: 'chain', key: 'chainId', label: 'Chain' },
      { kind: 'tokens', key: 'token', label: 'Token' },
      {
        kind: 'text',
        key: 'destinationAddress',
        label: 'Destination (exact)',
        placeholder: '0x… / T… / base58',
      },
      {
        kind: 'text',
        key: 'destinationAddressContains',
        label: 'Destination contains',
        placeholder: 'substring',
      },
      {
        kind: 'text',
        key: 'sourceAddress',
        label: 'Source address (exact)',
        placeholder: 'HD source…',
      },
      {
        kind: 'text',
        key: 'sourceAddressContains',
        label: 'Source contains',
        placeholder: 'substring',
      },
      {
        kind: 'text',
        key: 'txHash',
        label: 'Tx hash',
        placeholder: 'on-chain hash',
      },
      {
        kind: 'text',
        key: 'batchId',
        label: 'Batch ID',
        placeholder: 'POST /payouts/batch group id',
      },
    ],
  },
  {
    title: 'Dates',
    icon: CalendarRange,
    fields: [
      { kind: 'dateRange', keyFrom: 'createdFrom', keyTo: 'createdTo', label: 'Created' },
      {
        kind: 'dateRange',
        keyFrom: 'submittedFrom',
        keyTo: 'submittedTo',
        label: 'Submitted',
      },
      {
        kind: 'dateRange',
        keyFrom: 'confirmedFrom',
        keyTo: 'confirmedTo',
        label: 'Confirmed',
      },
      { kind: 'dateRange', keyFrom: 'updatedFrom', keyTo: 'updatedTo', label: 'Updated' },
    ],
  },
]

const PAYOUT_SORT: SortConfig = {
  byKey: 'sortBy',
  dirKey: 'sortDir',
  defaultBy: 'createdAt',
  defaultDir: 'desc',
  options: [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Updated' },
    { value: 'submittedAt', label: 'Submitted' },
    { value: 'confirmedAt', label: 'Confirmed' },
    { value: 'amountUsd', label: 'Amount (USD)' },
  ],
}

const NON_NARROWING = new Set(['sortBy', 'sortDir'])

function hasNarrowingFilter(values: FilterValues): boolean {
  return Object.entries(cleanFilterValues(values)).some(
    ([k]) => !NON_NARROWING.has(k),
  )
}

const EMPTY_ROWS: GatewayPayout[] = []

export function PayoutsPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const [filters, setFilters] = React.useState<FilterValues>({})
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailId, setDetailId] = useUrlParam('payout')

  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  const chainsQ = useQuery({
    enabled: canList,
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    staleTime: 120_000,
  })
  const { chainOptions, tokenOptions } = useFilterOptions(chainsQ.data?.chains)

  // Page-based view over the same limit/offset API. Page resets when the
  // store or the filters change.
  const [page, setPage] = React.useState(0)
  const pageKey = `${active?.id ?? ''}|${JSON.stringify(filters)}`
  const [lastPageKey, setLastPageKey] = React.useState(pageKey)
  if (lastPageKey !== pageKey) {
    setLastPageKey(pageKey)
    setPage(0)
  }

  const list = useQuery({
    enabled: canList,
    queryKey: ['payouts', 'list', active?.id ?? null, filters, page] as const,
    queryFn: async () => {
      const qs = new URLSearchParams(cleanFilterValues(filters))
      qs.set('limit', String(PAGE_SIZE))
      qs.set('offset', String(page * PAGE_SIZE))
      // v2.2: the gateway can insert internal `gas_top_up` sibling rows that
      // are merchant-noise by default. Filtering to `standard` matches the
      // merchant API's default and keeps the dashboard's list legible.
      qs.set('kind', 'standard')
      const res = await api<Partial<PayoutListResponse> | null>(
        `/api/mg/${encodeURIComponent(active!.id)}/payouts?${qs}`,
      )
      // A misconfigured gateway can answer 200 with an empty / non-JSON body
      // (api() yields null then) or omit `payouts`. Normalize to a valid page
      // so the list shows an empty state instead of crashing.
      return {
        payouts: Array.isArray(res?.payouts) ? res.payouts : [],
        limit: typeof res?.limit === 'number' ? res.limit : PAGE_SIZE,
        offset: typeof res?.offset === 'number' ? res.offset : page * PAGE_SIZE,
        hasMore: res?.hasMore === true,
      } satisfies PayoutListResponse
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })

  const all = list.data?.payouts ?? EMPTY_ROWS
  const narrowed = hasNarrowingFilter(filters)
  const showTable = !list.isLoading && !list.isError && !(all.length === 0 && page === 0)

  if (merchants.isLoading) {
    return <PageSkeleton />
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchants />
  }

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Payouts"
        description="Outgoing transfers for this store"
        actions={
          <>
            <MerchantSwitcher />
            <Button
              size="sm"
              variant="outline"
              disabled={!canList}
              asChild={canList}
            >
              {canList ? (
                <Link to="/payouts/batch">
                  <Layers className="size-4" /> Batch
                </Link>
              ) : (
                <span>
                  <Layers className="size-4" /> Batch
                </span>
              )}
            </Button>
            <Button size="sm" disabled={!canList} onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Plan payout
            </Button>
          </>
        }
      />

      {!canList && active ? (
        <NoApiKeyCard merchant={active} />
      ) : (
        <>
          <PayoutSummary rows={all} loading={list.isLoading} />

          <TableCard
            toolbar={
              <ListFilterBar
                values={filters}
                onChange={setFilters}
                sections={PAYOUT_SECTIONS}
                sort={PAYOUT_SORT}
                chainOptions={chainOptions}
                tokenOptions={tokenOptions}
                resultCount={all.length}
                loading={list.isFetching}
              />
            }
            footer={
              showTable ? (
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  shown={all.length}
                  hasNext={list.data?.hasMore === true}
                  onPage={setPage}
                  loading={list.isFetching}
                  noun="payouts"
                />
              ) : undefined
            }
          >
            {list.isLoading ? (
              <TableSkeleton />
            ) : list.isError ? (
              <div className="p-6">
                <ErrorCard
                  message={list.error instanceof Error ? list.error.message : 'Could not load'}
                />
              </div>
            ) : !showTable ? (
              narrowed ? (
                <NoMatch onClear={() => setFilters({})} />
              ) : (
                <EmptyState onCreate={() => setCreateOpen(true)} />
              )
            ) : (
              <PayoutList rows={all} onOpen={setDetailId} dim={list.isPlaceholderData} />
            )}
          </TableCard>
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
              setFilters((f) => ({ ...f, batchId: bid }))
              setDetailId(null)
            }}
          />
        </>
      )}
    </div>
  )
}

/* ── summary strip (from the loaded page only) ─────────── */

const num = (s: string | null | undefined) => {
  const n = s ? parseFloat(s) : 0
  return isFinite(n) ? n : 0
}

function PayoutSummary({ rows, loading }: { rows: GatewayPayout[]; loading: boolean }) {
  const s = React.useMemo(() => {
    const by: Record<string, number> = {}
    let volume = 0
    let errors = 0
    for (const p of rows) {
      by[p.status] = (by[p.status] ?? 0) + 1
      volume += num(p.quotedAmountUsd)
      if (p.lastError) errors += 1
    }
    const planned = by.planned ?? 0
    const moving = (by.reserved ?? 0) + (by['topping-up'] ?? 0) + (by.submitted ?? 0)
    const confirmed = by.confirmed ?? 0
    const failed = by.failed ?? 0
    const canceled = by.canceled ?? 0
    const terminal = confirmed + failed
    return {
      volume,
      errors,
      planned,
      moving,
      confirmed,
      failed,
      canceled,
      submitted: by.submitted ?? 0,
      rate: terminal > 0 ? Math.round((confirmed / terminal) * 100) : null,
    }
  }, [rows])

  return (
    <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryTile
        label="Volume"
        loading={loading}
        value={fmtUsd(s.volume)}
        sub={`${rows.length} on this page`}
        footer={
          <SegmentedBar
            parts={[
              { key: 'ok', name: 'Confirmed', value: s.confirmed, color: 'var(--st-ok-dot)' },
              { key: 'run', name: 'In flight', value: s.moving, color: 'var(--st-run-dot)' },
              { key: 'wait', name: 'Planned', value: s.planned, color: 'var(--st-wait-dot)' },
              { key: 'bad', name: 'Failed', value: s.failed + s.canceled, color: 'var(--st-bad-dot)' },
            ]}
          />
        }
      />
      <SummaryTile
        label="In flight"
        loading={loading}
        value={s.moving + s.planned}
        sub={`${s.submitted} submitted · ${s.planned} planned`}
      />
      <SummaryTile
        label="Confirmed"
        loading={loading}
        value={s.confirmed}
        sub={s.rate != null ? `${s.rate}% success` : 'No settled payouts'}
      />
      <SummaryTile
        label="Failed"
        loading={loading}
        value={s.failed}
        sub={`${s.canceled} canceled · ${s.errors} with errors`}
      />
    </div>
  )
}

function SummaryTile({
  label,
  value,
  sub,
  footer,
  loading,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
}) {
  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="text-sm text-[var(--fg-2)]">{label}</div>
      <div className="figure mt-2 truncate text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-24" /> : value}
      </div>
      {sub != null && (
        <div className="mt-1 truncate text-xs text-[var(--fg-2)]">
          {loading ? <Skeleton className="h-3 w-20" /> : sub}
        </div>
      )}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

/* ── list / row ────────────────────────────────────────── */

function PayoutList({
  rows,
  onOpen,
  dim,
}: {
  rows: GatewayPayout[]
  onOpen: (id: string) => void
  dim?: boolean
}) {
  const lookup = useChainTokenLookup()
  return (
    <TableWrap>
      <Table className={cn('min-w-[880px] transition-opacity', dim && 'opacity-60')}>
        <THead>
          <tr>
            <Th>Payout</Th>
            <Th>Status</Th>
            <Th>Network</Th>
            <Th>To</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Updated</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((po) => (
            <PayoutRow
              key={po.id}
              po={po}
              lookup={lookup}
              onOpen={() => onOpen(po.id)}
            />
          ))}
        </TBody>
      </Table>
    </TableWrap>
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
    <Tr
      interactive
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
    >
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <TokenOnChain symbol={po.token} chainId={po.chainId} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-sm font-medium">
                {truncateAddr(po.id, 8, 6)}
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <CopyButton value={po.id} />
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--fg-3)]">
              {po.feeTier && (
                <span className="inline-flex items-center gap-1" title={`Fee tier: ${po.feeTier}`}>
                  <Gauge className="size-3.5" />
                  {tierLabel(po.feeTier)}
                </span>
              )}
              {po.topUpTxHash && (
                <span title="Gas auto-sponsored by another HD address">
                  <Fuel className="size-3.5" />
                </span>
              )}
              {po.batchId && (
                <span title={`batch ${po.batchId}`}>
                  <Layers className="size-3.5" />
                </span>
              )}
              {po.webhookUrl && (
                <span title="Per-payout webhook URL override">
                  <Webhook className="size-3.5" />
                </span>
              )}
              {(po.feeBumpAttempts ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[var(--st-warn)]"
                  title={`RBF re-broadcast ${po.feeBumpAttempts}×`}
                >
                  <Zap className="size-3.5" />
                  <span className="figure">{po.feeBumpAttempts}</span>
                </span>
              )}
              {po.lastError && (
                <span className="text-[var(--st-bad)]" title={po.lastError}>
                  <Info className="size-3.5" />
                </span>
              )}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <StatusBadge status={po.status} />
      </Td>
      <Td>
        <ChainPill chainId={po.chainId} />
      </Td>
      <Td>
        <span onClick={(e) => e.stopPropagation()}>
          <Addr value={po.destinationAddress} chainId={po.chainId} />
        </span>
      </Td>
      <Td align="right">
        <div className="inline-flex items-center justify-end gap-1.5 font-semibold">
          {formatted}
          <TokenIcon symbol={po.token} size={16} />
          <span className="text-sm font-medium text-[var(--fg-2)]">{po.token}</span>
        </div>
        <div className="text-xs text-[var(--fg-2)]">
          {po.quotedAmountUsd ? fmtUsd(po.quotedAmountUsd) : '—'}
        </div>
      </Td>
      <Td
        align="right"
        className="text-sm whitespace-nowrap text-[var(--fg-2)]"
        title={fmtLocal(po.updatedAt)}
      >
        {fmtRel(unixOf(po.updatedAt))}
      </Td>
    </Tr>
  )
}

function tierLabel(tier: FeeTier): string {
  return tier === 'low' ? 'Low' : tier === 'medium' ? 'Medium' : 'High'
}

function FeeTierBadge({ tier }: { tier: FeeTier }) {
  return (
    <Badge variant="outline" title={`Fee tier: ${tier}`}>
      <Gauge /> {tierLabel(tier)}
    </Badge>
  )
}

/* ── detail sheet ──────────────────────────────────────── */

type Tab = 'overview' | 'chain' | 'fees'

export function PayoutDetailSheet({
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
  const [tab, setTab] = React.useState<Tab>('overview')
  // Reset to the overview tab whenever a new payout is opened.
  const [prevPayoutId, setPrevPayoutId] = React.useState<string | null>(payoutId)
  if (prevPayoutId !== payoutId) {
    setPrevPayoutId(payoutId)
    if (payoutId) setTab('overview')
  }

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
  const isUtxo = po ? chainInfo(po.chainId).family === 'utxo' : false
  const canBump = isUtxo && po?.status === 'submitted'
  const [bumpOpen, setBumpOpen] = React.useState(false)

  const txCount = po
    ? [
        po.txHash,
        po.originalTxHash && po.originalTxHash !== po.txHash ? po.originalTxHash : null,
        po.topUpTxHash,
      ].filter(Boolean).length
    : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHero
          icon={po ? heroIconFor(po.token, po.chainId) : ArrowUpRight}
          iconClassName={po ? 'bg-transparent ring-0' : undefined}
          title={
            <span className="font-mono">{payoutId ? truncateAddr(payoutId, 8, 6) : ''}</span>
          }
          meta={
            <>
              {po ? (
                <StatusBadge status={po.status} />
              ) : (
                <Skeleton className="h-6 w-20 rounded-full" />
              )}
              {po && (
                <span
                  className="inline-flex items-center gap-1 font-mono text-xs text-[var(--fg-1)]"
                  title={po.destinationAddress}
                >
                  <ArrowRight className="size-3.5 text-[var(--fg-3)]" />
                  {truncateAddr(po.destinationAddress, 6, 4)}
                </span>
              )}
              {po?.kind === 'gas_top_up' && (
                <Badge variant="outline">
                  <Fuel /> Gas top-up
                </Badge>
              )}
              {po?.kind === 'gas_burn' && (
                <Badge
                  variant="outline"
                  title="Synthetic debit row — records the native fee a failed-but-broadcast tx burned on chain."
                >
                  <Fuel /> Gas burn
                </Badge>
              )}
              {po?.kind === 'consolidation_sweep' && (
                <Badge
                  variant="outline"
                  title="Internal pool-defragmentation sweep planned via /admin/pool/consolidate."
                >
                  <Layers /> Consolidation
                </Badge>
              )}
              {(po?.feeBumpAttempts ?? 0) > 0 && (
                <Badge variant="outline" title="Re-broadcast via RBF">
                  <Zap /> Bumped {po!.feeBumpAttempts}×
                </Badge>
              )}
              {po && (
                <span className="text-[var(--fg-3)]" title={fmtLocal(po.createdAt)}>
                  · {fmtRel(unixOf(po.createdAt))}
                </span>
              )}
            </>
          }
          actions={payoutId ? <CopyButton value={payoutId} /> : undefined}
        >
          {po && <PayoutHero po={po} meta={meta} />}
        </SheetHero>

        <SheetTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'overview', label: 'Overview', icon: ListBullets },
            { value: 'chain', label: 'Transactions', icon: ArrowsLeftRight, count: txCount },
            { value: 'fees', label: 'Fees', icon: Fuel },
          ]}
        />

        <SheetBody key={tab} className="fade-in">
          {detail.isLoading ? (
            <DetailSkeleton />
          ) : !po ? (
            <ErrorState
              title="Could not load payout"
              message={detail.error instanceof Error ? detail.error.message : 'Not found'}
            />
          ) : tab === 'overview' ? (
            <OverviewTab po={po} meta={meta} onOpenBatch={onOpenBatch} />
          ) : tab === 'chain' ? (
            <ChainTab po={po} />
          ) : (
            <FeesTab po={po} />
          )}
        </SheetBody>

        {po && (canCancel || canBump) && (
          <SheetFooter className="justify-between">
            <div className="min-w-0 text-xs text-[var(--fg-2)]">
              {canCancel ? 'Reserved · not broadcast yet' : 'Submitted · awaiting confirmation'}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canBump && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setBumpOpen(true)}
                >
                  <Zap className="size-4" />
                  Bump fee
                </Button>
              )}
              {canCancel && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  <Ban className="size-4" />
                  {cancel.isPending ? 'Canceling…' : 'Cancel'}
                </Button>
              )}
            </div>
          </SheetFooter>
        )}
      </SheetContent>
      {po && canBump && (
        <BumpFeeDialog
          open={bumpOpen}
          onOpenChange={setBumpOpen}
          payoutId={po.id}
          chainId={po.chainId}
          onBumped={() => {
            void detail.refetch()
            qc.invalidateQueries({ queryKey: ['payouts', 'list', merchantId] })
          }}
        />
      )}
    </Sheet>
  )
}

/* Sheet icon tile: token logo with network badge. Components are cached at
 * module level so the tile isn't remounted on every render. */
type HeroIconComp = React.ComponentType<{ className?: string }>
const heroIconCache = new Map<string, HeroIconComp>()
function heroIconFor(symbol: string, chainId: number): HeroIconComp {
  const key = `${chainId}:${symbol}`
  let C = heroIconCache.get(key)
  if (!C) {
    C = function PayoutTokenIcon() {
      return <TokenOnChain symbol={symbol} chainId={chainId} size={36} />
    }
    heroIconCache.set(key, C)
  }
  return C
}

/* Lifecycle: reserved → topping-up → submitted → confirmed / failed. */

type Step = {
  key: string
  label: string
  done: boolean
  live?: boolean
  bad?: boolean
  skipped?: boolean
}

const STAGE: Record<string, number> = {
  planned: 0,
  reserved: 1,
  'topping-up': 2,
  submitted: 3,
  confirmed: 4,
}

function payoutSteps(po: GatewayPayout): Step[] {
  const terminalBad = po.status === 'failed' || po.status === 'canceled'
  if (terminalBad) {
    const broadcast = !!(po.submittedAt || po.txHash)
    return [
      { key: 'reserved', label: 'Reserved', done: true },
      {
        key: 'topup',
        label: !po.topUpTxHash && broadcast ? 'No top-up' : 'Top-up',
        done: !!po.topUpTxHash,
        skipped: !po.topUpTxHash && broadcast,
      },
      { key: 'submitted', label: 'Submitted', done: broadcast },
      {
        key: 'end',
        label: po.status === 'failed' ? 'Failed' : 'Canceled',
        done: true,
        bad: true,
      },
    ]
  }
  const s = STAGE[po.status] ?? 0
  const skippedTopUp = s >= 3 && !po.topUpTxHash
  return [
    { key: 'reserved', label: 'Reserved', done: s >= 1, live: s === 0 },
    {
      key: 'topup',
      label: skippedTopUp ? 'No top-up' : 'Top-up',
      done: s >= 3 && !!po.topUpTxHash,
      live: s === 2,
      skipped: skippedTopUp,
    },
    { key: 'submitted', label: 'Submitted', done: s >= 3 },
    { key: 'end', label: 'Confirmed', done: s >= 4, live: s === 3 },
  ]
}

function PayoutHero({ po, meta }: { po: GatewayPayout; meta: ChainToken | undefined }) {
  const steps = payoutSteps(po)
  return (
    <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-[var(--fg-2)]">Amount</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <TokenIcon symbol={po.token} size={22} />
            <span className="figure truncate text-2xl font-semibold">
              {meta ? formatUnits(po.amountRaw, meta.decimals) : po.amountRaw}
            </span>
            <span className="shrink-0 text-base font-medium text-[var(--fg-2)]">
              {meta ? po.token : `${po.token} (raw)`}
            </span>
          </div>
        </div>
        {po.quotedAmountUsd && (
          <div className="shrink-0 text-right text-xs text-[var(--fg-2)]">
            <div>Quoted</div>
            <div className="figure text-base font-semibold text-foreground">
              {fmtUsd(po.quotedAmountUsd)}
            </div>
          </div>
        )}
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-2">
        {steps.map((s) => (
          <li key={s.key} className="min-w-0">
            <div
              className={cn(
                'h-1.5 rounded-full',
                s.bad
                  ? 'bg-[var(--st-bad-dot)]'
                  : s.skipped
                    ? 'bg-[var(--st-ok-dot)] opacity-35'
                    : s.done
                      ? 'bg-[var(--st-ok-dot)]'
                      : s.live
                        ? 'animate-pulse bg-[var(--st-run-dot)]'
                        : 'bg-[var(--chart-muted)]',
              )}
            />
            <div
              className={cn(
                'mt-1.5 truncate text-xs',
                (s.done || s.live) && !s.skipped
                  ? 'font-medium text-foreground'
                  : 'text-[var(--fg-3)]',
              )}
            >
              {s.label}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** One row of a details list: icon · label on the left, value on the right. */
function Fact({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-[var(--fg-2)]" title={title}>
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right">{children}</dd>
    </div>
  )
}

function FactList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-border rounded-xl border border-border">{children}</dl>
}

/** Full address / hash (CSS-truncated to fit) with copy + explorer link. */
function FullValue({
  value,
  align = 'right',
  chainId,
  kind = 'address',
}: {
  value: string
  align?: 'left' | 'right'
  chainId?: number
  kind?: 'address' | 'tx'
}) {
  return (
    <Addr
      value={value}
      truncated={false}
      chainId={chainId}
      kind={kind}
      className={cn('max-w-full', align === 'right' && 'justify-end')}
    />
  )
}

const Dash = () => <span className="text-[var(--fg-3)]">—</span>

function OverviewTab({
  po,
  meta,
  onOpenBatch,
}: {
  po: GatewayPayout
  meta: ChainToken | undefined
  onOpenBatch: (batchId: string) => void
}) {
  return (
    <div className="space-y-6">
      {po.lastError && (
        <Callout tone="danger" title="Last error">
          <span className="font-mono text-xs break-all whitespace-pre-wrap">
            {po.lastError}
          </span>
        </Callout>
      )}

      <SheetSection title="Details">
        <FactList>
          <Fact icon={Activity} label="Network">
            <ChainPill chainId={po.chainId} />
          </Fact>
          <Fact icon={Coins} label="Token">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <TokenIcon symbol={po.token} size={16} />
              {po.token}
              {meta && (
                <span className="font-normal text-[var(--fg-3)]">· {meta.decimals} dp</span>
              )}
            </span>
          </Fact>
          <Fact icon={Hash} label="Raw amount">
            <span className="font-mono text-xs break-all">{po.amountRaw}</span>
          </Fact>
          {po.quotedAmountUsd && (
            <Fact icon={Dollar} label="Quoted">
              <span className="figure font-medium">{fmtUsd(po.quotedAmountUsd)}</span>
              {po.quotedRate && (
                <span
                  className="ml-1.5 text-xs text-[var(--fg-2)]"
                  title="Quoted at create time"
                >
                  @ <span className="figure">${po.quotedRate}</span>/{po.token}
                </span>
              )}
            </Fact>
          )}
          <Fact icon={Tag} label="Kind">
            <span className="font-mono text-xs">{po.kind}</span>
          </Fact>
          <Fact icon={Target} label="Destination">
            <FullValue
              value={po.destinationAddress}
              chainId={po.chainId}
            />
          </Fact>
          <Fact icon={Wallet} label="Source">
            {po.sourceAddress ? (
              <FullValue
                value={po.sourceAddress}
                chainId={po.chainId}
              />
            ) : (
              <Dash />
            )}
          </Fact>
          <Fact icon={Gauge} label="Fee tier">
            {po.feeTier ? <FeeTierBadge tier={po.feeTier} /> : <Dash />}
          </Fact>
          <Fact icon={Fuel} label="Network fee" title="Actual after broadcast, else quoted at plan time">
            <NativeAmount chainId={po.chainId} raw={po.feeEstimateNative ?? po.feeQuotedNative} />
          </Fact>
          {po.topUpTxHash && (
            <Fact icon={Fuel} label="Gas top-up" title="Auto-sponsored before broadcast">
              {po.topUpAmountRaw ? (
                <NativeAmount chainId={po.chainId} raw={po.topUpAmountRaw} />
              ) : (
                <span className="text-[var(--fg-2)]">Sponsored</span>
              )}
            </Fact>
          )}
          {po.batchId && (
            <Fact icon={Layers} label="Batch">
              <button
                type="button"
                onClick={() => onOpenBatch(po.batchId!)}
                className="group inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs hover:underline"
                title="View batch"
              >
                {truncateAddr(po.batchId, 10, 6)}
                <ArrowRight className="size-3.5 text-[var(--fg-3)] group-hover:text-foreground" />
              </button>
            </Fact>
          )}
          {po.parentPayoutId && (
            <Fact icon={ArrowUpRight} label="Parent payout">
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                {truncateAddr(po.parentPayoutId, 10, 6)}
                <CopyButton value={po.parentPayoutId} />
              </span>
            </Fact>
          )}
          {po.webhookUrl && (
            <Fact icon={Webhook} label="Webhook">
              <span className="flex min-w-0 items-center justify-end gap-1">
                <a
                  href={po.webhookUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Per-payout webhook override"
                  className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs hover:underline"
                >
                  <span className="truncate">{po.webhookUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <CopyButton value={po.webhookUrl} />
              </span>
            </Fact>
          )}
        </FactList>
      </SheetSection>

      <SheetSection title="Timeline" icon={Clock}>
        <FactList>
          <Fact icon={Calendar} label="Created">
            {fmtLocal(po.createdAt)}
          </Fact>
          <Fact icon={Send} label="Broadcast try" title="First broadcast attempt">
            {po.broadcastAttemptedAt ? fmtLocal(po.broadcastAttemptedAt) : <Dash />}
          </Fact>
          <Fact icon={ArrowUpRight} label="Submitted">
            {po.submittedAt ? fmtLocal(po.submittedAt) : <Dash />}
          </Fact>
          <Fact icon={CheckCircle2} label="Confirmed">
            {po.confirmedAt ? fmtLocal(po.confirmedAt) : <Dash />}
          </Fact>
        </FactList>
      </SheetSection>
    </div>
  )
}

function TxCard({
  icon,
  title,
  sub,
  hint,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub?: React.ReactNode
  hint?: string
  rows: Array<{ label: string; node: React.ReactNode }>
}) {
  return (
    <li className="rounded-xl border border-border p-3.5" title={hint}>
      <div className="flex items-center gap-3">
        <RowAvatar icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {sub && <div className="text-xs text-[var(--fg-2)]">{sub}</div>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        {rows.map((r) => (
          <React.Fragment key={r.label}>
            <span className="leading-5 text-[var(--fg-2)]">{r.label}</span>
            <span className="min-w-0">{r.node}</span>
          </React.Fragment>
        ))}
      </div>
    </li>
  )
}

function ChainTab({ po }: { po: GatewayPayout }) {
  const replaced = po.originalTxHash && po.originalTxHash !== po.txHash
  const bumps = po.feeBumpAttempts ?? 0
  if (!po.txHash && !replaced && !po.topUpTxHash) {
    return (
      <SharedEmptyState
        compact
        framed
        icon={ArrowsLeftRight}
        title="Not broadcast yet"
        description="Transactions appear here once the gateway broadcasts."
      />
    )
  }
  return (
    <ul className="space-y-2.5">
      <TxCard
        icon={ArrowUpRight}
        title="Payout"
        sub={
          po.txHash
            ? bumps > 0
              ? `Latest after ${bumps} RBF bump${bumps === 1 ? '' : 's'}`
              : undefined
            : 'Pending'
        }
        rows={[
          {
            label: 'Tx',
            node: po.txHash ? (
              <FullValue value={po.txHash} align="left" chainId={po.chainId} kind="tx" />
            ) : (
              <Dash />
            ),
          },
          {
            label: 'To',
            node: (
              <FullValue
                value={po.destinationAddress}
                align="left"
                chainId={po.chainId}
              />
            ),
          },
          ...(po.sourceAddress
            ? [{ label: 'From', node: <FullValue value={po.sourceAddress} align="left" chainId={po.chainId} /> }]
            : []),
        ]}
      />
      {replaced && (
        <TxCard
          icon={RefreshCw}
          title="Original tx"
          sub="Replaced by RBF; the original tx is no longer in the mempool."
          rows={[
            {
              label: 'Tx',
              node: (
                <FullValue
                  value={po.originalTxHash!}
                  align="left"
                  chainId={po.chainId} kind="tx"
                />
              ),
            },
          ]}
        />
      )}
      {po.topUpTxHash && (
        <TxCard
          icon={Fuel}
          title="Gas top-up"
          sub="Auto-sponsored before broadcast"
          hint="Sibling rows of kind gas_top_up carry the full detail."
          rows={[
            ...(po.topUpSponsorAddress
              ? [
                  {
                    label: 'Sponsor',
                    node: (
                      <FullValue value={po.topUpSponsorAddress} align="left" chainId={po.chainId} />
                    ),
                  },
                ]
              : []),
            ...(po.topUpAmountRaw
              ? [
                  {
                    label: 'Amount',
                    node: <NativeAmount chainId={po.chainId} raw={po.topUpAmountRaw} />,
                  },
                ]
              : []),
            {
              label: 'Tx',
              node: (
                <FullValue
                  value={po.topUpTxHash}
                  align="left"
                  chainId={po.chainId} kind="tx"
                />
              ),
            },
          ]}
        />
      )}
    </ul>
  )
}

function FeesTab({ po }: { po: GatewayPayout }) {
  const drift =
    po.feeQuotedNative &&
    po.feeEstimateNative &&
    po.feeQuotedNative !== po.feeEstimateNative
  const bumps = po.feeBumpAttempts ?? 0
  return (
    <SheetSection title="Network fee" icon={Fuel}>
      <FactList>
        <Fact icon={Gauge} label="Tier">
          {po.feeTier ? <FeeTierBadge tier={po.feeTier} /> : <Dash />}
        </Fact>
        <Fact icon={Clock} label="Quoted" title="Fee quoted at plan time">
          <NativeAmount chainId={po.chainId} raw={po.feeQuotedNative} />
        </Fact>
        <Fact icon={Fuel} label="Actual" title="Fee after broadcast">
          <NativeAmount chainId={po.chainId} raw={po.feeEstimateNative} />
        </Fact>
        {drift && (
          <Fact icon={Activity} label="Gas drift">
            <FeeDrift
              chainId={po.chainId}
              quoted={po.feeQuotedNative!}
              actual={po.feeEstimateNative!}
            />
          </Fact>
        )}
        {bumps > 0 && (
          <Fact icon={Zap} label="RBF bumps">
            <span className="figure font-medium">{bumps}</span>
          </Fact>
        )}
        {po.lastFeeBumpAt && (
          <Fact icon={Timer} label="Last bump">
            {fmtLocal(po.lastFeeBumpAt)}
          </Fact>
        )}
      </FactList>
    </SheetSection>
  )
}

function BumpFeeDialog({
  open,
  onOpenChange,
  payoutId,
  chainId,
  onBumped,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  payoutId: string
  chainId: number
  onBumped: () => void
}) {
  const [mode, setMode] = React.useState<'tier' | 'manual'>('tier')
  const [tier, setTier] = React.useState<FeeTier>('high')
  const [satPerVb, setSatPerVb] = React.useState('')
  const [dryRun, setDryRun] = React.useState(false)
  const [result, setResult] = React.useState<BumpFeeResponse['bump'] | null>(
    null,
  )

  // Reset form state on every closed → open transition without an effect:
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setResult(null)
      setMode('tier')
      setTier('high')
      setSatPerVb('')
      setDryRun(false)
    }
  }

  const native = nativeMeta(chainId)

  const bump = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { dryRun }
      if (mode === 'tier') {
        body.tier = tier
      } else {
        const n = parseInt(satPerVb, 10)
        if (!Number.isFinite(n) || n <= 0)
          throw new ApiError('Enter a positive sat/vB rate', 400)
        body.satPerVb = n
      }
      return api<BumpFeeResponse>(
        `/api/gw/admin/payouts/${encodeURIComponent(payoutId)}/bump-fee`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: (res) => {
      setResult(res.bump)
      if (res.bump.dryRun) {
        toast.success('Dry-run preview ready')
      } else {
        toast.success(`Re-broadcast (attempt #${res.bump.attemptNumber})`)
        onBumped()
      }
    },
    onError: (e: ApiError) => {
      const map: Record<string, string> = {
        WRONG_FAMILY: 'Not a UTXO payout — bump-fee only applies to BTC/LTC.',
        WRONG_STATUS: 'Payout is not in submitted status.',
        ALREADY_CONFIRMED: 'Tx is already confirmed; no bump needed.',
        MAX_ATTEMPTS: 'Hit the 10-bump cap on this payout.',
        FEE_NOT_HIGHER:
          "Replacement fee wouldn't beat the prior — try a higher tier or sat/vB.",
        CONFLICT: 'Another bump is already in flight.',
        INSUFFICIENT_FUNDS:
          'Even adding all spendable UTXOs cannot cover the bumped fee.',
        BROADCAST_FAILED: 'Relay rejected the replacement tx.',
        PAYOUT_NOT_FOUND: 'Payout not found.',
      }
      toast.error(map[e.code ?? ''] ?? e.message ?? 'Bump failed')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-5" /> Bump fee (RBF)
          </DialogTitle>
          <DialogDescription>
            Re-broadcasts this UTXO payout at a higher fee. BIP125-compliant —
            shares inputs with the prior tx, fee strictly higher, exceeds the
            relay's incremental-fee threshold. The executor picks the strategy
            (<span className="font-mono">shrink_change</span> →{' '}
            <span className="font-mono">drop_change</span> →{' '}
            <span className="font-mono">add_inputs</span>) automatically.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            bump.mutate()
          }}
        >
          <ModeToggle<'tier' | 'manual'>
            ariaLabel="Bump mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'tier', label: 'Re-quote tier', icon: Gauge },
              { value: 'manual', label: 'Explicit sat/vB', icon: Hash },
            ]}
          />

          {mode === 'tier' ? (
            <Field
              label="Fee tier"
              hint="Re-queries the chain adapter at this tier and clamps up by incremental_relay_fee."
            >
              <Select value={tier} onValueChange={(v) => setTier(v as FeeTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              label="Target feerate (sat/vB)"
              hint="Independent feerate target — e.g. from mempool.space."
            >
              <Input
                value={satPerVb}
                onChange={(e) => setSatPerVb(e.target.value)}
                inputMode="numeric"
                className="figure"
                placeholder="50"
              />
            </Field>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <div>
              <div className="font-medium text-foreground">Dry-run preview</div>
              <div className="text-[var(--fg-2)]">
                Compute the strategy + new fee + change without broadcasting.
                Use to check feasibility (insufficient funds, no headroom).
              </div>
            </div>
          </label>

          {result && <BumpResult bump={result} symbol={native.symbol} chainId={chainId} />}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={bump.isPending}
            >
              {result ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={
                bump.isPending ||
                (mode === 'manual' && !/^\d+$/.test(satPerVb.trim()))
              }
            >
              {bump.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              {bump.isPending
                ? 'Submitting…'
                : dryRun
                  ? 'Preview'
                  : 'Bump & re-broadcast'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Segmented single-choice control used inside dialogs. */
function ModeToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex h-9 w-full items-center rounded-[10px] bg-[var(--bg-active)] p-0.5"
    >
      {options.map((o) => {
        const Icon = o.icon
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 truncate rounded-lg px-2.5 text-sm font-medium text-[var(--fg-2)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              on && 'bg-[var(--bg-1)] text-foreground shadow-[var(--shadow-sm)]',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function BumpResult({
  bump,
  symbol,
  chainId,
}: {
  bump: BumpFeeResponse['bump']
  symbol: string
  chainId: number
}) {
  const priorBtc = formatUnits(bump.priorFeeSats, 8)
  const newBtc = formatUnits(bump.newFeeSats, 8)
  return (
    <div className="space-y-3 rounded-xl border border-border bg-[var(--bg-2)] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={bump.dryRun ? 'info' : 'ok'}>
          {bump.dryRun ? 'preview' : `attempt #${bump.attemptNumber}`}
        </StatusPill>
        <Badge variant="default">{bump.strategy.replace('_', ' ')}</Badge>
        <span className="figure ml-auto text-xs text-[var(--fg-2)]">{bump.vsize} vB</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-[var(--fg-2)]">Prior fee</dt>
        <dd className="figure">
          {priorBtc} {symbol}{' '}
          <span className="text-[var(--fg-2)]">· {bump.priorFeerateSatVb} sat/vB</span>
        </dd>
        <dt className="text-[var(--fg-2)]">New fee</dt>
        <dd className="figure font-medium text-[var(--st-ok)]">
          {newBtc} {symbol}{' '}
          <span className="font-normal text-[var(--fg-2)]">
            · {bump.newFeerateSatVb} sat/vB
          </span>
        </dd>
        {bump.changeAddress && bump.changeValueSats && (
          <>
            <dt className="text-[var(--fg-2)]">Change</dt>
            <dd className="figure">
              {formatUnits(bump.changeValueSats, 8)} {symbol}{' '}
              <span className="inline-flex items-center gap-1 text-[var(--fg-2)]">
                →<Addr value={bump.changeAddress} chainId={chainId} />
              </span>
            </dd>
          </>
        )}
        {!bump.dryRun && (
          <>
            <dt className="text-[var(--fg-2)]">Replaced</dt>
            <dd className="min-w-0">
              <FullValue value={bump.priorTxHash} align="left" chainId={chainId} kind="tx" />
            </dd>
            <dt className="text-[var(--fg-2)]">New tx</dt>
            <dd className="min-w-0">
              <FullValue value={bump.txHash} align="left" chainId={chainId} kind="tx" />
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

function NativeAmount({
  chainId,
  raw,
}: {
  chainId: number
  raw: string | null | undefined
}) {
  if (raw == null) return <Dash />
  const native = nativeMeta(chainId)
  return (
    <span className="inline-flex items-center gap-1.5" title={`raw ${raw}`}>
      <span className="figure font-medium">{formatUnits(raw, native.decimals)}</span>
      <TokenIcon symbol={native.symbol} size={14} />
      <span className="text-xs text-[var(--fg-2)]">{native.symbol}</span>
    </span>
  )
}

function FeeDrift({
  chainId,
  quoted,
  actual,
}: {
  chainId: number
  quoted: string
  actual: string
}) {
  const native = nativeMeta(chainId)
  const q = parseFloat(quoted)
  const a = parseFloat(actual)
  const qHuman = formatUnits(quoted, native.decimals)
  const aHuman = formatUnits(actual, native.decimals)
  if (!isFinite(q) || !isFinite(a) || q <= 0) {
    return (
      <span className="figure text-xs text-[var(--fg-2)]">
        {qHuman} → {aHuman} {native.symbol}
      </span>
    )
  }
  const pct = ((a - q) / q) * 100
  const up = pct > 0
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="figure text-xs text-[var(--fg-2)]">
        {qHuman} → {aHuman} {native.symbol}
      </span>
      <StatusPill
        size="sm"
        icon={null}
        tone={Math.abs(pct) < 10 ? 'off' : up ? 'warn' : 'ok'}
      >
        {up ? '+' : ''}
        {pct.toFixed(1)}%
      </StatusPill>
    </span>
  )
}

/* ── skeletons / empty / error ──────────────────────────── */

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-6 py-3.5 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="w-40 space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="hidden h-3.5 w-24 sm:block" />
          <div className="flex-1" />
          <div className="space-y-1.5">
            <Skeleton className="ml-auto h-3.5 w-24" />
            <Skeleton className="ml-auto h-2.5 w-14" />
          </div>
          <Skeleton className="hidden h-3 w-12 sm:block" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3.5 w-20" />
      <div className="divide-y divide-border rounded-xl border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-40" />
          </div>
        ))}
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="fade-in space-y-8">
      <PageHeader title="Payouts" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-7 w-24" />
          </Card>
        ))}
      </div>
      <TableCard>
        <TableSkeleton />
      </TableCard>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <SharedEmptyState
      icon={ArrowUpRight}
      title="No payouts yet"
      description="Plan one to send funds out."
      action={
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" /> Plan payout
        </Button>
      }
    />
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <SharedEmptyState
      compact
      title="No payouts match these filters"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" /> Clear filters
        </Button>
      }
    />
  )
}

function ErrorCard({ message }: { message: string }) {
  return <ErrorState title="Could not load payouts" message={message} />
}

function NoApiKeyCard({ merchant }: { merchant: Merchant }) {
  return (
    <SharedEmptyState
      framed
      icon={KeyRound}
      title={
        <>
          No API key for <span className="font-mono">{merchant.name}</span>
        </>
      }
      description="Rotate or import the key in Stores to list payouts."
      action={
        <Button size="sm" asChild>
          <Link to="/stores">
            <KeyRound className="size-4" /> Set up API key
          </Link>
        </Button>
      }
    />
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-8">
      <PageHeader title="Payouts" />
      <SharedEmptyState
        framed
        icon={ArrowUpRight}
        title="Add a store first"
        description="Payouts use a store's API key."
        action={
          <Button size="sm" asChild>
            <Link to="/stores">
              Go to Stores <ChevronDown className="size-4 -rotate-90" />
            </Link>
          </Button>
        }
      />
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
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-3 text-sm text-[var(--fg-2)]">
        <Fuel className="size-4 shrink-0 text-[var(--fg-3)]" />
        Fill chain, token, amount, and destination to see fee tiers.
      </div>
    )
  }

  if (loading && !estimate) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border px-3 py-2.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
        <span className="sr-only">Estimating fees…</span>
      </div>
    )
  }

  // Real ApiError (400 VALIDATION_FAILED / 503 ORACLE_FAILED / 429 / etc).
  // v2.1 made operational issues into `warnings` on a 200, so hitting this
  // branch now means a genuine input or auth problem.
  if (!estimate) {
    return (
      <Callout tone="warn" title={errorMessage ?? 'Could not estimate fees.'}>
        <span className="text-xs">
          Submitting without an estimate; the gateway will try its default tier.
        </span>
      </Callout>
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
      <Callout
        tone="info"
        title="Fee will be calculated at broadcast"
        action={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
            Retry
          </Button>
        }
      >
        <span className="text-xs text-[var(--fg-2)]">
          The chain&rsquo;s RPC couldn&rsquo;t quote tiers right now. The
          executor will pick a reasonable default when it picks this payout
          up. Safe to submit; only the preview is missing.
        </span>
      </Callout>
    )
  }

  if (!tiers.tieringSupported) {
    const t = tiers.medium
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
        <Fuel className="size-4 shrink-0 text-[var(--fg-2)]" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--fg-2)]">Network fee</div>
          <div className="figure text-sm font-medium">{fmtNative(t.nativeAmountRaw)}</div>
        </div>
        {t.usdAmount && (
          <span className="figure text-sm text-[var(--fg-2)]">~{fmtUsd(t.usdAmount)}</span>
        )}
        <span
          className="text-[var(--fg-3)]"
          title="This chain does not support fee tiering."
        >
          <Info className="size-4" />
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Fee tier</div>
        {loading && <Loader2 className="size-4 animate-spin text-[var(--fg-3)]" />}
      </div>
      <div role="radiogroup" aria-label="Fee tier" className="grid grid-cols-3 gap-2">
        {(['low', 'medium', 'high'] as const).map((t) => {
          const q = tiers[t]
          const active = selected === t
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(t)}
              className={cn(
                'min-w-0 cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                active
                  ? 'border-foreground bg-card ring-1 ring-foreground'
                  : 'border-border bg-card hover:border-[var(--fg-3)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{tierLabel(t)}</span>
                {active && <CheckCircle2 weight="fill" className="size-4 shrink-0" />}
              </div>
              <div className="figure mt-1 truncate text-xs text-[var(--fg-2)]">
                {fmtNative(q.nativeAmountRaw)}
              </div>
              {q.usdAmount && (
                <div className="figure truncate text-xs text-[var(--fg-3)]">
                  {fmtUsd(q.usdAmount)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
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
  const [consolidateOpen, setConsolidateOpen] = React.useState(false)

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
  // Companion warning: aggregate IS sufficient but it's split across
  // pool addresses. Account-model chains pick a single sender per payout,
  // so the operator needs to consolidate first.
  const consolidateRequired = warnings.includes(
    'single_source_insufficient_consolidate_required',
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

  // Review-column fee line, read straight off the estimate already loaded.
  const reviewFee = (() => {
    const est = estimate.data
    if (!est) return null
    if (est.warnings.includes('fee_quote_unavailable')) return 'At broadcast'
    const q = est.tiers.tieringSupported ? est.tiers[effectiveFeeTier] : est.tiers.medium
    const native =
      nativeDecimals == null
        ? `${q.nativeAmountRaw} (raw)`
        : `${formatUnits(q.nativeAmountRaw, nativeDecimals)} ${est.tiers.nativeSymbol}`
    return q.usdAmount ? `${native} · ${fmtUsd(q.usdAmount)}` : native
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="size-5" /> Plan payout
          </DialogTitle>
          <DialogDescription>
            Creates the payout in <span className="font-mono">planned</span>{' '}
            state. The gateway will reserve a fee wallet, sign, and broadcast on
            its next scheduler tick.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ── form column ── */}
            <div className="min-w-0 space-y-5">
              <ChainTokenPicker
                chainId={chainId}
                token={token}
                onChange={({ chainId: c, token: t, tokenMeta: m }) => {
                  setChainId(c)
                  setToken(t)
                  setTokenMeta(m ?? null)
                }}
                // UTXO chains (BTC/LTC) never report `bootstrapReady: true` because
                // the backend formula requires `feeWallets`, and the UTXO family
                // doesn't have a fee-wallet topology — payouts use coinselect over
                // owned UTXOs directly. Accept any wired UTXO chain alongside the
                // strict `bootstrapReady` set for the other families.
                filter={(c) =>
                  c.bootstrapReady || (c.family === 'utxo' && c.wired)
                }
                emptyHint="No payout-ready chains. Bootstrap fee wallets / Alchemy webhooks from Chains first."
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Amount in">
                  <ModeToggle<PayoutAmountMode>
                    ariaLabel="Amount mode"
                    value={mode}
                    onChange={(k) => {
                      setMode(k)
                      setAmount('')
                    }}
                    options={[
                      { value: 'amount', label: 'Token', icon: Coins },
                      { value: 'raw', label: 'Raw', icon: Hash },
                      { value: 'usd', label: 'USD', icon: Dollar },
                    ]}
                  />
                </Field>
                <Field
                  label={amountLabel}
                  right={
                    available.match ? (
                      <button
                        type="button"
                        onClick={useMax}
                        className="cursor-pointer text-xs font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        Use max
                      </button>
                    ) : undefined
                  }
                >
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={placeholder}
                    inputMode={mode === 'raw' ? 'numeric' : 'decimal'}
                    className="figure"
                    aria-invalid={amountFormatError ? true : undefined}
                  />
                </Field>
              </div>
              <div className="-mt-2 space-y-1 text-xs">
                {amountFormatError ? (
                  <div className="text-destructive">{amountFormatError}</div>
                ) : (
                  <div className="text-[var(--fg-2)]">{amountHint}</div>
                )}
                {available.match ? (
                  <div className="flex items-center gap-1.5 text-[var(--fg-2)]">
                    <Wallet className="size-3.5" />
                    Available
                    <span className="figure font-medium text-foreground">
                      {fmtNum(available.match.amountDecimal)} {token}
                    </span>
                    <span className="text-[var(--fg-3)]">
                      ~{fmtUsd(available.match.usd)}
                    </span>
                  </div>
                ) : available.loading ? (
                  <div className="flex items-center gap-1.5 text-[var(--fg-3)]">
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking available balance…
                  </div>
                ) : chainId && token ? (
                  <div className="flex items-center gap-1.5 text-[var(--fg-2)]">
                    <Wallet className="size-3.5" />
                    No {token} balance on this chain in the gateway pool.
                  </div>
                ) : null}
              </div>

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
                <Callout tone="warn">
                  <span className="text-xs">
                    USD pegging snapshots at create time; {token} price can drift
                    before broadcast.
                  </span>
                </Callout>
              )}

              <Field label="Destination address">
                <Input
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  placeholder="0x…"
                  className="font-mono text-sm"
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
                <div className="space-y-2">
                  <NoSourceBalanceBanner token={token || 'this token'} />
                  {consolidateRequired && (
                    <Callout
                      tone="warn"
                      action={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConsolidateOpen(true)}
                          disabled={!chainId || !token}
                        >
                          <Layers className="size-4" />
                          Consolidate first
                        </Button>
                      }
                    >
                      <span className="text-xs">
                        Aggregate balance is sufficient but split across pool
                        addresses — consolidate first to unblock this payout.
                      </span>
                    </Callout>
                  )}
                </div>
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

              <details className="group rounded-xl border border-border">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--fg-1)] select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <Webhook className="size-4 text-[var(--fg-2)]" />
                  Webhook override
                  <span className="text-[var(--fg-3)]">· optional</span>
                  <ChevronDown className="ml-auto size-4 text-[var(--fg-3)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid grid-cols-1 gap-4 border-t border-border px-4 pt-4 pb-4 sm:grid-cols-2">
                  <Field
                    label="Webhook URL"
                    hint="Events for this payout dispatch here instead of the store default. Requires a secret."
                  >
                    <Input
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://store.example.com/hooks/payout"
                      type="url"
                      className="font-mono text-sm"
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
                      className="font-mono text-sm"
                      minLength={16}
                      maxLength={512}
                    />
                  </Field>
                  {webhookMismatch && (
                    <div className="text-xs text-destructive sm:col-span-2">
                      Webhook URL and secret must be provided together.
                    </div>
                  )}
                </div>
              </details>
            </div>

            {/* ── review column ── */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              <div className="rounded-xl border border-border bg-[var(--bg-2)]">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <ListBullets className="size-4 text-[var(--fg-2)]" />
                  Review
                </div>
                <dl className="divide-y divide-border text-sm">
                  <ReviewRow label="Network">
                    {RAW_RE.test(chainId) ? (
                      <ChainPill chainId={parseInt(chainId, 10)} />
                    ) : (
                      <Dash />
                    )}
                  </ReviewRow>
                  <ReviewRow label="Amount">
                    {amount !== '' && !amountFormatError ? (
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className="figure font-semibold">
                          {mode === 'usd' ? fmtUsd(amount) : amount}
                        </span>
                        {token && <TokenIcon symbol={token} size={16} />}
                        <span className="text-[var(--fg-2)]">
                          {mode === 'usd' ? token || '' : mode === 'raw' ? `${token} raw` : token}
                        </span>
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </ReviewRow>
                  <ReviewRow label="To">
                    {destinationAddress.trim() ? (
                      <span className="font-mono text-xs" title={destinationAddress.trim()}>
                        {truncateAddr(destinationAddress.trim(), 6, 4)}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </ReviewRow>
                  <ReviewRow label="Fee">
                    {reviewFee ? (
                      <span className="figure text-xs">
                        {tieringSupported && reviewFee !== 'At broadcast' && (
                          <span className="font-medium">{tierLabel(effectiveFeeTier)} · </span>
                        )}
                        {reviewFee}
                      </span>
                    ) : estimate.isFetching ? (
                      <Loader2 className="ml-auto size-4 animate-spin text-[var(--fg-3)]" />
                    ) : (
                      <Dash />
                    )}
                  </ReviewRow>
                  <ReviewRow label="Webhook">
                    <span className="text-[var(--fg-2)]">
                      {webhookUrl.trim() ? 'Override' : 'Store default'}
                    </span>
                  </ReviewRow>
                </dl>
              </div>

              {source && !noSourceBalance && (
                <SourcePanel
                  source={source}
                  topUp={topUp}
                  alternatives={alternatives}
                  tokenMeta={tokenMeta}
                  nativeDecimals={nativeDecimals}
                  chainId={RAW_RE.test(chainId) ? parseInt(chainId, 10) : undefined}
                />
              )}
            </aside>
          </div>

          <DialogFooter className="border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {create.isPending ? 'Planning…' : 'Plan payout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConsolidateDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        prefillChainId={chainId ? parseInt(chainId, 10) : undefined}
        prefillToken={token || undefined}
        onPlanned={() => {
          // Refetch the estimate so the warning clears once legs confirm.
          void estimate.refetch()
        }}
      />
    </Dialog>
  )
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-3 px-4 py-2">
      <dt className="w-20 shrink-0 text-[var(--fg-2)]">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right">{children}</dd>
    </div>
  )
}

/* ── v2.2 estimate panels ───────────────────────────────── */

function NoSourceBalanceBanner({ token }: { token: string }) {
  return (
    <Callout
      tone="danger"
      title={<>No source address has enough {token}</>}
      action={
        <Button size="sm" variant="outline" asChild>
          <Link to="/balances">
            <Wallet className="size-4" /> Open balances
          </Link>
        </Button>
      }
    >
      <span className="text-xs">
        Fund one of your HD addresses with {token} before planning this
        payout. Any pool address auto-qualifies as a source — see Balances
        for current holdings.
      </span>
    </Callout>
  )
}

function NoGasSponsorBanner() {
  return (
    <Callout tone="danger" title="No gas sponsor available">
      <span className="text-xs">
        A source has enough token, but no other HD address has enough
        native to cover gas. Fund a pool address with native before the
        executor can auto-sponsor the top-up.
      </span>
    </Callout>
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
    <Callout tone="warn" title="Amount exceeds net spendable">
      <div className="space-y-3 text-xs">
        <p className="text-[var(--fg-2)]">
          Sending this much would leave the source unable to cover gas.
          Either lower the amount or proceed and let the backend reject with
          a suggested value. Source holds{' '}
          <span className="figure font-medium text-foreground">{bal}</span>{' '}
          {source.tokenSymbol}.
        </p>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--warn-border)] bg-card px-3 py-2.5">
          <input
            type="checkbox"
            checked={proceedAnyway}
            onChange={(e) => onToggleProceed(e.target.checked)}
            className="mt-0.5 size-4 cursor-pointer accent-warn"
          />
          <span className="text-[var(--fg-1)]">
            I understand — submit anyway and apply the backend&rsquo;s suggested
            amount if it rejects.
          </span>
        </label>
      </div>
    </Callout>
  )
}

function SourcePanel({
  source,
  topUp,
  alternatives,
  tokenMeta,
  nativeDecimals,
  chainId,
}: {
  source: PayoutEstimateSource
  topUp: PayoutEstimate['topUp']
  alternatives: PayoutEstimateSource[]
  tokenMeta: ChainToken | null
  nativeDecimals: number | null
  chainId?: number
}) {
  const fmtToken = (raw: string) =>
    tokenMeta ? formatUnits(raw, tokenMeta.decimals) : raw
  const fmtNative = (raw: string) =>
    nativeDecimals != null ? formatUnits(raw, nativeDecimals) : raw

  const sponsorMissing = topUp && topUp.sponsor === null
  const sponsorNeeded = topUp !== null && !sponsorMissing

  return (
    <div className="rounded-xl border border-border text-xs">
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 text-[var(--fg-2)]" />
          Picked source
        </div>
        <Addr value={source.address} chainId={chainId} className="max-w-full" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--fg-2)]">
          <span className="inline-flex items-center gap-1">
            <TokenIcon symbol={source.tokenSymbol} size={14} />
            <span className="figure text-foreground">{fmtToken(source.tokenBalance)}</span>
            {source.tokenSymbol}
          </span>
          <span className="inline-flex items-center gap-1">
            <TokenIcon symbol={source.nativeSymbol} size={14} />
            <span className="figure text-foreground">{fmtNative(source.nativeBalance)}</span>
            {source.nativeSymbol}
          </span>
        </div>
      </div>

      {sponsorNeeded && topUp && topUp.sponsor && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          <div className="flex items-start gap-1.5 text-[var(--fg-2)]">
            <Fuel className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Gas auto-sponsored:{' '}
              <span className="figure text-foreground">{fmtNative(topUp.amountRaw)}</span>{' '}
              {source.nativeSymbol} moved from sponsor before broadcast.
            </span>
          </div>
          <Addr value={topUp.sponsor.address} chainId={chainId} className="max-w-full" />
        </div>
      )}

      {sponsorMissing && (
        <div className="border-t border-border p-3">
          <Callout tone="danger">
            <span className="text-xs">
              Source lacks gas and no other HD address has enough native to
              sponsor. Submit will fail with{' '}
              <span className="font-mono">NO_GAS_SPONSOR_AVAILABLE</span>.
            </span>
          </Callout>
        </div>
      )}

      {alternatives.length > 0 && (
        <details className="group border-t border-border px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[var(--fg-2)] select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            {alternatives.length} alternative source
            {alternatives.length === 1 ? '' : 's'}
            <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 space-y-2">
            {alternatives.map((alt) => (
              <li key={alt.address} className="space-y-0.5">
                <Addr value={alt.address} chainId={chainId} />
                <div className="figure text-[var(--fg-2)]">
                  {fmtToken(alt.tokenBalance)} {alt.tokenSymbol} ·{' '}
                  {fmtNative(alt.nativeBalance)} {alt.nativeSymbol}
                </div>
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
    <Callout tone="info" title="Amount leaves no room for gas">
      {errorMessage && (
        <div className="text-xs text-[var(--fg-2)]">{errorMessage}</div>
      )}

      <div className="mt-2.5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--fg-2)]">Suggested</div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="figure text-lg font-semibold text-foreground">
              {primary.value}
            </span>
            <span className="text-xs text-[var(--fg-2)]">{primary.suffix}</span>
          </div>
          <div className="figure mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--fg-3)]">
            {suggestion.decimal && mode !== 'amount' && (
              <span>
                {suggestion.decimal} {tokenSymbol}
              </span>
            )}
            {suggestion.usd && mode !== 'usd' && <span>~${suggestion.usd}</span>}
            {mode !== 'raw' && <span>raw {suggestion.raw}</span>}
          </div>
        </div>
        <Button type="button" size="sm" onClick={onApply}>
          Use suggested amount
        </Button>
      </div>
    </Callout>
  )
}

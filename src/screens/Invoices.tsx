import * as React from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  CalendarRange,
  ChevronDown,
  Coins,
  ExternalLink,
  FileText,
  Hash,
  KeyRound,
  Plus,
  Webhook,
  X,
  ArrowsLeftRight,
  Braces,
  Calendar,
  CheckCircle2,
  Dollar,
  Layers,
  ListBullets,
  QrCode as QrCodeIcon,
  Scale,
  Tag,
  Timer,
} from '@/components/icons'

import { useUrlParam } from '@/lib/useUrlParam'
import { api, ApiError } from '@/lib/api'
import {
  fmtCountdown,
  fmtLocal,
  fmtNum,
  fmtRel,
  fmtUsd,
  truncateAddr,
  useNow,
} from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import type {
  ChainInventoryEntry,
  Family,
  GatewayInvoice,
  InvoiceDetails,
  InvoiceExtraStatus,
  InvoiceListResponse,
  Merchant,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainTokenPicker } from '@/components/ChainTokenPicker'
import { ListFilterBar } from '@/components/ListFilterBar'
import {
  cleanFilterValues,
  useFilterOptions,
  type FilterSection,
  type FilterValues,
  type SortConfig,
} from '@/lib/listFilters'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { MetadataEditor } from '@/components/MetadataEditor'
import { QrCode } from '@/components/QrCode'
import { Badge } from '@/components/ui/badge'
import { ChainPill } from '@/components/ChainPill'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState as SharedEmptyState, ErrorState } from '@/components/States'
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
  SheetFooter,
  SheetHero,
  SheetSection,
  SheetTabs,
} from '@/components/ui/sheet'
import { StatusPill, toneFor, type StatusTone } from '@/components/StatusPill'
import { Pager, RowAvatar, TableCard } from '@/components/DataTable'
import { FamilyStack, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { chainInfo } from '@/lib/chains'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/* ── public helpers reused by Payouts ───────────────────── */

/**
 * Map a (possibly legacy) invoice status onto the v3 lifecycle stages
 * plus a synthetic extraStatus when the legacy value implied fidelity
 * (`partial` → processing+partial, `overpaid` → completed+overpaid).
 * Non-invoice statuses (payouts: planned/reserved/submitted/…/transactions:
 * detected/confirmed/reverted/orphaned) pass through unchanged.
 */
function normalizeInvoiceStatus(
  status: string,
): { status: string; extra: InvoiceExtraStatus } {
  switch (status) {
    case 'created':
      return { status: 'pending', extra: null }
    case 'partial':
      return { status: 'processing', extra: 'partial' }
    case 'detected':
      return { status: 'processing', extra: null }
    case 'confirmed':
      return { status: 'completed', extra: null }
    case 'overpaid':
      return { status: 'completed', extra: 'overpaid' }
    default:
      return { status, extra: null }
  }
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'completed':
    case 'confirmed':
      return 'ok'
    case 'processing':
    case 'submitted':
    case 'reserved':
    case 'topping-up':
    case 'detected':
      return 'run'
    case 'pending':
    case 'planned':
      return 'wait'
    case 'expired':
      return 'off'
    case 'reverted':
    case 'orphaned':
    case 'canceled':
    case 'failed':
      return 'bad'
    case 'overpaid':
      return 'info'
    case 'partial':
      return 'warn'
    default:
      return toneFor(status)
  }
}

export function StatusBadge({
  status,
  extraStatus,
  stack,
}: {
  status: string
  extraStatus?: InvoiceExtraStatus
  /**
   * When `true`, render the lifecycle pill on top and the fidelity note
   * below — used in narrow list cells.
   */
  stack?: boolean
}) {
  const norm = normalizeInvoiceStatus(status)
  const effectiveExtra = extraStatus ?? norm.extra
  const extra = effectiveExtra && (
    <StatusPill tone={effectiveExtra === 'overpaid' ? 'info' : 'warn'} size="sm" icon={null}>
      {effectiveExtra}
    </StatusPill>
  )
  return (
    <span
      className={
        stack
          ? 'inline-flex flex-col items-start gap-1'
          : 'inline-flex flex-wrap items-center gap-1'
      }
    >
      <StatusPill tone={statusTone(norm.status)}>{norm.status.replace(/-/g, ' ')}</StatusPill>
      {extra}
    </span>
  )
}

/* ── page ────────────────────────────────────────────────── */

const PAGE_SIZE = 25

/* Filter spec for invoices — keys are the gateway's query-param names. */

const INVOICE_SECTIONS: FilterSection[] = [
  {
    title: 'Status',
    icon: Activity,
    fields: [
      {
        kind: 'enumSet',
        key: 'status',
        label: 'Lifecycle status',
        options: [
          { value: 'pending', label: 'Pending' },
          { value: 'processing', label: 'Processing' },
          { value: 'completed', label: 'Completed' },
          { value: 'expired', label: 'Expired' },
          { value: 'canceled', label: 'Canceled' },
        ],
      },
    ],
  },
  {
    title: 'Payment',
    icon: Coins,
    fields: [
      {
        kind: 'enumSet',
        key: 'extraStatus',
        label: 'Payment fidelity',
        options: [
          { value: 'partial', label: 'Partial (underpaid)' },
          { value: 'overpaid', label: 'Overpaid' },
        ],
      },
      {
        kind: 'tri',
        key: 'hasPayments',
        label: 'Has payments',
        yes: 'Credited',
        no: 'Untouched',
      },
      {
        kind: 'numberRange',
        keyMin: 'amountUsdMin',
        keyMax: 'amountUsdMax',
        label: 'Invoice amount (USD)',
        prefix: '$',
      },
      {
        kind: 'numberRange',
        keyMin: 'paidUsdMin',
        keyMax: 'paidUsdMax',
        label: 'Paid amount (USD)',
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
        key: 'externalId',
        label: 'External ID (exact)',
        placeholder: 'cart-123',
      },
      {
        kind: 'text',
        key: 'externalIdContains',
        label: 'External ID contains',
        placeholder: 'substring',
      },
      {
        kind: 'text',
        key: 'toAddress',
        label: 'Receive address (exact)',
        placeholder: '0x… / T… / base58',
      },
      {
        kind: 'text',
        key: 'addressContains',
        label: 'Receive address contains',
        placeholder: 'substring',
      },
      {
        kind: 'text',
        key: 'fromAddress',
        label: 'Payer address',
        placeholder: 'paid from…',
      },
      {
        kind: 'text',
        key: 'txHash',
        label: 'Tx hash',
        placeholder: 'on-chain hash',
      },
    ],
  },
  {
    title: 'Dates',
    icon: CalendarRange,
    fields: [
      { kind: 'dateRange', keyFrom: 'createdFrom', keyTo: 'createdTo', label: 'Created' },
      { kind: 'dateRange', keyFrom: 'updatedFrom', keyTo: 'updatedTo', label: 'Updated' },
      {
        kind: 'dateRange',
        keyFrom: 'confirmedFrom',
        keyTo: 'confirmedTo',
        label: 'Confirmed',
      },
      { kind: 'dateRange', keyFrom: 'expiresFrom', keyTo: 'expiresTo', label: 'Expires' },
    ],
  },
]

const INVOICE_SORT: SortConfig = {
  byKey: 'sortBy',
  dirKey: 'sortDir',
  defaultBy: 'createdAt',
  defaultDir: 'desc',
  options: [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Updated' },
    { value: 'confirmedAt', label: 'Confirmed' },
    { value: 'expiresAt', label: 'Expires' },
    { value: 'amountUsd', label: 'Amount (USD)' },
    { value: 'paidUsd', label: 'Paid (USD)' },
  ],
}

/** Filter keys that don't narrow the result set (sort is cosmetic). */
const NON_NARROWING = new Set(['sortBy', 'sortDir'])

function hasNarrowingFilter(values: FilterValues): boolean {
  return Object.entries(cleanFilterValues(values)).some(
    ([k]) => !NON_NARROWING.has(k),
  )
}

export function InvoicesPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const [filters, setFilters] = React.useState<FilterValues>({})
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailId, setDetailId] = useUrlParam('invoice')

  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  // Chain + token options for the filter bar's chain/token pickers.
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
    queryKey: ['invoices', 'list', active?.id ?? null, filters, page] as const,
    queryFn: async () => {
      const qs = new URLSearchParams(cleanFilterValues(filters))
      qs.set('limit', String(PAGE_SIZE))
      qs.set('offset', String(page * PAGE_SIZE))
      const res = await api<Partial<InvoiceListResponse> | null>(
        `/api/mg/${encodeURIComponent(active!.id)}/invoices?${qs}`,
      )
      // A misconfigured gateway can answer 200 with an empty / non-JSON body
      // (api() yields null then) or omit `invoices`. Normalize to a valid
      // page so the list shows an empty state instead of crashing.
      return {
        invoices: Array.isArray(res?.invoices) ? res.invoices : [],
        limit: typeof res?.limit === 'number' ? res.limit : PAGE_SIZE,
        offset: typeof res?.offset === 'number' ? res.offset : page * PAGE_SIZE,
        hasMore: res?.hasMore === true,
      } satisfies InvoiceListResponse
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })

  const all = list.data?.invoices ?? []
  const narrowed = hasNarrowingFilter(filters)

  if (merchants.isLoading) {
    return <PageSkeleton title="Invoices" />
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchants />
  }

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        eyebrow="Payments"
        title="Invoices"
        description="Issued by the selected store."
        actions={
          <>
            <MerchantSwitcher />
            <Button size="sm" disabled={!canList} onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New invoice
            </Button>
          </>
        }
      />

      {!canList && active ? (
        <NoApiKeyCard merchant={active} />
      ) : (
        <>
          <ListFilterBar
            values={filters}
            onChange={setFilters}
            sections={INVOICE_SECTIONS}
            sort={INVOICE_SORT}
            chainOptions={chainOptions}
            tokenOptions={tokenOptions}
            resultCount={all.length}
            loading={list.isFetching}
          />

          {list.isLoading ? (
            <ListSkeleton />
          ) : list.isError ? (
            <ErrorCard message={list.error instanceof Error ? list.error.message : 'Could not load'} />
          ) : all.length === 0 && page === 0 ? (
            narrowed ? (
              <NoMatch onClear={() => setFilters({})} />
            ) : (
              <EmptyState onCreate={() => setCreateOpen(true)} />
            )
          ) : (
            <TableCard
              footer={
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  shown={all.length}
                  hasNext={list.data?.hasMore === true}
                  onPage={setPage}
                  loading={list.isFetching}
                  noun="invoices"
                />
              }
            >
              <InvoiceList rows={all} onOpen={setDetailId} dim={list.isPlaceholderData} />
            </TableCard>
          )}
        </>
      )}

      {active && canList && (
        <>
          <CreateInvoiceDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            merchantId={active.id}
            onCreated={(id) => setDetailId(id)}
          />
          <InvoiceDetailSheet
            merchantId={active.id}
            invoiceId={detailId}
            onOpenChange={(v) => !v && setDetailId(null)}
          />
        </>
      )}
    </div>
  )
}


function InvoiceList({
  rows,
  onOpen,
  dim,
}: {
  rows: GatewayInvoice[]
  onOpen: (id: string) => void
  dim?: boolean
}) {
  return (
    <TableWrap>
      <Table className={cn('min-w-[720px] transition-opacity', dim && 'opacity-60')}>
        <THead>
          <tr>
            <Th>Invoice</Th>
            <Th>Status</Th>
            <Th>Network</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Updated</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} onOpen={() => onOpen(inv.id)} />
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

function amountSpecOf(inv: GatewayInvoice): string {
  if (inv.amountUsd) return fmtUsd(inv.amountUsd)
  if (inv.fiatAmount && inv.fiatCurrency) return `${inv.fiatAmount} ${inv.fiatCurrency}`
  return inv.requiredAmountRaw
}

function unixOf(iso: string): number {
  const t = Date.parse(iso)
  return isFinite(t) ? Math.floor(t / 1000) : 0
}

function InvoiceRow({
  inv,
  onOpen,
}: {
  inv: GatewayInvoice
  onOpen: () => void
}) {
  const families = inv.acceptedFamilies ?? []
  const multiFamily = families.length > 1
  const paid = inv.paidUsd ? parseFloat(inv.paidUsd) : 0
  const required = inv.amountUsd ? parseFloat(inv.amountUsd) : 0
  const showPaid = inv.amountUsd != null && paid > 0
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
          {multiFamily ? (
            <RowAvatar icon={Layers} />
          ) : (
            <TokenOnChain symbol={inv.token} chainId={inv.chainId} size={32} />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{inv.externalId ?? truncateAddr(inv.id, 8, 6)}</span>
              {inv.webhookUrl && (
                <span title="Per-invoice webhook URL override" className="text-[var(--fg-3)]">
                  <Webhook className="size-3.5" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 font-mono text-xs text-[var(--fg-3)]">
              {truncateAddr(inv.id, 6, 4)}
              <span onClick={(e) => e.stopPropagation()}>
                <CopyButton value={inv.id} />
              </span>
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <StatusBadge status={inv.status} extraStatus={inv.extraStatus ?? null} />
      </Td>
      <Td>
        {multiFamily ? (
          <FamilyStack families={families} />
        ) : (
          <ChainPill chainId={inv.chainId} className="text-sm" />
        )}
      </Td>
      <Td align="right">
        <div className="font-semibold">{amountSpecOf(inv)}</div>
        <div className="text-xs">
          {showPaid ? (
            <span className={paid >= required ? 'text-[var(--st-ok)]' : 'text-[var(--fg-2)]'}>
              {fmtUsd(paid)} paid
              {inv.overpaidUsd && parseFloat(inv.overpaidUsd) > 0 && (
                <span className="text-[var(--st-warn)]"> · +{fmtUsd(inv.overpaidUsd)}</span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[var(--fg-2)]">
              <TokenIcon symbol={inv.token} size={14} />
              {inv.token}
            </span>
          )}
        </div>
      </Td>
      <Td align="right" className="text-sm whitespace-nowrap text-[var(--fg-2)]">
        {fmtRel(unixOf(inv.updatedAt))}
      </Td>
    </Tr>
  )
}

/* ── detail sheet ────────────────────────────────────────── */

type Tab = 'overview' | 'payment' | 'transactions'

function InvoiceDetailSheet({
  merchantId,
  invoiceId,
  onOpenChange,
}: {
  merchantId: string
  invoiceId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const open = invoiceId !== null
  const [tab, setTab] = React.useState<Tab>('overview')
  // Reset to the overview tab whenever a new invoice is opened.
  const [prevInvoiceId, setPrevInvoiceId] = React.useState<string | null>(invoiceId)
  if (prevInvoiceId !== invoiceId) {
    setPrevInvoiceId(invoiceId)
    if (invoiceId) setTab('overview')
  }

  const qc = useQueryClient()
  const detail = useQuery({
    enabled: open,
    queryKey: ['invoice', merchantId, invoiceId] as const,
    queryFn: () =>
      api<InvoiceDetails>(
        `/api/mg/${encodeURIComponent(merchantId)}/invoices/${encodeURIComponent(invoiceId!)}`,
      ),
    refetchInterval: open ? 10_000 : false,
  })

  const expire = useMutation({
    mutationFn: () =>
      api(
        `/api/mg/${encodeURIComponent(merchantId)}/invoices/${encodeURIComponent(invoiceId!)}/expire`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Invoice force-expired')
      qc.invalidateQueries({ queryKey: ['invoice', merchantId, invoiceId] })
      qc.invalidateQueries({ queryKey: ['invoices', 'list', merchantId] })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not expire'),
  })

  const inv = detail.data?.invoice
  // Terminal statuses: v3 = completed/expired/canceled. Legacy gateways
  // may still emit confirmed/overpaid for the same idea — block both so
  // we don't try to force-expire a paid invoice on either schema.
  const canExpire =
    inv &&
    !['completed', 'expired', 'canceled', 'confirmed', 'overpaid'].includes(
      inv.status,
    )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHero
          icon={FileText}
          title={
            inv ? (
              inv.externalId ?? truncateAddr(inv.id, 8, 6)
            ) : (
              <span className="font-mono">{invoiceId ? truncateAddr(invoiceId, 8, 6) : ''}</span>
            )
          }
          meta={
            <>
              {inv ? (
                <StatusBadge status={inv.status} extraStatus={inv.extraStatus ?? null} />
              ) : (
                <Skeleton className="h-6 w-20 rounded-full" />
              )}
              {inv && <ChainPill chainId={inv.chainId} className="text-sm" />}
              {inv && (
                <span className="text-[var(--fg-3)]">
                  · {fmtRel(unixOf(inv.createdAt))}
                </span>
              )}
            </>
          }
          actions={invoiceId ? <CopyButton value={invoiceId} /> : undefined}
        >
          {detail.data && <InvoiceHero data={detail.data} />}
        </SheetHero>

        <SheetTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'overview', label: 'Overview', icon: ListBullets },
            { value: 'payment', label: 'Pay to', icon: QrCodeIcon },
            {
              value: 'transactions',
              label: 'Transactions',
              icon: ArrowsLeftRight,
              count: detail.data?.transactions.length,
            },
          ]}
        />

        <SheetBody key={tab} className="fade-in">
          {detail.isLoading ? (
            <DetailSkeleton />
          ) : !detail.data ? (
            <ErrorState
              title="Invoice not found"
              message={detail.error instanceof Error ? detail.error.message : undefined}
            />
          ) : tab === 'overview' ? (
            <OverviewTab data={detail.data} />
          ) : tab === 'payment' ? (
            <AddressesTab data={detail.data} />
          ) : (
            <TransactionsTab data={detail.data} />
          )}
        </SheetBody>

        {detail.data && canExpire && (
          <SheetFooter className="justify-between">
            <div className="min-w-0 text-xs text-[var(--fg-2)]">
              <span className="font-medium text-foreground">Force expire</span> · Moves the
              invoice to expired immediately. Partial deposits become orphans.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
              onClick={() => expire.mutate()}
              disabled={expire.isPending}
            >
              <X className="size-4" />
              {expire.isPending ? 'Expiring…' : 'Expire'}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* Big amount + lifecycle stepper under the sheet title. */
function InvoiceHero({ data }: { data: InvoiceDetails }) {
  const { invoice, amounts, transactions } = data
  const norm = normalizeInvoiceStatus(invoice.status)
  const required = invoice.amountUsd
    ? fmtUsd(invoice.amountUsd)
    : `${invoice.requiredAmountRaw} ${invoice.token}`
  const confirmed = parseFloat(amounts.confirmedUsd ?? '0') || 0
  const confirming = parseFloat(amounts.confirmingUsd ?? '0') || 0
  const terminalBad = norm.status === 'expired' || norm.status === 'canceled'
  const completed = norm.status === 'completed'
  const requiredUsd = parseFloat(amounts.requiredUsd ?? '0') || 0
  const received = confirmed + confirming
  const paidAll = completed || (requiredUsd > 0 && received >= requiredUsd)
  const anyPaid = received > 0 || transactions.length > 0
  const steps: Array<{ key: string; label: string; done: boolean; live?: boolean; bad?: boolean }> = [
    { key: 'created', label: 'Created', done: true },
    { key: 'paid', label: paidAll ? 'Paid' : anyPaid ? 'Part paid' : 'Paid', done: paidAll, live: !paidAll && anyPaid },
    { key: 'confirming', label: 'Confirming', done: completed, live: !completed && (confirming > 0 || paidAll) },
    terminalBad
      ? { key: 'end', label: norm.status === 'expired' ? 'Expired' : 'Canceled', done: true, bad: true }
      : { key: 'end', label: 'Completed', done: completed },
  ]
  return (
    <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-[var(--fg-2)]">Amount due</div>
          <div className="mt-0.5 flex items-center gap-2.5">
            <TokenOnChain symbol={invoice.token} chainId={invoice.chainId} size={30} />
            <span className="figure text-2xl font-semibold">{required}</span>
          </div>
        </div>
        {amounts.requiredUsd != null && (
          <div className="text-right text-xs text-[var(--fg-2)]">
            <div>Received</div>
            <div className="figure text-base font-semibold text-foreground">
              {fmtUsd(String(confirmed + confirming))}
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
                s.done || s.live ? 'font-medium text-foreground' : 'text-[var(--fg-3)]',
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

function OverviewTab({ data }: { data: InvoiceDetails }) {
  const { invoice, amounts } = data
  const families = invoice.acceptedFamilies ?? []
  const showTolerance =
    invoice.paymentToleranceUnderBps > 0 || invoice.paymentToleranceOverBps > 0
  return (
    <div className="space-y-6">
      {amounts.requiredUsd != null && (
        <PaymentProgress amounts={amounts} overpaidUsd={invoice.overpaidUsd} />
      )}

      <SheetSection title="Details">
        <dl className="divide-y divide-border rounded-xl border border-border">
          <Fact icon={Coins} label="Token">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <TokenIcon symbol={invoice.token} size={16} />
              {invoice.token}
            </span>
            {families.length > 1 && (
              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                {families.map((f) => (
                  <Badge key={f} variant="default" className="uppercase">
                    {f}
                  </Badge>
                ))}
              </span>
            )}
          </Fact>
          {families.length === 1 && (
            <Fact icon={Layers} label="Family">
              <span className="uppercase">{families[0]}</span>
            </Fact>
          )}
          <Fact icon={Tag} label="External ID">
            {invoice.externalId ? (
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                {invoice.externalId}
                <CopyButton value={invoice.externalId} />
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </Fact>
          <Fact icon={Calendar} label="Created">
            {fmtLocal(invoice.createdAt)}
          </Fact>
          <Fact icon={Timer} label="Expires">
            <ExpiresCell iso={invoice.expiresAt} />
          </Fact>
          {invoice.confirmedAt && (
            <Fact icon={CheckCircle2} label="Confirmed">
              {fmtLocal(invoice.confirmedAt)}
            </Fact>
          )}
          {showTolerance && (
            <Fact icon={Scale} label="Tolerance">
              <span className="figure">
                −{bpsLabel(invoice.paymentToleranceUnderBps)} / +
                {bpsLabel(invoice.paymentToleranceOverBps)}
              </span>
            </Fact>
          )}
          {invoice.webhookUrl && (
            <Fact icon={Webhook} label="Webhook">
              <span className="flex min-w-0 items-center justify-end gap-1">
                <a
                  href={invoice.webhookUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Per-invoice webhook override"
                  className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs hover:underline"
                >
                  <span className="truncate">{invoice.webhookUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <CopyButton value={invoice.webhookUrl} />
              </span>
            </Fact>
          )}
        </dl>
      </SheetSection>

      {invoice.rates && Object.keys(invoice.rates).length > 0 && (
        <RatesSnapshot
          rates={invoice.rates}
          windowExpiresAt={invoice.rateWindowExpiresAt}
        />
      )}

      {invoice.metadata && Object.keys(invoice.metadata).length > 0 && (
        <SheetSection title="Metadata" icon={Braces}>
          <pre className="overflow-x-auto rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(invoice.metadata, null, 2)}
          </pre>
        </SheetSection>
      )}
    </div>
  )
}

/** One row of a details list: icon · label on the left, value on the right. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-[var(--fg-2)]">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right">{children}</dd>
    </div>
  )
}

function bpsLabel(bps: number): string {
  if (bps === 0) return '0%'
  const pct = bps / 100
  return pct < 1 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`
}

function RatesSnapshot({
  rates,
  windowExpiresAt,
}: {
  rates: Record<string, string>
  windowExpiresAt?: string | null
}) {
  const [open, setOpen] = React.useState(false)
  const now = useNow()
  const expiresMs = windowExpiresAt ? Date.parse(windowExpiresAt) : NaN
  const expired = isFinite(expiresMs) && expiresMs <= now
  const sortedEntries = React.useMemo(
    () => Object.entries(rates).sort(([a], [b]) => a.localeCompare(b)),
    [rates],
  )
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Dollar className="size-4 text-[var(--fg-2)]" />
          Pinned rates
          <span className="figure rounded-full bg-[var(--bg-active)] px-1.5 text-2xs font-medium text-[var(--fg-1)]">
            {sortedEntries.length}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {windowExpiresAt && (
            <StatusPill
              tone={expired ? 'warn' : 'wait'}
              size="sm"
              icon={Timer}
            >
              <span title={fmtLocal(windowExpiresAt, { seconds: true })}>
                {expired ? 'Expired' : 'Until'} {fmtLocal(windowExpiresAt)}
              </span>
            </StatusPill>
          )}
          <ChevronDown
            className={cn('size-4 shrink-0 text-[var(--fg-3)] transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>
      {open && (
        <ul className="fade-in grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
          {sortedEntries.map(([sym, rate]) => (
            <li key={sym} className="flex items-baseline justify-between gap-3 bg-card px-4 py-2.5">
              <span className="text-xs font-medium text-[var(--fg-2)]">{sym}</span>
              <span className="figure text-sm font-medium">${rate}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExpiresCell({ iso }: { iso: string }) {
  const target = React.useMemo(() => new Date(iso).getTime(), [iso])
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = target - now
  if (!isFinite(target)) {
    return <span>—</span>
  }
  if (diff <= 0) {
    return (
      <span className="text-destructive" title={fmtLocal(iso, { seconds: true })}>
        Expired {fmtLocal(iso)}
      </span>
    )
  }
  return (
    <span title={fmtLocal(iso, { seconds: true })}>
      <span className="figure font-medium">in {fmtCountdown(diff)}</span>
    </span>
  )
}

function AddressesTab({ data }: { data: InvoiceDetails }) {
  const { invoice } = data
  const list:
    | Array<{ family: Family; address: string; poolAddressId?: string }> =
    invoice.receiveAddresses?.length
      ? invoice.receiveAddresses
      : [{ family: 'evm' as Family, address: invoice.receiveAddress }]

  return (
    <div
      className={
        list.length > 1
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
          : 'grid grid-cols-1 gap-4'
      }
    >
      {list.map((r) => (
        <div
          key={r.family + r.address}
          className="flex flex-col items-center gap-3 rounded-2xl border border-border p-4"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <Badge variant="default" className="uppercase">
              {r.family}
            </Badge>
            <Addr value={r.address} chainId={r.family === chainInfo(data.invoice.chainId).family ? data.invoice.chainId : undefined} className="[&>span:first-child]:hidden" />
          </div>
          <div className="rounded-xl bg-white p-2 ring-1 ring-border">
            <QrCode value={r.address} size={168} />
          </div>
          <div className="w-full break-all text-center font-mono text-xs text-[var(--fg-1)]">
            {r.address}
          </div>
          {r.poolAddressId && (
            <div className="flex w-full items-center justify-between gap-2 border-t border-border pt-2.5 text-xs text-[var(--fg-2)]">
              <span>Pool row</span>
              <span className="inline-flex items-center gap-1 font-mono">
                {truncateAddr(r.poolAddressId, 6, 4)}
                <CopyButton value={r.poolAddressId} />
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function TransactionsTab({ data }: { data: InvoiceDetails }) {
  if (data.transactions.length === 0) {
    return (
      <SharedEmptyState
        compact
        framed
        icon={ArrowsLeftRight}
        title="No transactions yet"
        description="Deposits to the payment address appear here as soon as they're seen."
      />
    )
  }
  // Multi-family invoices accept any registered token; "wrong token" only
  // applies to single-token (legacy) invoices, where USD aggregation isn't
  // in play.
  const isMultiFamily = (data.invoice.acceptedFamilies?.length ?? 0) > 0 ||
    data.invoice.amountUsd != null
  const invoiceToken = data.invoice.token
  return (
    <ul className="space-y-2.5">
      {data.transactions.map((t) => {
        const uncounted =
          !isMultiFamily &&
          t.amountUsd == null &&
          t.token.toUpperCase() !== invoiceToken.toUpperCase()
        const info = chainInfo(t.chainId)
        return (
          <li
            key={t.id}
            className={cn('rounded-xl border border-border p-3.5', uncounted && 'opacity-55')}
            title={
              uncounted
                ? `Wrong token — this transfer of ${t.token} doesn't count toward a ${invoiceToken} invoice. Logged for audit only.`
                : t.blockNumber != null
                  ? `block ${t.blockNumber}`
                  : undefined
            }
          >
            <div className="flex items-center gap-3">
              <TokenOnChain symbol={t.token} chainId={t.chainId} size={34} />
              <div className="min-w-0 flex-1">
                <div className="figure flex items-center gap-2 font-semibold">
                  {fmtNum(t.amount)} {t.token}
                  {uncounted && (
                    <Badge variant="default" className="font-normal">
                      Uncounted
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-[var(--fg-2)]">
                  {info.name} · {t.amountUsd ? fmtUsd(t.amountUsd) : 'no USD'} ·{' '}
                  {fmtRel(unixOf(t.detectedAt))}
                </div>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs sm:grid-cols-[auto_1fr_auto]">
              <span className="text-[var(--fg-2)]">Tx</span>
              <Addr value={t.txHash} chainId={t.chainId} kind="tx" />
              <span className="figure text-[var(--fg-2)] sm:row-span-2 sm:self-center">
                <span className="font-semibold text-foreground">{t.confirmations}</span> conf
              </span>
              <span className="text-[var(--fg-2)]">From</span>
              <Addr value={t.fromAddress} chainId={t.chainId} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function PaymentProgress({
  amounts,
  overpaidUsd,
}: {
  amounts: InvoiceDetails['amounts']
  overpaidUsd: string | null
}) {
  const required = parseFloat(amounts.requiredUsd ?? '0') || 0
  const confirmed = parseFloat(amounts.confirmedUsd ?? '0') || 0
  const confirming = parseFloat(amounts.confirmingUsd ?? '0') || 0
  const remaining = Math.max(0, parseFloat(amounts.remainingUsd ?? '0') || 0)
  const overpaid = parseFloat(overpaidUsd ?? '0') || 0

  const denom = Math.max(required, confirmed + confirming) || 1
  const pct = (v: number) => Math.min(100, Math.max(0, (v / denom) * 100))
  const confirmedPct = pct(confirmed)
  const confirmingPct = pct(confirming)
  const paidPct = Math.round(Math.min(100, ((confirmed + confirming) / (required || 1)) * 100))

  const items: Array<{ key: string; label: string; value: string; swatch: string; muted?: boolean }> = [
    {
      key: 'confirmed',
      label: overpaid > 0 ? 'Confirmed · over' : 'Confirmed',
      value: fmtUsd(amounts.confirmedUsd ?? '0'),
      swatch: overpaid > 0 ? 'bg-[var(--st-warn-dot)]' : 'bg-[var(--st-ok-dot)]',
    },
    {
      key: 'confirming',
      label: 'Confirming',
      value: fmtUsd(amounts.confirmingUsd ?? '0'),
      swatch: 'bg-[var(--st-run-dot)]',
    },
    {
      key: 'remaining',
      label: 'Remaining',
      value: fmtUsd(amounts.remainingUsd ?? '0'),
      swatch: 'bg-[var(--chart-muted)]',
      muted: remaining === 0,
    },
  ]

  return (
    <SheetSection
      title="Payment"
      icon={Dollar}
      action={
        <span className="figure text-sm font-semibold">
          {paidPct}%
        </span>
      }
    >
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--chart-muted)]">
        {confirmedPct > 0 && (
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full',
              overpaid > 0 ? 'bg-[var(--st-warn-dot)]' : 'bg-[var(--st-ok-dot)]',
            )}
            style={{ width: `${confirmedPct}%` }}
          />
        )}
        {confirmingPct > 0 && (
          <div
            className="absolute inset-y-0 animate-pulse bg-[var(--st-run-dot)]"
            style={{ left: `${confirmedPct}%`, width: `${confirmingPct}%` }}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((m) => (
          <div key={m.key} className="rounded-xl bg-[var(--bg-2)] px-3 py-2.5">
            <div className={cn('flex items-center gap-1.5 text-xs', m.muted ? 'text-[var(--fg-3)]' : 'text-[var(--fg-2)]')}>
              <span className={cn('size-2 shrink-0 rounded-full', m.swatch)} />
              {m.label}
            </div>
            <div className="figure mt-0.5 font-semibold">{m.value}</div>
          </div>
        ))}
      </div>
    </SheetSection>
  )
}

/* ── skeletons / empty / error ──────────────────────────── */

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_120px_180px_110px_90px] items-center gap-4 border-b border-border px-4 py-3.5 last:border-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-3 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-10" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="fade-in space-y-5">
      <PageHeader eyebrow="Payments" title={title} />
      <ListSkeleton />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <SharedEmptyState
      framed
      icon={FileText}
      title="No invoices yet"
      description="Create the first invoice for this store to start collecting payments."
      action={
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-3.5" /> Create invoice
        </Button>
      }
    />
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <SharedEmptyState
      framed
      compact
      title="No invoices match these filters"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-3.5" /> Clear filters
        </Button>
      }
    />
  )
}

function ErrorCard({ message }: { message: string }) {
  return <ErrorState title="Could not load invoices" message={message} />
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
      description="The gateway sees this store, but no sealed API key is held here. Rotate or import the key from Stores to list invoices."
      action={
        <Button size="sm" asChild>
          <Link to="/stores">
            <KeyRound className="size-3.5" /> Set up API key
          </Link>
        </Button>
      }
    />
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-5">
      <PageHeader eyebrow="Payments" title="Invoices" />
      <SharedEmptyState
        framed
        icon={FileText}
        title="Add a store first"
        description="Invoices are issued against a store's API key. Create or import one in Stores."
        action={
          <Button size="sm" asChild>
            <Link to="/stores">
              Go to Stores <ChevronDown className="size-3.5 -rotate-90" />
            </Link>
          </Button>
        }
      />
    </div>
  )
}

/* ── create invoice ──────────────────────────────────────── */

type PricingMode = 'usd' | 'raw' | 'fiat'

function CreateInvoiceDialog({
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
  const [mode, setMode] = React.useState<PricingMode>('usd')
  const [chainId, setChainId] = React.useState('1')
  const [token, setToken] = React.useState('USDC')
  const [amountUsd, setAmountUsd] = React.useState('10.00')
  const [amountRaw, setAmountRaw] = React.useState('')
  const [fiatAmount, setFiatAmount] = React.useState('')
  const [fiatCurrency, setFiatCurrency] = React.useState('USD')
  const [externalId, setExternalId] = React.useState('')
  const [metadataJson, setMetadataJson] = React.useState('')
  const [expiresInMinutes, setExpiresInMinutes] = React.useState('30')
  const [acceptedFamilies, setAcceptedFamilies] = React.useState<Family[]>([
    'evm',
  ])
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [tolUnder, setTolUnder] = React.useState('')
  const [tolOver, setTolOver] = React.useState('')
  const [created, setCreated] = React.useState<GatewayInvoice | null>(null)

  // Clear the success view on close without an effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) setCreated(null)
  }

  const webhookMismatch =
    (webhookUrl.trim() !== '' && webhookSecret.trim() === '') ||
    (webhookUrl.trim() === '' && webhookSecret.trim() !== '')
  const tolUnderValid =
    tolUnder === '' ||
    (/^\d+$/.test(tolUnder) && parseInt(tolUnder, 10) <= 2000)
  const tolOverValid =
    tolOver === '' || (/^\d+$/.test(tolOver) && parseInt(tolOver, 10) <= 2000)

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        chainId: parseInt(chainId, 10),
        token: token.toUpperCase(),
        expiresInMinutes: parseInt(expiresInMinutes, 10),
      }
      if (externalId) body.externalId = externalId
      if (metadataJson.trim()) {
        try {
          body.metadata = JSON.parse(metadataJson)
        } catch {
          throw new Error('metadata must be valid JSON')
        }
      }
      if (mode === 'usd') {
        body.amountUsd = amountUsd
        if (acceptedFamilies.length > 0) body.acceptedFamilies = acceptedFamilies
      } else if (mode === 'raw') {
        body.amountRaw = amountRaw
      } else {
        body.fiatAmount = fiatAmount
        body.fiatCurrency = fiatCurrency
      }
      if (webhookUrl.trim()) {
        body.webhookUrl = webhookUrl.trim()
        body.webhookSecret = webhookSecret.trim()
      }
      if (tolUnder !== '')
        body.paymentToleranceUnderBps = parseInt(tolUnder, 10)
      if (tolOver !== '') body.paymentToleranceOverBps = parseInt(tolOver, 10)
      return api<{ invoice: GatewayInvoice }>(
        `/api/mg/${encodeURIComponent(merchantId)}/invoices`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: (res) => {
      toast.success('Invoice created')
      qc.invalidateQueries({ queryKey: ['invoices', 'list', merchantId] })
      setCreated(res.invoice)
    },
    onError: (e: ApiError | Error) =>
      toast.error(e.message || 'Could not create invoice'),
  })

  const canSubmit =
    (mode === 'usd'
      ? /^\d+(\.\d{1,8})?$/.test(amountUsd)
      : mode === 'raw'
        ? /^\d+$/.test(amountRaw)
        : /^\d+(\.\d+)?$/.test(fiatAmount) &&
          /^[A-Z]{3}$/.test(fiatCurrency)) &&
    /^\d+$/.test(chainId) &&
    /^[A-Z0-9]+$/.test(token) &&
    !webhookMismatch &&
    (webhookUrl.trim() === '' ||
      (webhookSecret.trim().length >= 16 && webhookSecret.trim().length <= 512)) &&
    tolUnderValid &&
    tolOverValid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {created ? (
          <InvoiceCreatedView
            invoice={created}
            onGoToInvoice={() => {
              onCreated(created.id)
              onOpenChange(false)
            }}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>
            Posts to the gateway with the selected store's API key. Pick
            exactly one pricing mode.
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
            onChange={({ chainId: c, token: t }) => {
              setChainId(c)
              setToken(t)
            }}
            emptyHint="No wired chains yet — deploy adapters from Chains."
          />

          <Field label="Pricing mode">
            <Select value={mode} onValueChange={(v) => setMode(v as PricingMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usd">USD-pegged (amountUsd)</SelectItem>
                <SelectItem value="raw">Raw token (amountRaw)</SelectItem>
                <SelectItem value="fiat">Fiat-quoted (fiatAmount + fiatCurrency)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {mode === 'usd' && (
            <>
              <Field label="Amount (USD)">
                <Input
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  placeholder="10.00"
                  inputMode="decimal"
                  className="font-mono"
                />
              </Field>
              <Field
                label="Accepted families"
                hint="Each accepted family gets one allocated receive address. UTXO and Monero mint a fresh address per invoice (no pool)."
              >
                <div className="flex flex-wrap gap-2">
                  {(['evm', 'tron', 'solana', 'utxo', 'monero'] as const).map((f) => {
                    const active = acceptedFamilies.includes(f)
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          setAcceptedFamilies((cur) =>
                            active
                              ? cur.filter((x) => x !== f)
                              : [...cur, f],
                          )
                        }
                        className={
                          'cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium uppercase tracking-wider transition-colors ' +
                          (active
                            ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary'
                            : 'border-border text-[var(--fg-2)] hover:bg-[var(--bg-hover)]')
                        }
                      >
                        {f}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </>
          )}

          {mode === 'raw' && (
            <Field label="Amount (raw integer, smallest units)">
              <Input
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="1000000"
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
          )}

          {mode === 'fiat' && (
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Field label="Fiat amount">
                <Input
                  value={fiatAmount}
                  onChange={(e) => setFiatAmount(e.target.value)}
                  placeholder="19.99"
                  className="font-mono"
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={fiatCurrency}
                  onChange={(e) => setFiatCurrency(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  maxLength={3}
                  className="font-mono"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="External ID (optional)"
              hint="Stripe-style idempotency key."
            >
              <Input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="cart-123"
                className="font-mono"
              />
            </Field>
            <Field label="Expires in (minutes)">
              <Input
                value={expiresInMinutes}
                onChange={(e) => setExpiresInMinutes(e.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Metadata (optional)"
            hint="Attach arbitrary key/value pairs the gateway echoes back in webhooks. Toggle Raw JSON for nested values."
          >
            <MetadataEditor
              value={metadataJson}
              onChange={setMetadataJson}
            />
          </Field>

          <details className="rounded-md border border-border bg-[var(--bg-2)] open:pb-3">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--fg-2)]">
              Advanced — per-invoice webhook &amp; tolerance overrides
            </summary>
            <div className="space-y-3 px-3 pt-1">
              <Field
                label="Webhook URL (override)"
                hint="Events for this invoice dispatch here instead of the store default. Requires a secret."
              >
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://merchant.example.com/hooks/invoice"
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
                <div className="-mt-1 text-2xs text-destructive">
                  Webhook URL and secret must be provided together.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Under-pay override (bps)"
                  hint="0–2000. 1 bps = 0.01% (50 = 0.5%). Omit to inherit store default."
                >
                  <Input
                    value={tolUnder}
                    onChange={(e) => setTolUnder(e.target.value)}
                    placeholder="—"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>
                <Field
                  label="Over-pay override (bps)"
                  hint="0–2000. 1 bps = 0.01%."
                >
                  <Input
                    value={tolOver}
                    onChange={(e) => setTolOver(e.target.value)}
                    placeholder="—"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>
              </div>
            </div>
          </details>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function InvoiceCreatedView({
  invoice,
  onGoToInvoice,
  onClose,
}: {
  invoice: GatewayInvoice
  onGoToInvoice: () => void
  onClose: () => void
}) {
  const addresses =
    invoice.receiveAddresses && invoice.receiveAddresses.length > 0
      ? invoice.receiveAddresses
      : [{ family: 'evm' as Family, address: invoice.receiveAddress }]

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invoice created</DialogTitle>
        <DialogDescription>
          Share the receive address{addresses.length > 1 ? 'es' : ''} or have
          the payer scan a QR. The invoice updates live as transactions
          confirm.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs">
          <span className="font-mono text-2xs text-[var(--fg-2)]">
            {truncateAddr(invoice.id, 10, 8)}
          </span>
          <CopyButton value={invoice.id} />
          <span className="flex-1" />
          <span className="text-[var(--fg-2)]">
            {invoice.amountUsd ? (
              <>
                ${invoice.amountUsd}{' '}
                <span className="text-[var(--fg-3)]">· {invoice.token}</span>
              </>
            ) : (
              <span className="font-mono">{invoice.token}</span>
            )}
          </span>
        </div>

        <div
          className={
            addresses.length > 1
              ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
              : 'grid grid-cols-1'
          }
        >
          {addresses.map((a) => (
            <div
              key={a.family + a.address}
              className="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-3"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="rounded-full border border-border bg-[var(--bg-2)] px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-[var(--fg-2)]">
                  {a.family}
                </span>
                <CopyButton value={a.address} />
              </div>
              <QrCode value={a.address} size={152} />
              <div className="w-full overflow-hidden font-mono text-2xs break-all text-[var(--fg-2)]">
                {a.address}
              </div>
            </div>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={onGoToInvoice}>
          Open invoice
        </Button>
      </DialogFooter>
    </>
  )
}

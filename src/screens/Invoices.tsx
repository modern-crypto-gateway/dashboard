import * as React from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronDown,
  FileText,
  KeyRound,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import {
  fmtCountdown,
  fmtLocal,
  fmtNum,
  fmtRel,
  fmtUsd,
  truncateAddr,
} from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import type {
  Family,
  GatewayInvoice,
  InvoiceDetails,
  InvoiceListResponse,
  Merchant,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainTokenPicker } from '@/components/ChainTokenPicker'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { MetadataEditor } from '@/components/MetadataEditor'
import { QrCode } from '@/components/QrCode'
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

/* ── public helpers reused by Payouts ───────────────────── */

export function StatusBadge({ status }: { status: string }) {
  const variant: 'success' | 'accent' | 'warn' | 'danger' | 'default' = (() => {
    switch (status) {
      case 'confirmed':
        return 'success'
      case 'overpaid':
        return 'accent'
      case 'detected':
      case 'partial':
      case 'submitted':
      case 'reserved':
      case 'planned':
        return 'warn'
      case 'expired':
      case 'canceled':
      case 'failed':
      case 'reverted':
        return 'danger'
      default:
        return 'default'
    }
  })()
  return <Badge variant={variant}>{status}</Badge>
}

/* ── page ────────────────────────────────────────────────── */

type InvoiceFilter = 'all' | 'open' | 'paid' | 'failed'

const STATUS_CSV: Record<InvoiceFilter, string | undefined> = {
  all: undefined,
  open: 'created,partial,detected',
  paid: 'confirmed,overpaid',
  failed: 'expired,canceled',
}

const PAGE_SIZE = 50

const invoicesQueryKey = (merchantId: string | null, filter: InvoiceFilter) =>
  ['invoices', 'list', merchantId, filter] as const

export function InvoicesPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<InvoiceFilter>('all')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  const list = useInfiniteQuery({
    enabled: canList,
    queryKey: invoicesQueryKey(active?.id ?? null, filter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      })
      const s = STATUS_CSV[filter]
      if (s) qs.set('status', s)
      return api<InvoiceListResponse>(
        `/api/mg/${encodeURIComponent(active!.id)}/invoices?${qs}`,
      )
    },
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    refetchInterval: 30_000,
  })

  const all = React.useMemo(
    () => list.data?.pages.flatMap((p) => p.invoices) ?? [],
    [list.data],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (inv) =>
        inv.id.toLowerCase().includes(q) ||
        (inv.externalId ?? '').toLowerCase().includes(q) ||
        inv.token.toLowerCase().includes(q),
    )
  }, [all, query])

  if (merchants.isLoading) {
    return <PageSkeleton title="Invoices" />
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchants />
  }

  return (
    <div className="fade-in space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Every invoice the selected merchant has issued, straight from the
            gateway.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MerchantSwitcher />
          <Button size="sm" disabled={!canList} onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New invoice
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
              <InvoiceList rows={filtered} onOpen={setDetailId} />
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

/* ── toolbar / list / row ───────────────────────────────── */

function Toolbar({
  query,
  setQuery,
  filter,
  setFilter,
  loaded,
}: {
  query: string
  setQuery: (v: string) => void
  filter: InvoiceFilter
  setFilter: (v: InvoiceFilter) => void
  loaded: number
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--fg-3)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search loaded by id, external id, token…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as InvoiceFilter)}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
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

function InvoiceList({
  rows,
  onOpen,
}: {
  rows: GatewayInvoice[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[1fr_120px_160px_110px_90px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)] sm:grid">
        <div>Invoice</div>
        <div>Chain</div>
        <div>Amount</div>
        <div>Status</div>
        <div>Updated</div>
      </div>
      <ul>
        {rows.map((inv) => (
          <InvoiceRow key={inv.id} inv={inv} onOpen={() => onOpen(inv.id)} />
        ))}
      </ul>
    </div>
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
        className="grid w-full cursor-pointer grid-cols-1 items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[1fr_120px_160px_110px_90px] sm:gap-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12.5px]">
              {truncateAddr(inv.id, 8, 6)}
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              <CopyButton value={inv.id} />
            </span>
          </div>
          {inv.externalId && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--fg-3)]">
              ext · {inv.externalId}
            </div>
          )}
        </div>

        <ChainPill chainId={inv.chainId} />

        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px]">
            {amountSpecOf(inv)}
          </div>
          <div className="font-mono text-[11px] text-[var(--fg-3)]">
            {inv.token}
          </div>
        </div>

        <div>
          <StatusBadge status={inv.status} />
        </div>

        <div className="text-xs text-[var(--fg-3)]">
          {fmtRel(unixOf(inv.updatedAt))}
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

/* ── detail sheet ────────────────────────────────────────── */

type Tab = 'overview' | 'addresses' | 'transactions'

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
  React.useEffect(() => {
    if (invoiceId) setTab('overview')
  }, [invoiceId])

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
  const canExpire =
    inv && !['expired', 'canceled', 'confirmed', 'overpaid'].includes(inv.status)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <SheetTitle className="truncate font-mono text-base">
              {invoiceId ? truncateAddr(invoiceId, 10, 8) : ''}
            </SheetTitle>
            {invoiceId && <CopyButton value={invoiceId} />}
            {inv && <StatusBadge status={inv.status} />}
          </div>
          <SheetTabs value={tab} onChange={setTab} />
        </SheetHeader>

        <SheetBody>
          {detail.isLoading ? (
            <DetailSkeleton />
          ) : !detail.data ? (
            <div className="py-8 text-center text-sm text-destructive">
              {detail.error instanceof Error ? detail.error.message : 'Not found'}
            </div>
          ) : tab === 'overview' ? (
            <OverviewTab data={detail.data} />
          ) : tab === 'addresses' ? (
            <AddressesTab data={detail.data} />
          ) : (
            <TransactionsTab data={detail.data} />
          )}

          {detail.data && canExpire && (
            <div className="mt-6 border-t border-border pt-5">
              <div className="eyebrow mb-3">Danger zone</div>
              <div className="flex items-center justify-between gap-4 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">Force expire</div>
                  <div className="text-xs text-[var(--fg-2)]">
                    Moves the invoice to expired immediately. Partial deposits
                    become orphans.
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => expire.mutate()}
                  disabled={expire.isPending}
                >
                  <X className="size-3.5" />
                  {expire.isPending ? 'Expiring…' : 'Expire'}
                </Button>
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function SheetTabs({
  value,
  onChange,
}: {
  value: Tab
  onChange: (t: Tab) => void
}) {
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'addresses', label: 'Addresses' },
    { key: 'transactions', label: 'Transactions' },
  ]
  return (
    <div className="-mb-px flex gap-1 border-b-0">
      {tabs.map(({ key, label }) => {
        const active = value === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={
              'cursor-pointer rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors ' +
              (active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-[var(--fg-3)] hover:text-foreground')
            }
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function OverviewTab({ data }: { data: InvoiceDetails }) {
  const { invoice, amounts } = data
  return (
    <div className="space-y-5">
      <KV grid>
        <KVItem label="Chain">
          <ChainPill chainId={invoice.chainId} />
        </KVItem>
        <KVItem label="Token">
          <span className="font-mono">{invoice.token}</span>
        </KVItem>
        <KVItem label="External id">
          <span className="font-mono text-xs">
            {invoice.externalId ?? '—'}
          </span>
        </KVItem>
        <KVItem label="Required">
          <span className="font-mono">
            {invoice.amountUsd
              ? fmtUsd(invoice.amountUsd)
              : invoice.requiredAmountRaw}
          </span>
        </KVItem>
        <KVItem label="Received">
          <span className="font-mono">
            {invoice.paidUsd
              ? fmtUsd(invoice.paidUsd)
              : invoice.receivedAmountRaw}
          </span>
        </KVItem>
        <KVItem label="Created">
          <span className="font-mono text-xs">{fmtLocal(invoice.createdAt)}</span>
        </KVItem>
        <KVItem label="Expires">
          <ExpiresCell iso={invoice.expiresAt} />
        </KVItem>
      </KV>

      {amounts.requiredUsd != null && (
        <PaymentProgress amounts={amounts} overpaidUsd={invoice.overpaidUsd} />
      )}

      {invoice.metadata && Object.keys(invoice.metadata).length > 0 && (
        <div className="space-y-2">
          <div className="eyebrow">Metadata</div>
          <pre className="overflow-x-auto rounded-md border border-border bg-secondary px-3 py-2 text-[11.5px] font-mono">
            {JSON.stringify(invoice.metadata, null, 2)}
          </pre>
        </div>
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
    return <span className="font-mono text-xs">—</span>
  }
  if (diff <= 0) {
    return (
      <span className="font-mono text-xs text-destructive">
        expired · {fmtLocal(iso, { seconds: true })}
      </span>
    )
  }
  return (
    <span className="font-mono text-xs">
      in {fmtCountdown(diff)}
      <span className="ml-1.5 text-[var(--fg-3)]">· {fmtLocal(iso)}</span>
    </span>
  )
}

function AddressesTab({ data }: { data: InvoiceDetails }) {
  const { invoice } = data
  const list =
    invoice.receiveAddresses?.length
      ? invoice.receiveAddresses
      : [{ family: 'evm' as Family, address: invoice.receiveAddress }]

  return (
    <div
      className={
        list.length > 1
          ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
          : 'grid grid-cols-1 gap-3'
      }
    >
      {list.map((r) => (
        <div
          key={r.family + r.address}
          className="flex flex-col items-center gap-2.5 rounded-md border border-border bg-card p-3"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <span className="rounded-full border border-border bg-[var(--bg-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-2)]">
              {r.family}
            </span>
            <CopyButton value={r.address} />
          </div>
          <QrCode value={r.address} size={152} />
          <div className="w-full break-all text-center font-mono text-[11px] text-[var(--fg-2)]">
            {r.address}
          </div>
        </div>
      ))}
    </div>
  )
}

function TransactionsTab({ data }: { data: InvoiceDetails }) {
  if (data.transactions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-[var(--fg-2)]">
        No transactions observed yet.
      </div>
    )
  }
  const invoiceToken = data.invoice.token
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-[var(--bg-2)]">
            <Th>Tx</Th>
            <Th>Status</Th>
            <Th>Token</Th>
            <Th>Amount</Th>
            <Th>USD</Th>
            <Th>Conf</Th>
          </tr>
        </thead>
        <tbody>
          {data.transactions.map((t) => {
            const uncounted =
              t.amountUsd == null && t.token.toUpperCase() !== invoiceToken.toUpperCase()
            return (
              <tr
                key={t.id}
                className={uncounted ? 'opacity-55' : ''}
                title={
                  uncounted
                    ? `Wrong token — this transfer of ${t.token} doesn't count toward a ${invoiceToken} invoice. Logged for audit only.`
                    : undefined
                }
              >
                <Td>
                  <Addr value={t.txHash} />
                </Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
                <Td className="font-mono text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5">
                    {t.token}
                    {uncounted && (
                      <span className="rounded border border-border bg-[var(--bg-2)] px-1 py-0 text-[9.5px] uppercase tracking-wider text-[var(--fg-3)]">
                        uncounted
                      </span>
                    )}
                  </span>
                </Td>
                <Td className="font-mono text-[12.5px]">{fmtNum(t.amount)}</Td>
                <Td className="font-mono text-[12.5px] text-[var(--fg-2)]">
                  {t.amountUsd ? fmtUsd(t.amountUsd) : '—'}
                </Td>
                <Td className="font-mono text-[12.5px]">{t.confirmations}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)]">
      {children}
    </th>
  )
}
function Td({
  children,
  className = '',
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td
      className={'border-b border-border px-3 py-2 last:border-b-0 ' + className}
    >
      {children}
    </td>
  )
}

function KV({
  children,
  grid = false,
}: {
  children: React.ReactNode
  grid?: boolean
}) {
  return (
    <dl
      className={
        grid
          ? 'grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2'
          : 'space-y-4'
      }
    >
      {children}
    </dl>
  )
}

function KVItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
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
  const overpaidPct = pct(Math.max(0, confirmed - required))
  const remainingPct = Math.max(0, 100 - confirmedPct - confirmingPct)

  const milestones: Array<{
    key: string
    label: string
    value: string
    swatch: string
    muted?: boolean
  }> = [
    {
      key: 'required',
      label: 'Required',
      value: fmtUsd(amounts.requiredUsd ?? '0'),
      swatch: 'bg-[var(--fg-3)]',
      muted: true,
    },
    {
      key: 'confirmed',
      label: overpaid > 0 ? 'Confirmed (overpaid)' : 'Confirmed',
      value: fmtUsd(amounts.confirmedUsd ?? '0'),
      swatch: overpaid > 0 ? 'bg-warn' : 'bg-success',
    },
    {
      key: 'confirming',
      label: 'Confirming',
      value: fmtUsd(amounts.confirmingUsd ?? '0'),
      swatch: 'bg-primary/70',
    },
    {
      key: 'remaining',
      label: 'Remaining',
      value: fmtUsd(amounts.remainingUsd ?? '0'),
      swatch: 'bg-[var(--bg-3,var(--bg-2))] border border-border',
      muted: remaining === 0,
    },
  ]

  return (
    <div className="space-y-3 rounded-md border border-border bg-[var(--bg-2)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Payment progress</div>
        <div className="font-mono text-xs text-[var(--fg-3)]">
          {fmtUsd(String(confirmed + confirming))} / {fmtUsd(amounts.requiredUsd ?? '0')}
        </div>
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--border)_60%,transparent)]">
        {confirmedPct > 0 && (
          <div
            className={overpaid > 0 ? 'absolute inset-y-0 left-0 bg-warn' : 'absolute inset-y-0 left-0 bg-success'}
            style={{ width: `${confirmedPct}%` }}
          />
        )}
        {confirmingPct > 0 && (
          <div
            className="absolute inset-y-0 bg-primary/70"
            style={{ left: `${confirmedPct}%`, width: `${confirmingPct}%` }}
          />
        )}
        {overpaid > 0 && overpaidPct > 0 && (
          <div
            className="absolute inset-y-0 bg-warn/40"
            style={{ left: `${confirmedPct - overpaidPct}%`, width: `${overpaidPct}%` }}
          />
        )}
        {remainingPct > 0 && confirmedPct + confirmingPct < 100 && (
          <div
            className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(45deg,transparent_0_4px,color-mix(in_oklch,var(--border)_80%,transparent)_4px_8px)]"
            style={{ width: `${remainingPct}%` }}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        {milestones.map((m) => (
          <div key={m.key} className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${m.swatch}`} />
            <div className="min-w-0 leading-tight">
              <div className={`truncate ${m.muted ? 'text-[var(--fg-3)]' : 'text-[var(--fg-2)]'}`}>
                {m.label}
              </div>
              <div className="font-mono tabular-nums">{m.value}</div>
            </div>
          </div>
        ))}
      </div>
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
          className="grid grid-cols-[1fr_120px_160px_110px_90px] items-center gap-4 border-b border-border px-5 py-3 last:border-0"
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
      <div>
        <div className="eyebrow">Money</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <ListSkeleton />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <FileText className="size-5 text-[var(--fg-2)]" />
      </div>
      <div>
        <div className="text-sm font-medium">No invoices yet</div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          Create your first invoice to start collecting payments.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="size-3.5" /> Create invoice
      </Button>
    </div>
  )
}

function NoMatch() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-[var(--fg-2)]">
      No loaded invoices match your search.
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
          Rotate or import the key from Merchants to list invoices.
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
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h1>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
          <FileText className="size-5 text-[var(--fg-2)]" />
        </div>
        <div className="text-sm font-medium">Add a merchant first</div>
        <p className="text-xs text-[var(--fg-2)]">
          Invoices are issued against a merchant's API key — head to Merchants
          to create or import one.
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

  React.useEffect(() => {
    if (!open) setCreated(null)
  }, [open])

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
            Posts to the gateway with the selected merchant's API key. Pick
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
                hint="Each accepted family gets one allocated receive address."
              >
                <div className="flex gap-2">
                  {(['evm', 'tron', 'solana'] as const).map((f) => {
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
                hint="Events for this invoice dispatch here instead of the merchant default. Requires a secret."
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
                <div className="-mt-1 text-[11.5px] text-destructive">
                  Webhook URL and secret must be provided together.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Under-pay override (bps)"
                  hint="0–2000. 1 bps = 0.01% (50 = 0.5%). Omit to inherit merchant default."
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
          <span className="font-mono text-[11.5px] text-[var(--fg-2)]">
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
                <span className="rounded-full border border-border bg-[var(--bg-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-2)]">
                  {a.family}
                </span>
                <CopyButton value={a.address} />
              </div>
              <QrCode value={a.address} size={152} />
              <div className="w-full overflow-hidden font-mono text-[11px] break-all text-[var(--fg-2)]">
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

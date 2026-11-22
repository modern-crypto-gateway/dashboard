import * as React from 'react'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDownLeft,
  Braces,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  Fingerprint,
  Hash,
  Link2,
  ListBullets,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Store,
  Timer,
  Webhook,
  XCircle,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtLocal, fmtRel, truncateAddr, useNow } from '@/lib/format'
import { useMerchants } from '@/lib/merchants'
import type { WebhookDelivery } from '@/lib/types'

import { SegmentedBar } from '@/components/charts'
import { CopyButton } from '@/components/CopyButton'
import { Pager, RowAvatar, TableCard, TableSearch, usePaged } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState } from '@/components/States'
import { Status, StatusPill, type StatusTone } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25
/**
 * Visual denominator for the attempts meter. The list API doesn't report
 * the gateway's retry budget; dead rows in the dev mock stop at 12. A row
 * that has used more simply fills the meter.
 */
const RETRY_BUDGET = 12

type HeroIcon = React.ComponentType<{
  className?: string
  weight?: 'regular' | 'fill' | 'duotone'
}>

function safeHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function codeTone(code: number): StatusTone {
  if (code >= 200 && code < 300) return 'ok'
  if (code >= 300 && code < 400) return 'warn'
  if (code >= 400) return 'bad'
  return 'wait'
}

/** Relative label for a unix-ms timestamp. */
function relMs(ms: number | null | undefined): string {
  if (!ms) return '—'
  return fmtRel(Math.floor(ms / 1000))
}

function countdown(at: number, nowMs: number): string {
  const delta = at - nowMs
  if (delta < 0) return 'due now'
  if (delta < 60_000) return `in ${Math.ceil(delta / 1000)}s`
  if (delta < 3_600_000) return `in ${Math.ceil(delta / 60_000)}m`
  return `in ${Math.ceil(delta / 3_600_000)}h`
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

/** When the last attempt happened (delivered rows: the success). */
function lastAttemptAt(d: WebhookDelivery): number {
  return d.status === 'delivered' && d.deliveredAt ? d.deliveredAt : d.updatedAt
}

/* ── event types ───────────────────────────────────────── */

/**
 * Map a backend event-type string to a friendly label + tone.
 * Handles both v3 colon-form (`invoice:payment_confirmed`,
 * `invoice:completed`) and legacy dot-form (`invoice.confirmed`,
 * `invoice.transfer_detected`, …) so we don't lose history when older
 * deliveries are replayed.
 */
type EventTone = 'success' | 'warn' | 'danger' | 'accent' | 'default'

type EventInfo = {
  label: string
  scope: 'invoice' | 'payout' | 'other'
  /** Per-tx events (`invoice:payment_*` / `invoice.transfer_detected` /
   * `invoice.payment_received`) get their own icon so operators can tell
   * them apart from whole-invoice events. */
  perTx: boolean
  tone: EventTone
}

function describeEventType(eventType: string): EventInfo {
  // Normalise both `invoice:payment_confirmed` and `invoice.payment_received`
  // into a tail like `payment_confirmed` for matching.
  const [scopePart, ...rest] = eventType.split(/[:.]/)
  const tail = rest.join('.')
  const scope: 'invoice' | 'payout' | 'other' =
    scopePart === 'invoice'
      ? 'invoice'
      : scopePart === 'payout'
        ? 'payout'
        : 'other'

  // v3 invoice events
  if (scope === 'invoice') {
    switch (tail) {
      case 'payment_detected':
      case 'transfer_detected': // legacy
        return { label: 'Payment detected', scope, perTx: true, tone: 'warn' }
      case 'payment_confirmed':
      case 'payment_received': // legacy
        return { label: 'Payment confirmed', scope, perTx: true, tone: 'success' }
      case 'completed':
      case 'confirmed': // legacy
        return { label: 'Invoice completed', scope, perTx: false, tone: 'success' }
      case 'overpaid': // legacy (now folded into completed+extraStatus)
        return { label: 'Invoice overpaid', scope, perTx: false, tone: 'accent' }
      case 'partial': // legacy
        return { label: 'Invoice partial', scope, perTx: false, tone: 'warn' }
      case 'detected': // legacy whole-invoice "first sighting"
        return { label: 'Invoice detected', scope, perTx: false, tone: 'warn' }
      case 'expired':
        return { label: 'Invoice expired', scope, perTx: false, tone: 'danger' }
      case 'canceled':
        return { label: 'Invoice canceled', scope, perTx: false, tone: 'danger' }
      case 'demoted':
        return { label: 'Invoice demoted (reorg)', scope, perTx: false, tone: 'danger' }
    }
  }

  if (scope === 'payout') {
    switch (tail) {
      case 'submitted':
        return { label: 'Payout submitted', scope, perTx: false, tone: 'warn' }
      case 'confirmed':
        return { label: 'Payout confirmed', scope, perTx: false, tone: 'success' }
      case 'failed':
        return { label: 'Payout failed', scope, perTx: false, tone: 'danger' }
    }
  }

  return { label: eventType, scope, perTx: false, tone: 'default' }
}

/** One icon per event family: invoice, per-tx payment, payout, other. */
function eventIcon(ev: EventInfo): HeroIcon {
  if (ev.scope === 'invoice') return ev.perTx ? Coins : FileText
  if (ev.scope === 'payout') return Send
  return Webhook
}

const EVENT_TINT: Record<EventTone, string> = {
  success: 'bg-[var(--st-ok-bg)] text-[var(--st-ok)] ring-0',
  warn: 'bg-[var(--st-warn-bg)] text-[var(--st-warn)] ring-0',
  danger: 'bg-[var(--st-bad-bg)] text-[var(--st-bad)] ring-0',
  accent: 'bg-[var(--st-info-bg)] text-[var(--st-info)] ring-0',
  default: '',
}

const FAMILY_TITLE: Record<EventInfo['scope'], string> = {
  invoice: 'Invoice event',
  payout: 'Payout event',
  other: 'Event',
}

/**
 * Event cell: family icon (tinted by outcome) + friendly label over the raw
 * type and resource id.
 */
function DeliveryEvent({
  eventType,
  resourceId,
}: {
  eventType: string
  resourceId?: string
}) {
  const ev = describeEventType(eventType)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        title={ev.perTx ? 'Per-transaction event' : FAMILY_TITLE[ev.scope]}
        className="shrink-0"
      >
        <RowAvatar icon={eventIcon(ev)} className={EVENT_TINT[ev.tone]} />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{ev.label}</div>
        <div className="truncate font-mono text-xs text-[var(--fg-3)]">
          {eventType}
          {resourceId && ` · ${truncateAddr(resourceId, 6, 4)}`}
        </div>
      </div>
    </div>
  )
}

/* ── page ──────────────────────────────────────────────── */

type DeliveryStatus = 'pending' | 'delivered' | 'dead'

const STATUS_TABS: Array<{
  value: DeliveryStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { value: 'dead', label: 'Dead', icon: AlertTriangle },
  { value: 'pending', label: 'Pending', icon: Clock },
  { value: 'delivered', label: 'Delivered', icon: CheckCircle2 },
]

type DeliveriesResponse = { deliveries: WebhookDelivery[] }

function deliveriesQuery(status: DeliveryStatus) {
  return {
    queryKey: ['webhook-deliveries', status] as const,
    queryFn: () =>
      api<DeliveriesResponse>(
        `/api/gw/admin/webhook-deliveries?status=${status}&limit=100`,
      ),
    refetchInterval: 60_000,
  }
}

/** POST …/replay, shared by the row menu and the sheet footer. */
function useReplay(onDone: () => void) {
  return useMutation({
    mutationFn: (id: string) =>
      api(
        `/api/gw/admin/webhook-deliveries/${encodeURIComponent(id)}/replay`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Queued for retry')
      onDone()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not replay'),
  })
}

export function WebhooksPage() {
  const [status, setStatus] = React.useState<DeliveryStatus>('dead')
  const [query, setQuery] = React.useState('')
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const qc = useQueryClient()
  const now = useNow()
  const merchants = useMerchants()

  // The same per-status request the tabs always made; all three are kept
  // warm so the summary and tab counts are real.
  const results = useQueries({
    queries: STATUS_TABS.map((t) => deliveriesQuery(t.value)),
  })
  const byStatus = {} as Record<DeliveryStatus, (typeof results)[number]>
  STATUS_TABS.forEach((t, i) => {
    byStatus[t.value] = results[i]
  })
  const list = byStatus[status]

  const nameOf = React.useCallback(
    (id: string) => merchants.data?.merchants.find((m) => m.id === id)?.name ?? null,
    [merchants.data],
  )

  const all = React.useMemo(() => list.data?.deliveries ?? [], [list.data])
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (d) =>
        d.id.toLowerCase().includes(q) ||
        d.merchantId.toLowerCase().includes(q) ||
        (nameOf(d.merchantId)?.toLowerCase().includes(q) ?? false) ||
        d.eventType.toLowerCase().includes(q) ||
        (d.resourceId?.toLowerCase().includes(q) ?? false) ||
        (d.targetUrl?.toLowerCase().includes(q) ?? false),
    )
  }, [all, query, nameOf])
  const paged = usePaged(filtered, PAGE_SIZE)

  const detail = all.find((d) => d.id === detailId) ?? null

  const counts: Partial<Record<DeliveryStatus, number>> = {}
  for (const t of STATUS_TABS) {
    const d = byStatus[t.value].data
    if (d) counts[t.value] = d.deliveries.length
  }
  const summaryLoading = results.some((r) => r.isLoading)
  const anyFetching = results.some((r) => r.isFetching)

  const invalidateCurrent = () =>
    qc.invalidateQueries({ queryKey: ['webhook-deliveries', status] })
  const rowReplay = useReplay(invalidateCurrent)

  const pick = (s: DeliveryStatus) => {
    setStatus(s)
    paged.setPage(0)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Webhook deliveries"
        description="Outbox delivery log"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => results.forEach((r) => r.refetch())}
            disabled={anyFetching}
          >
            <RefreshCw className={cn('size-4', anyFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <SummaryStrip
        counts={counts}
        loading={summaryLoading}
        active={status}
        onPick={pick}
      />

      <TableCard
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <CountSegmented
              value={status}
              onChange={pick}
              options={STATUS_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
            />
            <TableSearch
              value={query}
              onChange={(v) => {
                setQuery(v)
                paged.setPage(0)
              }}
              placeholder="Search event, store, id…"
              className="w-full sm:ml-auto sm:w-64"
            />
          </div>
        }
        footer={
          paged.total > 0 ? (
            <Pager
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              hasNext={paged.page < paged.pageCount - 1}
              onPage={paged.setPage}
              noun="deliveries"
            />
          ) : undefined
        }
      >
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.isError ? (
          <div className="p-6">
            <ErrorState
              title="Could not load deliveries"
              message={
                list.error instanceof Error
                  ? list.error.message
                  : 'Could not load deliveries'
              }
            />
          </div>
        ) : all.length === 0 ? (
          <EmptyState icon={Webhook} title={EMPTY_COPY[status]} />
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title="No matches"
            action={
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <DeliveryTable
            rows={paged.rows}
            now={now}
            nameOf={nameOf}
            onOpen={setDetailId}
            onReplay={(id) => rowReplay.mutate(id)}
            replayingId={rowReplay.isPending ? (rowReplay.variables ?? null) : null}
          />
        )}
      </TableCard>

      <DeliveryDetailSheet
        delivery={detail}
        storeName={detail ? nameOf(detail.merchantId) : null}
        onOpenChange={(v) => !v && setDetailId(null)}
        onReplayed={invalidateCurrent}
      />
    </div>
  )
}

const EMPTY_COPY: Record<DeliveryStatus, string> = {
  dead: 'No dead deliveries',
  pending: 'Nothing queued for retry',
  delivered: 'No recent deliveries',
}

/* ── summary ───────────────────────────────────────────── */

const SUMMARY: Array<{
  value: DeliveryStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  tint: string
  color: string
}> = [
  {
    value: 'pending',
    label: 'Pending',
    icon: Clock,
    tint: 'bg-[var(--st-warn-bg)] text-[var(--st-warn)]',
    color: 'var(--st-warn-dot)',
  },
  {
    value: 'delivered',
    label: 'Delivered',
    icon: CheckCircle2,
    tint: 'bg-[var(--st-ok-bg)] text-[var(--st-ok)]',
    color: 'var(--st-ok-dot)',
  },
  {
    value: 'dead',
    label: 'Dead',
    icon: XCircle,
    tint: 'bg-[var(--st-bad-bg)] text-[var(--st-bad)]',
    color: 'var(--st-bad-dot)',
  },
]

function SummaryStrip({
  counts,
  loading,
  active,
  onPick,
}: {
  counts: Partial<Record<DeliveryStatus, number>>
  loading: boolean
  active: DeliveryStatus
  onPick: (s: DeliveryStatus) => void
}) {
  const delivered = counts.delivered ?? 0
  const dead = counts.dead ?? 0
  const rate = delivered + dead > 0 ? (delivered / (delivered + dead)) * 100 : null
  return (
    <div className="stagger grid grid-cols-2 gap-5 xl:grid-cols-4">
      {SUMMARY.map((s) => {
        const Icon = s.icon
        const on = active === s.value
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onPick(s.value)}
            aria-pressed={on}
            className={cn(
              'flex cursor-pointer flex-col rounded-lg border bg-card p-5 text-left shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              on ? 'border-[var(--fg-3)]' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--fg-2)]">{s.label}</span>
              <span className={cn('grid size-7 place-items-center rounded-full', s.tint)}>
                <Icon className="size-4" />
              </span>
            </div>
            <div className="figure mt-2 text-xl font-semibold">
              {loading && counts[s.value] == null ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                (counts[s.value] ?? '—')
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--fg-2)]">Latest 100</div>
          </button>
        )
      })}
      <Card className="col-span-2 flex flex-col p-5 xl:col-span-1">
        <div className="text-sm text-[var(--fg-2)]" title="Delivered ÷ (delivered + dead), over loaded rows">
          Success rate
        </div>
        <div className="figure mt-2 text-xl font-semibold">
          {loading && rate == null ? (
            <Skeleton className="h-7 w-16" />
          ) : rate == null ? (
            '—'
          ) : (
            `${rate.toFixed(rate >= 99.95 || rate === 0 ? 0 : 1)}%`
          )}
        </div>
        <div className="mt-auto pt-4">
          <SegmentedBar
            parts={SUMMARY.map((s) => ({
              key: s.value,
              name: s.label,
              value: counts[s.value] ?? 0,
              color: s.color,
            }))}
          />
        </div>
      </Card>
    </div>
  )
}

/* ── segmented status control with counts ──────────────── */

function CountSegmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{
    value: T
    label: string
    icon: React.ComponentType<{ className?: string }>
    count?: number
  }>
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Delivery status"
      className="inline-flex h-8 max-w-full items-center overflow-x-auto rounded-[10px] bg-[var(--bg-active)] p-0.5 [scrollbar-width:none]"
    >
      {options.map((o) => {
        const on = value === o.value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              on && 'bg-[var(--bg-1)] text-foreground shadow-[var(--shadow-sm)]',
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
            {o.count != null && (
              <span className="figure text-[var(--fg-3)]">{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── table ─────────────────────────────────────────────── */

function DeliveryTable({
  rows,
  now,
  nameOf,
  onOpen,
  onReplay,
  replayingId,
}: {
  rows: WebhookDelivery[]
  now: number
  nameOf: (id: string) => string | null
  onOpen: (id: string) => void
  onReplay: (id: string) => void
  replayingId: string | null
}) {
  return (
    <TableWrap>
      <Table className="min-w-[900px]">
        <THead>
          <tr>
            <Th>Event</Th>
            <Th>Store</Th>
            <Th>Endpoint</Th>
            <Th>Status</Th>
            <Th>Attempts</Th>
            <Th align="right">Last try</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((d) => {
            const host = safeHost(d.targetUrl)
            const name = nameOf(d.merchantId)
            const at = lastAttemptAt(d)
            return (
              <Tr
                key={d.id}
                interactive
                tabIndex={0}
                onClick={() => onOpen(d.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(d.id)
                  }
                }}
                className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
              >
                <Td className="max-w-[280px]">
                  <DeliveryEvent eventType={d.eventType} resourceId={d.resourceId} />
                </Td>
                <Td className="max-w-[180px]">
                  {name ? (
                    <span className="block truncate text-sm" title={d.merchantId}>
                      {name}
                    </span>
                  ) : (
                    <span className="block truncate font-mono text-xs" title={d.merchantId}>
                      {truncateAddr(d.merchantId, 8, 4)}
                    </span>
                  )}
                </Td>
                <Td className="max-w-[200px]">
                  {host ? (
                    <span
                      className="block truncate font-mono text-xs text-[var(--fg-1)]"
                      title={d.targetUrl}
                    >
                      {host}
                    </span>
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </Td>
                <Td>
                  <Status value={d.status} />
                </Td>
                <Td>
                  <AttemptsMeter d={d} />
                </Td>
                <Td
                  align="right"
                  className="text-sm whitespace-nowrap"
                  title={fmtLocal(at, { seconds: true })}
                >
                  <div className="text-[var(--fg-1)]">{relMs(at)}</div>
                  {d.status === 'pending' && d.nextAttemptAt && (
                    <div className="text-xs text-[var(--fg-3)]">
                      next {countdown(d.nextAttemptAt, now)}
                    </div>
                  )}
                </Td>
                <Td
                  align="right"
                  className="w-12"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <RowMenu
                    d={d}
                    onOpen={() => onOpen(d.id)}
                    onReplay={() => onReplay(d.id)}
                    replaying={replayingId === d.id}
                  />
                </Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </TableWrap>
  )
}

/** "3/12" plus a thin bar; colour follows the outcome. */
function AttemptsMeter({ d }: { d: WebhookDelivery }) {
  const budget = Math.max(RETRY_BUDGET, d.attempts)
  const pct = Math.min(100, (d.attempts / budget) * 100)
  const color =
    d.status === 'dead'
      ? 'bg-[var(--st-bad-dot)]'
      : d.status === 'delivered'
        ? 'bg-[var(--st-ok-dot)]'
        : 'bg-[var(--st-warn-dot)]'
  return (
    <div className="flex items-center gap-2" title={`${d.attempts} attempt${d.attempts === 1 ? '' : 's'}`}>
      <span className="figure w-10 text-sm">
        {d.attempts}
        <span className="text-[var(--fg-3)]">/{budget}</span>
      </span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--chart-muted)]">
        <span className={cn('block h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

function RowMenu({
  d,
  onOpen,
  onReplay,
  replaying,
}: {
  d: WebhookDelivery
  onOpen: () => void
  onReplay: () => void
  replaying: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Delivery actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onOpen}>
          <Eye /> View details
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard
              .writeText(d.id)
              .then(() => toast.success('Delivery id copied'))
              .catch(() => undefined)
          }}
        >
          <Copy /> Copy id
        </DropdownMenuItem>
        {d.status === 'dead' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReplay} disabled={replaying}>
              <RotateCcw /> {replaying ? 'Replaying…' : 'Replay'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CodePill({ d }: { d: WebhookDelivery }) {
  if (d.lastStatusCode != null) {
    return (
      <StatusPill tone={codeTone(d.lastStatusCode)} size="sm">
        HTTP {d.lastStatusCode}
      </StatusPill>
    )
  }
  if (d.lastError) {
    return (
      <StatusPill tone="bad" size="sm">
        No response
      </StatusPill>
    )
  }
  return null
}

/* ── detail sheet ──────────────────────────────────────── */

type SheetTab = 'overview' | 'payload' | 'response'

function DeliveryDetailSheet({
  delivery,
  storeName,
  onOpenChange,
  onReplayed,
}: {
  delivery: WebhookDelivery | null
  storeName: string | null
  onOpenChange: (o: boolean) => void
  onReplayed: () => void
}) {
  const open = delivery !== null
  const now = useNow(open ? 1000 : 30_000)
  const [tab, setTab] = React.useState<SheetTab>('overview')
  // Keep the last delivery so the sheet doesn't blank while it slides out.
  const [shown, setShown] = React.useState<WebhookDelivery | null>(delivery)
  const [shownName, setShownName] = React.useState<string | null>(storeName)
  if (delivery && delivery !== shown) {
    if (delivery.id !== shown?.id) setTab('overview')
    setShown(delivery)
  }
  if (delivery && storeName !== shownName) setShownName(storeName)

  const replay = useReplay(() => {
    onReplayed()
    onOpenChange(false)
  })

  const d = shown
  const ev = d ? describeEventType(d.eventType) : null
  const hasResponse = !!d && (d.lastStatusCode != null || !!d.lastError)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {d && ev && (
          <>
            <SheetHero
              icon={eventIcon(ev)}
              iconClassName={EVENT_TINT[ev.tone]}
              title={ev.label}
              meta={
                <>
                  <Status value={d.status} />
                  <span className="inline-flex min-w-0 items-center gap-1.5" title={d.merchantId}>
                    <Store className="size-4 shrink-0" />
                    <span className={cn('truncate', !shownName && 'font-mono text-xs')}>
                      {shownName ?? truncateAddr(d.merchantId, 8, 4)}
                    </span>
                  </span>
                  <span
                    className="text-[var(--fg-3)]"
                    title={fmtLocal(d.createdAt, { seconds: true })}
                  >
                    · {relMs(d.createdAt)}
                  </span>
                </>
              }
              actions={<CopyButton value={d.id} title="Copy delivery id" />}
            >
              <AttemptsTimeline d={d} now={now} />
            </SheetHero>

            <SheetTabs<SheetTab>
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'overview', label: 'Overview', icon: ListBullets },
                { value: 'payload', label: 'Payload', icon: Braces },
                { value: 'response', label: 'Response', icon: ArrowDownLeft },
              ]}
            />

            <SheetBody key={tab} className="fade-in">
              {tab === 'overview' ? (
                <OverviewTab d={d} now={now} storeName={shownName} />
              ) : tab === 'payload' ? (
                d.payload ? (
                  <CodeBlock
                    icon={Braces}
                    title={d.payload.event}
                    text={JSON.stringify(d.payload, null, 2)}
                    json
                  />
                ) : (
                  <EmptyState compact framed icon={Braces} title="No payload stored" />
                )
              ) : hasResponse ? (
                <ResponseTab d={d} />
              ) : (
                <EmptyState compact framed icon={ArrowDownLeft} title="No response yet" />
              )}
            </SheetBody>

            {d.status === 'dead' && (
              <SheetFooter className="justify-between">
                <div className="min-w-0 text-xs text-[var(--fg-2)]">
                  <span className="font-medium text-foreground">Replay delivery</span> ·
                  Resets attempts and re-queues this delivery.
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => replay.mutate(delivery!.id)}
                  disabled={replay.isPending}
                >
                  <RotateCcw className={cn('size-4', replay.isPending && 'animate-spin')} />
                  {replay.isPending ? 'Replaying…' : 'Replay'}
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Attempts as a vertical stepper. The API keeps only the first enqueue
 * time and the last attempt's outcome, so middle retries collapse into
 * one step rather than inventing per-try details.
 */
function AttemptsTimeline({ d, now }: { d: WebhookDelivery; now: number }) {
  type Step = {
    key: string
    title: React.ReactNode
    at?: number | null
    right?: React.ReactNode
    tone: 'ok' | 'bad' | 'warn' | 'muted' | 'live'
  }
  const steps: Step[] = []
  const last = lastAttemptAt(d)
  const n = d.attempts

  if (n === 0) {
    steps.push({ key: 'queued', title: 'Queued', at: d.createdAt, tone: 'muted' })
  } else {
    const firstIsLast = n === 1
    steps.push({
      key: 'a1',
      title: 'Attempt 1',
      at: firstIsLast ? last : d.createdAt,
      right: firstIsLast ? <CodePill d={d} /> : undefined,
      tone: firstIsLast ? (d.status === 'delivered' ? 'ok' : 'bad') : 'warn',
    })
    if (n > 2) {
      steps.push({
        key: 'mid',
        title: (
          <>
            Attempts 2–{n - 1}
            <span className="font-normal text-[var(--fg-3)]"> · retried</span>
          </>
        ),
        tone: 'warn',
      })
    }
    if (n >= 2) {
      steps.push({
        key: 'an',
        title: `Attempt ${n}`,
        at: last,
        right: <CodePill d={d} />,
        tone: d.status === 'delivered' ? 'ok' : 'bad',
      })
    }
  }

  if (d.status === 'delivered') {
    const took = d.deliveredAt ? d.deliveredAt - d.createdAt : null
    steps.push({
      key: 'end',
      title: 'Delivered',
      at: d.deliveredAt,
      right:
        took != null && took >= 0 ? (
          <span className="figure text-xs text-[var(--fg-2)]">took {fmtDuration(took)}</span>
        ) : undefined,
      tone: 'ok',
    })
  } else if (d.status === 'pending') {
    steps.push({
      key: 'end',
      title: 'Next try',
      at: d.nextAttemptAt,
      right: d.nextAttemptAt ? (
        <span className="figure text-xs font-medium text-foreground">
          {countdown(d.nextAttemptAt, now)}
        </span>
      ) : undefined,
      tone: 'live',
    })
  } else {
    steps.push({ key: 'end', title: 'Retries exhausted', at: d.updatedAt, tone: 'bad' })
  }

  const dot: Record<Step['tone'], string> = {
    ok: 'bg-[var(--st-ok-dot)]',
    bad: 'bg-[var(--st-bad-dot)]',
    warn: 'bg-[var(--st-warn-dot)]',
    muted: 'bg-[var(--chart-muted)]',
    live: 'animate-pulse bg-[var(--st-run-dot)]',
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--fg-2)]">Attempts</div>
        <AttemptsMeter d={d} />
      </div>
      <ol className="mt-3">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex min-h-9 items-start gap-3 pb-2 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" />
            )}
            <span className={cn('relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--bg-2)]', dot[s.tone])} />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.title}</div>
                {s.at ? (
                  <div className="text-xs text-[var(--fg-2)]" title={fmtLocal(s.at, { seconds: true })}>
                    {fmtLocal(s.at, { seconds: true })}
                  </div>
                ) : null}
              </div>
              {s.right}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function OverviewTab({
  d,
  now,
  storeName,
}: {
  d: WebhookDelivery
  now: number
  storeName: string | null
}) {
  const resourceLabel = d.resourceType
    ? `${d.resourceType[0].toUpperCase()}${d.resourceType.slice(1)}`
    : 'Resource'
  return (
    <div className="space-y-6">
      {d.lastError && (
        <Callout tone="danger" title="Last error">
          <div className="font-mono text-xs break-all whitespace-pre-wrap">{d.lastError}</div>
        </Callout>
      )}

      <SheetSection title="Details">
        <dl className="divide-y divide-border rounded-xl border border-border">
          {d.targetUrl && (
            <Fact icon={Link2} label="Endpoint">
              <span className="flex min-w-0 items-center justify-end gap-1">
                <a
                  href={d.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={d.targetUrl}
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:underline"
                >
                  <span className="truncate">{d.targetUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <CopyButton value={d.targetUrl} />
              </span>
            </Fact>
          )}
          <Fact icon={Store} label="Store">
            {storeName ? (
              <span className="flex min-w-0 items-center justify-end gap-1">
                <span className="truncate" title={d.merchantId}>
                  {storeName}
                </span>
                <CopyButton value={d.merchantId} />
              </span>
            ) : (
              <MonoValue value={d.merchantId} />
            )}
          </Fact>
          {d.resourceId && (
            <Fact icon={d.resourceType === 'payout' ? Send : FileText} label={resourceLabel}>
              <MonoValue value={d.resourceId} />
            </Fact>
          )}
          <Fact icon={Hash} label="Delivery id">
            <MonoValue value={d.id} />
          </Fact>
          {d.idempotencyKey && (
            <Fact icon={Fingerprint} label="Idempotency">
              <MonoValue value={d.idempotencyKey} />
            </Fact>
          )}
          <Fact icon={Calendar} label="Created">
            {fmtLocal(d.createdAt)}
          </Fact>
          <Fact icon={Clock} label="Updated">
            {fmtLocal(d.updatedAt)}
          </Fact>
          {d.deliveredAt && (
            <Fact icon={CheckCircle2} label="Delivered">
              {fmtLocal(d.deliveredAt)}
            </Fact>
          )}
          {d.status === 'pending' && d.nextAttemptAt && (
            <Fact icon={Timer} label="Next try">
              <span title={fmtLocal(d.nextAttemptAt, { seconds: true })}>
                {countdown(d.nextAttemptAt, now)}
              </span>
            </Fact>
          )}
        </dl>
      </SheetSection>
    </div>
  )
}

/** Last response only — the outbox doesn't keep per-attempt bodies. */
function ResponseTab({ d }: { d: WebhookDelivery }) {
  const body = d.lastError ? prettyMaybeJson(d.lastError) : null
  return (
    <div className="space-y-6">
      <dl className="divide-y divide-border rounded-xl border border-border">
        <Fact icon={ArrowDownLeft} label="Status">
          <span className="inline-flex justify-end">
            <CodePill d={d} />
          </span>
        </Fact>
        <Fact icon={Clock} label="At">
          {fmtLocal(lastAttemptAt(d), { seconds: true })}
        </Fact>
      </dl>
      {body && (
        <CodeBlock
          icon={body.json ? Braces : AlertTriangle}
          title="Error"
          text={body.text}
          json={body.json}
        />
      )}
    </div>
  )
}

function prettyMaybeJson(s: string): { text: string; json: boolean } {
  const t = s.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), json: true }
    } catch {
      /* not JSON */
    }
  }
  return { text: s, json: false }
}

function MonoValue({ value }: { value: string }) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-1">
      <span className="truncate font-mono text-xs" title={value}>
        {value}
      </span>
      <CopyButton value={value} />
    </span>
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

/* ── code block ────────────────────────────────────────── */

const JSON_TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function highlightJson(json: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of json.matchAll(JSON_TOKEN)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(json.slice(last, idx))
    const t = m[0]
    const cls = t.startsWith('"')
      ? m[2]
        ? 'text-foreground'
        : 'text-[var(--st-ok)]'
      : /^(true|false|null)$/.test(t)
        ? 'text-[var(--st-run)]'
        : 'text-[var(--st-info)]'
    out.push(
      <span key={i++} className={cls}>
        {t}
      </span>,
    )
    last = idx + t.length
  }
  if (last < json.length) out.push(json.slice(last))
  return out
}

function CodeBlock({
  icon: Icon,
  title,
  text,
  json,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
  json?: boolean
}) {
  const lines = React.useMemo(() => text.split('\n').length, [text])
  const content = React.useMemo(() => (json ? highlightJson(text) : text), [text, json])
  const long = lines > 18
  const [expanded, setExpanded] = React.useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[var(--bg-2)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-[var(--fg-2)]" />
          <span className="truncate font-mono text-xs text-[var(--fg-1)]">{title}</span>
          <span className="figure shrink-0 rounded-full bg-[var(--bg-active)] px-1.5 text-2xs font-medium text-[var(--fg-1)]">
            {lines} {lines === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {long && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              title={expanded ? 'Collapse' : 'Expand'}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')}
              />
            </Button>
          )}
          <CopyButton value={text} title="Copy" />
        </div>
      </div>
      <div className="relative">
        <pre
          className={cn(
            'px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--fg-1)]',
            long && !expanded ? 'max-h-72 overflow-hidden' : 'max-h-[60vh] overflow-auto',
          )}
        >
          {content}
        </pre>
        {long && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="absolute inset-x-0 bottom-0 flex h-16 cursor-pointer items-end justify-center bg-gradient-to-t from-[var(--bg-1)] to-transparent pb-2 text-xs font-medium text-[var(--fg-2)] hover:text-foreground"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  )
}

/* ── skeleton ──────────────────────────────────────────── */

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-border px-6 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
          <Skeleton className="hidden h-2 w-20 rounded-full md:block" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  )
}

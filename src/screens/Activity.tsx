import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  ChartPie,
  CheckCircle2,
  ChevronDown,
  Coins,
  Eye,
  FileText,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Timer,
  Webhook,
  XCircle,
} from '@/components/icons'

import { api } from '@/lib/api'
import type { WebhookDelivery } from '@/lib/types'
import { fmtLocal, fmtRel, fmtUsd, truncateAddr, useNow } from '@/lib/format'
import { useMerchants } from '@/lib/merchants'

import { Addr } from '@/components/Addr'
import { Segmented, SparkBars } from '@/components/charts'
import { CopyButton } from '@/components/CopyButton'
import { TokenIcon } from '@/components/CryptoIcon'
import { Pager, TableSearch, usePaged } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState } from '@/components/States'
import { Status, StatusDotTone, StatusPill, type StatusTone } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Source = 'pending' | 'delivered' | 'dead'
type FeedItem = WebhookDelivery & { _source: Source }
type Feed = FeedItem[]
type Filter = 'all' | Source

const PAGE_SIZE = 25

/* ── event meta: short title, icon, tone ───────────────── */

type EventMeta = {
  title: string
  icon: React.ComponentType<{ className?: string }>
  tone: StatusTone
}

function eventMeta(eventType: string): EventMeta {
  // `invoice:payment_confirmed` and legacy `invoice.payment_received` alike.
  const [scope, ...rest] = eventType.split(/[:.]/)
  const tail = rest.join('.')
  if (scope === 'invoice') {
    switch (tail) {
      case 'created':
        return { title: 'Invoice created', icon: FileText, tone: 'wait' }
      case 'payment_detected':
      case 'transfer_detected':
        return { title: 'Payment seen', icon: Coins, tone: 'run' }
      case 'payment_confirmed':
      case 'payment_received':
        return { title: 'Payment confirmed', icon: Coins, tone: 'ok' }
      case 'completed':
      case 'confirmed':
        return { title: 'Invoice paid', icon: CheckCircle2, tone: 'ok' }
      case 'overpaid':
        return { title: 'Invoice overpaid', icon: ArrowUpRight, tone: 'info' }
      case 'partial':
        return { title: 'Partially paid', icon: ChartPie, tone: 'warn' }
      case 'detected':
        return { title: 'Invoice detected', icon: Eye, tone: 'run' }
      case 'expired':
        return { title: 'Invoice expired', icon: Timer, tone: 'off' }
      case 'canceled':
        return { title: 'Invoice canceled', icon: XCircle, tone: 'bad' }
      case 'demoted':
        return { title: 'Reorg demoted', icon: RotateCcw, tone: 'bad' }
    }
    return { title: `Invoice ${tail.replace(/_/g, ' ')}`, icon: FileText, tone: 'wait' }
  }
  if (scope === 'payout') {
    switch (tail) {
      case 'submitted':
        return { title: 'Payout sent', icon: Send, tone: 'run' }
      case 'confirmed':
        return { title: 'Payout confirmed', icon: CheckCircle2, tone: 'ok' }
      case 'failed':
        return { title: 'Payout failed', icon: XCircle, tone: 'bad' }
    }
    return { title: `Payout ${tail.replace(/_/g, ' ')}`, icon: Send, tone: 'wait' }
  }
  return { title: eventType, icon: Webhook, tone: 'wait' }
}

const TINT: Record<StatusTone, string> = {
  ok: 'bg-[var(--st-ok-bg)] text-[var(--st-ok)]',
  run: 'bg-[var(--st-run-bg)] text-[var(--st-run)]',
  wait: 'bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border',
  warn: 'bg-[var(--st-warn-bg)] text-[var(--st-warn)]',
  bad: 'bg-[var(--st-bad-bg)] text-[var(--st-bad)]',
  info: 'bg-[var(--st-info-bg)] text-[var(--st-info)]',
  off: 'bg-[var(--st-wait-bg)] text-[var(--st-wait)]',
}

/** Payload fields we surface, when present. */
function payloadData(e: FeedItem): Record<string, unknown> {
  return (e.payload?.data ?? {}) as Record<string, unknown>
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null
}

/* ── grouping ──────────────────────────────────────────── */

type Cluster = { head: FeedItem; rest: FeedItem[] }
type DayGroup = { key: string; label: string; clusters: Cluster[] }

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(ms: number, nowMs: number): string {
  const d = new Date(ms)
  const today = new Date(nowMs)
  if (dayKey(ms) === dayKey(nowMs)) return 'Today'
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (dayKey(ms) === dayKey(y.getTime())) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** Day buckets; consecutive events for the same resource fold into one cluster. */
function groupFeed(rows: Feed, nowMs: number): DayGroup[] {
  const groups: DayGroup[] = []
  for (const e of rows) {
    const key = dayKey(e.updatedAt)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(e.updatedAt, nowMs), clusters: [] }
      groups.push(g)
    }
    const prev = g.clusters[g.clusters.length - 1]
    if (prev && e.resourceId && prev.head.resourceId === e.resourceId) prev.rest.push(e)
    else g.clusters.push({ head: e, rest: [] })
  }
  return groups
}

/* ── page ──────────────────────────────────────────────── */

export function ActivityPage() {
  const pending = useQuery({
    queryKey: ['activity', 'pending'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=pending&limit=50',
      ),
    refetchInterval: 15_000,
  })
  const delivered = useQuery({
    queryKey: ['activity', 'delivered'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=delivered&limit=50',
      ),
    refetchInterval: 30_000,
  })
  const dead = useQuery({
    queryKey: ['activity', 'dead'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=dead&limit=50',
      ),
    refetchInterval: 30_000,
  })
  const merchants = useMerchants()
  const now = useNow()

  const feed: Feed = React.useMemo(() => {
    const rows: Feed = []
    for (const d of pending.data?.deliveries ?? []) rows.push({ ...d, _source: 'pending' })
    for (const d of delivered.data?.deliveries ?? [])
      rows.push({ ...d, _source: 'delivered' })
    for (const d of dead.data?.deliveries ?? []) rows.push({ ...d, _source: 'dead' })
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return rows.slice(0, 150)
  }, [pending.data, delivered.data, dead.data])

  const [filter, setFilter] = React.useState<Filter>('all')
  const [query, setQuery] = React.useState('')
  const [openId, setOpenId] = React.useState<string | null>(null)

  const nameOf = React.useCallback(
    (id: string) => merchants.data?.merchants.find((m) => m.id === id)?.name ?? null,
    [merchants.data],
  )

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return feed.filter((e) => {
      if (filter !== 'all' && e._source !== filter) return false
      if (!q) return true
      return (
        e.eventType.toLowerCase().includes(q) ||
        eventMeta(e.eventType).title.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.merchantId.toLowerCase().includes(q) ||
        (nameOf(e.merchantId)?.toLowerCase().includes(q) ?? false) ||
        (e.resourceId?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [feed, filter, query, nameOf])
  const paged = usePaged(visible, PAGE_SIZE)
  const groups = React.useMemo(() => groupFeed(paged.rows, now), [paged.rows, now])

  const counts = React.useMemo(() => {
    const c: Record<Source, number> = { pending: 0, delivered: 0, dead: 0 }
    for (const e of feed) c[e._source]++
    return c
  }, [feed])

  // Events per hour over the last 24h, oldest → newest.
  const hourly = React.useMemo(() => {
    const buckets = new Array<number>(24).fill(0)
    for (const e of feed) {
      const age = now - e.updatedAt
      if (age < 0 || age >= 24 * 3_600_000) continue
      buckets[23 - Math.floor(age / 3_600_000)]++
    }
    return buckets
  }, [feed, now])
  const last24 = hourly.reduce((a, n) => a + n, 0)

  const refresh = () => {
    pending.refetch()
    delivered.refetch()
    dead.refetch()
  }

  const anyLoading =
    pending.isLoading || delivered.isLoading || dead.isLoading
  const anyFetching =
    pending.isFetching || delivered.isFetching || dead.isFetching

  const resetPage = () => paged.setPage(0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activity"
        description="Live gateway event timeline"
        actions={
          <>
            <StatusPill tone="ok" icon={Radio}>
              Live
            </StatusPill>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={anyFetching}
            >
              <RefreshCw className={cn('size-4', anyFetching && 'animate-spin')} />
              Refresh
            </Button>
          </>
        }
      />

      <DensityStrip
        loading={anyLoading}
        total={last24}
        hourly={hourly}
        counts={counts}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Filter>
            ariaLabel="Filter by delivery status"
            value={filter}
            onChange={(v) => {
              setFilter(v)
              resetPage()
            }}
            options={[
              { value: 'all', label: `All ${feed.length}` },
              { value: 'delivered', label: `Delivered ${counts.delivered}` },
              { value: 'pending', label: `Pending ${counts.pending}` },
              { value: 'dead', label: `Failed ${counts.dead}` },
            ]}
          />
          <TableSearch
            value={query}
            onChange={(v) => {
              setQuery(v)
              resetPage()
            }}
            placeholder="Search event, store, id…"
            className="w-full sm:ml-auto sm:w-64"
          />
        </div>

        <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-sm)]">
          {anyLoading ? (
            <TimelineSkeleton />
          ) : feed.length === 0 ? (
            <EmptyState icon={ActivityIcon} title="No recent activity" />
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              title="No matches"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div key={`${filter}|${paged.page}`} className="fade-in">
              {groups.map((g, gi) => (
                <section key={g.key}>
                  <h2
                    className={cn(
                      'sticky top-14 z-10 flex items-center justify-between border-b border-border bg-card/95 px-6 py-2.5 text-xs font-semibold text-[var(--fg-2)] backdrop-blur-md',
                      gi === 0 && 'rounded-t-lg',
                      gi > 0 && 'border-t',
                    )}
                  >
                    {g.label}
                    <span className="figure font-medium text-[var(--fg-3)]">
                      {g.clusters.reduce((a, c) => a + 1 + c.rest.length, 0)}
                    </span>
                  </h2>
                  <ol className="relative px-4 py-3 sm:px-6">
                    <span
                      aria-hidden
                      className="absolute top-0 bottom-0 left-[41px] w-px bg-border sm:left-[49px]"
                    />
                    {g.clusters.map((c) => (
                      <li key={c.head.id} className="relative">
                        <EventRow
                          e={c.head}
                          storeName={nameOf(c.head.merchantId)}
                          open={openId === c.head.id}
                          onToggle={() => setOpenId((v) => (v === c.head.id ? null : c.head.id))}
                        />
                        {c.rest.length > 0 && (
                          <ol className="mb-2 ml-[44px] space-y-0.5 border-l-2 border-border pl-3">
                            {c.rest.map((e) => (
                              <li key={e.id}>
                                <EventRow
                                  e={e}
                                  sub
                                  storeName={nameOf(e.merchantId)}
                                  open={openId === e.id}
                                  onToggle={() => setOpenId((v) => (v === e.id ? null : e.id))}
                                />
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
          {paged.total > 0 && !anyLoading && (
            <div className="border-t border-border px-6 py-3">
              <Pager
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                hasNext={paged.page < paged.pageCount - 1}
                onPage={paged.setPage}
                noun="events"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── density strip ─────────────────────────────────────── */

function DensityStrip({
  loading,
  total,
  hourly,
  counts,
}: {
  loading: boolean
  total: number
  hourly: number[]
  counts: Record<Source, number>
}) {
  const legend: Array<{ key: Source; label: string; tone: StatusTone }> = [
    { key: 'delivered', label: 'Delivered', tone: 'ok' },
    { key: 'pending', label: 'Pending', tone: 'wait' },
    { key: 'dead', label: 'Failed', tone: 'bad' },
  ]
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="text-sm text-[var(--fg-2)]">Last 24 hours</div>
          <div className="figure mt-1 text-xl font-semibold">
            {loading ? <Skeleton className="h-7 w-24" /> : `${total} events`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {legend.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-2 text-[var(--fg-2)]">
              <StatusDotTone tone={l.tone} />
              {l.label}
              <span className="figure font-medium text-foreground">
                {loading ? '–' : counts[l.key]}
              </span>
            </span>
          ))}
        </div>
      </div>
      <SparkBars values={hourly} height={44} className="mt-4" />
      <div className="mt-1.5 flex justify-between text-xs text-[var(--fg-3)]">
        <span>24h ago</span>
        <span>12h</span>
        <span>Now</span>
      </div>
    </Card>
  )
}

/* ── timeline row ──────────────────────────────────────── */

function EventRow({
  e,
  storeName,
  open,
  onToggle,
  sub,
}: {
  e: FeedItem
  storeName: string | null
  open: boolean
  onToggle: () => void
  sub?: boolean
}) {
  const meta = eventMeta(e.eventType)
  const Icon = meta.icon
  const data = payloadData(e)
  const usd = str(data.amountUsd) ?? str(data.paidUsd)
  const token = str(data.token)
  const panelId = `ev-${e.id}`
  return (
    <div className={cn(!sub && 'py-0.5')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 rounded-xl text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          sub ? 'px-2 py-1.5' : 'px-2 py-2.5',
          open && 'bg-[var(--bg-hover)]',
        )}
      >
        <span
          className={cn(
            'relative z-[1] grid shrink-0 place-items-center rounded-full ring-4 ring-card',
            sub ? 'size-7' : 'size-9',
            TINT[meta.tone],
          )}
          title={e.eventType}
        >
          <Icon className={sub ? 'size-3.5' : 'size-[18px]'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium', sub && 'text-sm')}>{meta.title}</span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--fg-2)]">
            <span className="max-w-[180px] truncate" title={e.merchantId}>
              {storeName ?? truncateAddr(e.merchantId, 8, 4)}
            </span>
            {usd && (
              <>
                <span className="text-[var(--fg-3)]">·</span>
                <span className="figure inline-flex items-center gap-1 font-medium text-foreground">
                  {token && <TokenIcon symbol={token} size={14} />}
                  {fmtUsd(usd)}
                </span>
              </>
            )}
            {e.resourceId && (
              <>
                <span className="text-[var(--fg-3)]">·</span>
                <span className="font-mono text-[var(--fg-3)]">
                  {truncateAddr(e.resourceId, 6, 4)}
                </span>
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Status value={e._source} size={sub ? 'sm' : 'md'} />
          <span
            className="figure hidden w-16 text-right text-sm text-[var(--fg-2)] sm:block"
            title={fmtLocal(e.updatedAt, { seconds: true })}
          >
            {fmtRel(Math.floor(e.updatedAt / 1000))}
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-[var(--fg-3)] transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      {open && (
        <div id={panelId} className={cn('fade-in pt-1 pb-3', sub ? 'pl-2' : 'pl-[56px]')}>
          <EventDetail e={e} />
        </div>
      )}
    </div>
  )
}

const SHOWN_FIELDS = new Set(['amountUsd', 'paidUsd', 'token', 'txHash', 'destinationAddress', 'chainId'])

function EventDetail({ e }: { e: FeedItem }) {
  const data = payloadData(e)
  const chainId = typeof data.chainId === 'number' ? data.chainId : undefined
  const txHash = str(data.txHash)
  const dest = str(data.destinationAddress)
  const extra = Object.entries(data).filter(
    ([k, v]) =>
      !SHOWN_FIELDS.has(k) &&
      v != null &&
      v !== '' &&
      (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
  )
  return (
    <div className="space-y-3 rounded-xl border border-border bg-[var(--bg-2)] p-4">
      {e.lastError && (
        <Callout tone="danger" title="Last error" className="bg-card">
          <span className="font-mono text-xs break-all">{e.lastError}</span>
        </Callout>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        <Row label="Event">
          <span className="truncate font-mono text-xs">{e.eventType}</span>
        </Row>
        <Row label="Delivery">
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs" title={e.id}>
              {truncateAddr(e.id, 8, 6)}
            </span>
            <CopyButton value={e.id} />
          </span>
        </Row>
        <Row label="Attempts">
          <span className="figure">{e.attempts}</span>
        </Row>
        {e.lastStatusCode != null && (
          <Row label="Response">
            <span className="figure">HTTP {e.lastStatusCode}</span>
          </Row>
        )}
        {e.resourceId && (
          <Row label={e.resourceType === 'payout' ? 'Payout' : 'Invoice'}>
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs" title={e.resourceId}>
                {truncateAddr(e.resourceId, 8, 6)}
              </span>
              <CopyButton value={e.resourceId} />
            </span>
          </Row>
        )}
        {txHash && (
          <Row label="Tx">
            <Addr value={txHash} chainId={chainId} kind="tx" />
          </Row>
        )}
        {dest && (
          <Row label="To">
            <Addr value={dest} chainId={chainId} />
          </Row>
        )}
        {extra.slice(0, 6).map(([k, v]) => (
          <Row key={k} label={k}>
            <span className="truncate font-mono text-xs" title={String(v)}>
              {String(v)}
            </span>
          </Row>
        ))}
      </dl>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-[var(--fg-2)]">{label}</dt>
      <dd className="flex min-w-0 justify-end">{children}</dd>
    </div>
  )
}

/* ── skeleton ──────────────────────────────────────────── */

function TimelineSkeleton() {
  return (
    <div>
      <div className="border-b border-border px-6 py-2.5">
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="space-y-1 px-6 py-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-2.5 w-52 max-w-full" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="hidden h-3.5 w-12 sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}

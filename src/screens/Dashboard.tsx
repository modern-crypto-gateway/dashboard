import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtRel, fmtUsd, truncateAddr } from '@/lib/format'
import { useHeldQueue } from '@/lib/held'
import { useActiveMerchant } from '@/lib/merchants'
import { cn } from '@/lib/utils'
import type {
  BalancesSnapshot,
  ChainInventoryEntry,
  Family,
  GatewayInvoice,
  GatewayPayout,
  Health,
  InvoiceListResponse,
  OrphanTransaction,
  PayoutListResponse,
  PoolStatsRow,
  WebhookDelivery,
} from '@/lib/types'

import {
  AlertTriangle,
  ArrowRight,
  LifeBuoy,
  Link2,
  Plus,
  Waypoints,
  Webhook,
} from '@/components/icons'
import {
  BarTrend,
  Donut,
  Segmented,
  SegmentedBar,
  Spark,
  SparkBars,
  compactUsd,
  fullUsd,
  type Point,
  type Slice,
} from '@/components/charts'
import { ChainIcon, TokenOnChain } from '@/components/CryptoIcon'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/States'
import { Status, StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/* ── Queries (same requests the dedicated pages make) ─────── */

const HEALTH_Q = {
  queryKey: ['gw', 'health'] as const,
  queryFn: () => api<Health>('/api/gw/health'),
  refetchInterval: 30_000,
}
const POOL_Q = {
  queryKey: ['gw', 'pool-stats'] as const,
  queryFn: () => api<{ stats: PoolStatsRow[] }>('/api/gw/admin/pool/stats'),
  refetchInterval: 60_000,
}
const BAL_Q = {
  queryKey: ['gw', 'balances', 'db'] as const,
  queryFn: () =>
    api<{ snapshot: BalancesSnapshot; cached: boolean }>('/api/gw/admin/balances'),
  refetchInterval: 60_000,
}
const CHAINS_Q = {
  queryKey: ['gw', 'chains'] as const,
  queryFn: () => api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
  refetchInterval: 120_000,
}
const ORPHANS_Q = {
  queryKey: ['orphans'] as const,
  queryFn: () =>
    api<{ orphans: OrphanTransaction[] }>('/api/gw/admin/orphan-transactions?limit=100'),
  refetchInterval: 60_000,
}
const DEAD_HOOKS_Q = {
  queryKey: ['webhook-deliveries', 'dead'] as const,
  queryFn: () =>
    api<{ deliveries: WebhookDelivery[] }>(
      '/api/gw/admin/webhook-deliveries?status=dead&limit=100',
    ),
  refetchInterval: 60_000,
}

/** Latest page, exactly as the Invoices / Payouts pages request it. */
const STORE_PAGE = 50
const POOL_FAMILIES: Family[] = ['evm', 'tron', 'solana']
const LOW_POOL = 3

type Range = '7' | '14' | '30'

/* ── Helpers ──────────────────────────────────────────────── */

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function buildDays(n: number): Point[] {
  const out: Point[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({
      key: dayKey(d),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })
  }
  return out
}

const num = (s: string | null | undefined) => {
  const n = s ? parseFloat(s) : 0
  return isFinite(n) ? n : 0
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--st-ok-dot)',
  processing: 'var(--st-run-dot)',
  pending: 'var(--st-wait-dot)',
  expired: 'var(--st-warn-dot)',
  canceled: 'var(--st-bad-dot)',
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Request failed'
}

/* ── Page ─────────────────────────────────────────────────── */

export function DashboardPage() {
  const [range, setRange] = React.useState<Range>('14')
  const health = useQuery(HEALTH_Q)
  const pool = useQuery(POOL_Q)
  const bal = useQuery(BAL_Q)
  const chains = useQuery(CHAINS_Q)
  const orphans = useQuery(ORPHANS_Q)
  const deadHooks = useQuery(DEAD_HOOKS_Q)
  const held = useHeldQueue({ refetchInterval: 30_000 })

  const { active } = useActiveMerchant()
  const canList =
    !!active && active.source !== 'gateway-only' && active.apiKeyFingerprint !== null

  const invoices = useQuery({
    enabled: canList,
    queryKey: ['dashboard', 'invoices', active?.id ?? null] as const,
    queryFn: () =>
      api<Partial<InvoiceListResponse> | null>(
        `/api/mg/${encodeURIComponent(active!.id)}/invoices?limit=${STORE_PAGE}&offset=0`,
      ),
    refetchInterval: 60_000,
  })
  const payouts = useQuery({
    enabled: canList,
    queryKey: ['dashboard', 'payouts', active?.id ?? null] as const,
    queryFn: () =>
      api<Partial<PayoutListResponse> | null>(
        `/api/mg/${encodeURIComponent(active!.id)}/payouts?limit=${STORE_PAGE}&offset=0&kind=standard`,
      ),
    refetchInterval: 60_000,
  })

  const invList: GatewayInvoice[] = React.useMemo(
    () => (Array.isArray(invoices.data?.invoices) ? invoices.data.invoices : []),
    [invoices.data],
  )
  const payList: GatewayPayout[] = React.useMemo(
    () => (Array.isArray(payouts.data?.payouts) ? payouts.data.payouts : []),
    [payouts.data],
  )

  const n = Number(range)
  const hasMore = invoices.data?.hasMore === true
  const series = React.useMemo(() => {
    const days = buildDays(n)
    const idx = new Map(days.map((d, i) => [d.key, i]))
    for (const d of days) {
      d.collected = 0
      d.invoiced = 0
      d.count = 0
      d.paidOut = 0
    }
    const statusCounts: Record<string, number> = {}
    let collected = 0
    let invoiced = 0
    let count = 0
    for (const inv of invList) {
      const ci = idx.get(dayKey(new Date(inv.createdAt)))
      if (ci != null) {
        days[ci].invoiced = Number(days[ci].invoiced) + num(inv.amountUsd)
        days[ci].count = Number(days[ci].count) + 1
        invoiced += num(inv.amountUsd)
        count += 1
        statusCounts[inv.status] = (statusCounts[inv.status] ?? 0) + 1
      }
      const paid = num(inv.paidUsd)
      const ui = idx.get(dayKey(new Date(inv.updatedAt)))
      if (paid > 0 && ui != null) {
        days[ui].collected = Number(days[ui].collected) + paid
        collected += paid
      }
    }
    let paidOut = 0
    let payoutCount = 0
    for (const p of payList) {
      if (p.status !== 'confirmed') continue
      const pi = idx.get(dayKey(new Date(p.createdAt)))
      if (pi == null) continue
      const usd = num(p.quotedAmountUsd)
      days[pi].paidOut = Number(days[pi].paidOut) + usd
      paidOut += usd
      payoutCount += 1
    }
    const oldest = invList.reduce<number>(
      (m, i) => Math.min(m, Date.parse(i.createdAt) || m),
      Number.POSITIVE_INFINITY,
    )
    const truncated = hasMore && oldest > Date.parse(days[0].key + 'T00:00:00')
    return { days, collected, invoiced, count, paidOut, payoutCount, statusCounts, truncated }
  }, [invList, payList, n, hasMore])

  const bootstrapGaps = React.useMemo(() => {
    const list = chains.data?.chains ?? []
    if (list.length === 0) return null
    const wired = list.filter((c) => c.wired)
    return { notReady: wired.filter((c) => !c.bootstrapReady).length }
  }, [chains.data])

  const lowPool = (pool.data?.stats ?? []).filter(
    (r) => POOL_FAMILIES.includes(r.family) && r.total > 0 && r.available < LOW_POOL,
  ).length

  const attention: AttentionItem[] = [
    { key: 'held', label: 'Held payouts', icon: LifeBuoy, to: '/held-payouts', count: held.data?.count, loading: held.isLoading, failed: held.isError },
    { key: 'orphans', label: 'Orphan transactions', icon: AlertTriangle, to: '/orphans', count: orphans.data?.orphans.length, loading: orphans.isLoading, failed: orphans.isError },
    { key: 'hooks', label: 'Dead webhooks', icon: Webhook, to: '/webhooks', count: deadHooks.data?.deliveries.length, loading: deadHooks.isLoading, failed: deadHooks.isError },
    { key: 'chains', label: 'Chains not ready', icon: Link2, to: '/chains', count: bootstrapGaps?.notReady, loading: chains.isLoading, failed: chains.isError },
    { key: 'pool', label: 'Low address pool', icon: Waypoints, to: '/pool', count: pool.data ? lowPool : undefined, loading: pool.isLoading, failed: pool.isError },
  ]
  const openIssues = attention.reduce((a, i) => a + (i.count ?? 0), 0)

  const snap = bal.data?.snapshot
  const storeLoading = canList && (invoices.isLoading || payouts.isLoading)
  const rangeLabel = `last ${n} days`

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Overview"
        description={
          active ? (
            <>
              <span className="text-foreground">{active.name}</span> · {rangeLabel}
            </>
          ) : (
            'Gateway health, money in and money out.'
          )
        }
        actions={
          <>
            <Segmented<Range>
              ariaLabel="Time range"
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '7D' },
                { value: '14', label: '14D' },
                { value: '30', label: '30D' },
              ]}
            />
            <MerchantSwitcher />
            <Button size="sm" asChild>
              <Link to="/invoices">
                <Plus className="size-4" /> New invoice
              </Link>
            </Button>
          </>
        }
      />

      {/* ── KPI tiles ───────────────────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total balance"
          loading={bal.isLoading}
          value={bal.isError ? '—' : fmtUsd(snap?.totalUsd ?? 0)}
          sub={
            snap
              ? `${snap.families.reduce((a, f) => a + f.chains.length, 0)} chains · updated ${fmtRel(Math.floor(Date.parse(snap.generatedAt) / 1000))}`
              : bal.isError
                ? errMsg(bal.error)
                : undefined
          }
          footer={<BalanceBar snapshot={snap} />}
        />
        <StatTile
          label={`Collected · ${n}D`}
          loading={storeLoading}
          value={canList ? fmtUsd(series.collected) : '—'}
          sub={canList ? `of ${fmtUsd(series.invoiced)} invoiced` : 'Pick a store with an API key'}
          footer={<Spark values={series.days.map((d) => Number(d.collected))} />}
        />
        <StatTile
          label={`Invoices · ${n}D`}
          loading={storeLoading}
          value={canList ? String(series.count) : '—'}
          sub={
            canList && series.count > 0
              ? `${Math.round(((series.statusCounts.completed ?? 0) / series.count) * 100)}% completed`
              : canList
                ? 'None in this range'
                : undefined
          }
          footer={<SparkBars values={series.days.map((d) => Number(d.count))} />}
        />
        <StatTile
          label={`Paid out · ${n}D`}
          loading={storeLoading}
          value={canList ? fmtUsd(series.paidOut) : '—'}
          sub={
            canList
              ? `${series.payoutCount} confirmed payout${series.payoutCount === 1 ? '' : 's'}`
              : undefined
          }
          footer={
            <Spark
              values={series.days.map((d) => Number(d.paidOut))}
              color="var(--chart-2)"
              fill="var(--chart-2)"
            />
          }
        />
      </div>

      {/* ── Volume + balance mix ────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">Payment volume</h2>
              <p className="mt-1 text-sm text-[var(--fg-2)]">
                Daily USD, {rangeLabel}
                {series.truncated && ` · from the latest ${STORE_PAGE} invoices`}
              </p>
            </div>
            <Legend
              items={[
                { name: 'Collected', color: 'var(--chart-1-fill)' },
                { name: 'Invoiced', color: 'var(--chart-muted)' },
              ]}
            />
          </div>
          <div className="mt-6">
            {!canList ? (
              <EmptyState
                compact
                title="No store selected"
                description="Volume comes from a store's invoices. Add or pick a store with an API key."
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/stores">Open stores</Link>
                  </Button>
                }
              />
            ) : storeLoading ? (
              <Skeleton className="h-[260px] w-full rounded-xl" />
            ) : invoices.isError ? (
              <div className="grid h-[260px] place-items-center text-sm text-destructive">
                {errMsg(invoices.error)}
              </div>
            ) : (
              <BarTrend
                height={260}
                data={series.days}
                series={[
                  { key: 'collected', name: 'Collected', color: 'var(--chart-1-fill)' },
                  { key: 'invoiced', name: 'Invoiced', color: 'var(--chart-muted)' },
                ]}
              />
            )}
          </div>
        </Card>

        <BalanceMix snapshot={snap} loading={bal.isLoading} />
      </div>

      {/* ── Attention · outcomes · system ───────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Needs attention</h2>
            {attention.every((a) => !a.loading) &&
              (openIssues === 0 ? (
                <StatusPill tone="ok">All clear</StatusPill>
              ) : (
                <StatusPill tone="warn">{openIssues} open</StatusPill>
              ))}
          </div>
          <ul className="mt-3 -mx-2">
            {attention.map((a) => (
              <AttentionRow key={a.key} item={a} />
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Invoice outcomes</h2>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            {canList ? `${series.count} invoices, ${rangeLabel}` : 'Pick a store to see outcomes'}
          </p>
          <StatusMix counts={series.statusCounts} loading={storeLoading} />
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">System</h2>
            <HealthBadge health={health.data} loading={health.isLoading} error={health.isError} />
          </div>
          <PoolMeters stats={pool.data?.stats} loading={pool.isLoading} />
        </Card>
      </div>

      {/* ── Recent invoices ─────────────────────────────── */}
      {canList && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Recent invoices</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/invoices">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {storeLoading ? (
            <div className="space-y-3 px-6 pb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : invList.length === 0 ? (
            <EmptyState compact title="No invoices yet" />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {invList.slice(0, 6).map((inv) => (
                <RecentInvoiceRow key={inv.id} inv={inv} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

/* ── Pieces ──────────────────────────────────────────────── */

function StatTile({
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
    <Card className="flex flex-col p-6">
      <div className="text-sm font-medium text-[var(--fg-2)]">{label}</div>
      <div className="figure mt-3 text-2xl font-semibold tracking-[-0.03em]">
        {loading ? <Skeleton className="h-9 w-32" /> : value}
      </div>
      <div className="mt-1.5 min-h-4 truncate text-xs text-[var(--fg-2)]">
        {loading ? <Skeleton className="h-3 w-24" /> : sub}
      </div>
      {footer && <div className="mt-auto pt-5">{footer}</div>}
    </Card>
  )
}

function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  return (
    <div className="flex items-center gap-4 text-xs text-[var(--fg-2)]">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  )
}

function chainSlices(snapshot?: BalancesSnapshot): Slice[] {
  const all =
    snapshot?.families
      .flatMap((f) =>
        f.chains.map((c) => {
          const info = chainInfo(c.chainId)
          return { key: String(c.chainId), name: info.name, value: num(c.totalUsd), color: info.color }
        }),
      )
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value) ?? []
  if (all.length <= 6) return all
  const head = all.slice(0, 5)
  const rest = all.slice(5).reduce((a, s) => a + s.value, 0)
  return [...head, { key: 'other', name: 'Other', value: rest, color: 'var(--chart-muted)' }]
}

function BalanceBar({ snapshot }: { snapshot?: BalancesSnapshot }) {
  const slices = chainSlices(snapshot)
  return (
    <SegmentedBar
      className="h-2"
      parts={slices.map((s) => ({ key: s.key, name: s.name, value: s.value, color: s.color }))}
    />
  )
}

function BalanceMix({ snapshot, loading }: { snapshot?: BalancesSnapshot; loading: boolean }) {
  const slices = chainSlices(snapshot)
  const total = slices.reduce((a, s) => a + s.value, 0)
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Balance by chain</h2>
        <Link to="/balances" className="text-sm text-[var(--fg-2)] hover:text-foreground">
          Details
        </Link>
      </div>
      {loading ? (
        <div className="mt-6 flex justify-center">
          <Skeleton className="size-[168px] rounded-full" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row xl:flex-col">
          <Donut
            slices={slices}
            size={168}
            thickness={20}
            center={
              <div>
                <div className="figure text-lg font-semibold">{compactUsd(total)}</div>
                <div className="text-2xs text-[var(--fg-2)]">total</div>
              </div>
            }
          />
          <ul className="w-full space-y-2">
            {slices.length === 0 && (
              <li className="text-sm text-[var(--fg-2)]">No balances yet.</li>
            )}
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.key !== 'other' && <ChainIcon chainId={Number(s.key)} size={16} />}
                <span className="truncate text-[var(--fg-1)]">{s.name}</span>
                <span className="figure ml-auto font-medium">{compactUsd(s.value)}</span>
                <span className="figure w-12 text-right text-xs text-[var(--fg-3)]">
                  {total ? ((s.value / total) * 100).toFixed(0) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

type AttentionItem = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  to: string
  count?: number
  loading: boolean
  failed: boolean
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = item.icon
  const n = item.count ?? 0
  const hot = n > 0
  return (
    <li>
      <Link
        to={item.to}
        className="group flex h-11 items-center gap-3 rounded-[10px] px-2 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            'grid size-7 place-items-center rounded-lg',
            hot ? 'bg-[var(--warn-bg)] text-warn' : 'bg-[var(--bg-2)] text-[var(--fg-3)]',
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className={cn('flex-1 text-sm', hot ? 'text-foreground' : 'text-[var(--fg-2)]')}>
          {item.label}
        </span>
        {item.loading ? (
          <Skeleton className="h-4 w-6" />
        ) : item.failed ? (
          <span className="text-xs text-destructive">Unavailable</span>
        ) : (
          <span
            className={cn(
              'figure text-sm font-semibold',
              hot ? 'text-foreground' : 'text-[var(--fg-3)]',
            )}
          >
            {n}
          </span>
        )}
        <ArrowRight className="size-3.5 text-[var(--fg-3)] transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  )
}

function StatusMix({
  counts,
  loading,
}: {
  counts: Record<string, number>
  loading: boolean
}) {
  const order = ['completed', 'processing', 'pending', 'expired', 'canceled']
  const parts = order.map((k) => ({
    key: k,
    name: k,
    value: counts[k] ?? 0,
    color: STATUS_COLORS[k],
  }))
  const total = parts.reduce((a, p) => a + p.value, 0)
  if (loading) return <Skeleton className="mt-5 h-24 w-full" />
  return (
    <div className="mt-5">
      <SegmentedBar className="h-3" parts={parts} />
      <ul className="mt-4 space-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            <span className="capitalize text-[var(--fg-1)]">{p.name}</span>
            <span className="figure ml-auto font-medium">{p.value}</span>
            <span className="figure w-12 text-right text-xs text-[var(--fg-3)]">
              {total ? Math.round((p.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HealthBadge({
  health,
  loading,
  error,
}: {
  health?: Health
  loading: boolean
  error: boolean
}) {
  if (loading) return <Skeleton className="h-5 w-24 rounded-full" />
  if (error) return <StatusPill tone="bad">Unreachable</StatusPill>
  const ok = health?.status === 'ok'
  return <StatusPill tone={ok ? 'ok' : 'warn'}>{ok ? 'Operational' : 'Degraded'}</StatusPill>
}

function PoolMeters({ stats, loading }: { stats?: PoolStatsRow[]; loading: boolean }) {
  const byFamily = Object.fromEntries((stats ?? []).map((s) => [s.family, s]))
  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-[var(--fg-2)]">Free pool addresses</span>
        <Link to="/pool" className="text-[var(--fg-2)] hover:text-foreground">
          Manage
        </Link>
      </div>
      <div className="space-y-3.5">
        {POOL_FAMILIES.map((fam) => {
          const s = byFamily[fam]
          const tot = s?.total ?? 0
          const av = s?.available ?? 0
          const pct = tot ? (av / tot) * 100 : 0
          const tone =
            av < LOW_POOL ? 'var(--danger)' : av < 6 ? 'var(--warn)' : 'var(--chart-1-fill)'
          return (
            <div key={fam}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium uppercase">{fam}</span>
                {loading ? (
                  <Skeleton className="h-4 w-14" />
                ) : (
                  <span className="figure text-[var(--fg-2)]">
                    <span className="font-semibold text-foreground">{av}</span> / {tot}
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--chart-muted)]">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecentInvoiceRow({ inv }: { inv: GatewayInvoice }) {
  const info = chainInfo(inv.chainId)
  const amount = inv.amountUsd
    ? fullUsd(num(inv.amountUsd))
    : `${inv.requiredAmountRaw} ${inv.token}`
  const when = Math.floor(Date.parse(inv.createdAt) / 1000)
  return (
    <li>
      <Link
        to="/invoices"
        className="flex items-center gap-4 px-6 py-3.5 text-sm outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]"
      >
        <TokenOnChain symbol={inv.token} chainId={inv.chainId} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{inv.externalId ?? truncateAddr(inv.id, 8, 4)}</div>
          <div className="truncate text-xs text-[var(--fg-2)]">
            {info.name} · {inv.token}
          </div>
        </div>
        <div className="hidden w-28 sm:block">
          <Status value={inv.status} />
        </div>
        <div className="figure w-28 text-right font-medium">{amount}</div>
        <div className="hidden w-20 text-right text-xs text-[var(--fg-3)] sm:block">
          {fmtRel(when)}
        </div>
      </Link>
    </li>
  )
}

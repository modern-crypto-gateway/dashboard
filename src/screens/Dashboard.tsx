import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Link2,
  LifeBuoy,
  Plus,
  RefreshCw,
  Waypoints,
  Webhook,
} from 'lucide-react'

import { api } from '@/lib/api'
import { chainInfo, FAMILY_COLOR } from '@/lib/chains'
import { fmtLocalTime, fmtUsd, fmtNum } from '@/lib/format'
import { useHeldQueue } from '@/lib/held'
import { cn } from '@/lib/utils'
import type {
  BalancesSnapshot,
  ChainInventoryEntry,
  Family,
  Health,
  OrphanTransaction,
  PoolStatsRow,
  WebhookDelivery,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/States'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/StatusDot'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'

const HEALTH_Q = {
  queryKey: ['gw', 'health'] as const,
  queryFn: () => api<Health>('/api/gw/health'),
  refetchInterval: 30_000,
}

const POOL_Q = {
  queryKey: ['gw', 'pool-stats'] as const,
  queryFn: () =>
    api<{ stats: PoolStatsRow[] }>('/api/gw/admin/pool/stats'),
  refetchInterval: 60_000,
}

const BAL_Q = {
  queryKey: ['gw', 'balances', 'db'] as const,
  queryFn: () =>
    api<{ snapshot: BalancesSnapshot; cached: boolean }>(
      '/api/gw/admin/balances',
    ),
  refetchInterval: 60_000,
}

const CHAINS_Q = {
  queryKey: ['gw', 'chains'] as const,
  queryFn: () =>
    api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
  refetchInterval: 120_000,
}

// Same keys + requests as the Orphans and Webhooks pages, so the
// dashboard shares their cache instead of adding traffic.
const ORPHANS_Q = {
  queryKey: ['orphans'] as const,
  queryFn: () =>
    api<{ orphans: OrphanTransaction[] }>(
      '/api/gw/admin/orphan-transactions?limit=100',
    ),
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

/** Families that participate in the reusable address pool. */
const POOL_FAMILIES: Family[] = ['evm', 'tron', 'solana']
const LOW_POOL = 3

export function DashboardPage() {
  const health = useQuery(HEALTH_Q)
  const pool = useQuery(POOL_Q)
  const bal = useQuery(BAL_Q)
  const chains = useQuery(CHAINS_Q)
  const orphans = useQuery(ORPHANS_Q)
  const deadHooks = useQuery(DEAD_HOOKS_Q)
  const held = useHeldQueue({ refetchInterval: 30_000 })

  const bootstrapGaps = React.useMemo(() => {
    const chainList = chains.data?.chains ?? []
    if (chainList.length === 0) return null
    const wired = chainList.filter((c) => c.wired)
    const webhookGaps = wired.filter(
      (c) => c.webhooksSupported && !c.webhooks,
    ).length
    const notReady = wired.filter((c) => !c.bootstrapReady).length
    return { webhookGaps, notReady, total: wired.length }
  }, [chains.data])

  const lowPoolFamilies = React.useMemo(() => {
    const rows = pool.data?.stats ?? []
    return rows.filter(
      (r) => POOL_FAMILIES.includes(r.family) && r.total > 0 && r.available < LOW_POOL,
    )
  }, [pool.data])

  const balSnap = bal.data?.snapshot

  const refreshAll = () => {
    health.refetch()
    pool.refetch()
    bal.refetch()
    chains.refetch()
    orphans.refetch()
    deadHooks.refetch()
    held.refetch()
  }

  const attention: AttentionItem[] = [
    {
      key: 'held',
      label: 'Held payouts',
      hint: 'Stuck legs waiting for recovery',
      icon: LifeBuoy,
      to: '/held-payouts',
      count: held.data?.count,
      loading: held.isLoading,
      failed: held.isError,
    },
    {
      key: 'orphans',
      label: 'Orphan transactions',
      hint: 'Deposits not matched to an invoice',
      icon: AlertTriangle,
      to: '/orphans',
      count: orphans.data?.orphans.length,
      loading: orphans.isLoading,
      failed: orphans.isError,
    },
    {
      key: 'hooks',
      label: 'Dead webhooks',
      hint: 'Store deliveries that gave up retrying',
      icon: Webhook,
      to: '/webhooks',
      count: deadHooks.data?.deliveries.length,
      loading: deadHooks.isLoading,
      failed: deadHooks.isError,
    },
    {
      key: 'chains',
      label: 'Chains not ready',
      hint:
        bootstrapGaps && bootstrapGaps.webhookGaps > 0
          ? `${bootstrapGaps.webhookGaps} missing Alchemy webhook${bootstrapGaps.webhookGaps === 1 ? '' : 's'}`
          : 'Wired chains missing bootstrap config',
      icon: Link2,
      to: '/chains',
      count: bootstrapGaps?.notReady,
      loading: chains.isLoading,
      failed: chains.isError,
    },
    {
      key: 'pool',
      label: 'Pool running low',
      hint: `Families with fewer than ${LOW_POOL} free addresses`,
      icon: Waypoints,
      to: '/pool',
      count: pool.data ? lowPoolFamilies.length : undefined,
      loading: pool.isLoading,
      failed: pool.isError,
    },
  ]

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={
          balSnap ? (
            <>
              Balances as of{' '}
              <span className="font-mono text-[var(--fg-1)]">
                {fmtLocalTime(balSnap.generatedAt)}
              </span>{' '}
              · refreshes every minute
            </>
          ) : (
            'Gateway health, balances and anything that needs an operator.'
          )
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button size="sm" asChild>
              <Link to="/invoices">
                <Plus className="size-3.5" /> New invoice
              </Link>
            </Button>
          </>
        }
      />

      <AttentionStrip items={attention} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <BalanceHero
          snapshot={balSnap}
          loading={bal.isLoading}
          error={bal.isError ? errMsg(bal.error) : null}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <HealthCard health={health.data} loading={health.isLoading} error={health.isError} />
          <PoolCard stats={pool.data?.stats} loading={pool.isLoading} />
        </div>
      </div>

      <TopAddressesCard snapshot={balSnap} loading={bal.isLoading} />
    </div>
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Request failed'
}

/* ── Attention strip ───────────────────────────────────────── */

type AttentionItem = {
  key: string
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  to: string
  count?: number
  loading: boolean
  failed: boolean
}

function AttentionStrip({ items }: { items: AttentionItem[] }) {
  const settled = items.every((i) => !i.loading)
  const open = items.filter((i) => (i.count ?? 0) > 0)
  const failed = items.filter((i) => i.failed)
  const allClear = settled && open.length === 0 && failed.length === 0

  return (
    <section aria-labelledby="attention-title">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="attention-title" className="text-sm font-medium">
          Needs attention
        </h2>
        {allClear ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-3.5" /> All clear
          </span>
        ) : settled && open.length > 0 ? (
          <span className="text-sm text-[var(--fg-2)]">
            {open.length} {open.length === 1 ? 'area' : 'areas'}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-6 xl:grid-cols-5">
        {items.map((it, idx) => {
          const Icon = it.icon
          const n = it.count ?? 0
          const hot = n > 0
          return (
            <Link
              key={it.key}
              to={it.to}
              className={cn(
                'group relative flex flex-col gap-2 bg-card px-4 py-3.5 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset xl:col-span-1',
                // 2 cols on phones (last tile spans), 3+2 on tablets.
                idx === items.length - 1 && items.length % 2 === 1 ? 'col-span-2' : 'col-span-1',
                idx < 3 ? 'sm:col-span-2' : 'sm:col-span-3',
              )}
            >
              {hot && (
                <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-warn" />
              )}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    hot ? 'font-medium text-warn' : 'text-[var(--fg-2)]',
                  )}
                >
                  <Icon className="size-3.5" />
                  {it.label}
                </span>
                <ArrowRight className="size-3.5 text-[var(--fg-3)] opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="flex items-baseline gap-2">
                {it.loading ? (
                  <Skeleton className="h-7 w-8" />
                ) : it.failed ? (
                  <span className="text-sm text-destructive">Unavailable</span>
                ) : (
                  <span
                    className={cn(
                      'font-mono text-2xl font-semibold tracking-[-0.02em] tabular-nums',
                      hot ? 'text-foreground' : 'text-[var(--fg-3)]',
                    )}
                  >
                    {n}
                  </span>
                )}
              </div>
              <span className="hidden text-2xs text-[var(--fg-2)] sm:block">{it.hint}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/* ── Balance hero ──────────────────────────────────────────── */

function BalanceHero({
  snapshot,
  loading,
  error,
}: {
  snapshot?: BalancesSnapshot
  loading: boolean
  error: string | null
}) {
  const families: Family[] = ['evm', 'tron', 'solana', 'utxo', 'monero']
  const rows =
    snapshot?.families.map((f) => ({
      family: f.family,
      usd: parseFloat(f.totalUsd),
      chains: f.chains,
    })) ?? []
  const byFamily = Object.fromEntries(rows.map((r) => [r.family, r]))
  const total = parseFloat(snapshot?.totalUsd ?? '0')

  const chainShares = rows
    .flatMap((r) =>
      r.chains.map((c) => ({
        chainId: c.chainId,
        usd: parseFloat(c.totalUsd),
        info: chainInfo(c.chainId),
      })),
    )
    .filter((c) => c.usd > 0)
    .sort((a, b) => b.usd - a.usd)

  return (
    <Card className="flex flex-col p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--fg-2)]">Total balance</div>
          <div className="mt-1 font-mono text-3xl font-semibold tracking-[-0.03em] tabular-nums">
            {loading ? (
              <Skeleton className="h-10 w-48" />
            ) : error ? (
              <span className="text-[var(--fg-3)]">—</span>
            ) : (
              fmtUsd(total)
            )}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-2)]">
            Gateway-owned addresses · source{' '}
            <span className="font-mono">{snapshot?.source ?? 'db'}</span>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/balances">
            All balances <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {error && (
        <div className="mt-4 text-sm text-destructive">
          Balances unavailable: <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      {total > 0 && (
        <div className="mt-5">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {chainShares.map((c) => (
              <div
                key={c.chainId}
                title={`${c.info.name} · ${fmtUsd(c.usd)}`}
                className="min-w-[3px]"
                style={{
                  background: c.info.color,
                  width: `${(c.usd / total) * 100}%`,
                }}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {chainShares.map((c) => (
              <li key={c.chainId} className="flex items-center gap-1.5 text-xs">
                <span className="size-2 rounded-full" style={{ background: c.info.color }} />
                <span className="text-[var(--fg-1)]">{c.info.name}</span>
                <span className="font-mono text-[var(--fg-2)] tabular-nums">
                  {((c.usd / total) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
          {families.map((fam) => {
            const r = byFamily[fam]
            const usd = r?.usd ?? 0
            const inactive = usd === 0
            return (
              <div key={fam} className="bg-card px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-[var(--fg-2)]">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: FAMILY_COLOR[fam], opacity: inactive ? 0.4 : 1 }}
                  />
                  {fam}
                </div>
                <div
                  className={cn(
                    'mt-1 font-mono text-sm font-medium tabular-nums',
                    inactive && 'text-[var(--fg-3)]',
                  )}
                >
                  {loading ? <Skeleton className="h-4 w-16" /> : fmtUsd(usd)}
                </div>
                <div className="text-2xs text-[var(--fg-3)]">
                  {r?.chains.length ?? 0} {r?.chains.length === 1 ? 'chain' : 'chains'}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

/* ── Health ────────────────────────────────────────────────── */

function HealthCard({
  health,
  loading,
  error,
}: {
  health?: Health
  loading: boolean
  error: boolean
}) {
  const ok = health?.status === 'ok'
  return (
    <Card className="p-5">
      <div className="text-sm text-[var(--fg-2)]">Gateway health</div>
      <div className="mt-2 flex items-center gap-2.5">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : error ? (
          <>
            <StatusDot tone="danger" />
            <span className="text-xl font-semibold tracking-[-0.015em]">Unreachable</span>
          </>
        ) : (
          <>
            <StatusDot tone={ok ? 'success' : 'warn'} pulse />
            <span className="text-xl font-semibold tracking-[-0.015em]">
              {ok ? 'Operational' : 'Degraded'}
            </span>
          </>
        )}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-2)]">
        Phase <span className="font-mono">{health?.phase ?? '—'}</span> · checked every 30s
      </div>
    </Card>
  )
}

/* ── Pool ──────────────────────────────────────────────────── */

function PoolCard({
  stats,
  loading,
}: {
  stats?: PoolStatsRow[]
  loading: boolean
}) {
  // UTXO is intentionally omitted: BTC/LTC mint a fresh BIP84 address per
  // invoice (privacy requirement) and never participate in the pool.
  const byFamily = Object.fromEntries((stats ?? []).map((s) => [s.family, s]))

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[var(--fg-2)]">Address pool</div>
        <Link
          to="/pool"
          className="text-xs text-[var(--fg-2)] hover:text-foreground"
        >
          Manage
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        {POOL_FAMILIES.map((fam) => {
          const s = byFamily[fam]
          const tot = s?.total ?? 0
          const av = s?.available ?? 0
          const pct = tot ? (av / tot) * 100 : 0
          const tone = av < LOW_POOL ? 'danger' : av < 6 ? 'warn' : 'success'
          const indicator =
            tone === 'danger'
              ? 'bg-destructive'
              : tone === 'warn'
                ? 'bg-warn'
                : 'bg-success'

          return (
            <div key={fam}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium uppercase tracking-[0.06em] text-[var(--fg-1)]">
                  <span className="size-2 rounded-full" style={{ background: FAMILY_COLOR[fam] }} />
                  {fam}
                </span>
                <span className="font-mono text-[var(--fg-2)] tabular-nums">
                  {loading ? '…' : (
                    <>
                      <span
                        className={cn(
                          'font-medium',
                          tone === 'danger' && 'text-destructive',
                          tone === 'warn' && 'text-warn',
                          tone === 'success' && 'text-foreground',
                        )}
                      >
                        {av}
                      </span>{' '}
                      free / {tot}
                    </>
                  )}
                </span>
              </div>
              <Progress value={pct} indicatorClassName={indicator} />
              <div className="mt-1 flex gap-3 text-2xs text-[var(--fg-3)]">
                <span>
                  allocated <span className="font-mono">{s?.allocated ?? 0}</span>
                </span>
                <span>
                  quarantined <span className="font-mono">{s?.quarantined ?? 0}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ── Top addresses ─────────────────────────────────────────── */

function TopAddressesCard({
  snapshot,
  loading,
}: {
  snapshot?: BalancesSnapshot
  loading: boolean
}) {
  const rows: Array<{
    address: string
    chainId: number
    usd: number
    token: string
    amountDecimal: string
  }> = []
  snapshot?.families.forEach((f) =>
    f.chains.forEach((c) =>
      c.addresses.forEach((a) => {
        const top = a.tokens[0]
        rows.push({
          address: a.address,
          chainId: c.chainId,
          usd: parseFloat(a.totalUsd),
          token: top?.token ?? '—',
          amountDecimal: top?.amountDecimal ?? '0',
        })
      }),
    ),
  )
  rows.sort((a, b) => b.usd - a.usd)
  const top = rows.slice(0, 8)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle>Largest pool addresses</CardTitle>
        <CardDescription>Top 8 by USD value across all chains</CardDescription>
      </CardHeader>
      {loading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <EmptyState
          compact
          icon={Waypoints}
          title="No balances yet"
          description="Funds received on pool addresses show up here once the first invoice is paid."
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[560px]">
            <THead>
              <tr>
                <Th>Address</Th>
                <Th>Chain</Th>
                <Th>Token</Th>
                <Th align="right">Amount</Th>
                <Th align="right">USD</Th>
              </tr>
            </THead>
            <TBody>
              {top.map((r, i) => {
                const info = chainInfo(r.chainId)
                return (
                  <Tr key={i}>
                    <Td>
                      <Addr value={r.address} />
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: info.color }}
                        />
                        {info.name}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{r.token}</Td>
                    <Td align="right" className="text-xs">
                      {fmtNum(r.amountDecimal)}
                    </Td>
                    <Td align="right" className="font-medium">
                      {fmtUsd(r.usd)}
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  )
}

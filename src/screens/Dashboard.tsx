import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Plus, RefreshCw, Terminal } from 'lucide-react'

import { api } from '@/lib/api'
import { chainInfo, FAMILY_COLOR } from '@/lib/chains'
import { fmtUsd, fmtNum } from '@/lib/format'
import type { BalancesSnapshot, Family, Health, PoolStatsRow } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Sparkline } from '@/components/Sparkline'
import { StatusDot } from '@/components/StatusDot'

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

export function DashboardPage() {
  const health = useQuery(HEALTH_Q)
  const pool = useQuery(POOL_Q)
  const bal = useQuery(BAL_Q)

  const poolTotals = React.useMemo(() => {
    const rows = pool.data?.stats ?? []
    const total = rows.reduce((s, r) => s + r.total, 0)
    const available = rows.reduce((s, r) => s + r.available, 0)
    return { total, available }
  }, [pool.data])

  const balSnap = bal.data?.snapshot
  const balTotal = balSnap ? parseFloat(balSnap.totalUsd) : 0

  return (
    <div className="fade-in space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Overview</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          {balSnap && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--muted-bg)] px-2 py-0.5 text-[11.5px] text-[var(--muted-fg)]">
              <StatusDot tone="success" />
              Last sync{' '}
              <span className="font-mono">
                {new Date(balSnap.generatedAt).toISOString().slice(11, 19)}Z
              </span>
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              health.refetch()
              pool.refetch()
              bal.refetch()
            }}
          >
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button size="sm">
            <Plus className="size-3.5" /> New invoice
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total balance (USD)"
          value={bal.isLoading ? '—' : fmtUsd(balTotal)}
          big
          sub={
            <span className="inline-flex items-center gap-1 text-success">
              <ArrowUp className="size-3" /> live
            </span>
          }
          spark={SPARK}
        />
        <KpiCard
          label="Health"
          loading={health.isLoading}
          value={
            <span className="inline-flex items-center gap-2">
              <StatusDot
                tone={health.data?.status === 'ok' ? 'success' : 'warn'}
                pulse
              />
              {health.data?.status === 'ok' ? 'OK' : (health.data?.status ?? '—')}
            </span>
          }
          sub={
            <>
              Phase <span className="font-mono">{health.data?.phase ?? '—'}</span>
            </>
          }
        />
        <KpiCard
          label="Active pool"
          value={
            pool.isLoading
              ? '—'
              : `${poolTotals.available} / ${poolTotals.total}`
          }
          sub={<>{pool.data?.stats.length ?? 0} families wired</>}
        />
        <KpiCard
          label="Pool availability"
          value={
            <span className="font-mono">
              {poolTotals.total
                ? Math.round((poolTotals.available / poolTotals.total) * 100)
                : 0}
              %
            </span>
          }
          sub={
            <Progress
              value={
                poolTotals.total
                  ? (poolTotals.available / poolTotals.total) * 100
                  : 0
              }
            />
          }
          subRaw
        />
      </div>

      {/* Balances + Pool */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <BalancesCard snapshot={balSnap} loading={bal.isLoading} />
        <PoolCard stats={pool.data?.stats} loading={pool.isLoading} />
      </div>

      {/* Top addresses + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <TopAddressesCard snapshot={balSnap} loading={bal.isLoading} />
        <ActivityCard />
      </div>

      <RuntimeCard />
    </div>
  )
}

const SPARK = [8.1, 8.4, 8.2, 8.9, 9.3, 9.1, 9.6, 9.8, 9.4, 10.0, 10.1, 9.8, 10.2, 10.23]

function KpiCard({
  label,
  value,
  sub,
  big,
  spark,
  subRaw,
  loading,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  big?: boolean
  spark?: number[]
  subRaw?: boolean
  loading?: boolean
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={
          big
            ? 'font-mono text-[30px] font-semibold leading-tight tracking-tight tabular-nums'
            : 'text-[22px] font-semibold leading-tight tracking-tight tabular-nums'
        }
      >
        {loading ? <span className="text-[var(--fg-3)]">—</span> : value}
      </div>
      <div className={subRaw ? '' : 'text-xs text-[var(--fg-2)]'}>{sub}</div>
      {spark && <Sparkline data={spark} />}
    </Card>
  )
}

function BalancesCard({
  snapshot,
  loading,
}: {
  snapshot?: BalancesSnapshot
  loading: boolean
}) {
  const families: Family[] = ['evm', 'tron', 'solana']
  const rows =
    snapshot?.families.map((f) => ({
      family: f.family,
      usd: parseFloat(f.totalUsd),
      chains: f.chains,
    })) ?? []
  const byFamily = Object.fromEntries(rows.map((r) => [r.family, r]))
  const total = parseFloat(snapshot?.totalUsd ?? '0')

  // Flatten chain shares across all families (sorted)
  const chainShares = rows
    .flatMap((r) =>
      r.chains.map((c) => ({
        chainId: c.chainId,
        usd: parseFloat(c.totalUsd),
        info: chainInfo(c.chainId),
      })),
    )
    .sort((a, b) => b.usd - a.usd)

  return (
    <Card className="p-5">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <CardTitle>Balances</CardTitle>
          <CardDescription className="mt-1">
            Per-family · gateway-owned addresses · source{' '}
            <span className="font-mono">db</span>
          </CardDescription>
        </div>
      </div>

      {/* Stacked bar */}
      {total > 0 && (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-md border border-border">
            {chainShares.map((c) => (
              <div
                key={c.chainId}
                title={`${c.info.name} · ${fmtUsd(c.usd)}`}
                style={{
                  background: c.info.color,
                  width: `${(c.usd / total) * 100}%`,
                }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
            {chainShares.map((c) => (
              <div
                key={c.chainId}
                className="flex items-center gap-1.5 text-xs"
              >
                <span
                  className="size-2 rounded-sm"
                  style={{ background: c.info.color }}
                />
                <span>{c.info.name}</span>
                <span className="font-mono text-[var(--fg-2)]">
                  {fmtUsd(c.usd)}
                </span>
                <span className="text-[11px] text-[var(--fg-3)]">
                  ({((c.usd / total) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Family blocks */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {families.map((fam) => {
          const r = byFamily[fam]
          const inactive = !r || r.usd === 0
          return (
            <div
              key={fam}
              className="rounded-[var(--radius-md)] border border-border p-3.5"
              style={{
                background: inactive ? 'transparent' : 'var(--bg-2)',
                opacity: inactive ? 0.7 : 1,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: FAMILY_COLOR[fam] }}
                  />
                  <span className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">
                    {fam}
                  </span>
                </div>
                {inactive && (
                  <span className="rounded-full border border-border bg-[var(--muted-bg)] px-1.5 py-0.5 text-[10px] text-[var(--muted-fg)]">
                    {loading ? '…' : 'no balance'}
                  </span>
                )}
              </div>
              <div className="mt-2.5 font-mono text-[22px] font-semibold tracking-tight">
                {fmtUsd(r?.usd ?? 0)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--fg-2)]">
                <span>
                  <span className="font-mono">{r?.chains.length ?? 0}</span> chains
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function PoolCard({
  stats,
  loading,
}: {
  stats?: PoolStatsRow[]
  loading: boolean
}) {
  const families: Family[] = ['evm', 'tron', 'solana']
  const byFamily = Object.fromEntries((stats ?? []).map((s) => [s.family, s]))

  return (
    <Card className="p-5">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <CardTitle>Address pool</CardTitle>
          <CardDescription className="mt-1">
            Available / allocated / quarantined
          </CardDescription>
        </div>
        <Button size="sm" variant="outline">
          <Plus className="size-3" /> Seed
        </Button>
      </div>

      <div className="space-y-3.5">
        {families.map((fam) => {
          const s = byFamily[fam]
          const tot = s?.total ?? 0
          const av = s?.available ?? 0
          const pct = tot ? (av / tot) * 100 : 0
          const tone = av < 3 ? 'danger' : av < 6 ? 'warn' : 'success'
          const indicator =
            tone === 'danger'
              ? 'bg-destructive'
              : tone === 'warn'
                ? 'bg-warn'
                : 'bg-success'

          return (
            <div key={fam}>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: FAMILY_COLOR[fam] }}
                  />
                  <span className="text-[13px] font-medium">
                    {fam.toUpperCase()}
                  </span>
                  <span
                    className={
                      'rounded-full border px-1.5 py-0.5 text-[10px] ' +
                      (tone === 'danger'
                        ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-destructive'
                        : tone === 'warn'
                          ? 'border-[var(--warn-border)] bg-[var(--warn-bg)] text-warn'
                          : 'border-[var(--success-border)] bg-[var(--success-bg)] text-success')
                    }
                  >
                    {loading ? '…' : `${av} available`}
                  </span>
                </div>
                <span className="font-mono text-xs text-[var(--fg-2)]">
                  {av}/{tot}
                </span>
              </div>
              <Progress value={pct} indicatorClassName={indicator} />
              <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-[var(--fg-2)]">
                <span>
                  alloc <span className="font-mono">{s?.allocated ?? 0}</span>
                </span>
                <span>
                  quar <span className="font-mono">{s?.quarantined ?? 0}</span>
                </span>
                <span className="flex-1" />
                <span>
                  idx{' '}
                  <span className="font-mono">{s?.highestIndex ?? 0}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

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
    <Card className="overflow-hidden p-0">
      <CardHeader className="border-b">
        <CardTitle>Top pool addresses</CardTitle>
        <CardDescription>Sorted by USD balance</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--fg-2)]">Loading…</div>
        ) : top.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-2)]">
            No balances yet.
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left">
                <Th>Address</Th>
                <Th>Chain</Th>
                <Th>Token</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">USD</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => {
                const info = chainInfo(r.chainId)
                return (
                  <tr
                    key={i}
                    className="transition-colors hover:bg-[var(--bg-2)]"
                  >
                    <Td>
                      <Addr value={r.address} />
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-[7px] rounded-full"
                          style={{ background: info.color }}
                        />
                        {info.name}
                      </span>
                    </Td>
                    <Td className="font-mono text-[12.5px]">{r.token}</Td>
                    <Td className="text-right font-mono text-[12.5px]">
                      {fmtNum(r.amountDecimal)}
                    </Td>
                    <Td className="text-right font-mono font-semibold">
                      {fmtUsd(r.usd)}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={
        'border-b border-border bg-card px-3.5 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-[var(--fg-2)] ' +
        className
      }
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td className={'border-b border-border px-3.5 py-3 align-middle ' + className}>
      {children}
    </td>
  )
}

function ActivityCard() {
  // Placeholder — gateway doesn't expose a generic event stream endpoint.
  return (
    <Card className="flex flex-col p-0">
      <CardHeader className="border-b">
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Wire this to your event log once one exists.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center p-10 text-center">
        <div className="space-y-2 text-sm text-[var(--fg-2)]">
          <div>Activity stream will appear here.</div>
          <div className="text-xs text-[var(--fg-3)]">
            Derive from <span className="font-mono">/admin/webhook-deliveries</span>{' '}
            + webhook outbox in a later phase.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RuntimeCard() {
  const items = [
    { label: 'Runtime', value: 'CF Workers', sub: 'edge · global' },
    { label: 'DB adapter', value: '—', sub: 'read from gateway config' },
    { label: 'Price oracle', value: '—', sub: 'chain: gateway-defined' },
    { label: 'Rate limit', value: 'per-route', sub: 'dashboard + gateway proxy' },
  ]
  return (
    <Card className="p-5">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <CardTitle>Runtime</CardTitle>
          <CardDescription>Configuration and infrastructure</CardDescription>
        </div>
        <Button size="sm" variant="outline">
          <Terminal className="size-3" /> Open logs
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.map((it) => (
          <div key={it.label}>
            <div className="eyebrow">{it.label}</div>
            <div className="mt-1.5 font-mono text-[15px] font-semibold">
              {it.value}
            </div>
            <div className="mt-0.5 text-xs text-[var(--fg-2)]">{it.sub}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

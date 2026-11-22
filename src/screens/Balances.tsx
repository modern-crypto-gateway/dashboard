import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Coins,
  Database,
  Fuel,
  RefreshCw,
  Satellite,
  Scale,
  Wallet,
} from '@/components/icons'

import { api } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtLocal, fmtNum, fmtRel, fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BalancesSnapshot } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainIcon, FamilyIcon, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, TableCard, TableToolbar, usePaged } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { ReconcileDialog } from '@/components/ReconcileDialog'
import { EmptyState, ErrorState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { Donut, Segmented, SegmentedBar, compactUsd, type Slice } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'

type Mode = 'db' | 'rpc'
type FamilyRow = BalancesSnapshot['families'][number]
type ChainRow = FamilyRow['chains'][number]

/** Token amount with grouping, up to 4 decimals. */
const fmtAmt = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : fmtNum(v)
}

const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function BalancesPage() {
  const [mode, setMode] = React.useState<Mode>('db')
  const [reconcileOpen, setReconcileOpen] = React.useState(false)
  const q = useQuery({
    queryKey: ['balances', mode] as const,
    queryFn: () =>
      api<{ snapshot: BalancesSnapshot; cached: boolean }>(
        `/api/gw/admin/balances${mode === 'rpc' ? '?live=true' : ''}`,
      ),
    staleTime: mode === 'rpc' ? 60_000 : 5_000,
    refetchInterval: mode === 'rpc' ? false : 60_000,
  })

  const snap = q.data?.snapshot

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Balances"
        description="Funds on gateway addresses"
        actions={
          <>
            <span title="Live RPC probes every wired chain — slower, authoritative.">
              <Segmented<Mode>
                ariaLabel="Balance source"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'db', label: 'Ledger' },
                  { value: 'rpc', label: 'Live RPC' },
                ]}
              />
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              onClick={() => setReconcileOpen(true)}
              title="Compare on-chain balances to the settled ledger and snap any drift"
            >
              <Scale className="size-4" />
              Reconcile
            </Button>
          </>
        }
      />

      <ReconcileDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        onApplied={() => setMode('db')}
      />

      {q.isLoading ? (
        <BalancesSkeleton />
      ) : q.isError ? (
        <ErrorState
          title="Could not load balances"
          message={q.error instanceof Error ? q.error.message : 'Error'}
        />
      ) : !snap ? null : (
        <>
          <PortfolioCard snapshot={snap} cached={q.data!.cached} />

          {snap.families.length === 0 ? (
            <EmptyState
              framed
              icon={Wallet}
              title="No balances yet"
              description="Nothing is held on gateway addresses."
            />
          ) : (
            <HoldingsTable snapshot={snap} mode={mode} />
          )}
        </>
      )}
    </div>
  )
}

/* ── hero ─────────────────────────────────────────────────── */

/**
 * One portfolio card: the headline number with its provenance, where the
 * money sits (pool vs fee wallets), what it's held in (asset mix) and on
 * which networks (donut). No duplicated family/chain breakdowns.
 */
function PortfolioCard({ snapshot, cached }: { snapshot: BalancesSnapshot; cached: boolean }) {
  const total = num(snapshot.totalUsd)
  let pool = 0
  let fee = 0
  let addrCount = 0
  for (const f of snapshot.families)
    for (const c of f.chains)
      for (const a of c.addresses) {
        addrCount++
        if (a.kind === 'fee') fee += num(a.totalUsd)
        else pool += num(a.totalUsd)
      }
  const generated = Math.floor(Date.parse(snapshot.generatedAt) / 1000)
  const chainCount = snapshot.families.reduce((a, f) => a + f.chains.length, 0)

  // Asset mix: same token across chains folds together.
  const byToken = new Map<string, number>()
  for (const f of snapshot.families)
    for (const c of f.chains)
      for (const t of c.tokens) byToken.set(t.token, (byToken.get(t.token) ?? 0) + num(t.usd))
  const tokensSorted = [...byToken.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const tokenHead = tokensSorted.slice(0, 5)
  const tokenRest = tokensSorted.slice(5).reduce((a, [, v]) => a + v, 0)
  const tokenColors = ['var(--chart-1-fill)', 'var(--chart-2)', 'var(--chart-3)', '#3ba7c9', '#e87ba4']
  const assetParts = [
    ...tokenHead.map(([sym, v], i) => ({ key: sym, name: sym, value: v, color: tokenColors[i] })),
    ...(tokenRest > 0 ? [{ key: 'other', name: 'Other', value: tokenRest, color: 'var(--chart-muted)' }] : []),
  ]

  const [whole, cents] = fmtUsd(total).split('.')
  const slices = chainSlices(snapshot)
  const sliceTotal = slices.reduce((a, s) => a + s.value, 0)
  const pct = (v: number, of: number) => (of ? Math.round((v / of) * 100) : 0)
  const pctLabel = (v: number, of: number) => {
    const p = of ? (v / of) * 100 : 0
    return p > 0 && p < 1 ? '<1%' : p > 99 && p < 100 ? '>99%' : `${Math.round(p)}%`
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Left: the number and the asset mix */}
        <div className="flex flex-col p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--fg-2)]">Total balance</span>
            <StatusPill
              tone={snapshot.source === 'rpc' ? 'info' : 'wait'}
              size="sm"
              icon={snapshot.source === 'rpc' ? Satellite : Database}
            >
              <span title={fmtLocal(snapshot.generatedAt, { seconds: true })}>
                {snapshot.source === 'rpc' ? 'Live' : 'Ledger'} · {fmtRel(generated)}
                {cached ? ' · cached' : ''}
              </span>
            </StatusPill>
          </div>

          <div className="figure mt-3 text-3xl font-semibold tracking-[-0.035em]">
            {whole}
            <span className="text-[var(--fg-3)]">.{cents ?? '00'}</span>
          </div>
          <div className="mt-1 text-sm text-[var(--fg-2)]">
            <span className="figure">{addrCount}</span> addresses on{' '}
            <span className="figure">{chainCount}</span> chains
          </div>

          <dl className="mt-6 grid grid-cols-2 divide-x divide-border rounded-xl border border-border">
            <Split icon={Wallet} label="Pool" value={pool} share={pctLabel(pool, pool + fee)} />
            <Split icon={Fuel} label="Fee wallets" value={fee} share={pctLabel(fee, pool + fee)} />
          </dl>

          <div className="mt-6">
            <div className="mb-2.5 flex items-center justify-between text-sm">
              <span className="font-medium">Held in</span>
              <span className="text-xs text-[var(--fg-3)]">{byToken.size} assets</span>
            </div>
            <SegmentedBar className="h-2.5" parts={assetParts} />
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {assetParts.map((p) => (
                <li key={p.key} className="flex min-w-0 items-center gap-2 text-sm">
                  {p.key === 'other' ? (
                    <span className="size-4 shrink-0 rounded-full bg-[var(--chart-muted)]" />
                  ) : (
                    <TokenIcon symbol={p.key} size={16} />
                  )}
                  <span className="truncate text-[var(--fg-1)]">{p.name}</span>
                  <span className="figure ml-auto font-medium">{compactUsd(p.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: networks */}
        <div className="border-t border-border bg-[var(--bg-2)]/50 p-6 sm:p-7 lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">By network</span>
            <span className="text-xs text-[var(--fg-3)]">{chainCount} chains</span>
          </div>
          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row lg:flex-col xl:flex-row">
            <Donut
              slices={slices}
              size={152}
              thickness={16}
              center={
                <div>
                  <div className="figure text-base font-semibold">{compactUsd(sliceTotal)}</div>
                  <div className="text-2xs text-[var(--fg-3)]">{slices.length} networks</div>
                </div>
              }
            />
            <ul className="w-full min-w-0 space-y-2.5">
              {slices.map((s) => (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  {s.key === 'other' ? (
                    <span className="size-4 shrink-0 rounded-full bg-[var(--chart-muted)]" />
                  ) : (
                    <ChainIcon chainId={Number(s.key)} size={16} />
                  )}
                  <span className="truncate text-[var(--fg-1)]">{s.name}</span>
                  <span className="ml-auto h-1 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--chart-muted)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct(s.value, sliceTotal)}%`, background: s.color }}
                    />
                  </span>
                  <span className="figure w-14 text-right font-medium">{compactUsd(s.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Split({
  icon: Icon,
  label,
  value,
  share,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  share: string
}) {
  return (
    <div className="px-4 py-3.5">
      <dt className="flex items-center gap-1.5 text-xs text-[var(--fg-2)]">
        <Icon className="size-3.5" />
        {label}
        <span className="figure ml-auto text-[var(--fg-3)]">{share}</span>
      </dt>
      <dd className="figure mt-1 text-lg font-semibold">{fmtUsd(value)}</dd>
    </div>
  )
}

function chainSlices(snapshot: BalancesSnapshot): Slice[] {
  const all = snapshot.families
    .flatMap((f) =>
      f.chains.map((c) => {
        const info = chainInfo(c.chainId)
        return { key: String(c.chainId), name: info.name, value: num(c.totalUsd), color: info.color }
      }),
    )
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
  if (all.length <= 6) return all
  const head = all.slice(0, 5)
  const rest = all.slice(5).reduce((a, s) => a + s.value, 0)
  return [...head, { key: 'other', name: 'Other', value: rest, color: 'var(--chart-muted)' }]
}

/* ── holdings table ───────────────────────────────────────── */

function HoldingsTable({ snapshot, mode }: { snapshot: BalancesSnapshot; mode: Mode }) {
  const [open, setOpen] = React.useState<Set<number>>(() => new Set())
  const total = num(snapshot.totalUsd)
  const chainCount = snapshot.families.reduce((a, f) => a + f.chains.length, 0)
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <TableCard toolbar={<TableToolbar title="Holdings" count={chainCount} />}>
      <TableWrap>
        <Table className="min-w-[760px]">
          <THead>
            <tr>
              <Th>Network</Th>
              <Th>Tokens</Th>
              <Th align="right">Addresses</Th>
              <Th align="right">Share</Th>
              <Th align="right">Value</Th>
            </tr>
          </THead>
          <TBody>
            {snapshot.families.map((f) => (
              <React.Fragment key={f.family}>
                <tr>
                  <td
                    colSpan={5}
                    className="border-b border-border bg-[var(--bg-2)] px-6 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <FamilyIcon family={f.family} size={16} />
                      <span className="font-semibold uppercase">{f.family}</span>
                      <span className="figure text-xs text-[var(--fg-3)]">{f.chains.length}</span>
                      <span className="figure ml-auto font-semibold">{fmtUsd(f.totalUsd)}</span>
                    </div>
                  </td>
                </tr>
                {f.chains.length === 0 && (
                  <tr>
                    <td colSpan={5} className="border-b border-border px-6 py-4 text-sm text-[var(--fg-3)]">
                      No chain balances
                    </td>
                  </tr>
                )}
                {f.chains.map((c) => (
                  <ChainRows
                    key={c.chainId}
                    chain={c}
                    total={total}
                    mode={mode}
                    open={open.has(c.chainId)}
                    onToggle={() => toggle(c.chainId)}
                  />
                ))}
              </React.Fragment>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </TableCard>
  )
}

function ChainRows({
  chain: c,
  total,
  mode,
  open,
  onToggle,
}: {
  chain: ChainRow
  total: number
  mode: Mode
  open: boolean
  onToggle: () => void
}) {
  const usd = num(c.totalUsd)
  const share = total ? (usd / total) * 100 : 0
  const info = chainInfo(c.chainId)
  const lead = [...c.tokens].sort((a, b) => num(b.usd) - num(a.usd))
  return (
    <>
      <Tr
        interactive
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
      >
        <Td>
          <div className="flex min-w-0 items-center gap-3">
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-[var(--fg-3)] transition-transform duration-200',
                open && 'rotate-90',
              )}
            />
            <TokenOnChain symbol={lead[0]?.token ?? info.short} chainId={c.chainId} size={32} />
            <div className="min-w-0">
              <div className="truncate font-medium">{info.name}</div>
              {mode === 'rpc' && c.errors > 0 && (
                <StatusPill tone="warn" size="sm" className="mt-0.5">
                  {c.errors} RPC error{c.errors === 1 ? '' : 's'}
                </StatusPill>
              )}
            </div>
          </div>
        </Td>
        <Td>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {lead.slice(0, 3).map((t) => (
              <span key={t.token} className="inline-flex items-center gap-1.5 text-sm" title={fmtUsd(t.usd)}>
                <TokenIcon symbol={t.token} size={16} />
                <span className="figure">{fmtAmt(t.amountDecimal)}</span>
                <span className="text-xs text-[var(--fg-2)]">{t.token}</span>
              </span>
            ))}
            {lead.length > 3 && (
              <span className="figure text-xs text-[var(--fg-3)]">+{lead.length - 3}</span>
            )}
            {lead.length === 0 && <span className="text-[var(--fg-3)]">—</span>}
          </div>
        </Td>
        <Td align="right" className="text-[var(--fg-2)]">
          {c.addresses.length}
        </Td>
        <Td align="right">
          <div className="ml-auto flex w-28 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--chart-muted)]">
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: info.color }} />
            </div>
            <span className="w-9 text-xs text-[var(--fg-2)]">{share.toFixed(0)}%</span>
          </div>
        </Td>
        <Td align="right" className="font-semibold">
          {fmtUsd(usd)}
        </Td>
      </Tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-border bg-[var(--bg-2)] px-6 py-4">
            <ChainDetail chain={c} />
          </td>
        </tr>
      )}
    </>
  )
}

function ChainDetail({ chain: c }: { chain: ChainRow }) {
  const rows = React.useMemo(
    () => [...c.addresses].sort((a, b) => num(b.totalUsd) - num(a.totalUsd)),
    [c.addresses],
  )
  const paged = usePaged(rows, 25)
  return (
    <div className="fade-in space-y-4">
      {c.tokens.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {c.tokens.map((t) => (
            <div key={t.token} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <TokenIcon symbol={t.token} size={24} />
              <div className="min-w-0">
                <div className="figure truncate text-sm font-semibold">
                  {fmtAmt(t.amountDecimal)} <span className="font-normal text-[var(--fg-2)]">{t.token}</span>
                </div>
                <div className="figure text-xs text-[var(--fg-2)]">{fmtUsd(t.usd)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <EmptyState compact icon={Coins} title="No per-address rows" />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[620px]">
                <THead>
                  <tr>
                    <Th>Address</Th>
                    <Th>Kind</Th>
                    <Th>Holdings</Th>
                    <Th align="right">Value</Th>
                  </tr>
                </THead>
                <TBody>
                  {paged.rows.map((a) => (
                    <Tr key={a.address + a.kind}>
                      <Td>
                        <Addr value={a.address} chainId={c.chainId} />
                      </Td>
                      <Td>
                        <span
                          className="inline-flex items-center gap-1.5 text-sm text-[var(--fg-1)]"
                          title={a.kind === 'fee' ? 'Fee wallet' : 'Pool address'}
                        >
                          {a.kind === 'fee' ? (
                            <Fuel className="size-4 text-[var(--fg-2)]" />
                          ) : (
                            <Wallet className="size-4 text-[var(--fg-2)]" />
                          )}
                          {a.kind === 'fee' ? 'Fee' : 'Pool'}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {a.tokens.map((t) => (
                            <span key={t.token} className="inline-flex items-center gap-1.5 text-sm">
                              <TokenIcon symbol={t.token} size={14} />
                              <span className="figure">{fmtAmt(t.amountDecimal)}</span>
                            </span>
                          ))}
                        </div>
                      </Td>
                      <Td align="right" className="font-medium">
                        {fmtUsd(a.totalUsd)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            {paged.total > paged.pageSize && (
              <div className="border-t border-border px-6 py-3">
                <Pager
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hasNext={paged.page < paged.pageCount - 1}
                  onPage={paged.setPage}
                  noun="addresses"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ── loading ──────────────────────────────────────────────── */

function BalancesSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="space-y-4 p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-48" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <Skeleton className="h-2 w-full" />
        </Card>
        <Card className="flex flex-col items-center gap-5 p-6">
          <Skeleton className="size-[168px] rounded-full" />
          <Skeleton className="h-4 w-full" />
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="h-14 border-b border-border" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-6 py-4 last:border-0">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </Card>
    </div>
  )
}

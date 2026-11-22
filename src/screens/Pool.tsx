import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Layers,
  LifeBuoy,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo, FAMILY_COLOR } from '@/lib/chains'
import { useHeldQueue } from '@/lib/held'
import type {
  Family,
  MoneroPoolStatsResponse,
  MoneroPoolStatsRow,
  PoolAuditResponse,
  PoolStatsRow,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ConsolidateDialog } from '@/components/ConsolidateDialog'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function PoolPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['pool-stats'] as const,
    queryFn: () => api<{ stats: PoolStatsRow[] }>('/api/gw/admin/pool/stats'),
    refetchInterval: 30_000,
  })
  // Monero is a separate pool (subaddress-indexed, not HD-derived) with its
  // own endpoint. 404 means the gateway build doesn't have Monero wired —
  // suppress retries so the page works on non-Monero deployments.
  const moneroQ = useQuery({
    queryKey: ['pool-stats', 'monero'] as const,
    queryFn: () =>
      api<MoneroPoolStatsResponse>('/api/gw/admin/monero-pool/stats'),
    refetchInterval: 30_000,
    retry: false,
  })
  const moneroRows: MoneroPoolStatsRow[] = moneroQ.data?.stats ?? []
  const moneroAvailable = moneroQ.isSuccess
  const [consolidateOpen, setConsolidateOpen] = React.useState(false)

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow="Treasury"
        title="Address pool"
        description={
          <>
            HD-derived receive addresses per family. Watch availability — a family
            running dry triggers <span className="font-mono">POOL_EXHAUSTED</span>{' '}
            on invoice create.
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={'size-3.5' + (q.isFetching ? ' animate-spin' : '')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsolidateOpen(true)}
              title="Defragment a token balance scattered across pool addresses"
            >
              <Layers className="size-3.5" />
              Consolidate
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                to="/consolidation-schedules"
                title="Recurring auto-consolidation per (chain, token)"
              >
                <CalendarClock className="size-3.5" />
                Schedules
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                to="/pool/addresses"
                title="Browse, park, or re-enable individual pool addresses"
              >
                <ListChecks className="size-3.5" />
                Manage addresses
              </Link>
            </Button>
            <SeedDialog
              onSuccess={() => qc.invalidateQueries({ queryKey: ['pool-stats'] })}
            />
            {moneroAvailable && (
              <MoneroSeedDialog
                onSuccess={() =>
                  qc.invalidateQueries({ queryKey: ['pool-stats', 'monero'] })
                }
              />
            )}
          </>
        }
      />

      <ConsolidateDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        onPlanned={() =>
          qc.invalidateQueries({ queryKey: ['pool-stats'] })
        }
      />

      <HeldLegsBanner />

      <PoolAuditCard />

      {q.isLoading ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-busy="true"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-1.5 w-full" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            </Card>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState
          title="Could not load pool stats"
          message={q.error instanceof Error ? q.error.message : 'Error'}
        />
      ) : (q.data?.stats.length ?? 0) === 0 ? (
        <EmptyState
          framed
          icon={Waypoints}
          title="No pool families configured"
          description="Seed a family to get started."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(q.data?.stats ?? []).map((s) => (
            <PoolFamilyCard key={s.family} s={s} />
          ))}
          {moneroRows.map((row) => (
            <MoneroPoolCard key={row.chainId} stats={row} />
          ))}
        </div>
      )}
    </div>
  )
}

function PoolFamilyCard({ s }: { s: PoolStatsRow }) {
  const pct = s.total ? (s.available / s.total) * 100 : 0
  const tone = s.available < 3 ? 'danger' : s.available < 6 ? 'warn' : 'success'
  const indicator =
    tone === 'danger'
      ? 'bg-destructive'
      : tone === 'warn'
        ? 'bg-warn'
        : 'bg-success'
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: FAMILY_COLOR[s.family] }}
          />
          <span className="text-sm font-semibold uppercase tracking-[0.06em]">
            {s.family}
          </span>
        </div>
        <Badge
          variant={
            tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'success'
          }
        >
          {s.available} avail
        </Badge>
      </div>
      <div className="mt-4 font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {s.available}
        <span className="ml-1 text-base font-medium text-[var(--fg-2)]">/ {s.total}</span>
      </div>
      <div className="mt-3">
        <Progress value={pct} indicatorClassName={indicator} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MetricCell label="allocated" value={s.allocated} />
        <MetricCell label="quarantined" value={s.quarantined} />
        <MetricCell label="highest idx" value={s.highestIndex ?? 0} />
      </div>
    </Card>
  )
}

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-[var(--bg-2)] px-2 py-1.5">
      <div className="truncate text-2xs uppercase tracking-[0.06em] text-[var(--fg-2)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function MoneroPoolCard({ stats }: { stats: MoneroPoolStatsRow }) {
  const { chainId, total, available, allocated, quarantined } = stats
  const info = chainInfo(chainId)
  const pct = total ? (available / total) * 100 : 0
  const tone = available < 3 ? 'danger' : available < 6 ? 'warn' : 'success'
  const indicator =
    tone === 'danger'
      ? 'bg-destructive'
      : tone === 'warn'
        ? 'bg-warn'
        : 'bg-success'
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: FAMILY_COLOR.monero }}
          />
          <span className="truncate text-sm font-semibold uppercase tracking-[0.06em]">
            {info.short || 'monero'}
          </span>
          <Badge variant="outline" className="text-2xs" title="Monero uses subaddress derivation, not an HD pool">
            subaddress
          </Badge>
        </div>
        <Badge
          variant={
            tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'success'
          }
        >
          {available} avail
        </Badge>
      </div>
      <div className="mt-4 font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {available}
        <span className="ml-1 text-base font-medium text-[var(--fg-2)]">/ {total}</span>
      </div>
      <div className="mt-3">
        <Progress value={pct} indicatorClassName={indicator} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MetricCell label="allocated" value={allocated} />
        <MetricCell label="quarantined" value={quarantined} />
        <MetricCell label="highest idx" value={stats.highestIndex ?? 0} />
      </div>
    </Card>
  )
}

function SeedDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = React.useState(false)
  // UTXO omitted on purpose: BTC/LTC derive fresh addresses per invoice
  // (privacy requirement) and don't use a pool. Backend accepts `utxo`
  // here but returns zero rows, which would only confuse operators.
  const [families, setFamilies] = React.useState<Family[]>(['evm', 'tron', 'solana'])
  const [initialSize, setInitialSize] = React.useState('10')

  const seed = useMutation({
    mutationFn: () =>
      api<{
        results: Array<{
          family: Family
          status: 'seeded' | 'already-sufficient' | 'skipped-no-adapter'
          added: number
        }>
      }>('/api/gw/admin/pool/initialize', {
        method: 'POST',
        body: JSON.stringify({
          families,
          initialSize: parseInt(initialSize, 10),
        }),
      }),
    onSuccess: (res) => {
      const added = res.results.reduce((s, r) => s + r.added, 0)
      const summary = res.results
        .map((r) => `${r.family}: ${r.status}${r.added ? ` (+${r.added})` : ''}`)
        .join('  ·  ')
      toast.success(added ? `Seeded ${added} addresses` : 'No new addresses needed', {
        description: summary,
      })
      onSuccess()
      setOpen(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Seed failed'),
  })

  const toggle = (f: Family) =>
    setFamilies((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f],
    )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" /> Seed pool
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Seed address pool</DialogTitle>
          <DialogDescription>
            Idempotent. Families already at or above the target return{' '}
            <span className="font-mono">already-sufficient</span>.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            seed.mutate()
          }}
        >
          <Field label="Families">
            <div className="flex flex-wrap gap-2">
              {(['evm', 'tron', 'solana'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggle(f)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs font-medium uppercase tracking-[0.06em] transition-colors cursor-pointer',
                    families.includes(f)
                      ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary'
                      : 'border-border text-[var(--fg-2)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Target size" hint="Each selected family is topped up to this count.">
            <Input
              type="number"
              min={1}
              max={500}
              value={initialSize}
              onChange={(e) => setInitialSize(e.target.value)}
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={seed.isPending || families.length === 0}
            >
              {seed.isPending ? 'Seeding…' : 'Seed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MoneroSeedDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [initialSize, setInitialSize] = React.useState('20')

  const seed = useMutation({
    mutationFn: () =>
      api<{ added?: number; total?: number }>(
        '/api/gw/admin/monero-pool/initialize',
        {
          method: 'POST',
          body: JSON.stringify({ initialSize: parseInt(initialSize, 10) }),
        },
      ),
    onSuccess: (res) => {
      const added = res.added ?? 0
      toast.success(
        added > 0
          ? `Seeded ${added} Monero subaddress${added === 1 ? '' : 'es'}`
          : 'Monero pool already at target',
        res.total != null
          ? { description: `Pool now holds ${res.total} subaddresses.` }
          : undefined,
      )
      onSuccess()
      setOpen(false)
    },
    onError: (e: ApiError) =>
      toast.error(e.message || 'Monero seed failed'),
  })

  const sizeNum = parseInt(initialSize, 10)
  const sizeValid = Number.isFinite(sizeNum) && sizeNum >= 1 && sizeNum <= 500

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          title="Monero uses subaddress derivation, not an HD pool"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: FAMILY_COLOR.monero }}
          />
          Seed Monero
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: FAMILY_COLOR.monero }}
            />
            Seed Monero subaddress pool
          </DialogTitle>
          <DialogDescription>
            Reserves additional subaddresses derived from the gateway's Monero
            primary key. Distinct from the HD address pool — Monero invoices
            use a single view-key with per-invoice subaddress indices.
            Idempotent: a pool already at or above the target is left alone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            seed.mutate()
          }}
        >
          <Field
            label="Target size"
            hint="The pool is topped up to this many spare subaddresses. Cap 500."
          >
            <Input
              type="number"
              min={1}
              max={500}
              value={initialSize}
              onChange={(e) => setInitialSize(e.target.value)}
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={seed.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={seed.isPending || !sizeValid}>
              {seed.isPending ? 'Seeding…' : 'Seed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── held legs banner ────────────────────────────────────── */

/**
 * Surfaces the payout recovery queue right where consolidations are launched:
 * a stalled sweep (ambiguous broadcast) lands in `GET /admin/payouts/held` and
 * needs an operator to confirm the OUT hash. Hidden when the queue is clear.
 */
function HeldLegsBanner() {
  const held = useHeldQueue({ refetchInterval: 30_000 })
  const count = held.data?.count ?? 0
  if (count === 0) return null
  return (
    <Link
      to="/held-payouts"
      className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm transition-colors hover:border-warn focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <LifeBuoy className="size-4 shrink-0 text-warn" />
      <span className="font-medium text-foreground">
        <span className="font-mono font-semibold tabular-nums">{count}</span> payout leg
        {count === 1 ? '' : 's'} held for recovery
      </span>
      <span className="text-[var(--fg-2)]">
        — a consolidation sweep may have stalled mid-broadcast.
      </span>
      <span className="ml-auto inline-flex items-center gap-1 font-medium text-warn">
        Review
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

/* ── pool audit ──────────────────────────────────────────── */

function PoolAuditCard() {
  const audit = useMutation({
    mutationFn: () => api<PoolAuditResponse>('/api/gw/admin/pool/audit'),
    onSuccess: (res) => {
      if (res.status === 'healthy') {
        toast.success('Pool audit clean', {
          description: 'Every row matches the current MASTER_SEED derivation.',
        })
      } else {
        const total = res.reports.reduce(
          (n, r) => n + r.mismatches.length,
          0,
        )
        toast.warning(`${total} mismatch${total === 1 ? '' : 'es'} detected`, {
          description: 'See the breakdown below.',
        })
      }
    },
    onError: (e: ApiError) => toast.error(e.message || 'Audit failed'),
  })

  const data = audit.data
  const totalMismatches =
    data?.reports.reduce((n, r) => n + r.mismatches.length, 0) ?? 0
  const totalUnscanned =
    data?.reports.reduce((n, r) => n + r.unscannedBeyondLimit, 0) ?? 0

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-[var(--fg-2)]" />
              Seed-derivation audit
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Re-derives every pool row's expected address from the current{' '}
              <span className="font-mono">MASTER_SEED</span> and reports
              mismatches. Run before funding a fresh pool, after any deploy
              that might have rotated the seed, or when a payout fails with a
              signer-mismatch error. Read-only.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => audit.mutate()}
            disabled={audit.isPending}
          >
            {audit.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {audit.isPending ? 'Auditing…' : 'Run audit'}
          </Button>
        </div>
      </CardHeader>
      {data && (
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {data.status === 'healthy' ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" /> healthy
              </Badge>
            ) : (
              <Badge variant="warn">
                <AlertTriangle className="size-3" /> mismatches detected
              </Badge>
            )}
            <span className="text-xs text-[var(--fg-2)]">
              <span className="font-mono tabular-nums">{totalMismatches}</span> mismatch
              {totalMismatches === 1 ? '' : 'es'} ·{' '}
              <span className="font-mono">scanLimit {data.scanLimit}</span>
              {totalUnscanned > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-warn">
                    {totalUnscanned} row{totalUnscanned === 1 ? '' : 's'}{' '}
                    beyond limit
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.reports.map((r) => (
              <FamilyAuditCard key={r.family} report={r} />
            ))}
          </div>
          {totalMismatches > 0 && <MismatchList data={data} />}
        </CardContent>
      )}
    </Card>
  )
}

function FamilyAuditCard({
  report,
}: {
  report: PoolAuditResponse['reports'][number]
}) {
  const ok = report.mismatches.length === 0
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        ok
          ? 'border-border bg-[var(--bg-2)]'
          : 'border-[var(--warn-border)] bg-[var(--warn-bg)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: FAMILY_COLOR[report.family] }}
          />
          <span className="text-xs font-semibold uppercase tracking-[0.06em]">
            {report.family}
          </span>
        </div>
        {ok ? (
          <Badge variant="success">
            <CheckCircle2 className="size-3" /> clean
          </Badge>
        ) : (
          <Badge variant="warn">
            {report.mismatches.length} bad
          </Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <AuditCell label="scanned" value={report.scanned} />
        <AuditCell label="matches" value={report.matches} tone="success" />
        <AuditCell
          label="beyond"
          value={report.unscannedBeyondLimit}
          tone={report.unscannedBeyondLimit > 0 ? 'warn' : undefined}
        />
      </div>
    </div>
  )
}

function AuditCell({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'success' | 'warn'
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-2 py-1.5">
      <div className="truncate text-2xs uppercase tracking-[0.06em] text-[var(--fg-2)]">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-mono text-sm font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function MismatchList({ data }: { data: PoolAuditResponse }) {
  const rows = data.reports.flatMap((r) =>
    r.mismatches.map((m) => ({ ...m, family: r.family })),
  )
  if (rows.length === 0) return null
  return (
    <div className="mt-5">
      <div className="eyebrow mb-2">Mismatched rows</div>
      <TableWrap className="rounded-md border border-border">
        <Table className="min-w-[520px]">
          <THead>
            <tr>
              <Th>Family</Th>
              <Th align="right">Index</Th>
              <Th>Stored</Th>
              <Th>Expected</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((m) => (
              <Tr key={`${m.family}-${m.addressIndex}`}>
                <Td>
                  <Badge variant="outline" className="uppercase">
                    {m.family}
                  </Badge>
                </Td>
                <Td align="right" className="text-xs">
                  {m.addressIndex}
                </Td>
                <Td>
                  <Addr value={m.storedAddress} />
                </Td>
                <Td>
                  <Addr value={m.expectedAddress} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  )
}

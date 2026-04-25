import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { FAMILY_COLOR } from '@/lib/chains'
import type {
  Family,
  PoolAuditResponse,
  PoolStatsRow,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
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
import { cn } from '@/lib/utils'

export function PoolPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['pool-stats'] as const,
    queryFn: () => api<{ stats: PoolStatsRow[] }>('/api/gw/admin/pool/stats'),
    refetchInterval: 30_000,
  })

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Address pool
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            HD-derived receive addresses per family. Watch availability — a family
            running dry triggers <span className="font-mono">POOL_EXHAUSTED</span>{' '}
            on invoice create.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={'size-3.5' + (q.isFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
          <SeedDialog
            onSuccess={() => qc.invalidateQueries({ queryKey: ['pool-stats'] })}
          />
        </div>
      </div>

      <PoolAuditCard />


      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : q.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : 'Error'}
        </Card>
      ) : (q.data?.stats.length ?? 0) === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
            <Waypoints className="size-5 text-[var(--fg-2)]" />
          </div>
          <div className="mt-3 text-sm text-[var(--fg-1)]">
            No pool families configured.
          </div>
          <p className="mt-1 text-xs text-[var(--fg-2)]">
            Seed a family to get started.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(q.data?.stats ?? []).map((s) => (
            <PoolFamilyCard key={s.family} s={s} />
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: FAMILY_COLOR[s.family] }}
          />
          <span className="font-semibold uppercase tracking-[0.08em] text-[13px]">
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
      <div className="mt-4 font-mono text-[28px] font-semibold leading-none tracking-tight">
        {s.available}
        <span className="ml-1 text-base text-[var(--fg-2)]">/ {s.total}</span>
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
    <div className="rounded-md border border-border bg-[var(--bg-2)] px-2 py-1.5">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-[var(--fg-2)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono font-semibold">{value}</div>
    </div>
  )
}

function SeedDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = React.useState(false)
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
            <div className="flex gap-2">
              {(['evm', 'tron', 'solana'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggle(f)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium uppercase tracking-wider transition-colors cursor-pointer',
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
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
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
        <CardContent className="pt-5">
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
              <span className="font-mono">{totalMismatches}</span> mismatch
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
          : 'border-warn/40 bg-warn/10',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: FAMILY_COLOR[report.family] }}
          />
          <span className="font-semibold uppercase tracking-[0.08em] text-[12.5px]">
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
    <div className="rounded border border-border bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-2)]">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-mono text-sm font-semibold',
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
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--bg-2)] text-[10.5px] uppercase tracking-wider text-[var(--fg-3)]">
              <th className="px-3 py-2 text-left font-medium">Family</th>
              <th className="px-3 py-2 text-left font-medium">Index</th>
              <th className="px-3 py-2 text-left font-medium">Stored</th>
              <th className="px-3 py-2 text-left font-medium">Expected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr
                key={`${m.family}-${m.addressIndex}`}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2 align-top">
                  <Badge variant="outline" className="uppercase">
                    {m.family}
                  </Badge>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs">
                  {m.addressIndex}
                </td>
                <td className="px-3 py-2 align-top">
                  <Addr value={m.storedAddress} />
                </td>
                <td className="px-3 py-2 align-top">
                  <Addr value={m.expectedAddress} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

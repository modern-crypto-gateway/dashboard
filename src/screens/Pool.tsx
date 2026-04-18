import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, RefreshCw, Waypoints } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { FAMILY_COLOR } from '@/lib/chains'
import type { Family, PoolStatsRow } from '@/lib/types'

import { Field } from '@/components/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

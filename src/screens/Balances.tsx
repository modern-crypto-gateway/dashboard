import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Database,
  RefreshCw,
  Satellite,
  Scale,
  Wallet,
} from '@/components/icons'

import { api } from '@/lib/api'
import { chainInfo, FAMILY_COLOR } from '@/lib/chains'
import { fmtLocalTime, fmtUsd, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BalancesSnapshot, Family } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { PageHeader } from '@/components/PageHeader'
import { ReconcileDialog } from '@/components/ReconcileDialog'
import { EmptyState, ErrorState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type Mode = 'db' | 'rpc'

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
  const total = snap ? parseFloat(snap.totalUsd) : 0

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow="Treasury"
        title="Balances"
        description="Gateway-owned addresses, totaled by family / chain / address. Switch to live RPC for an authoritative snapshot — it costs a round-trip to every wired chain."
        actions={
          <>
            <ModeSwitch mode={mode} onChange={setMode} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReconcileOpen(true)}
              title="Compare on-chain balances to the settled ledger and snap any drift"
            >
              <Scale className="size-3.5" />
              Reconcile
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={'size-3.5' + (q.isFetching ? ' animate-spin' : '')} />
              Refresh
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
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
            <div className="min-w-0">
              <div className="eyebrow">Grand total</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
                {fmtUsd(total)}
              </div>
              <div className="mt-1.5 text-xs text-[var(--fg-2)]">
                sourced <span className="font-mono">{snap.source}</span>
                {q.data!.cached && (
                  <span className="ml-2 font-mono text-[var(--fg-3)]">(cached)</span>
                )}
                {' · '}generated{' '}
                <span className="font-mono">
                  {fmtLocalTime(snap.generatedAt)}
                </span>
              </div>
            </div>
            <div className="hidden h-12 w-px bg-border sm:block" />
            <div className="min-w-0 basis-full sm:basis-auto sm:min-w-[200px] sm:flex-1">
              <StackedBar snapshot={snap} />
            </div>
          </Card>

          <div className="space-y-4">
            {snap.families.map((f) => (
              <FamilyCard key={f.family} family={f} mode={mode} />
            ))}
            {snap.families.length === 0 && (
              <EmptyState
                framed
                icon={Wallet}
                title="No balances recorded"
                description="Nothing is held on gateway-owned addresses yet."
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (m: Mode) => void
}) {
  const items: Array<{ key: Mode; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'db', label: 'DB', Icon: Database },
    { key: 'rpc', label: 'RPC (live)', Icon: Satellite },
  ]
  return (
    <div className="inline-flex h-8 items-center rounded-md border border-border bg-card p-0.5">
      {items.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          aria-pressed={mode === key}
          className={cn(
            'inline-flex h-full items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors cursor-pointer',
            mode === key
              ? 'bg-[var(--bg-active)] text-foreground'
              : 'text-[var(--fg-2)] hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  )
}

function StackedBar({ snapshot }: { snapshot: BalancesSnapshot }) {
  const shares = snapshot.families
    .flatMap((f) =>
      f.chains.map((c) => ({
        chainId: c.chainId,
        usd: parseFloat(c.totalUsd),
        info: chainInfo(c.chainId),
      })),
    )
    .filter((x) => x.usd > 0)
    .sort((a, b) => b.usd - a.usd)
  const total = parseFloat(snapshot.totalUsd)
  if (total === 0 || shares.length === 0)
    return <div className="text-xs text-[var(--fg-2)]">—</div>

  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-md border border-border">
        {shares.map((s) => (
          <div
            key={s.chainId}
            title={`${s.info.name} · ${fmtUsd(s.usd)}`}
            style={{
              background: s.info.color,
              width: `${(s.usd / total) * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {shares.map((s) => (
          <div
            key={s.chainId}
            className="flex items-center gap-1.5 text-xs"
          >
            <ChainPill chainId={s.chainId} />
            <span className="font-mono tabular-nums text-[var(--fg-2)]">{fmtUsd(s.usd)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FamilyCard({
  family,
  mode,
}: {
  family: BalancesSnapshot['families'][number]
  mode: Mode
}) {
  const [expanded, setExpanded] = React.useState<number | null>(
    family.chains[0]?.chainId ?? null,
  )
  const totalUsd = parseFloat(family.totalUsd)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: FAMILY_COLOR[family.family as Family] }}
          />
          <div className="text-sm font-semibold uppercase tracking-[0.06em]">
            {family.family}
          </div>
        </div>
        <div className="font-mono text-lg font-semibold tabular-nums">
          {fmtUsd(totalUsd)}
        </div>
        <Badge variant="default" className="ml-auto">
          {family.chains.length} chain{family.chains.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <CardContent className="p-0">
        {family.chains.length === 0 && (
          <EmptyState compact title="No chain balances" />
        )}
        <div className="divide-y divide-border">
          {family.chains.map((c) => {
            const isOpen = expanded === c.chainId
            return (
              <div key={c.chainId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((cur) => (cur === c.chainId ? null : c.chainId))
                  }
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-[var(--fg-2)]" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-[var(--fg-2)]" />
                  )}
                  <ChainPill
                    chainId={c.chainId}
                    className="text-sm font-medium text-foreground"
                  />
                  <span className="ml-auto flex min-w-0 items-center gap-3 font-mono text-xs tabular-nums">
                    {c.tokens
                      .slice(0, 3)
                      .map((t) => (
                        <span key={t.token} className="hidden text-[var(--fg-2)] md:inline">
                          {fmtNum(t.amountDecimal)} {t.token}
                        </span>
                      ))}
                    <span className="font-semibold">{fmtUsd(c.totalUsd)}</span>
                  </span>
                  {c.errors > 0 && mode === 'rpc' && (
                    <Badge variant="warn">
                      {c.errors} RPC err
                    </Badge>
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-[var(--bg-2)] px-5 py-3">
                    <div className="grid gap-2">
                      {c.addresses.map((a) => (
                        <div
                          key={a.address + a.kind}
                          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2 break-all">
                            <Badge variant={a.kind === 'fee' ? 'accent' : 'default'}>
                              {a.kind}
                            </Badge>
                            <Addr value={a.address} truncated={false} />
                          </div>
                          <div className="min-w-0 flex-1 font-mono text-xs tabular-nums text-[var(--fg-2)]">
                            {a.tokens
                              .map((t) => `${fmtNum(t.amountDecimal)} ${t.token}`)
                              .join(' · ')}
                          </div>
                          <div className="font-mono font-semibold tabular-nums">
                            {fmtUsd(a.totalUsd)}
                          </div>
                        </div>
                      ))}
                      {c.addresses.length === 0 && (
                        <div className="py-3 text-center text-xs text-[var(--fg-2)]">
                          No per-address rows.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function BalancesSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="min-w-[200px] flex-1 space-y-2.5">
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </Card>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <div className="flex items-center gap-4 border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-28" />
          </div>
          {Array.from({ length: 3 }).map((_, j) => (
            <div
              key={j}
              className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-0"
            >
              <Skeleton className="h-3.5 w-32" />
              <div className="flex-1" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}

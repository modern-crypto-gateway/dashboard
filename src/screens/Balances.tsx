import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Database,
  RefreshCw,
  Satellite,
} from 'lucide-react'

import { api } from '@/lib/api'
import { chainInfo, FAMILY_COLOR } from '@/lib/chains'
import { fmtUsd, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BalancesSnapshot, Family } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Mode = 'db' | 'rpc'

export function BalancesPage() {
  const [mode, setMode] = React.useState<Mode>('db')
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Balances</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Gateway-owned addresses, totaled by family / chain / address. Switch
            to live RPC for an authoritative snapshot — it costs a round-trip to
            every wired chain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitch mode={mode} onChange={setMode} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={'size-3.5' + (q.isFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : q.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : 'Error'}
        </Card>
      ) : !snap ? null : (
        <>
          <Card className="flex flex-wrap items-center gap-4 p-5">
            <div>
              <div className="eyebrow">Grand total</div>
              <div className="mt-1 font-mono text-[34px] font-semibold leading-none tracking-tight">
                {fmtUsd(total)}
              </div>
              <div className="mt-1 text-xs text-[var(--fg-2)]">
                sourced <span className="font-mono">{snap.source}</span>
                {q.data!.cached && (
                  <span className="ml-2 font-mono text-[var(--fg-3)]">(cached)</span>
                )}
                {' · '}generated{' '}
                <span className="font-mono">
                  {new Date(snap.generatedAt).toISOString().slice(11, 19)}Z
                </span>
              </div>
            </div>
            <div className="h-12 w-px bg-border" />
            <div className="min-w-[200px] flex-1">
              <StackedBar snapshot={snap} />
            </div>
          </Card>

          <div className="space-y-4">
            {snap.families.map((f) => (
              <FamilyCard key={f.family} family={f} mode={mode} />
            ))}
            {snap.families.length === 0 && (
              <Card className="p-10 text-center text-sm text-[var(--fg-2)]">
                No balances recorded.
              </Card>
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
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {items.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
            mode === key
              ? 'bg-secondary text-foreground shadow-xs'
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
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {shares.map((s) => (
          <div
            key={s.chainId}
            className="flex items-center gap-1.5 text-xs"
          >
            <span
              className="size-2 rounded-sm"
              style={{ background: s.info.color }}
            />
            <span>{s.info.name}</span>
            <span className="font-mono text-[var(--fg-2)]">{fmtUsd(s.usd)}</span>
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
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span
            className="size-3 rounded-sm"
            style={{ background: FAMILY_COLOR[family.family as Family] }}
          />
          <div className="font-semibold tracking-tight uppercase tracking-[0.08em] text-[13px]">
            {family.family}
          </div>
        </div>
        <div className="font-mono text-xl font-semibold">
          {fmtUsd(totalUsd)}
        </div>
        <Badge variant="outline" className="ml-auto">
          {family.chains.length} chain{family.chains.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <CardContent className="p-0">
        {family.chains.length === 0 && (
          <div className="p-5 text-center text-xs text-[var(--fg-2)]">
            No chain balances.
          </div>
        )}
        <div className="divide-y divide-border">
          {family.chains.map((c) => {
            const info = chainInfo(c.chainId)
            const isOpen = expanded === c.chainId
            return (
              <div key={c.chainId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((cur) => (cur === c.chainId ? null : c.chainId))
                  }
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-2)] cursor-pointer"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3.5 text-[var(--fg-2)]" />
                  ) : (
                    <ChevronRight className="size-3.5 text-[var(--fg-2)]" />
                  )}
                  <span
                    className="size-2 rounded-full"
                    style={{ background: info.color }}
                  />
                  <span className="font-medium">{info.name}</span>
                  <span className="ml-auto flex items-center gap-3 font-mono text-[12.5px]">
                    {c.tokens
                      .slice(0, 3)
                      .map((t) => (
                        <span key={t.token} className="text-[var(--fg-2)]">
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
                  <div className="border-t border-border bg-[var(--bg-0)] px-5 py-3">
                    <div className="grid gap-2">
                      {c.addresses.map((a) => (
                        <div
                          key={a.address + a.kind}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant={a.kind === 'fee' ? 'accent' : 'default'}>
                              {a.kind}
                            </Badge>
                            <Addr value={a.address} truncated={false} />
                          </div>
                          <div className="font-mono text-xs text-[var(--fg-2)]">
                            {a.tokens
                              .map((t) => `${fmtNum(t.amountDecimal)} ${t.token}`)
                              .join(' · ')}
                          </div>
                          <div className="font-mono font-semibold">
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


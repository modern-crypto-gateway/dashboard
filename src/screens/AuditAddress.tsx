import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Calendar,
  CheckCircle2,
  Database,
  Hash,
  Layers,
  Plus,
  Search,
  WalletIcon,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtLocalDate } from '@/lib/format'
import type { AuditResult, ChainInventoryEntry } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainIcon } from '@/components/CryptoIcon'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

export function AuditAddressPage() {
  const [chainId, setChainId] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [sinceDays, setSinceDays] = React.useState('30')

  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  })
  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )
  // Default to the first option once chainOptions loads. Render-time
  // setState is safe: the condition becomes false on the next render.
  if (!chainId && chainOptions.length > 0) {
    setChainId(String(chainOptions[0].chainId))
  }

  const audit = useMutation({
    mutationFn: () => {
      const sinceMs = Date.now() - parseInt(sinceDays || '0', 10) * 86_400_000
      return api<{ audit: AuditResult }>('/api/gw/admin/audit-address', {
        method: 'POST',
        body: JSON.stringify({
          chainId: parseInt(chainId, 10),
          address,
          sinceMs,
        }),
      })
    },
    onSuccess: (res) => {
      toast.success(
        res.audit.inserted > 0
          ? `Inserted ${res.audit.inserted} tx${res.audit.inserted === 1 ? '' : 's'}`
          : 'No new transactions',
      )
    },
    onError: (e: ApiError) => toast.error(e.message || 'Audit failed'),
  })

  return (
    <div className="fade-in space-y-8">
      <PageHeader title="Audit address" description="Recover missed on-chain transfers" />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <CardHead
            icon={Search}
            title="Run audit"
            sub="Missing transfers land as orphans or credit an open invoice."
          />
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              audit.mutate()
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label="Chain">
                <Select
                  value={chainId}
                  onValueChange={setChainId}
                  disabled={chainsQ.isLoading || chainOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        chainsQ.isLoading
                          ? 'Loading…'
                          : chainOptions.length === 0
                            ? 'No wired chains'
                            : 'Select chain'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {chainOptions.map((c) => (
                      <SelectItem key={c.chainId} value={String(c.chainId)}>
                        <span className="flex items-center gap-2">
                          <ChainIcon chainId={c.chainId} size={16} />
                          <span>{c.displayName}</span>
                          <span className="font-mono text-xs text-[var(--fg-3)]">
                            {c.chainId}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Lookback (days)" hint="Adapter-clamped.">
                <Input
                  value={sinceDays}
                  onChange={(e) => setSinceDays(e.target.value)}
                  inputMode="numeric"
                  className="figure"
                />
              </Field>
            </div>
            <Field label="Address">
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono"
                required
              />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--fg-2)]">
                Idempotent — known txs are skipped.
              </span>
              <Button
                type="submit"
                disabled={
                  audit.isPending || !/^\d+$/.test(chainId) || address.trim().length < 8
                }
              >
                <Search className="size-4" />
                {audit.isPending ? 'Auditing…' : 'Run audit'}
              </Button>
            </div>
          </form>
        </Card>

        {audit.isPending ? (
          <ResultSkeleton />
        ) : audit.data ? (
          <ResultCard key={JSON.stringify(audit.data.audit)} result={audit.data.audit} />
        ) : (
          <Card>
            <EmptyState
              icon={Database}
              title="No audit yet"
              description="Results show up here."
            />
          </Card>
        )}
      </div>
    </div>
  )
}

function CardHead({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-[var(--fg-2)]">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

function ResultCard({ result }: { result: AuditResult }) {
  const info = chainInfo(result.chainId)
  return (
    <Card className="fade-in p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChainIcon chainId={result.chainId} size={32} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Result</h2>
            <div className="text-sm text-[var(--fg-2)]">{info.name}</div>
          </div>
        </div>
        {result.inserted > 0 ? (
          <StatusPill tone="info" icon={Plus}>
            {result.inserted} recovered
          </StatusPill>
        ) : (
          <StatusPill tone="ok">In sync</StatusPill>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
        <MiniStat label="Scanned" value={result.scanned} />
        <MiniStat label="Inserted" value={result.inserted} />
        <MiniStat label="Present" value={result.alreadyPresent} />
      </div>

      <dl className="mt-5 divide-y divide-border rounded-xl border border-border">
        <Fact icon={Layers} label="Chain">
          <span className="font-mono text-xs">{result.chainId}</span>
        </Fact>
        <Fact icon={WalletIcon} label="Address">
          <Addr value={result.address} chainId={result.chainId} className="justify-end" />
        </Fact>
        <Fact icon={Calendar} label="Since">
          {fmtLocalDate(result.sinceMs)}
        </Fact>
      </dl>

      {result.insertedTxIds.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="size-4 text-[var(--st-ok)]" />
            Newly inserted
          </h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {result.insertedTxIds.map((id) => (
              <li key={id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Hash className="size-4 shrink-0 text-[var(--fg-3)]" />
                <Addr value={id} truncated={false} className="flex-1" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs text-[var(--fg-2)]">{label}</div>
      <div className="figure mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  )
}

/** One row of a details list: icon · label on the left, value on the right. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-[var(--fg-2)]">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right">{children}</dd>
    </div>
  )
}

function ResultSkeleton() {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="mt-6 h-16 w-full rounded-xl" />
      <Skeleton className="mt-5 h-32 w-full rounded-xl" />
    </Card>
  )
}

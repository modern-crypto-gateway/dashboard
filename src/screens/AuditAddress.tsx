import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  CheckCircle2,
  Database,
  ExternalLink,
  Hash,
  Layers,
  ListChecks,
  Plus,
  Search,
  WalletIcon,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtLocalDate, formatUnits } from '@/lib/format'
import { useMerchants } from '@/lib/merchants'
import { cn } from '@/lib/utils'
import type { AuditResult, AuditTransfer, ChainInventoryEntry } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/States'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
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

const InvoiceSheet = React.lazy(() =>
  import('@/screens/Invoices').then((m) => ({ default: m.InvoiceDetailSheet })),
)

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
          <ResultCard
            key={JSON.stringify(audit.data.audit)}
            result={audit.data.audit}
            decimalsOf={(token) =>
              chainsQ.data?.chains
                .find((c) => c.chainId === audit.data.audit.chainId)
                ?.tokens.find((t) => t.symbol.toUpperCase() === token.toUpperCase())?.decimals ?? null
            }
          />
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

function ResultCard({ result, decimalsOf }: { result: AuditResult; decimalsOf: (token: string) => number | null }) {
  const info = chainInfo(result.chainId)
  const navigate = useNavigate()
  const merchants = useMerchants()
  const storeName = (id: string | null) =>
    (id && merchants.data?.merchants.find((m) => m.id === id)?.name) || null
  const [openInvoice, setOpenInvoice] = React.useState<{ merchantId: string; invoiceId: string } | null>(null)

  const transfers = result.transfers ?? null
  const stats = React.useMemo(() => {
    const s = { credited: 0, invoices: new Set<string>(), awaiting: 0, orphanOpen: 0, dismissed: 0, reverted: 0, unknown: 0 }
    for (const t of transfers ?? []) {
      const o = outcomeOf(t)
      if (o === 'credited' || o === 'awaiting') {
        if (o === 'credited') s.credited++
        else s.awaiting++
        if (t.invoiceId) s.invoices.add(t.invoiceId)
      } else if (o === 'orphan') s.orphanOpen++
      else if (o === 'dismissed') s.dismissed++
      else if (o === 'reverted') s.reverted++
      else s.unknown++
    }
    return s
  }, [transfers])

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
        {stats.orphanOpen > 0 ? (
          <StatusPill tone="warn">
            {stats.orphanOpen} orphan{stats.orphanOpen === 1 ? '' : 's'} to review
          </StatusPill>
        ) : result.inserted > 0 ? (
          <StatusPill tone="info" icon={Plus}>
            {result.inserted} recovered
          </StatusPill>
        ) : (
          <StatusPill tone="ok">In sync</StatusPill>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
        <MiniStat label="Found on chain" value={result.scanned} />
        <MiniStat label="New (recovered)" value={result.inserted} />
        <MiniStat label="Already known" value={result.alreadyPresent} />
      </div>
      {transfers && (
        <div className="mt-2 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
          <MiniStat
            label="Credited to invoices"
            value={
              <span>
                {stats.credited + stats.awaiting}
                {stats.invoices.size > 0 && (
                  <span className="ml-1 text-xs font-normal text-[var(--fg-2)]">
                    · {stats.invoices.size} invoice{stats.invoices.size === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            }
          />
          <MiniStat
            label="Orphans to review"
            value={<span className={stats.orphanOpen > 0 ? 'text-warn' : undefined}>{stats.orphanOpen}</span>}
          />
          <MiniStat label="Dismissed / reverted" value={stats.dismissed + stats.reverted} />
        </div>
      )}

      <dl className="mt-5 divide-y divide-border rounded-xl border border-border">
        <Fact icon={Layers} label="Chain">
          <span className="inline-flex items-center gap-1.5">
            <ChainIcon chainId={result.chainId} size={16} />
            {info.name}
          </span>
        </Fact>
        <Fact icon={WalletIcon} label="Address">
          <Addr value={result.address} chainId={result.chainId} className="justify-end" />
        </Fact>
        <Fact icon={Calendar} label="Since">
          {fmtLocalDate(result.sinceMs)}
        </Fact>
      </dl>

      {transfers && transfers.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-4 text-[var(--fg-2)]" />
            What happened to each transfer
          </h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {transfers.map((t) => (
              <TransferRow
                key={`${t.txHash}:${t.logIndex ?? ''}`}
                t={t}
                chainId={result.chainId}
                decimals={decimalsOf(t.token)}
                store={storeName(t.merchantId)}
                onOpenInvoice={() => t.invoiceId && t.merchantId && setOpenInvoice({ merchantId: t.merchantId, invoiceId: t.invoiceId })}
                onOpenOrphan={() =>
                  navigate(`/orphans?q=${encodeURIComponent(t.txHash)}${t.transactionId ? `&open=${encodeURIComponent(t.transactionId)}` : ''}`)
                }
              />
            ))}
          </ul>
          {result.transfersTruncated && (
            <p className="text-xs text-[var(--fg-2)]">Showing the first 500 transfers.</p>
          )}
        </div>
      )}

      {!transfers && result.insertedTxIds.length > 0 && (
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

      <React.Suspense fallback={null}>
        {openInvoice && (
          <InvoiceSheet
            merchantId={openInvoice.merchantId}
            invoiceId={openInvoice.invoiceId}
            onOpenChange={(o) => !o && setOpenInvoice(null)}
          />
        )}
      </React.Suspense>
    </Card>
  )
}

type Outcome = 'credited' | 'awaiting' | 'orphan' | 'dismissed' | 'reverted' | 'unknown'

function outcomeOf(t: AuditTransfer): Outcome {
  if (t.status === 'reverted') return 'reverted'
  if (t.invoiceId && t.status === 'confirmed') return 'credited'
  if (t.invoiceId && t.status === 'detected') return 'awaiting'
  if (t.status === 'orphaned' || (!t.invoiceId && t.status)) return t.dismissed ? 'dismissed' : 'orphan'
  return 'unknown'
}

const OUTCOME: Record<Outcome, { label: string; tone: StatusTone }> = {
  credited: { label: 'Credited to invoice', tone: 'ok' },
  awaiting: { label: 'Linked · awaiting confirmations', tone: 'run' },
  orphan: { label: 'Orphan · needs review', tone: 'warn' },
  dismissed: { label: 'Orphan · dismissed', tone: 'off' },
  reverted: { label: 'Reverted · not a valid payment', tone: 'bad' },
  unknown: { label: 'Not recorded', tone: 'off' },
}

function TransferRow({
  t,
  chainId,
  decimals,
  store,
  onOpenInvoice,
  onOpenOrphan,
}: {
  t: AuditTransfer
  chainId: number
  decimals: number | null
  store: string | null
  onOpenInvoice: () => void
  onOpenOrphan: () => void
}) {
  const o = outcomeOf(t)
  const amount = decimals != null ? formatUnits(t.amountRaw, decimals) : t.amountRaw
  const when = t.onchainTime ?? null
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <TokenOnChain symbol={t.token} chainId={chainId} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="figure font-semibold">
              {amount}{' '}
              <span className="font-normal text-[var(--fg-2)]">
                {t.token}
                {decimals == null && ' (base units)'}
              </span>
            </span>
            {t.amountUsd && <span className="text-xs text-[var(--fg-2)]">≈ ${Number(t.amountUsd).toFixed(2)}</span>}
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase',
                t.outcome === 'inserted'
                  ? 'bg-[var(--accent-bg)] text-[var(--accent-ink)]'
                  : 'bg-[var(--muted-bg)] text-[var(--fg-2)]',
              )}
            >
              {t.outcome === 'inserted' ? 'New' : 'Already known'}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--fg-2)]">
            <Addr value={t.txHash} chainId={chainId} kind="tx" />
            {when && <span>{fmtLocalDate(when)}</span>}
          </div>
        </div>
        <StatusPill tone={OUTCOME[o].tone}>{OUTCOME[o].label}</StatusPill>
      </div>

      {(o === 'credited' || o === 'awaiting') && t.invoiceId && (
        <div className="ml-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-0)] px-3 py-2 text-xs">
          <span className="min-w-0 text-[var(--fg-2)]">
            Invoice{' '}
            <span className="font-mono text-[var(--fg-1)]">{t.externalId || `${t.invoiceId.slice(0, 8)}…`}</span>
            {store && <> · {store}</>}
            {t.invoiceStatus && <> · {t.invoiceStatus}</>}
          </span>
          <Button size="sm" variant="outline" onClick={onOpenInvoice} disabled={!t.merchantId}>
            <ExternalLink className="size-3.5" /> Open invoice
          </Button>
        </div>
      )}
      {o === 'orphan' && (
        <div className="ml-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs">
          <span className="text-[var(--fg-2)]">
            Not linked to any invoice. Credit it to the right invoice, or dismiss it, from Orphan transactions.
          </span>
          <Button size="sm" variant="outline" onClick={onOpenOrphan}>
            <ExternalLink className="size-3.5" /> Open in Orphans
          </Button>
        </div>
      )}
      {o === 'reverted' && (
        <div className="ml-10 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--fg-2)]">
          The chain's own record did not prove this as a payment to this address, so it was not credited.
        </div>
      )}
    </li>
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

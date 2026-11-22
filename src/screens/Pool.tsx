import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  CalendarClock,
  Hash,
  Layers,
  LifeBuoy,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { useHeldQueue } from '@/lib/held'
import type {
  Family,
  MoneroPoolStatsResponse,
  MoneroPoolStatsRow,
  PoolAuditResponse,
  PoolStatsRow,
} from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { ConsolidateDialog } from '@/components/ConsolidateDialog'
import { ChainIcon, FamilyIcon } from '@/components/CryptoIcon'
import { Pager, TableCard, TableToolbar, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState } from '@/components/States'
import { Status, StatusPill, type StatusTone } from '@/components/StatusPill'
import { SegmentedBar } from '@/components/charts'
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
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'

/* Meter colours shared by the tiles, cards and legend. */
const METER = {
  available: 'var(--st-ok-dot)',
  allocated: 'var(--st-run-dot)',
  quarantined: 'var(--st-wait-dot)',
} as const

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
  const [seedOpen, setSeedOpen] = React.useState(false)
  const [moneroSeedOpen, setMoneroSeedOpen] = React.useState(false)

  const stats = q.data?.stats ?? []
  const totals = [...stats, ...moneroRows].reduce(
    (a, s) => ({
      available: a.available + s.available,
      allocated: a.allocated + s.allocated,
      quarantined: a.quarantined + s.quarantined,
      total: a.total + s.total,
    }),
    { available: 0, allocated: 0, quarantined: 0, total: 0 },
  )
  const lowFamilies = [...stats, ...moneroRows].filter((s) => s.available < 6).length

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Address pool"
        description="Receive addresses per family"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link
                to="/pool/addresses"
                title="Browse, park, or re-enable individual pool addresses"
              >
                <ListChecks className="size-4" />
                Addresses
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsolidateOpen(true)}
              title="Defragment a token balance scattered across pool addresses"
            >
              <Layers className="size-4" />
              Consolidate
            </Button>
            <Button size="sm" onClick={() => setSeedOpen(true)}>
              <Plus className="size-4" /> Seed pool
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More actions" title="More">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link to="/consolidation-schedules">
                    <CalendarClock /> Schedules
                  </Link>
                </DropdownMenuItem>
                {moneroAvailable && (
                  <DropdownMenuItem onSelect={() => setMoneroSeedOpen(true)}>
                    <ChainIcon chainId={1000} size={16} /> Seed Monero
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => q.refetch()} disabled={q.isFetching}>
                  <RefreshCw /> Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <SeedDialog
        open={seedOpen}
        onOpenChange={setSeedOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['pool-stats'] })}
      />
      {moneroAvailable && (
        <MoneroSeedDialog
          open={moneroSeedOpen}
          onOpenChange={setMoneroSeedOpen}
          onSuccess={() =>
            qc.invalidateQueries({ queryKey: ['pool-stats', 'monero'] })
          }
        />
      )}

      <ConsolidateDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        onPlanned={() =>
          qc.invalidateQueries({ queryKey: ['pool-stats'] })
        }
      />

      <HeldLegsBanner />

      {q.isLoading ? (
        <PoolSkeleton />
      ) : q.isError ? (
        <ErrorState
          title="Could not load pool stats"
          message={q.error instanceof Error ? q.error.message : 'Error'}
        />
      ) : stats.length === 0 ? (
        <EmptyState
          framed
          icon={Waypoints}
          title="No pool families"
          description="Seed a family to get started."
          action={
            <Button size="sm" onClick={() => setSeedOpen(true)}>
              <Plus className="size-4" /> Seed pool
            </Button>
          }
        />
      ) : (
        <>
          <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Available" value={totals.available} sub={`of ${totals.total} addresses`}>
              <SegmentedBar
                parts={[
                  { key: 'a', name: 'Available', value: totals.available, color: METER.available },
                  { key: 'l', name: 'Allocated', value: totals.allocated, color: METER.allocated },
                  { key: 'q', name: 'Parked', value: totals.quarantined, color: METER.quarantined },
                ]}
              />
            </Tile>
            <Tile label="Allocated" value={totals.allocated} sub="Serving invoices" />
            <Tile label="Parked" value={totals.quarantined} sub="Quarantined" />
            <Tile
              label="Running low"
              value={lowFamilies}
              sub={lowFamilies ? 'Families under 6 free' : 'All families healthy'}
              tone={lowFamilies ? 'warn' : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <PoolMeterCard
                key={s.family}
                icon={<FamilyIcon family={s.family} size={28} />}
                name={s.family.toUpperCase()}
                row={s}
              />
            ))}
            {moneroRows.map((row) => (
              <PoolMeterCard
                key={row.chainId}
                icon={<ChainIcon chainId={row.chainId} size={28} />}
                name={chainInfo(row.chainId).short || 'XMR'}
                tag="Subaddress"
                row={row}
              />
            ))}
          </div>
        </>
      )}

      <PoolAuditSection />
    </div>
  )
}

/* ── tiles + family cards ────────────────────────────────── */

function Tile({
  label,
  value,
  sub,
  tone,
  children,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'warn'
  children?: React.ReactNode
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="text-sm text-[var(--fg-2)]">{label}</div>
      <div className={cn('figure mt-2 text-xl font-semibold', tone === 'warn' && 'text-[var(--st-warn)]')}>
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-[var(--fg-2)]">{sub}</div>}
      {children && <div className="mt-auto pt-4">{children}</div>}
    </Card>
  )
}

function healthOf(available: number): { tone: StatusTone; label: string } {
  if (available < 3) return { tone: 'bad', label: 'Critical' }
  if (available < 6) return { tone: 'warn', label: 'Low' }
  return { tone: 'ok', label: 'Healthy' }
}

function PoolMeterCard({
  icon,
  name,
  tag,
  row,
}: {
  icon: React.ReactNode
  name: string
  tag?: string
  row: { available: number; allocated: number; quarantined: number; total: number; highestIndex?: number }
}) {
  const h = healthOf(row.available)
  const parts = [
    { key: 'available', name: 'Available', value: row.available, color: METER.available },
    { key: 'allocated', name: 'Allocated', value: row.allocated, color: METER.allocated },
    { key: 'quarantined', name: 'Parked', value: row.quarantined, color: METER.quarantined },
  ]
  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            {tag && (
              <Badge variant="outline" title="Monero uses subaddress derivation, not an HD pool">
                {tag}
              </Badge>
            )}
          </div>
        </div>
        <StatusPill tone={h.tone} size="sm">
          {h.label}
        </StatusPill>
      </div>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="figure text-2xl font-semibold tracking-[-0.03em]">{row.available}</span>
        <span className="figure text-sm text-[var(--fg-2)]">free of {row.total}</span>
      </div>

      <SegmentedBar className="mt-4 h-2" parts={parts} />

      <ul className="mt-4 space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            <span className="text-[var(--fg-1)]">{p.name}</span>
            <span className="figure ml-auto font-medium">{p.value}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-border pt-2 text-[var(--fg-2)]">
          <Hash className="size-3.5" />
          <span>Highest index</span>
          <span className="figure ml-auto">{row.highestIndex ?? 0}</span>
        </li>
      </ul>
    </Card>
  )
}

function PoolSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-16 w-full" />
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ── seed dialogs ────────────────────────────────────────── */

function SeedDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
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
      onOpenChange(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Seed failed'),
  })

  const toggle = (f: Family) =>
    setFamilies((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f],
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" /> Seed address pool
          </DialogTitle>
          <DialogDescription>
            Idempotent — families at target are left alone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            seed.mutate()
          }}
        >
          <Field label="Families">
            <div className="grid grid-cols-3 gap-2">
              {(['evm', 'tron', 'solana'] as const).map((f) => {
                const on = families.includes(f)
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggle(f)}
                    aria-pressed={on}
                    className={cn(
                      'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border text-sm font-medium uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      on
                        ? 'border-foreground bg-[var(--bg-active)] text-foreground'
                        : 'border-border text-[var(--fg-2)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <FamilyIcon family={f} size={18} />
                    {f}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Target size" hint="Each family is topped up to this count.">
            <Input
              type="number"
              min={1}
              max={500}
              value={initialSize}
              onChange={(e) => setInitialSize(e.target.value)}
              className="figure"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={seed.isPending || families.length === 0}
            >
              {seed.isPending && <Loader2 className="size-4 animate-spin" />}
              {seed.isPending ? 'Seeding…' : 'Seed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MoneroSeedDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
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
      onOpenChange(false)
    },
    onError: (e: ApiError) =>
      toast.error(e.message || 'Monero seed failed'),
  })

  const sizeNum = parseInt(initialSize, 10)
  const sizeValid = Number.isFinite(sizeNum) && sizeNum >= 1 && sizeNum <= 500

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChainIcon chainId={1000} size={20} />
            Seed Monero subaddresses
          </DialogTitle>
          <DialogDescription>
            Separate from the HD pool. Idempotent — a pool at target is left alone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            seed.mutate()
          }}
        >
          <Field label="Target size" hint="Spare subaddresses to keep. Max 500.">
            <Input
              type="number"
              min={1}
              max={500}
              value={initialSize}
              onChange={(e) => setInitialSize(e.target.value)}
              className="figure"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={seed.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={seed.isPending || !sizeValid}>
              {seed.isPending && <Loader2 className="size-4 animate-spin" />}
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
    <Callout
      tone="warn"
      icon={LifeBuoy}
      title={
        <>
          <span className="figure">{count}</span> payout leg{count === 1 ? '' : 's'} held for
          recovery
        </>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/held-payouts">
            Review <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    >
      A consolidation sweep may have stalled mid-broadcast.
    </Callout>
  )
}

/** Explorer chain for a family address — only where the family maps to one chain. */
function explorerChainOf(f: Family): number | undefined {
  return f === 'tron' ? 728 : f === 'solana' ? 900 : undefined
}

/* ── pool audit ──────────────────────────────────────────── */

function PoolAuditSection() {
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

  return (
    <div className="space-y-5">
      <TableCard
        toolbar={
          <TableToolbar
            title={
              <span
                className="inline-flex items-center gap-2"
                title="Re-derives every pool row's expected address from the current MASTER_SEED and reports mismatches. Run before funding a fresh pool, after any deploy that might have rotated the seed, or when a payout fails with a signer-mismatch error. Read-only."
              >
                <ShieldCheck className="size-4 text-[var(--fg-2)]" />
                Seed audit
              </span>
            }
          >
            {data && <Status value={data.status} />}
            {data && (
              <span className="figure text-xs text-[var(--fg-2)]">
                scan limit {data.scanLimit}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => audit.mutate()}
              disabled={audit.isPending}
            >
              {audit.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {audit.isPending ? 'Auditing…' : data ? 'Re-run' : 'Run audit'}
            </Button>
          </TableToolbar>
        }
      >
        {!data ? (
          <EmptyState
            compact
            icon={ShieldCheck}
            title="Not run yet"
            description="Checks every row against MASTER_SEED. Read-only."
          />
        ) : (
          <TableWrap className="fade-in">
            <Table className="min-w-[620px]">
              <THead>
                <tr>
                  <Th>Family</Th>
                  <Th>Status</Th>
                  <Th align="right">Scanned</Th>
                  <Th align="right">Matches</Th>
                  <Th align="right">Mismatches</Th>
                  <Th align="right">Beyond limit</Th>
                </tr>
              </THead>
              <TBody>
                {data.reports.map((r) => {
                  const ok = r.mismatches.length === 0
                  return (
                    <Tr key={r.family}>
                      <Td>
                        <span className="inline-flex items-center gap-2.5 font-medium uppercase">
                          <FamilyIcon family={r.family} size={24} />
                          {r.family}
                        </span>
                      </Td>
                      <Td>
                        {ok ? (
                          <StatusPill tone="ok">Clean</StatusPill>
                        ) : (
                          <StatusPill tone="bad">{r.mismatches.length} bad</StatusPill>
                        )}
                      </Td>
                      <Td align="right">{r.scanned}</Td>
                      <Td align="right" className="text-[var(--st-ok)]">
                        {r.matches}
                      </Td>
                      <Td
                        align="right"
                        className={ok ? 'text-[var(--fg-3)]' : 'font-semibold text-[var(--st-bad)]'}
                      >
                        {r.mismatches.length}
                      </Td>
                      <Td
                        align="right"
                        className={
                          r.unscannedBeyondLimit > 0 ? 'text-[var(--st-warn)]' : 'text-[var(--fg-3)]'
                        }
                      >
                        {r.unscannedBeyondLimit}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </TableCard>

      {data && totalMismatches > 0 && <MismatchTable data={data} />}
    </div>
  )
}

function MismatchTable({ data }: { data: PoolAuditResponse }) {
  const rows = React.useMemo(
    () =>
      data.reports.flatMap((r) =>
        r.mismatches.map((m) => ({ ...m, family: r.family })),
      ),
    [data],
  )
  const paged = usePaged(rows, 25)
  return (
    <TableCard
      className="fade-in"
      toolbar={<TableToolbar title="Mismatched rows" count={rows.length} />}
      footer={
        paged.total > paged.pageSize ? (
          <Pager
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="rows"
          />
        ) : undefined
      }
    >
      <TableWrap>
        <Table className="min-w-[620px]">
          <THead>
            <tr>
              <Th>Family</Th>
              <Th align="right">Index</Th>
              <Th>Stored</Th>
              <Th>Expected</Th>
            </tr>
          </THead>
          <TBody>
            {paged.rows.map((m) => (
              <Tr key={`${m.family}-${m.addressIndex}`}>
                <Td>
                  <FamilyIcon family={m.family} size={20} />
                </Td>
                <Td align="right" className="text-[var(--fg-2)]">
                  {m.addressIndex}
                </Td>
                <Td>
                  <span className="text-[var(--st-bad)]">
                    <Addr value={m.storedAddress} chainId={explorerChainOf(m.family)} />
                  </span>
                </Td>
                <Td>
                  <Addr value={m.expectedAddress} chainId={explorerChainOf(m.family)} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </TableCard>
  )
}

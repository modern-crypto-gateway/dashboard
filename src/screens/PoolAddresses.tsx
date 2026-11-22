import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Waypoints,
  X,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { FAMILY_COLOR } from '@/lib/chains'
import { fmtLocal, fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  BalancesSnapshot,
  DisabledPoolAddressesResponse,
  Family,
  PoolAddressAdminView,
  PoolAddressListResponse,
  PoolStatsRow,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'

type AdminFamily = Exclude<Family, 'monero'>

const ADMIN_FAMILIES: AdminFamily[] = ['evm', 'tron', 'solana', 'utxo']

type StatusFilter = 'all' | 'available' | 'allocated' | 'quarantined' | 'disabled'

const PAGE_SIZE = 100

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'allocated', label: 'Allocated' },
  { value: 'quarantined', label: 'Parked' },
  { value: 'disabled', label: 'Disabled (incl. on-loan)' },
]

export function PoolAddressesPage() {
  const [family, setFamily] = React.useState<AdminFamily>('evm')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [search, setSearch] = React.useState('')
  const [offset, setOffset] = React.useState(0)

  // Reset paging whenever the cursor moves to a different (family, status).
  const cursor = `${family}|${statusFilter}`
  const [prevCursor, setPrevCursor] = React.useState(cursor)
  if (prevCursor !== cursor) {
    setPrevCursor(cursor)
    setOffset(0)
  }

  const statsQ = useQuery({
    queryKey: ['pool-stats'] as const,
    queryFn: () => api<{ stats: PoolStatsRow[] }>('/api/gw/admin/pool/stats'),
    refetchInterval: 30_000,
  })
  const statsByFamily = React.useMemo(() => {
    const m = new Map<Family, PoolStatsRow>()
    for (const r of statsQ.data?.stats ?? []) m.set(r.family, r)
    return m
  }, [statsQ.data])

  // Balance cross-reference — flattened address → totalUsd map for this family.
  const balancesQ = useQuery({
    queryKey: ['pool-addresses', 'balances', family] as const,
    queryFn: () =>
      api<{ snapshot: BalancesSnapshot; cached: boolean }>(
        `/api/gw/admin/balances?family=${family}`,
      ),
    staleTime: 30_000,
  })
  const balanceByAddress = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const fam of balancesQ.data?.snapshot.families ?? []) {
      for (const ch of fam.chains) {
        for (const a of ch.addresses) {
          const prev = m.get(a.address.toLowerCase()) ?? 0
          m.set(a.address.toLowerCase(), prev + parseFloat(a.totalUsd))
        }
      }
    }
    return m
  }, [balancesQ.data])

  const listQ = useListQuery({ family, statusFilter, offset, limit: PAGE_SIZE })

  const rows = React.useMemo(
    () => listQ.data?.addresses ?? [],
    [listQ.data],
  )
  const searchLower = search.trim().toLowerCase()
  const filtered = React.useMemo(
    () =>
      searchLower
        ? rows.filter((r) => r.address.toLowerCase().includes(searchLower))
        : rows,
    [rows, searchLower],
  )

  const total =
    statusFilter === 'disabled'
      ? rows.length
      : (listQ.data as PoolAddressListResponse | undefined)?.total ?? null
  const hasMore =
    statusFilter !== 'disabled' &&
    rows.length === PAGE_SIZE &&
    total != null &&
    offset + PAGE_SIZE < total

  return (
    <div className="fade-in space-y-5">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-[var(--fg-2)]">
          <Link to="/pool">
            <ArrowLeft className="size-3.5" /> Address pool
          </Link>
        </Button>
        <PageHeader
          eyebrow="Treasury"
          title="Pool addresses"
          description="Browse individual addresses across families. Park empty / idle ones to keep the active set small and detection light. Reversible — never risks funds."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                listQ.refetch()
                balancesQ.refetch()
                statsQ.refetch()
              }}
              disabled={listQ.isFetching || balancesQ.isFetching}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  (listQ.isFetching || balancesQ.isFetching) && 'animate-spin',
                )}
              />
              Refresh
            </Button>
          }
        />
      </div>

      <CaveatBanner />

      <FamilyTabs
        active={family}
        onChange={setFamily}
        statsByFamily={statsByFamily}
        loading={statsQ.isLoading}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(s.value)}
                aria-pressed={statusFilter === s.value}
                className={cn(
                  'h-7 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors',
                  statusFilter === s.value
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary'
                    : 'border-border text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full min-w-0 sm:w-auto sm:min-w-[200px] sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--fg-3)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter loaded by address…"
              className="h-9 pl-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-[var(--fg-3)] hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="hidden whitespace-nowrap font-mono text-xs text-[var(--fg-2)] sm:block">
            {listQ.isFetching && !listQ.isFetched ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <>
                <span className="tabular-nums">{filtered.length}</span>
                {total != null && (
                  <>
                    {' '}
                    of <span className="tabular-nums">{total}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {listQ.isLoading ? (
          <TableSkeleton />
        ) : listQ.isError ? (
          <ErrorRow
            message={
              listQ.error instanceof Error ? listQ.error.message : 'Error'
            }
          />
        ) : filtered.length === 0 ? (
          <NoAddresses statusFilter={statusFilter} family={family} />
        ) : (
          <AddressTable
            rows={filtered}
            balanceByAddress={balanceByAddress}
            balancesLoading={balancesQ.isLoading}
            family={family}
          />
        )}

        {hasMore && (
          <div className="flex justify-center border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={listQ.isFetching}
            >
              {listQ.isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ── data hooks ──────────────────────────────────────────── */

function useListQuery({
  family,
  statusFilter,
  offset,
  limit,
}: {
  family: AdminFamily
  statusFilter: StatusFilter
  offset: number
  limit: number
}) {
  const isDisabled = statusFilter === 'disabled'
  return useQuery({
    queryKey: ['pool-addresses', family, statusFilter, offset, limit] as const,
    queryFn: () => {
      if (isDisabled) {
        return api<DisabledPoolAddressesResponse>(
          `/api/gw/admin/pool/addresses/disabled?family=${family}`,
        )
      }
      const qs = new URLSearchParams({
        family,
        limit: String(limit),
        offset: String(offset),
      })
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      return api<PoolAddressListResponse>(
        `/api/gw/admin/pool/addresses?${qs}`,
      )
    },
    refetchInterval: 30_000,
  })
}

/* ── header pieces ───────────────────────────────────────── */

function CaveatBanner() {
  return (
    <Callout tone="info" title="Park is safe and reversible.">
      <div className="space-y-1">
        <p>
          A parked address stays in the pool, is still swept by consolidation,
          and late payments follow the usual cooldown path. The allocator may
          borrow it if the family pool is exhausted, then auto-re-park on
          release.
        </p>
        <p className="text-[var(--fg-2)]">
          Parking does <span className="font-medium">not</span> save gas
          (there's no on-chain destroy for EVM/Tron EOAs). It reduces detection
          overhead and helps keep stranded dust contained.
        </p>
      </div>
    </Callout>
  )
}

function FamilyTabs({
  active,
  onChange,
  statsByFamily,
  loading,
}: {
  active: AdminFamily
  onChange: (f: AdminFamily) => void
  statsByFamily: Map<Family, PoolStatsRow>
  loading: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ADMIN_FAMILIES.map((f) => {
        const s = statsByFamily.get(f)
        const isActive = f === active
        return (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            aria-pressed={isActive}
            className={cn(
              'group flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-4 py-3 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'border-[var(--accent-border)] ring-1 ring-[var(--accent-border)]'
                : 'border-border hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: FAMILY_COLOR[f] }}
                />
                <span className="text-xs font-semibold uppercase tracking-[0.06em]">
                  {f}
                </span>
              </div>
              {loading && !s ? (
                <Skeleton className="h-3.5 w-10" />
              ) : (
                <span className="font-mono text-2xs tabular-nums text-[var(--fg-3)]">
                  total {s?.total ?? 0}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <FamilyMetric label="avail" value={s?.available ?? 0} tone="success" />
              <FamilyMetric label="alloc" value={s?.allocated ?? 0} tone="warn" />
              <FamilyMetric label="parked" value={s?.quarantined ?? 0} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

function FamilyMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'success' | 'warn'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-[var(--bg-2)] px-1.5 py-0.5 text-2xs',
        tone === 'success' && 'text-success',
        tone === 'warn' && 'text-warn',
      )}
    >
      <span className="font-mono tabular-nums font-semibold">{value}</span>
      <span className="text-[var(--fg-3)]">{label}</span>
    </span>
  )
}

/* ── table ───────────────────────────────────────────────── */

function AddressTable({
  rows,
  balanceByAddress,
  balancesLoading,
  family,
}: {
  rows: PoolAddressAdminView[]
  balanceByAddress: Map<string, number>
  balancesLoading: boolean
  family: AdminFamily
}) {
  return (
    <TableWrap>
      <Table className="min-w-[760px]">
        <THead>
          <tr>
            <Th>Address</Th>
            <Th align="right">Index</Th>
            <Th>State</Th>
            <Th align="right">Balance</Th>
            <Th>Allocation</Th>
            <Th align="right">Action</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            const usd = balanceByAddress.get(row.address.toLowerCase()) ?? 0
            return (
              <AddressRow
                key={row.address}
                row={row}
                usd={usd}
                balancesLoading={balancesLoading}
                family={family}
              />
            )
          })}
        </TBody>
      </Table>
    </TableWrap>
  )
}

function AddressRow({
  row,
  usd,
  balancesLoading,
  family,
}: {
  row: PoolAddressAdminView
  usd: number
  balancesLoading: boolean
  family: AdminFamily
}) {
  const isDisabled = row.disabledAt != null
  // On-loan: operator-disabled but currently serving an invoice. The system
  // borrowed it because the family pool was exhausted; it re-parks on release.
  const onLoan = isDisabled && row.status === 'allocated'
  return (
    <Tr>
      <Td className="align-top">
        <Addr value={row.address} truncated />
      </Td>
      <Td align="right" className="align-top text-xs text-[var(--fg-2)]">
        {row.addressIndex}
      </Td>
      <Td className="align-top">
        <StateCell row={row} onLoan={onLoan} />
      </Td>
      <Td align="right" className="align-top">
        {balancesLoading ? (
          <Skeleton className="ml-auto h-3 w-12" />
        ) : (
          <span
            className={cn(
              'font-mono text-xs tabular-nums',
              usd > 0 ? 'text-foreground' : 'text-[var(--fg-3)]',
            )}
          >
            {usd > 0 ? fmtUsd(usd) : '—'}
          </span>
        )}
      </Td>
      <Td className="align-top font-mono text-xs text-[var(--fg-2)]">
        {row.allocatedToInvoiceId ? (
          <Link
            to={`/invoices?id=${encodeURIComponent(row.allocatedToInvoiceId)}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {row.allocatedToInvoiceId.slice(0, 8)}…
            <ExternalLink className="size-3" />
          </Link>
        ) : (
          <span className="text-[var(--fg-3)]">—</span>
        )}
      </Td>
      <Td className="text-right align-top">
        <ParkButton row={row} family={family} usd={usd} />
      </Td>
    </Tr>
  )
}

function StateCell({
  row,
  onLoan,
}: {
  row: PoolAddressAdminView
  onLoan: boolean
}) {
  const liveVariant: 'success' | 'warn' | 'default' =
    row.status === 'available' ? 'success' : row.status === 'allocated' ? 'warn' : 'default'
  const liveLabel = row.status === 'quarantined' ? 'parked' : row.status
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={liveVariant}>{liveLabel}</Badge>
        {row.disabledAt != null && (
          <Badge
            variant={onLoan ? 'warn' : 'default'}
            className="text-2xs uppercase"
            title={
              onLoan
                ? 'Operator-disabled but currently serving an invoice. Will auto-park on release.'
                : 'Operator-disabled'
            }
          >
            {onLoan ? 'on-loan' : 'disabled'}
          </Badge>
        )}
      </div>
      {row.disabledAt != null && (
        <span className="text-2xs text-[var(--fg-3)]">
          disabled {fmtLocal(row.disabledAt)}
        </span>
      )}
    </div>
  )
}

function ParkButton({
  row,
  family,
  usd,
}: {
  row: PoolAddressAdminView
  family: AdminFamily
  usd: number
}) {
  const qc = useQueryClient()
  const isDisabled = row.disabledAt != null

  const mut = useMutation({
    mutationFn: () =>
      api<{ address: PoolAddressAdminView }>(
        isDisabled
          ? '/api/gw/admin/pool/addresses/enable'
          : '/api/gw/admin/pool/addresses/disable',
        {
          method: 'POST',
          body: JSON.stringify({ family, address: row.address }),
        },
      ),
    onSuccess: (res) => {
      toast.success(
        isDisabled ? 'Re-enabled' : 'Parked',
        {
          description: isDisabled
            ? `${row.address.slice(0, 10)}… is back in normal rotation.`
            : res.address.status === 'allocated'
              ? 'Will auto-park when the current invoice ends.'
              : 'Removed from active rotation. Reversible at any time.',
        },
      )
      qc.invalidateQueries({ queryKey: ['pool-addresses'] })
      qc.invalidateQueries({ queryKey: ['pool-stats'] })
    },
    onError: (e: ApiError) => {
      const map: Record<string, string> = {
        ADDRESS_NOT_FOUND: 'Address not in this family pool',
        BAD_JSON: 'Bad request body',
      }
      toast.error(map[e.code ?? ''] ?? e.message ?? 'Action failed')
    },
  })

  if (isDisabled) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
        className="border-[var(--accent-border)] text-primary hover:bg-[var(--accent-bg)]"
      >
        {mut.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        Re-enable
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      title={
        usd > 0
          ? `Address holds ${fmtUsd(usd)} — park is still safe; balances stay where they are.`
          : 'Remove from normal rotation. Reversible.'
      }
    >
      {mut.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Pause className="size-3.5" />
      )}
      Park
    </Button>
  )
}

/* ── empty / loading / error ──────────────────────────────── */

function TableSkeleton() {
  return (
    <div aria-busy="true">
      <div className="h-9 border-b border-border bg-[var(--bg-2)]" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
        >
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="hidden h-3.5 w-8 sm:block" />
          <Skeleton className="h-5 w-16" />
          <div className="flex-1" />
          <Skeleton className="hidden h-3.5 w-14 sm:block" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  )
}

function NoAddresses({
  statusFilter,
  family,
}: {
  statusFilter: StatusFilter
  family: AdminFamily
}) {
  return (
    <EmptyState
      icon={statusFilter === 'disabled' ? CheckCircle2 : Waypoints}
      title={
        statusFilter === 'disabled'
          ? `No disabled ${family} addresses`
          : statusFilter === 'all'
            ? `No ${family} pool addresses yet`
            : `No ${statusFilter} addresses on ${family}`
      }
      description={
        statusFilter === 'disabled'
          ? 'Every address in this family is in normal rotation.'
          : statusFilter === 'all'
            ? 'Seed the pool from Address pool to get started.'
            : 'Try a different filter or chain family.'
      }
    />
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="p-4">
      <ErrorState title="Could not load addresses" message={message} />
    </div>
  )
}

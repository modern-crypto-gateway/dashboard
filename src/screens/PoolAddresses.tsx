import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Waypoints,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
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
import { FamilyIcon } from '@/components/CryptoIcon'
import { Pager, TableCard, TableSearch, TableToolbar, usePaged } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { Segmented, SegmentedBar } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type AdminFamily = Exclude<Family, 'monero'>

const ADMIN_FAMILIES: AdminFamily[] = ['evm', 'tron', 'solana', 'utxo']

type StatusFilter = 'all' | 'available' | 'allocated' | 'quarantined' | 'disabled'

/** Server chunk size — unchanged `limit` on the list request. */
const PAGE_SIZE = 100
/** Rows shown per table page (client view over the server chunk). */
const VIEW_SIZE = 25
const VIEWS_PER_CHUNK = PAGE_SIZE / VIEW_SIZE

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'allocated', label: 'Allocated' },
  { value: 'quarantined', label: 'Parked' },
  { value: 'disabled', label: 'Disabled (incl. on-loan)' },
]

const METER = {
  available: 'var(--st-ok-dot)',
  allocated: 'var(--st-run-dot)',
  quarantined: 'var(--st-wait-dot)',
} as const

export function PoolAddressesPage() {
  const [family, setFamily] = React.useState<AdminFamily>('evm')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [search, setSearch] = React.useState('')
  // View page (25 rows). The server is still asked for 100-row chunks with
  // the same limit/offset; the chunk is derived from the view page.
  const [page, setPage] = React.useState(0)

  // Reset paging whenever the cursor moves to a different (family, status).
  const cursor = `${family}|${statusFilter}`
  const [prevCursor, setPrevCursor] = React.useState(cursor)
  if (prevCursor !== cursor) {
    setPrevCursor(cursor)
    setPage(0)
  }

  const isDisabledView = statusFilter === 'disabled'
  const offset = isDisabledView
    ? 0
    : Math.floor(page / VIEWS_PER_CHUNK) * PAGE_SIZE

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
  // Searching filters the loaded chunk; page through the matches locally.
  const searchPaged = usePaged(filtered, VIEW_SIZE)

  const total: number | null = isDisabledView
    ? rows.length
    : (listQ.data as PoolAddressListResponse | undefined)?.total ?? null

  const localStart = page * VIEW_SIZE - offset
  const visible = searchLower
    ? searchPaged.rows
    : rows.slice(localStart, localStart + VIEW_SIZE)
  const hasNext = searchLower
    ? searchPaged.page < searchPaged.pageCount - 1
    : total != null
      ? (page + 1) * VIEW_SIZE < total
      : localStart + VIEW_SIZE < rows.length || rows.length === PAGE_SIZE

  const fam = statsByFamily.get(family)

  return (
    <div className="fade-in space-y-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-[var(--fg-2)]">
          <Link to="/pool">
            <ArrowLeft className="size-3.5" /> Address pool
          </Link>
        </Button>
        <PageHeader
          title="Pool addresses"
          description="Park or re-enable addresses"
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
                  'size-4',
                  (listQ.isFetching || balancesQ.isFetching) && 'animate-spin',
                )}
              />
              Refresh
            </Button>
          }
        />
      </div>

      <div className="stagger grid grid-cols-2 gap-5 xl:grid-cols-4">
        <Tile
          label="Total"
          value={fam?.total ?? 0}
          loading={statsQ.isLoading}
          icon={<FamilyIcon family={family} size={18} />}
        >
          <SegmentedBar
            parts={[
              { key: 'a', name: 'Available', value: fam?.available ?? 0, color: METER.available },
              { key: 'l', name: 'Allocated', value: fam?.allocated ?? 0, color: METER.allocated },
              { key: 'q', name: 'Parked', value: fam?.quarantined ?? 0, color: METER.quarantined },
            ]}
          />
        </Tile>
        <Tile label="Available" value={fam?.available ?? 0} loading={statsQ.isLoading} dot={METER.available} />
        <Tile label="Allocated" value={fam?.allocated ?? 0} loading={statsQ.isLoading} dot={METER.allocated} />
        <Tile label="Parked" value={fam?.quarantined ?? 0} loading={statsQ.isLoading} dot={METER.quarantined} />
      </div>

      <CaveatBanner />

      <TableCard
        toolbar={
          <TableToolbar title="Addresses" count={total ?? undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<AdminFamily>
                ariaLabel="Family"
                value={family}
                onChange={setFamily}
                options={ADMIN_FAMILIES.map((f) => ({ value: f, label: f.toUpperCase() }))}
              />
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="h-8 w-auto min-w-[150px] rounded-[10px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TableSearch
              value={search}
              onChange={setSearch}
              placeholder="Filter loaded by address…"
            />
          </TableToolbar>
        }
        footer={
          !listQ.isLoading && !listQ.isError && visible.length > 0 ? (
            searchLower ? (
              <Pager
                page={searchPaged.page}
                pageSize={VIEW_SIZE}
                total={searchPaged.total}
                hasNext={hasNext}
                onPage={searchPaged.setPage}
                noun="matches"
              />
            ) : (
              <Pager
                page={page}
                pageSize={VIEW_SIZE}
                total={total ?? undefined}
                shown={visible.length}
                hasNext={hasNext}
                onPage={setPage}
                loading={listQ.isFetching}
                noun="addresses"
              />
            )
          ) : undefined
        }
      >
        {listQ.isLoading ? (
          <TableSkeleton />
        ) : listQ.isError ? (
          <ErrorRow
            message={
              listQ.error instanceof Error ? listQ.error.message : 'Error'
            }
          />
        ) : visible.length === 0 ? (
          <NoAddresses statusFilter={statusFilter} family={family} searching={!!searchLower} />
        ) : (
          <AddressTable
            rows={visible}
            balanceByAddress={balanceByAddress}
            balancesLoading={balancesQ.isLoading}
            family={family}
          />
        )}
      </TableCard>
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

function Tile({
  label,
  value,
  loading,
  icon,
  dot,
  children,
}: {
  label: string
  value: number
  loading?: boolean
  icon?: React.ReactNode
  dot?: string
  children?: React.ReactNode
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
        {dot && <span className="size-2.5 rounded-[3px]" style={{ background: dot }} />}
        {label}
        {icon && <span className="ml-auto">{icon}</span>}
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-12" /> : value}
      </div>
      {children && <div className="mt-auto pt-4">{children}</div>}
    </Card>
  )
}

function CaveatBanner() {
  return (
    <Callout
      tone="info"
      title="Park is safe and reversible."
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About parking"
              className="grid size-7 cursor-pointer place-items-center rounded-full text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Info className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-pretty font-normal">
            The allocator may borrow a parked address if the family pool is
            exhausted, then auto-re-park on release. Parking does not save gas
            (there's no on-chain destroy for EVM/Tron EOAs); it reduces detection
            overhead and helps keep stranded dust contained.
          </TooltipContent>
        </Tooltip>
      }
    >
      Parked addresses stay in the pool, are still swept by consolidation, and
      late payments follow the usual cooldown path.
    </Callout>
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
      <Table className="min-w-[780px]">
        <THead>
          <tr>
            <Th>Address</Th>
            <Th>Status</Th>
            <Th align="right">Balance</Th>
            <Th>Invoice</Th>
            <Th align="right">
              <span className="sr-only">Action</span>
            </Th>
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
      <Td>
        <div className="flex items-center gap-3">
          <span
            className="figure grid h-8 min-w-8 shrink-0 place-items-center rounded-full bg-[var(--bg-2)] px-1.5 text-2xs font-semibold text-[var(--fg-1)] ring-1 ring-border"
            title={`Derivation index ${row.addressIndex}`}
          >
            {row.addressIndex}
          </span>
          <Addr value={row.address} truncated chainId={explorerChainOf(family)} />
        </div>
      </Td>
      <Td>
        <StateCell row={row} onLoan={onLoan} />
      </Td>
      <Td align="right">
        {balancesLoading ? (
          <Skeleton className="ml-auto h-3.5 w-14" />
        ) : (
          <span className={usd > 0 ? 'font-medium text-foreground' : 'text-[var(--fg-3)]'}>
            {usd > 0 ? fmtUsd(usd) : '—'}
          </span>
        )}
      </Td>
      <Td>
        {row.allocatedToInvoiceId ? (
          <Link
            to={`/invoices?id=${encodeURIComponent(row.allocatedToInvoiceId)}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:underline"
          >
            {row.allocatedToInvoiceId.slice(0, 8)}…
            <ExternalLink className="size-3.5 text-[var(--fg-3)]" />
          </Link>
        ) : (
          <span className="text-[var(--fg-3)]">—</span>
        )}
      </Td>
      <Td className="text-right">
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
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.status === 'available' ? (
        <StatusPill tone="ok">Available</StatusPill>
      ) : row.status === 'allocated' ? (
        <StatusPill tone="info" icon={Play}>
          Allocated
        </StatusPill>
      ) : (
        <StatusPill tone="off" icon={Pause}>
          Parked
        </StatusPill>
      )}
      {row.disabledAt != null && (
        <span
          title={
            (onLoan
              ? 'Operator-disabled but currently serving an invoice. Will auto-park on release.'
              : 'Operator-disabled') + ` · disabled ${fmtLocal(row.disabledAt)}`
          }
        >
          <StatusPill tone={onLoan ? 'warn' : 'off'} size="sm">
            {onLoan ? 'On loan' : 'Disabled'}
          </StatusPill>
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
      >
        {mut.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        Re-enable
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
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
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Pause className="size-4" />
      )}
      Park
    </Button>
  )
}

/**
 * Explorer chain for a family address — only where the family maps to a
 * single chain (EVM addresses span many chains; UTXO spans BTC/LTC).
 */
function explorerChainOf(f: AdminFamily): number | undefined {
  return f === 'tron' ? 728 : f === 'solana' ? 900 : undefined
}

/* ── empty / loading / error ──────────────────────────────── */

function TableSkeleton() {
  return (
    <div aria-busy="true">
      <div className="h-11 border-b border-border" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-border px-6 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-6 w-20 rounded-full" />
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
  searching,
}: {
  statusFilter: StatusFilter
  family: AdminFamily
  searching: boolean
}) {
  if (searching) {
    return <EmptyState icon={Waypoints} title="No matches" description="Nothing in the loaded rows matches." />
  }
  const fam = family.toUpperCase()
  return (
    <EmptyState
      icon={statusFilter === 'disabled' ? CheckCircle2 : Waypoints}
      title={
        statusFilter === 'disabled'
          ? `No disabled ${fam} addresses`
          : statusFilter === 'all'
            ? `No ${fam} pool addresses yet`
            : `No ${STATUS_FILTERS.find((s) => s.value === statusFilter)?.label.toLowerCase()} ${fam} addresses`
      }
      description={
        statusFilter === 'all'
          ? 'Seed the pool from Address pool.'
          : statusFilter === 'disabled'
            ? 'Every address is in rotation.'
            : 'Try another filter.'
      }
      action={
        statusFilter === 'all' ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/pool">Address pool</Link>
          </Button>
        ) : undefined
      }
    />
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="p-6">
      <ErrorState title="Could not load addresses" message={message} />
    </div>
  )
}

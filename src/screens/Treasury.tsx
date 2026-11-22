import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  BadgeCheck,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Coins,
  FlaskConical,
  Gauge,
  Hash,
  Info,
  Landmark,
  Layers,
  ListBullets,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Send,
  Tag,
  Timer,
  Trash2,
  Wallet,
} from '@/components/icons'

import { useUrlSheet } from '@/lib/useUrlParam'
import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import {
  fmtLocal,
  fmtNum,
  fmtRel,
  fmtUsd,
  formatUnits,
  parseUnits,
  toDate,
  useNow,
} from '@/lib/format'
import type {
  ChainInventoryEntry,
  ChainToken,
  TreasuryDestination,
  TreasuryEligibility,
  TreasuryTransfer,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { CopyButton } from '@/components/CopyButton'
import { TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, TableCard, TableSearch, TableToolbar, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import {
  Callout,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from '@/components/States'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { SegmentedBar, SparkBars } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/table'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetSection,
  SheetTabs,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/* ── Queries, constants ─────────────────────────────────────── */

const BASE = '/api/gw/admin/treasury'
/** Prefix shared by every treasury query — one invalidation covers all. */
const TREASURY_KEY = ['gw', 'treasury'] as const

const CHAINS_Q = {
  queryKey: ['gw', 'chains'] as const,
  queryFn: () => api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
  refetchInterval: 120_000,
  staleTime: 30_000,
}

const DESTINATIONS_Q = {
  queryKey: [...TREASURY_KEY, 'destinations'] as const,
  queryFn: () =>
    api<{ destinations: TreasuryDestination[] }>(`${BASE}/destinations`),
  refetchInterval: 30_000,
}

/** Server-side defaults applied when a field is omitted on create. */
const DEFAULTS = {
  exchangeMin: '0',
  minTransferUsd: '100',
  maxPerTransferUsd: '3000',
  maxDailyUsd: '6000',
  keepFloat: '0',
}

const PAGE_SIZE = 25

/**
 * Operator-facing text per API error code. Codes whose server message
 * already carries the specifics (`TREASURY_NOTHING_TO_SEND` says *why*,
 * `VALIDATION` names the field) fall through to the message instead.
 */
const ERROR_TEXT: Record<string, string> = {
  BAD_JSON: 'Body was not valid JSON',
  TREASURY_INVALID_CHAIN: 'Chain is not in the registry or has no adapter',
  TREASURY_INVALID_TOKEN: 'Token is not registered on this chain',
  TREASURY_INVALID_ADDRESS: "Address fails the chain family's format check",
  TREASURY_ADDRESS_IS_OURS:
    'Address is gateway-controlled (pool, fee wallet or invoice address) — a treasury destination must be external',
  TREASURY_ADDRESS_IS_CONTRACT:
    'Address is a registry token contract — funds sent there would be burned',
  TREASURY_DUPLICATE:
    'A destination with this chain, token and address already exists',
  TREASURY_NOT_FOUND: 'Destination no longer exists',
  TREASURY_NOT_VERIFIED:
    'Destination is not verified yet — send a verification transfer and mark it verified first',
  TREASURY_DISABLED: 'Destination is disabled — enable it before transferring',
  TREASURY_VERIFICATION_PENDING:
    'The verification payout has not confirmed on-chain yet. Wait for it to confirm and arrive at the exchange, then mark verified again.',
  TREASURY_IN_FLIGHT:
    'A previous transfer still has pending legs — wait for them to settle',
  TREASURY_DAILY_CAP: 'Rolling 24 h cap reached — try again later',
  TREASURY_IN_USE:
    'Destination has transfers and cannot be deleted — disable it instead',
}

const BLOCKED_TEXT: Record<
  NonNullable<TreasuryEligibility['blocked']>,
  string
> = {
  DISABLED: 'destination is disabled',
  NOT_VERIFIED: 'destination is not verified',
  BELOW_MIN_TRANSFER: 'budget is below the minimum transfer',
  DAILY_CAP_REACHED: 'rolling 24 h cap reached',
  IN_FLIGHT: 'a previous transfer still has pending legs',
  NO_ELIGIBLE_SOURCES:
    'no pool source holds eligible balance (everything is held for refunds or below the float)',
}

function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const code = e.code ?? ''
    if (code === 'TREASURY_NOTHING_TO_SEND' || code === 'VALIDATION')
      return e.message || fallback
    return ERROR_TEXT[code] ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

/* ── Helpers ────────────────────────────────────────────────── */

function findToken(
  chains: ChainInventoryEntry[] | undefined,
  chainId: number,
  token: string,
): ChainToken | undefined {
  return chains
    ?.find((c) => c.chainId === chainId)
    ?.tokens.find((t) => t.symbol.toUpperCase() === token.toUpperCase())
}

function chainName(
  chains: ChainInventoryEntry[] | undefined,
  chainId: number,
): string {
  return (
    chains?.find((c) => c.chainId === chainId)?.displayName ??
    chainInfo(chainId).name
  )
}

/** Raw smallest-unit → `12.5 USDT`; falls back to the raw integer when the token's decimals are unknown. */
function fmtAmt(raw: string, dec: number | null, token: string): string {
  return dec != null ? `${formatUnits(raw, dec)} ${token}` : `${raw} (raw ${token})`
}

/** Human-unit input → raw. With unknown decimals the input must already be raw. */
function toRaw(human: string, dec: number | null): string | null {
  const s = human.trim()
  if (dec == null) return /^\d+$/.test(s) ? s : null
  return parseUnits(s, dec)
}

function fromRaw(raw: string, dec: number | null): string {
  return dec != null ? formatUnits(raw, dec) : raw
}

const isUsd = (s: string) => /^\d+(\.\d+)?$/.test(s)

function pendingLegs(s: TreasuryTransfer['status']): number {
  return s.planned + s.reserved + s.toppingUp + s.submitted
}

function fmtRelDelta(deltaMs: number): string {
  const abs = Math.abs(deltaMs)
  const sec = Math.round(abs / 1000)
  const future = deltaMs > 0
  let body: string
  if (sec < 60) body = `${sec}s`
  else if (sec < 3600) body = `${Math.round(sec / 60)}m`
  else if (sec < 86400) body = `${Math.round(sec / 3600)}h`
  else body = `${Math.round(sec / 86400)}d`
  return future ? `in ${body}` : `${body} ago`
}

/** Relative "5m ago" for any date-ish value (ms or s). */
function rel(x: number | string | null | undefined): string {
  const d = toDate(x)
  return d ? fmtRel(Math.floor(d.getTime() / 1000)) : '—'
}

const num = (s: string | null | undefined): number => {
  const n = parseFloat(s ?? '')
  return Number.isFinite(n) ? n : 0
}

/** Values bucketed per local day, oldest first, ending today. */
function dailyBuckets<T>(
  rows: T[],
  at: (r: T) => number,
  value: (r: T) => number,
  days: number,
): number[] {
  const out = new Array<number>(days).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (days - 1) * 86_400_000
  for (const r of rows) {
    const d = toDate(at(r))
    if (!d) continue
    const day = new Date(d)
    day.setHours(0, 0, 0, 0)
    const i = Math.round((day.getTime() - start) / 86_400_000)
    if (i >= 0 && i < days) out[i] += value(r)
  }
  return out
}

/** Gating shared by the row menu and the detail sheet. */
function gatingOf(d: TreasuryDestination) {
  const verified = d.verifiedAt != null
  const canTransfer = d.enabled && verified
  const transferTitle = !verified
    ? 'Verify the destination first'
    : !d.enabled
      ? 'Enable the destination first'
      : 'Dry-run preview first, then confirm'
  const toggleTitle =
    !verified && !d.enabled
      ? 'Only verified destinations can be enabled'
      : d.enabled
        ? 'Stops manual and scheduled transfers'
        : 'Allows transfers'
  return {
    verified,
    canTransfer,
    transferTitle,
    toggleTitle,
    toggleBlocked: !verified && !d.enabled,
  }
}

function destinationTone(d: TreasuryDestination): { tone: StatusTone; label: string } {
  if (d.verifiedAt == null) return { tone: 'warn', label: 'Unverified' }
  if (!d.enabled) return { tone: 'off', label: 'Disabled' }
  return { tone: 'ok', label: 'Enabled' }
}

function transferTone(s: TreasuryTransfer['status']): { tone: StatusTone; label: string } {
  const pending = pendingLegs(s)
  const total = pending + s.confirmed + s.failed + s.canceled
  if (total === 0) return { tone: 'wait', label: 'No legs' }
  if (pending > 0) return { tone: 'run', label: `${pending} pending` }
  if (s.failed > 0) return { tone: 'bad', label: `${s.failed} failed` }
  if (s.confirmed > 0) return { tone: 'ok', label: 'Confirmed' }
  return { tone: 'off', label: 'Canceled' }
}

const MODE_META: Record<
  TreasuryTransfer['mode'],
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  verification: { label: 'Verification', icon: FlaskConical },
  scheduled: { label: 'Scheduled', icon: Clock },
  manual: { label: 'Manual', icon: Send },
}

/** Stops row click / Enter from firing when the event starts inside a control. */
const stop = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
}

/* ── Mutations shared by row + sheet ────────────────────────── */

function useDestinationMutations(d: TreasuryDestination, onChanged: () => void) {
  const toggle = useMutation({
    mutationFn: () =>
      api<{ destination: TreasuryDestination }>(
        `${BASE}/destinations/${encodeURIComponent(d.id)}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: !d.enabled }) },
      ),
    onSuccess: () => {
      toast.success(d.enabled ? 'Destination disabled' : 'Destination enabled')
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Update failed')),
  })

  const markVerified = useMutation({
    mutationFn: () =>
      api<{ destination: TreasuryDestination }>(
        `${BASE}/destinations/${encodeURIComponent(d.id)}/mark-verified`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      toast.success('Destination marked verified — you can enable it now')
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Could not mark verified')),
  })

  return { toggle, markVerified }
}

function eligibilityQuery(destinationId: string) {
  return {
    queryKey: [...TREASURY_KEY, 'destinations', destinationId] as const,
    queryFn: () =>
      api<{ destination: TreasuryDestination; eligibility: TreasuryEligibility }>(
        `${BASE}/destinations/${encodeURIComponent(destinationId)}`,
      ),
    refetchInterval: 30_000,
  }
}

/* ── Page ───────────────────────────────────────────────────── */

type ActionKind = 'verify' | 'transfer' | 'delete'

export function TreasuryPage() {
  const qc = useQueryClient()
  const destQ = useQuery(DESTINATIONS_Q)
  const chainsQ = useQuery(CHAINS_Q)
  const now = useNow(15_000)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TreasuryDestination | null>(null)
  const [transferFilter, setTransferFilter] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [action, setAction] = React.useState<{ kind: ActionKind; id: string } | null>(null)
  const destUrl = useUrlSheet('destination')
  const transferUrl = useUrlSheet('transfer')
  const sheet = destUrl.id ? { id: destUrl.id, open: destUrl.open } : null
  const transferSheet = transferUrl.id ? { id: transferUrl.id, open: transferUrl.open } : null
  const transfersRef = React.useRef<HTMLDivElement>(null)

  const transfersQ = useQuery({
    queryKey: [...TREASURY_KEY, 'transfers', transferFilter] as const,
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '50' })
      if (transferFilter !== 'all') qs.set('destinationId', transferFilter)
      return api<{ transfers: TreasuryTransfer[] }>(
        `${BASE}/transfers?${qs.toString()}`,
      )
    },
    refetchInterval: 30_000,
  })

  const chains = chainsQ.data?.chains
  const destinations = React.useMemo(
    () => destQ.data?.destinations ?? [],
    [destQ.data],
  )
  const transfers = React.useMemo(
    () => transfersQ.data?.transfers ?? [],
    [transfersQ.data],
  )

  // Destinations ordered by chain (display name), then token, label.
  const ordered = React.useMemo(
    () =>
      destinations
        .slice()
        .sort(
          (a, b) =>
            chainName(chains, a.chainId).localeCompare(chainName(chains, b.chainId)) ||
            a.token.localeCompare(b.token) ||
            a.label.localeCompare(b.label),
        ),
    [destinations, chains],
  )

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((d) =>
      [d.label, d.token, d.address, d.exchange, chainName(chains, d.chainId)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [ordered, search, chains])

  // Destinations that already have transfers cannot be deleted (409
  // TREASURY_IN_USE); `lastTransferId` is the server's signal, the current
  // transfer list is a belt-and-braces check.
  const destsWithTransfers = React.useMemo(() => {
    const s = new Set<string>()
    for (const d of destinations) if (d.lastTransferId) s.add(d.id)
    for (const t of transfers) s.add(t.destinationId)
    return s
  }, [destinations, transfers])

  const invalidate = () => qc.invalidateQueries({ queryKey: TREASURY_KEY })
  const decOf = (d: TreasuryDestination) =>
    findToken(chains, d.chainId, d.token)?.decimals ?? null

  const actionDest = action ? destinations.find((d) => d.id === action.id) : undefined
  const sheetDest = sheet ? destinations.find((d) => d.id === sheet.id) : undefined
  const sheetTransfer = transferSheet
    ? transfers.find((t) => t.id === transferSheet.id)
    : undefined

  const handlers: RowHandlers = {
    onOpen: (d) => destUrl.show(d.id),
    onAction: (kind, d) => setAction({ kind, id: d.id }),
    onEdit: (d) => setEditing(d),
    onShowTransfers: (d) => {
      setTransferFilter(d.id)
      destUrl.close()
      transfersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <>
            Treasury
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="How treasury works"
                  className="grid size-6 cursor-help place-items-center rounded-full text-[var(--fg-3)] hover:text-foreground"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-pretty font-normal">
                One allow-listed exchange address per chain and token. Refund-held
                credits and the float stay put; per-transfer and 24 h caps bound
                every run. New destinations start disabled: send a test transfer,
                confirm it arrived, mark verified, then enable.
              </TooltipContent>
            </Tooltip>
          </>
        }
        description="Sweeps pool balances to exchanges."
        actions={
          <>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => {
                destQ.refetch()
                transfersQ.refetch()
              }}
              disabled={destQ.isFetching}
            >
              <RefreshCw className={cn('size-4', destQ.isFetching && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Add destination
            </Button>
          </>
        }
      />

      <SummaryTiles
        destinations={destinations}
        transfers={transfers}
        loading={destQ.isLoading}
        transfersLoading={transfersQ.isLoading}
        filtered={transferFilter !== 'all'}
        now={now}
      />

      {destQ.isLoading ? (
        <ListSkeleton rows={4} />
      ) : destQ.isError ? (
        <ErrorState
          title="Could not load treasury destinations"
          message={destQ.error instanceof Error ? destQ.error.message : 'Error'}
        />
      ) : destinations.length === 0 ? (
        <NoDestinations onCreate={() => setCreateOpen(true)} />
      ) : (
        <DestinationsTable
          rows={visible}
          total={destinations.length}
          search={search}
          onSearch={setSearch}
          chains={chains}
          now={now}
          hasTransfers={destsWithTransfers}
          onChanged={invalidate}
          handlers={handlers}
        />
      )}

      <div ref={transfersRef} className="scroll-mt-6">
        <TransfersSection
          key={transferFilter}
          transfers={transfers}
          isLoading={transfersQ.isLoading}
          isFetching={transfersQ.isFetching}
          error={transfersQ.error}
          onRefresh={() => transfersQ.refetch()}
          destinations={destinations}
          chains={chains}
          filter={transferFilter}
          onFilterChange={setTransferFilter}
          onOpen={(t) => transferUrl.show(t.id)}
        />
      </div>

      {/* ── Dialogs + sheets ─────────────────────────────── */}

      <DestinationFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        chains={chains}
        onSaved={invalidate}
      />
      {editing && (
        <DestinationFormDialog
          key={editing.id}
          mode="edit"
          open
          onOpenChange={(v) => !v && setEditing(null)}
          destination={editing}
          chains={chains}
          onSaved={() => {
            invalidate()
            setEditing(null)
          }}
        />
      )}

      {action?.kind === 'verify' && actionDest && (
        <VerifyDialog
          d={actionDest}
          dec={decOf(actionDest)}
          onClose={() => setAction(null)}
          onChanged={invalidate}
        />
      )}
      {action?.kind === 'transfer' && actionDest && (
        <TransferDialog
          d={actionDest}
          dec={decOf(actionDest)}
          onClose={() => setAction(null)}
          onChanged={invalidate}
        />
      )}
      {action?.kind === 'delete' && actionDest && (
        <DeleteDestinationDialog
          d={actionDest}
          onClose={() => setAction(null)}
          onChanged={invalidate}
        />
      )}

      <Sheet
        open={!!sheet?.open && !!sheetDest}
        onOpenChange={(v) => !v && destUrl.close()}
      >
        {sheetDest && (
          <DestinationSheet
            key={sheetDest.id}
            d={sheetDest}
            chains={chains}
            now={now}
            hasTransfers={destsWithTransfers.has(sheetDest.id)}
            onChanged={invalidate}
            handlers={handlers}
          />
        )}
      </Sheet>

      <Sheet
        open={!!transferSheet?.open && !!sheetTransfer}
        onOpenChange={(v) =>
          !v && transferUrl.close()
        }
      >
        {sheetTransfer && (
          <TransferSheet
            key={sheetTransfer.id}
            t={sheetTransfer}
            dest={destinations.find((d) => d.id === sheetTransfer.destinationId)}
            chains={chains}
          />
        )}
      </Sheet>
    </div>
  )
}

type RowHandlers = {
  onOpen: (d: TreasuryDestination) => void
  onAction: (kind: ActionKind, d: TreasuryDestination) => void
  onEdit: (d: TreasuryDestination) => void
  onShowTransfers: (d: TreasuryDestination) => void
}

function NoDestinations({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      framed
      icon={Landmark}
      title="No destinations yet"
      description="Add one per chain and token. It starts disabled until verified."
      action={
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" /> Add destination
        </Button>
      }
    />
  )
}

/* ── Summary tiles ──────────────────────────────────────────── */

function StatTile({
  label,
  icon: Icon,
  value,
  sub,
  footer,
  loading,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-[var(--fg-2)]">
        {label}
        {Icon && <Icon className="size-4 text-[var(--fg-3)]" />}
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-24" /> : value}
      </div>
      <div className="mt-1 min-h-4 truncate text-xs text-[var(--fg-2)]">
        {loading ? <Skeleton className="h-3 w-20" /> : sub}
      </div>
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

function SummaryTiles({
  destinations,
  transfers,
  loading,
  transfersLoading,
  filtered,
  now,
}: {
  destinations: TreasuryDestination[]
  transfers: TreasuryTransfer[]
  loading: boolean
  transfersLoading: boolean
  filtered: boolean
  now: number
}) {
  const s = React.useMemo(() => {
    const byChain = new Map<number, number>()
    for (const d of destinations) byChain.set(d.chainId, (byChain.get(d.chainId) ?? 0) + 1)
    const verified = destinations.filter((d) => d.verifiedAt != null).length
    const enabled = destinations.filter((d) => d.enabled).length
    const auto = destinations.filter((d) => d.autoIntervalHours != null).length
    const overdue = destinations.filter(
      (d) => d.enabled && d.autoIntervalHours != null && d.nextRunDue != null && d.nextRunDue < now,
    ).length
    const volume = transfers.reduce((a, t) => a + num(t.plannedUsd), 0)
    const inFlight = transfers.filter((t) => pendingLegs(t.status) > 0).length
    const days = dailyBuckets(transfers, (t) => t.createdAt, (t) => num(t.plannedUsd), 14)
    return { byChain, verified, enabled, auto, overdue, volume, inFlight, days }
  }, [destinations, transfers, now])
  const total = destinations.length

  return (
    <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Destinations"
        icon={Landmark}
        loading={loading}
        value={total}
        sub={`${s.byChain.size} chain${s.byChain.size === 1 ? '' : 's'}`}
        footer={
          <SegmentedBar
            parts={[...s.byChain.entries()].map(([chainId, n]) => ({
              key: String(chainId),
              name: chainInfo(chainId).name,
              value: n,
              color: chainInfo(chainId).color,
            }))}
          />
        }
      />
      <StatTile
        label="Verified"
        icon={BadgeCheck}
        loading={loading}
        value={
          <>
            {s.verified}
            <span className="text-base font-medium text-[var(--fg-3)]"> / {total}</span>
          </>
        }
        sub={total - s.verified > 0 ? `${total - s.verified} awaiting` : 'All verified'}
        footer={
          <SegmentedBar
            parts={[
              { key: 'ok', name: 'Verified', value: s.verified, color: 'var(--st-ok-dot)' },
              { key: 'wait', name: 'Awaiting', value: total - s.verified, color: 'var(--st-warn-dot)' },
            ]}
          />
        }
      />
      <StatTile
        label="Enabled"
        icon={Play}
        loading={loading}
        value={s.enabled}
        sub={
          s.overdue > 0 ? (
            <span className="text-[var(--st-warn)]">{s.overdue} overdue</span>
          ) : (
            `${s.auto} scheduled`
          )
        }
        footer={
          <SegmentedBar
            parts={[
              { key: 'on', name: 'Enabled', value: s.enabled, color: 'var(--chart-1-fill)' },
              { key: 'off', name: 'Disabled', value: total - s.enabled, color: 'var(--chart-muted)' },
            ]}
          />
        }
      />
      <StatTile
        label={filtered ? 'Volume · filtered' : 'Transfer volume'}
        icon={ArrowsLeftRight}
        loading={transfersLoading}
        value={fmtUsd(s.volume)}
        sub={`${transfers.length} transfer${transfers.length === 1 ? '' : 's'}${s.inFlight ? ` · ${s.inFlight} in flight` : ''}`}
        footer={<SparkBars values={s.days} height={32} />}
      />
    </div>
  )
}

/* ── Destinations table ─────────────────────────────────────── */

function DestinationsTable({
  rows,
  total,
  search,
  onSearch,
  chains,
  now,
  hasTransfers,
  onChanged,
  handlers,
}: {
  rows: TreasuryDestination[]
  total: number
  search: string
  onSearch: (v: string) => void
  chains: ChainInventoryEntry[] | undefined
  now: number
  hasTransfers: Set<string>
  onChanged: () => void
  handlers: RowHandlers
}) {
  const paged = usePaged(rows, PAGE_SIZE)
  return (
    <TableCard
      toolbar={
        <TableToolbar title="Destinations" count={total}>
          <TableSearch value={search} onChange={onSearch} placeholder="Search destinations" />
        </TableToolbar>
      }
      footer={
        <Pager
          page={paged.page}
          pageSize={PAGE_SIZE}
          total={paged.total}
          hasNext={paged.page < paged.pageCount - 1}
          onPage={paged.setPage}
          noun="destinations"
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact title="No matches" action={
          <Button size="sm" variant="outline" onClick={() => onSearch('')}>Clear search</Button>
        } />
      ) : (
        <TableWrap>
          <Table className="min-w-[940px]">
            <THead>
              <tr>
                <Th>Destination</Th>
                <Th>Network</Th>
                <Th>Status</Th>
                <Th align="right">Caps</Th>
                <Th>Schedule</Th>
                <Th align="right">Last run</Th>
                <Th className="w-0" aria-label="Actions" />
              </tr>
            </THead>
            <TBody>
              {paged.rows.map((d) => (
                <DestinationRow
                  key={d.id}
                  d={d}
                  chains={chains}
                  now={now}
                  hasTransfers={hasTransfers.has(d.id)}
                  onChanged={onChanged}
                  handlers={handlers}
                />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </TableCard>
  )
}

function DestinationRow({
  d,
  chains,
  now,
  hasTransfers,
  onChanged,
  handlers,
}: {
  d: TreasuryDestination
  chains: ChainInventoryEntry[] | undefined
  now: number
  hasTransfers: boolean
  onChanged: () => void
  handlers: RowHandlers
}) {
  const g = gatingOf(d)
  const auto = d.autoIntervalHours != null
  const overdue = d.enabled && auto && d.nextRunDue != null && d.nextRunDue < now
  const st = destinationTone(d)
  const open = () => handlers.onOpen(d)

  return (
    <Tr
      interactive
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
    >
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <TokenOnChain symbol={d.token} chainId={d.chainId} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <span className="truncate">{d.label}</span>
              <Badge variant="outline" className="capitalize">
                {d.exchange}
              </Badge>
            </div>
            <div className="flex items-center gap-1 text-xs text-[var(--fg-3)]" {...stop}>
              <span className="font-mono">{d.token}</span>
              <span>·</span>
              <Addr value={d.address} chainId={d.chainId} />
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <ChainPill chainId={d.chainId} className="max-w-[160px]" />
        <span className="sr-only">{chainName(chains, d.chainId)}</span>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1.5">
          <span title={st.tone === 'warn' ? 'Awaiting verification' : undefined}>
            <StatusPill tone={st.tone}>{st.label}</StatusPill>
          </span>
          {overdue && <StatusPill tone="warn">Overdue</StatusPill>}
        </div>
      </Td>
      <Td align="right" className="whitespace-nowrap" title={`min ${fmtUsd(d.minTransferUsd)}`}>
        <div className="font-medium">{fmtUsd(d.maxPerTransferUsd)}</div>
        <div className="text-xs text-[var(--fg-2)]">{fmtUsd(d.maxDailyUsd)} / day</div>
      </Td>
      <Td className="whitespace-nowrap">
        {auto ? (
          <>
            <div className="flex items-center gap-1.5 text-sm">
              <Timer className="size-4 text-[var(--fg-3)]" />
              Every {d.autoIntervalHours}h
            </div>
            {d.nextRunDue != null && (
              <div
                className={cn('text-xs', overdue ? 'text-[var(--st-warn)]' : 'text-[var(--fg-2)]')}
                title={fmtLocal(d.nextRunDue)}
              >
                next {fmtRelDelta(d.nextRunDue - now)}
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-[var(--fg-2)]">Manual</span>
        )}
      </Td>
      <Td
        align="right"
        className="text-sm whitespace-nowrap text-[var(--fg-2)]"
        title={d.lastRunAt != null ? fmtLocal(d.lastRunAt) : undefined}
      >
        {d.lastRunAt != null ? fmtRelDelta(d.lastRunAt - now) : 'Never'}
      </Td>
      <Td className="w-0">
        <div className="flex items-center justify-end gap-1" {...stop}>
          <span title={g.transferTitle}>
            <Button
              size="sm"
              disabled={!g.canTransfer}
              onClick={() => handlers.onAction('transfer', d)}
            >
              <Send className="size-4" /> Transfer now
            </Button>
          </span>
          <DestinationMenu
            d={d}
            hasTransfers={hasTransfers}
            onChanged={onChanged}
            handlers={handlers}
          />
        </div>
      </Td>
    </Tr>
  )
}

/** Menu item with a second muted line (used to explain a disabled item). */
function MenuText({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      {hint && <span className="text-xs text-[var(--fg-3)]">{hint}</span>}
    </span>
  )
}

function DestinationMenu({
  d,
  hasTransfers,
  onChanged,
  handlers,
  align = 'end',
  trigger = 'ghost',
}: {
  d: TreasuryDestination
  hasTransfers: boolean
  onChanged: () => void
  handlers: RowHandlers
  align?: 'start' | 'end'
  trigger?: 'ghost' | 'outline'
}) {
  const g = gatingOf(d)
  const { toggle, markVerified } = useDestinationMutations(d, onChanged)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant={trigger} aria-label="Destination actions" title="More">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <DropdownMenuItem
          title="Send a small test transfer to this address"
          onSelect={() => handlers.onAction('verify', d)}
        >
          <FlaskConical /> Send test transfer
        </DropdownMenuItem>
        {!g.verified && (
          <DropdownMenuItem
            disabled={markVerified.isPending}
            title="After the test transfer confirmed on-chain and arrived at the exchange"
            onSelect={() => markVerified.mutate()}
          >
            {markVerified.isPending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
            Mark verified
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={g.toggleBlocked || toggle.isPending}
          title={g.toggleTitle}
          onSelect={() => toggle.mutate()}
        >
          {d.enabled ? <Pause /> : <Play />}
          <MenuText
            label={d.enabled ? 'Disable' : 'Enable'}
            hint={g.toggleBlocked ? g.toggleTitle : undefined}
          />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onEdit(d)}>
          <Pencil /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onShowTransfers(d)}>
          <ArrowsLeftRight /> Show transfers
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={hasTransfers}
          onSelect={() => handlers.onAction('delete', d)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 />
          <MenuText
            label="Delete"
            hint={hasTransfers ? 'Has transfers — disable it instead' : undefined}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ── Destination detail sheet ───────────────────────────────── */

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

const Muted = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[var(--fg-3)]">{children}</span>
)

type DestTab = 'overview' | 'eligibility'

function DestinationSheet({
  d,
  chains,
  now,
  hasTransfers,
  onChanged,
  handlers,
}: {
  d: TreasuryDestination
  chains: ChainInventoryEntry[] | undefined
  now: number
  hasTransfers: boolean
  onChanged: () => void
  handlers: RowHandlers
}) {
  const [tab, setTab] = React.useState<DestTab>('overview')
  const q = useQuery(eligibilityQuery(d.id))
  const { toggle, markVerified } = useDestinationMutations(d, onChanged)
  const g = gatingOf(d)
  const st = destinationTone(d)
  const dec = findToken(chains, d.chainId, d.token)?.decimals ?? null
  const auto = d.autoIntervalHours != null
  const overdue = d.enabled && auto && d.nextRunDue != null && d.nextRunDue < now
  const elig = q.data?.eligibility

  return (
    <SheetContent>
      <SheetHero
        icon={Landmark}
        title={d.label}
        meta={
          <>
            <StatusPill tone={st.tone}>
              {st.tone === 'warn' ? 'Awaiting verification' : st.label}
            </StatusPill>
            {overdue && <StatusPill tone="warn">Overdue</StatusPill>}
            <ChainPill chainId={d.chainId} />
            <span className="inline-flex items-center gap-1.5">
              <TokenIcon symbol={d.token} size={16} />
              {d.token}
            </span>
          </>
        }
        actions={<CopyButton value={d.address} label="Copy address" />}
      >
        <DestinationHero d={d} elig={elig} loading={q.isLoading} dec={dec} />
      </SheetHero>

      <SheetTabs<DestTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview', icon: ListBullets },
          {
            value: 'eligibility',
            label: 'Eligibility',
            icon: Scale,
            count: elig?.sources.length,
          },
        ]}
      />

      <SheetBody key={tab} className="fade-in">
        {tab === 'overview' ? (
          <div className="space-y-6">
            <SheetSection title="Route">
              <dl className="divide-y divide-border rounded-xl border border-border">
                <Fact icon={Wallet} label="Address">
                  <Addr
                    value={d.address}
                    chainId={d.chainId}
                    truncated={false}
                    className="max-w-full justify-end"
                  />
                </Fact>
                {d.memo && (
                  <Fact icon={Tag} label="Memo">
                    <span className="font-mono text-xs">{d.memo}</span>
                  </Fact>
                )}
                <Fact icon={Landmark} label="Exchange">
                  <span className="capitalize">{d.exchange}</span>
                </Fact>
                <Fact icon={Coins} label="Exchange min">
                  <span className="figure">{fmtAmt(d.exchangeMinRaw, dec, d.token)}</span>
                </Fact>
                <Fact icon={Layers} label="Float kept">
                  <span className="figure" title="Always left for store payouts">
                    {fmtAmt(d.keepFloatRaw, dec, d.token)}
                  </span>
                </Fact>
              </dl>
            </SheetSection>

            <SheetSection title="Caps" icon={Gauge}>
              <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border">
                {[
                  ['Min', d.minTransferUsd],
                  ['Per transfer', d.maxPerTransferUsd],
                  ['Daily', d.maxDailyUsd],
                ].map(([label, v]) => (
                  <div key={label} className="px-4 py-3">
                    <div className="text-xs text-[var(--fg-2)]">{label}</div>
                    <div className="figure mt-0.5 text-base font-semibold">{fmtUsd(v)}</div>
                  </div>
                ))}
              </div>
            </SheetSection>

            <SheetSection title="Schedule" icon={CalendarClock}>
              <dl className="divide-y divide-border rounded-xl border border-border">
                <Fact icon={Timer} label="Interval">
                  {auto ? `Every ${d.autoIntervalHours}h` : <Muted>Manual only</Muted>}
                </Fact>
                <Fact icon={Clock} label="Next run">
                  {auto && d.nextRunDue != null ? (
                    <span className={cn('figure', overdue && 'text-[var(--st-warn)]')}>
                      {fmtLocal(d.nextRunDue)}{' '}
                      <Muted>({fmtRelDelta(d.nextRunDue - now)})</Muted>
                    </span>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Fact>
                <Fact icon={Clock} label="Last run">
                  {d.lastRunAt != null ? (
                    <span className="figure">
                      {fmtLocal(d.lastRunAt)} <Muted>({fmtRelDelta(d.lastRunAt - now)})</Muted>
                    </span>
                  ) : (
                    <Muted>Never</Muted>
                  )}
                </Fact>
                <Fact icon={ArrowsLeftRight} label="Last transfer">
                  {d.lastTransferId ? <Addr value={d.lastTransferId} /> : <Muted>—</Muted>}
                </Fact>
                <Fact icon={BadgeCheck} label="Verified">
                  {g.verified ? (
                    <span className="figure">{fmtLocal(d.verifiedAt)}</span>
                  ) : (
                    <Muted>Not yet</Muted>
                  )}
                </Fact>
                <Fact icon={Calendar} label="Created">
                  <span className="figure">{fmtLocal(d.createdAt)}</span>
                </Fact>
              </dl>
            </SheetSection>
          </div>
        ) : q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : q.isError ? (
          <ErrorState
            title="Could not load eligibility"
            message={errText(q.error, 'Could not load eligibility')}
          />
        ) : elig ? (
          <EligibilityView e={elig} token={d.token} sources="open" />
        ) : null}
      </SheetBody>

      <SheetFooter className="flex-wrap justify-between">
        <DestinationMenu
          d={d}
          hasTransfers={hasTransfers}
          onChanged={onChanged}
          handlers={handlers}
          align="start"
          trigger="outline"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!g.verified ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlers.onAction('verify', d)}
                title="Send a small test transfer to this address"
              >
                <FlaskConical className="size-4" /> Verify
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => markVerified.mutate()}
                disabled={markVerified.isPending}
                title="After the test transfer confirmed on-chain and arrived at the exchange"
              >
                {markVerified.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BadgeCheck className="size-4" />
                )}
                Mark verified
              </Button>
            </>
          ) : (
            <span title={g.toggleTitle}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggle.mutate()}
                disabled={g.toggleBlocked || toggle.isPending}
              >
                {d.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
                {d.enabled ? 'Disable' : 'Enable'}
              </Button>
            </span>
          )}
          <span title={g.transferTitle}>
            <Button
              size="sm"
              disabled={!g.canTransfer}
              onClick={() => handlers.onAction('transfer', d)}
            >
              <Send className="size-4" /> Transfer now
            </Button>
          </span>
        </div>
      </SheetFooter>
    </SheetContent>
  )
}

/** Budget now + setup lifecycle under the sheet title. */
function DestinationHero({
  d,
  elig,
  loading,
  dec,
}: {
  d: TreasuryDestination
  elig: TreasuryEligibility | undefined
  loading: boolean
  dec: number | null
}) {
  const verified = d.verifiedAt != null
  const steps = [
    { key: 'added', label: 'Added', done: true },
    { key: 'test', label: 'Test sent', done: verified || d.lastTransferId != null },
    { key: 'verified', label: 'Verified', done: verified },
    { key: 'enabled', label: 'Enabled', done: d.enabled },
  ]
  const nextIdx = steps.findIndex((s) => !s.done)
  return (
    <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-[var(--fg-2)]">Budget now</div>
          {loading ? (
            <Skeleton className="mt-1 h-8 w-40" />
          ) : elig ? (
            <div className="figure mt-0.5 flex items-center gap-2 truncate text-2xl font-semibold">
              <TokenIcon symbol={d.token} size={22} />
              {fmtAmt(elig.budgetRaw, elig.decimals ?? dec, d.token)}
            </div>
          ) : (
            <div className="figure mt-0.5 text-2xl font-semibold text-[var(--fg-3)]">—</div>
          )}
          {elig && <div className="figure text-xs text-[var(--fg-2)]">{fmtUsd(elig.budgetUsd)}</div>}
        </div>
        <div className="shrink-0 text-right text-xs text-[var(--fg-2)]">
          {elig?.blocked ? (
            <span title={BLOCKED_TEXT[elig.blocked]}>
              <StatusPill tone="warn">Blocked</StatusPill>
            </span>
          ) : (
            <>
              <div>Daily left</div>
              <div className="figure text-base font-semibold text-foreground">
                {elig ? fmtUsd(elig.dailyRemainingUsd) : '—'}
              </div>
            </>
          )}
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <li key={s.key} className="min-w-0">
            <div
              className={cn(
                'h-1.5 rounded-full',
                s.done
                  ? 'bg-[var(--st-ok-dot)]'
                  : i === nextIdx
                    ? 'bg-[var(--st-warn-dot)]'
                    : 'bg-[var(--chart-muted)]',
              )}
            />
            <div
              className={cn(
                'mt-1.5 truncate text-xs',
                s.done || i === nextIdx ? 'font-medium text-foreground' : 'text-[var(--fg-3)]',
              )}
            >
              {s.label}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ── Eligibility ────────────────────────────────────────────── */

function EligibilityView({
  e,
  token,
  sources,
}: {
  e: TreasuryEligibility
  token: string
  sources: 'open' | 'collapsed'
}) {
  const dec = e.decimals
  return (
    <div className="space-y-4">
      {e.blocked && (
        <Callout tone="warn">
          Blocked — <span className="font-mono">{e.blocked}</span>:{' '}
          {BLOCKED_TEXT[e.blocked]}
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Metric label="Spendable" value={fmtAmt(e.spendableRaw, dec, token)} />
        <Metric
          label={`Held · ${e.holdHours} h`}
          title={`Held for refunds · ${e.holdHours} h hold`}
          value={fmtAmt(e.heldForRefundsRaw, dec, token)}
        />
        <Metric label="Float kept" value={fmtAmt(e.keepFloatRaw, dec, token)} />
        <Metric label="Rate" value={`1 ${token} = $${fmtNum(e.usdRate, 4)}`} />
        <Metric label="Per-transfer cap" value={fmtUsd(e.perTransferCapUsd)} />
        <Metric label="Daily remaining" value={fmtUsd(e.dailyRemainingUsd)} />
        <Metric
          label="Sources"
          value={String(e.sources.length)}
          sub={`${e.sources.filter((s) => s.eligibleRaw !== '0').length} eligible`}
        />
        <Metric
          label="Budget now"
          value={fmtAmt(e.budgetRaw, dec, token)}
          sub={fmtUsd(e.budgetUsd)}
          accent={e.blocked == null && e.budgetRaw !== '0'}
        />
      </div>
      {sources === 'open' ? (
        <SheetSection title="Sources" icon={Wallet}>
          <SourcesTable e={e} token={token} />
        </SheetSection>
      ) : (
        <details className="group text-sm">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--fg-2)] select-none hover:text-foreground">
            <Wallet className="size-4" />
            {e.sources.length} source{e.sources.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2">
            <SourcesTable e={e} token={token} />
          </div>
        </details>
      )}
    </div>
  )
}

/** One cell of the eligibility grid. */
function Metric({
  label,
  title,
  value,
  sub,
  accent,
}: {
  label: string
  title?: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={cn('min-w-0 px-3 py-2.5', accent ? 'bg-[var(--accent-bg)]' : 'bg-card')}>
      <div className="truncate text-xs text-[var(--fg-2)]" title={title ?? label}>
        {label}
      </div>
      <div className="figure mt-0.5 truncate text-sm font-semibold" title={value}>
        {value}
      </div>
      {sub && <div className="figure truncate text-xs text-[var(--fg-2)]">{sub}</div>}
    </div>
  )
}

function SourcesTable({ e, token }: { e: TreasuryEligibility; token: string }) {
  const dec = e.decimals
  if (e.sources.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-[var(--fg-2)]">
        No pool source holds this token.
      </div>
    )
  return (
    <TableWrap className="rounded-xl border border-border bg-card">
      <Table className="min-w-[460px] text-sm">
        <THead>
          <tr>
            <Th>Source</Th>
            <Th align="right">Spendable</Th>
            <Th align="right">Held</Th>
            <Th align="right">Eligible</Th>
          </tr>
        </THead>
        <TBody>
          {e.sources.map((s) => (
            <Tr key={s.address}>
              <Td className="h-11">
                <Addr value={s.address} chainId={e.chainId} />
              </Td>
              <Td align="right" className="h-11">
                {formatUnits(s.spendableRaw, dec)}
              </Td>
              <Td align="right" className="h-11 text-[var(--fg-2)]">
                {formatUnits(s.heldRaw, dec)}
              </Td>
              <Td
                align="right"
                className={cn(
                  'h-11 font-medium',
                  s.eligibleRaw !== '0' ? 'text-[var(--st-ok)]' : 'text-[var(--fg-3)]',
                )}
              >
                {formatUnits(s.eligibleRaw, dec)} {token}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

/* ── Verify dialog ──────────────────────────────────────────── */

function VerifyDialog({
  d,
  dec,
  onClose,
  onChanged,
}: {
  d: TreasuryDestination
  dec: number | null
  onClose: () => void
  onChanged: () => void
}) {
  const [amount, setAmount] = React.useState('')
  const [result, setResult] = React.useState<TreasuryTransfer | null>(null)

  const verify = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      const a = amount.trim()
      if (a) {
        const raw = toRaw(a, dec)
        if (raw == null)
          throw new ApiError(
            dec != null
              ? `Amount must be a decimal with at most ${dec} places`
              : 'Amount must be a raw integer (token decimals unknown)',
            400,
          )
        body.amountRaw = raw
      }
      return api<{ transfer: TreasuryTransfer }>(
        `${BASE}/destinations/${encodeURIComponent(d.id)}/verify`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: (r) => {
      setResult(r.transfer)
      toast.success(
        `Verification transfer planned: ${fmtAmt(r.transfer.plannedAmountRaw, dec, d.token)}`,
      )
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Verification failed')),
  })

  const previewRaw = amount.trim() ? toRaw(amount, dec) : null

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-5" /> Verify {d.label}
          </DialogTitle>
          <DialogDescription>
            Sends one small test payout from the pool to{' '}
            <Addr value={d.address} chainId={d.chainId} truncated={false} className="align-middle" /> on{' '}
            {chainInfo(d.chainId).name} ({d.token}). Once the leg is confirmed
            on-chain and you have seen it arrive at the exchange, come back and
            click <span className="font-medium">Mark verified</span>.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <TransferSummary t={result} dec={dec} token={d.token} chainId={d.chainId} />
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              verify.mutate()
            }}
          >
            <Field
              label={`Amount (${d.token}, optional)`}
              hint={
                <>
                  Empty = server default: max(2 × exchange minimum, ≈ $5).
                  Exchange minimum for this destination:{' '}
                  <span className="font-mono text-[var(--fg-2)]">
                    {fmtAmt(d.exchangeMinRaw, dec, d.token)}
                  </span>
                  .{' '}
                  {amount.trim() && (
                    <span className="font-mono text-[var(--fg-2)]">
                      {previewRaw != null ? `raw ${previewRaw}` : 'invalid amount'}
                    </span>
                  )}
                </>
              }
            >
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
                  <TokenIcon symbol={d.token} size={16} />
                </span>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-8 font-mono"
                  placeholder={dec != null ? 'e.g. 10' : 'raw smallest unit'}
                />
              </div>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={verify.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={verify.isPending}>
                {verify.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {verify.isPending ? 'Sending…' : 'Send test transfer'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Transfer-now dialog (limit → dry run → confirm) ────────── */

function TransferDialog({
  d,
  dec,
  onClose,
  onChanged,
}: {
  d: TreasuryDestination
  dec: number | null
  onClose: () => void
  onChanged: () => void
}) {
  const [step, setStep] = React.useState<'limit' | 'review'>('limit')
  const [maxUsdInput, setMaxUsdInput] = React.useState('')
  // The value the preview was computed with; applied explicitly so typing
  // does not fire a dry-run per keystroke.
  const [maxUsd, setMaxUsd] = React.useState('')
  const [result, setResult] = React.useState<{
    transfer: TreasuryTransfer
    eligibility: TreasuryEligibility
  } | null>(null)

  const preview = useQuery({
    // Deliberately outside TREASURY_KEY: the dry run is request-scoped and
    // must not be refetched by the post-mutation invalidation.
    queryKey: ['gw', 'treasury-dry-run', d.id, maxUsd] as const,
    queryFn: () =>
      api<{ eligibility: TreasuryEligibility }>(
        `${BASE}/destinations/${encodeURIComponent(d.id)}/transfer`,
        {
          method: 'POST',
          body: JSON.stringify(
            maxUsd ? { dryRun: true, maxUsd } : { dryRun: true },
          ),
        },
      ),
    enabled: result == null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const send = useMutation({
    mutationFn: () =>
      api<{ transfer: TreasuryTransfer; eligibility: TreasuryEligibility }>(
        `${BASE}/destinations/${encodeURIComponent(d.id)}/transfer`,
        { method: 'POST', body: JSON.stringify(maxUsd ? { maxUsd } : {}) },
      ),
    onSuccess: (r) => {
      setResult(r)
      toast.success(
        `Transfer planned: ${r.transfer.legCount} leg${r.transfer.legCount === 1 ? '' : 's'}, ${fmtAmt(r.transfer.plannedAmountRaw, dec, d.token)}`,
      )
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Transfer failed')),
  })

  /** Validates and applies the limit; false when the input is not a USD decimal. */
  const applyMax = (): boolean => {
    const s = maxUsdInput.trim()
    if (s && !isUsd(s)) {
      toast.error('Max USD must be a decimal (e.g. 1500.00)')
      return false
    }
    setMaxUsd(s)
    return true
  }
  const toReview = () => {
    if (applyMax()) setStep('review')
  }

  const elig = preview.data?.eligibility
  const canSend =
    elig != null &&
    elig.blocked == null &&
    elig.budgetRaw !== '0' &&
    !preview.isFetching &&
    !send.isPending

  const stage = result ? 2 : step === 'review' ? 1 : 0

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-5" /> Transfer to {d.label}
          </DialogTitle>
          <DialogDescription>
            The preview is a dry run against the live ledger — nothing moves
            until you confirm. Legs are planned as payouts from the pool
            sources below to{' '}
            <Addr value={d.address} chainId={d.chainId} truncated={false} className="align-middle" />.
          </DialogDescription>
        </DialogHeader>

        <StepBar steps={['Limit', 'Review dry run', 'Planned']} current={stage} />

        {result ? (
          <>
            <TransferSummary t={result.transfer} dec={dec} token={d.token} chainId={d.chainId} />
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : step === 'limit' ? (
          <form
            key="limit"
            className="fade-in space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              toReview()
            }}
          >
            <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3">
              <TokenOnChain symbol={d.token} chainId={d.chainId} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.label}</div>
                <div className="text-[var(--fg-2)]">
                  <Addr value={d.address} chainId={d.chainId} />
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-[var(--fg-2)]">
                <div className="figure text-sm font-semibold text-foreground">
                  {fmtUsd(d.maxPerTransferUsd)}
                </div>
                cap / transfer
              </div>
            </div>
            <Field
              label="Max USD this run (optional)"
              hint="Lower than the per-transfer cap only; empty = use the destination's cap."
            >
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-[var(--fg-3)]">
                  $
                </span>
                <Input
                  autoFocus
                  inputMode="decimal"
                  value={maxUsdInput}
                  onChange={(e) => setMaxUsdInput(e.target.value)}
                  className="pl-6 font-mono"
                  placeholder={`e.g. 1500 — cap ${fmtUsd(d.maxPerTransferUsd)}`}
                />
              </div>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Review dry run <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div key="review" className="fade-in space-y-5">
            {preview.isLoading || (preview.isFetching && !elig) ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-[var(--bg-2)] px-3 py-8 text-sm text-[var(--fg-2)]">
                <Loader2 className="size-4 animate-spin" /> Running dry run…
              </div>
            ) : preview.isError ? (
              <Callout tone="danger">
                {errText(preview.error, 'Dry run failed')}
              </Callout>
            ) : elig ? (
              <>
                <div
                  className={cn(
                    'flex items-end justify-between gap-4 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3.5 transition-opacity',
                    preview.isFetching && 'opacity-60',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--fg-2)]">Would send now</div>
                    <div className="figure mt-0.5 flex items-center gap-2 truncate text-2xl font-semibold">
                      <TokenIcon symbol={d.token} size={22} />
                      {fmtAmt(elig.budgetRaw, dec, d.token)}
                    </div>
                    <div className="figure text-xs text-[var(--fg-2)]">{fmtUsd(elig.budgetUsd)}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-[var(--fg-2)]">
                    <div>{maxUsd ? 'Run limit' : 'Cap'}</div>
                    <div className="figure text-base font-semibold text-foreground">
                      {fmtUsd(maxUsd || d.maxPerTransferUsd)}
                    </div>
                  </div>
                </div>
                <EligibilityView e={elig} token={d.token} sources="collapsed" />
              </>
            ) : null}

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('limit')}
                disabled={send.isPending}
              >
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                type="button"
                onClick={() => send.mutate()}
                disabled={!canSend}
                title={
                  elig?.blocked
                    ? BLOCKED_TEXT[elig.blocked]
                    : elig && elig.budgetRaw === '0'
                      ? 'Nothing to send'
                      : undefined
                }
              >
                {send.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {send.isPending
                  ? 'Sending…'
                  : elig
                    ? `Confirm · ${fmtAmt(elig.budgetRaw, dec, d.token)}`
                    : 'Confirm transfer'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Horizontal progress for multi-step money dialogs. */
function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s} className="min-w-0">
          <div
            className={cn(
              'h-1.5 rounded-full transition-colors',
              i < current || (i === current && i === steps.length - 1)
                ? 'bg-[var(--st-ok-dot)]'
                : i === current
                  ? 'bg-foreground'
                  : 'bg-[var(--chart-muted)]',
            )}
          />
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1.5 truncate text-xs',
              i <= current ? 'font-medium text-foreground' : 'text-[var(--fg-3)]',
            )}
          >
            <span className="figure text-[var(--fg-3)]">{i + 1}</span>
            {s}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ── Transfer rendering (shared) ───────────────────────────── */

function ModeLabel({ mode }: { mode: TreasuryTransfer['mode'] }) {
  const m = MODE_META[mode]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--fg-1)]">
      <Icon className="size-4 text-[var(--fg-3)]" />
      {m.label}
    </span>
  )
}

function legParts(s: TreasuryTransfer['status']) {
  return [
    { key: 'confirmed', name: 'Confirmed', value: s.confirmed, color: 'var(--st-ok-dot)' },
    { key: 'pending', name: 'Pending', value: pendingLegs(s), color: 'var(--st-run-dot)' },
    { key: 'failed', name: 'Failed', value: s.failed, color: 'var(--st-bad-dot)' },
    { key: 'canceled', name: 'Canceled', value: s.canceled, color: 'var(--st-wait-dot)' },
  ]
}

/** Every non-zero leg count as a pill (the full breakdown). */
function LegPills({ status }: { status: TreasuryTransfer['status'] }) {
  const pending = pendingLegs(status)
  const total = pending + status.confirmed + status.failed + status.canceled
  if (total === 0) return <StatusPill tone="wait">No legs</StatusPill>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {pending > 0 && <StatusPill tone="run">{pending} pending</StatusPill>}
      {status.confirmed > 0 && <StatusPill tone="ok">{status.confirmed} confirmed</StatusPill>}
      {status.failed > 0 && <StatusPill tone="bad">{status.failed} failed</StatusPill>}
      {status.canceled > 0 && <StatusPill tone="off">{status.canceled} canceled</StatusPill>}
    </span>
  )
}

function TransferSummary({
  t,
  dec,
  token,
  chainId,
}: {
  t: TreasuryTransfer
  dec: number | null
  token: string
  chainId?: number
}) {
  return (
    <div className="fade-in space-y-4 rounded-xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--fg-2)]">
            <CheckCircle2 className="size-4 text-[var(--st-ok)]" /> Planned
          </div>
          <div className="figure mt-1 flex items-center gap-2 truncate text-2xl font-semibold">
            {token && <TokenIcon symbol={token} size={22} />}
            {fmtAmt(t.plannedAmountRaw, dec, token)}
          </div>
          <div className="figure text-xs text-[var(--fg-2)]">
            {fmtUsd(t.plannedUsd)} · {t.legCount} leg{t.legCount === 1 ? '' : 's'}
            {t.skippedCount > 0 && ` · ${t.skippedCount} skipped`}
            {t.status.confirmedAmountRaw !== '0' &&
              ` · confirmed ${fmtAmt(t.status.confirmedAmountRaw, dec, token)}`}
          </div>
        </div>
        <ModeLabel mode={t.mode} />
      </div>
      <LegPills status={t.status} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--fg-2)]">
        <span className="inline-flex items-center gap-1">
          <Hash className="size-3.5" /> transfer <Addr value={t.id} />
        </span>
        <span className="inline-flex items-center gap-1">
          <Layers className="size-3.5" /> batch <Addr value={t.batchId} />
        </span>
        <span className="figure">{fmtLocal(t.createdAt)}</span>
      </div>
      {t.skippedReasons.length > 0 && (
        <SkippedReasonsList reasons={t.skippedReasons} dec={dec} token={token} chainId={chainId} />
      )}
    </div>
  )
}

function SkippedReasonsList({
  reasons,
  dec,
  token,
  chainId,
}: {
  reasons: TreasuryTransfer['skippedReasons']
  dec: number | null
  token: string
  chainId?: number
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 text-xs text-[var(--st-warn)] hover:underline"
      >
        <AlertTriangle className="size-3.5" />
        {open ? 'Hide' : 'Show'} skipped sources · {reasons.length}
      </button>
      {open && <SkippedList reasons={reasons} dec={dec} token={token} chainId={chainId} className="mt-2" />}
    </div>
  )
}

function SkippedList({
  reasons,
  dec,
  token,
  chainId,
  className,
}: {
  reasons: TreasuryTransfer['skippedReasons']
  dec: number | null
  token: string
  chainId?: number
  className?: string
}) {
  return (
    <ul className={cn('divide-y divide-border overflow-hidden rounded-xl border border-border bg-card', className)}>
      {reasons.slice(0, 50).map((r) => (
        <li
          key={r.sourceAddress + r.amountRaw + r.reason}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0 text-[var(--st-warn)]" />
          <Addr value={r.sourceAddress} chainId={chainId} />
          <span className="figure text-[var(--fg-1)]">{fmtAmt(r.amountRaw, dec, token)}</span>
          <span
            className="ml-auto max-w-full truncate font-mono text-xs text-[var(--fg-2)] sm:max-w-[260px]"
            title={r.reason}
          >
            {r.reason}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ── Recent transfers ───────────────────────────────────────── */

function TransfersSection({
  transfers,
  isLoading,
  isFetching,
  error,
  onRefresh,
  destinations,
  chains,
  filter,
  onFilterChange,
  onOpen,
}: {
  transfers: TreasuryTransfer[]
  isLoading: boolean
  isFetching: boolean
  error: unknown
  onRefresh: () => void
  destinations: TreasuryDestination[]
  chains: ChainInventoryEntry[] | undefined
  filter: string
  onFilterChange: (v: string) => void
  onOpen: (t: TreasuryTransfer) => void
}) {
  const byId = React.useMemo(
    () => new Map(destinations.map((d) => [d.id, d])),
    [destinations],
  )
  const paged = usePaged(transfers, PAGE_SIZE)
  return (
    <TableCard
      toolbar={
        <TableToolbar title="Recent transfers" count={transfers.length}>
          <Select value={filter} onValueChange={onFilterChange}>
            <SelectTrigger className="h-8 w-full min-w-0 sm:w-[240px]">
              <SelectValue placeholder="All destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All destinations</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="flex items-center gap-2">
                    <TokenOnChain symbol={d.token} chainId={d.chainId} size={18} />
                    <span>{d.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh transfers"
            title="Refresh"
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          </Button>
        </TableToolbar>
      }
      footer={
        transfers.length > 0 && (
          <Pager
            page={paged.page}
            pageSize={PAGE_SIZE}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="transfers"
          />
        )
      }
    >
      {isLoading ? (
        <ListSkeleton rows={5} className="rounded-none border-0" />
      ) : error ? (
        <div className="p-5">
          <ErrorState
            title="Could not load transfers"
            message={errText(error, 'Could not load transfers')}
          />
        </div>
      ) : transfers.length === 0 ? (
        <EmptyState compact icon={ArrowsLeftRight} title="No transfers yet" />
      ) : (
        <TableWrap>
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <Th>Destination</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
                <Th align="right">Legs</Th>
                <Th align="right">Planned</Th>
                <Th align="right">Created</Th>
              </tr>
            </THead>
            <TBody>
              {paged.rows.map((t) => {
                const dest = byId.get(t.destinationId)
                const dec = dest
                  ? (findToken(chains, dest.chainId, dest.token)?.decimals ?? null)
                  : null
                return (
                  <TransferRow
                    key={t.id}
                    t={t}
                    dest={dest}
                    dec={dec}
                    onOpen={() => onOpen(t)}
                  />
                )
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </TableCard>
  )
}

function TransferRow({
  t,
  dest,
  dec,
  onOpen,
}: {
  t: TreasuryTransfer
  dest: TreasuryDestination | undefined
  dec: number | null
  onOpen: () => void
}) {
  const token = dest?.token ?? ''
  const st = transferTone(t.status)
  return (
    <Tr
      interactive
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
    >
      <Td>
        {dest ? (
          <div className="flex min-w-0 items-center gap-3">
            <TokenOnChain symbol={dest.token} chainId={dest.chainId} size={32} />
            <div className="min-w-0">
              <div className="truncate font-medium">{dest.label}</div>
              <div className="font-mono text-xs text-[var(--fg-3)]">{t.id.slice(0, 8)}…</div>
            </div>
          </div>
        ) : (
          <span className="font-mono text-sm text-[var(--fg-3)]" title={t.destinationId}>
            {t.destinationId.slice(0, 8)}… (unknown destination)
          </span>
        )}
      </Td>
      <Td>
        <ModeLabel mode={t.mode} />
      </Td>
      <Td>
        <StatusPill tone={st.tone}>{st.label}</StatusPill>
      </Td>
      <Td align="right" className="whitespace-nowrap">
        <div className="ml-auto w-16">
          <div className="text-sm">
            {t.status.confirmed}/{t.legCount}
            {t.skippedCount > 0 && (
              <span
                className="ml-1 text-xs text-[var(--st-warn)]"
                title={`${t.skippedCount} skipped`}
              >
                +{t.skippedCount}
              </span>
            )}
          </div>
          <SegmentedBar className="mt-1 h-1" parts={legParts(t.status)} />
        </div>
      </Td>
      <Td align="right" className="whitespace-nowrap">
        <div className="font-medium">{fmtAmt(t.plannedAmountRaw, dec, token)}</div>
        <div className="text-xs text-[var(--fg-2)]">{fmtUsd(t.plannedUsd)}</div>
      </Td>
      <Td
        align="right"
        className="text-sm whitespace-nowrap text-[var(--fg-2)]"
        title={fmtLocal(t.createdAt)}
      >
        {rel(t.createdAt)}
      </Td>
    </Tr>
  )
}

/* ── Transfer detail sheet ──────────────────────────────────── */

type TransferTab = 'overview' | 'skipped'

function TransferSheet({
  t,
  dest,
  chains,
}: {
  t: TreasuryTransfer
  dest: TreasuryDestination | undefined
  chains: ChainInventoryEntry[] | undefined
}) {
  const [tab, setTab] = React.useState<TransferTab>('overview')
  const token = dest?.token ?? ''
  const dec = dest ? (findToken(chains, dest.chainId, dest.token)?.decimals ?? null) : null
  const st = transferTone(t.status)
  const s = t.status
  const lifecycle = [
    { key: 'planned', label: 'Planned', value: s.planned },
    { key: 'reserved', label: 'Reserved', value: s.reserved },
    { key: 'toppingUp', label: 'Topping up', value: s.toppingUp },
    { key: 'submitted', label: 'Submitted', value: s.submitted },
    { key: 'confirmed', label: 'Confirmed', value: s.confirmed },
    { key: 'failed', label: 'Failed', value: s.failed },
    { key: 'canceled', label: 'Canceled', value: s.canceled },
  ]
  return (
    <SheetContent>
      <SheetHero
        icon={MODE_META[t.mode].icon}
        title={dest?.label ?? 'Unknown destination'}
        meta={
          <>
            <StatusPill tone={st.tone}>{st.label}</StatusPill>
            <ModeLabel mode={t.mode} />
            {dest && <ChainPill chainId={dest.chainId} />}
            <span className="text-[var(--fg-3)]" title={fmtLocal(t.createdAt)}>
              · {rel(t.createdAt)}
            </span>
          </>
        }
        actions={<CopyButton value={t.id} label="Copy id" />}
      >
        <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-[var(--fg-2)]">Planned</div>
              <div className="figure mt-0.5 flex items-center gap-2 truncate text-2xl font-semibold">
                {token && <TokenIcon symbol={token} size={22} />}
                {fmtAmt(t.plannedAmountRaw, dec, token)}
              </div>
              <div className="figure text-xs text-[var(--fg-2)]">{fmtUsd(t.plannedUsd)}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-[var(--fg-2)]">
              <div>Confirmed</div>
              <div className="figure text-base font-semibold text-foreground">
                {t.status.confirmedAmountRaw !== '0'
                  ? fmtAmt(t.status.confirmedAmountRaw, dec, token)
                  : '—'}
              </div>
            </div>
          </div>
          <SegmentedBar className="mt-4" parts={legParts(t.status)} />
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {lifecycle
              .filter((l) => l.value > 0)
              .map((l) => (
                <span key={l.key} className="text-[var(--fg-2)]">
                  {l.label} <span className="figure font-medium text-foreground">{l.value}</span>
                </span>
              ))}
            {lifecycle.every((l) => l.value === 0) && (
              <span className="text-[var(--fg-3)]">No legs</span>
            )}
          </div>
        </div>
      </SheetHero>

      <SheetTabs<TransferTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview', icon: ListBullets },
          { value: 'skipped', label: 'Skipped', icon: AlertTriangle, count: t.skippedCount },
        ]}
      />

      <SheetBody key={tab} className="fade-in">
        {tab === 'overview' ? (
          <div className="space-y-6">
            <SheetSection title="Details">
              <dl className="divide-y divide-border rounded-xl border border-border">
                <Fact icon={Landmark} label="Destination">
                  {dest ? (
                    <span className="inline-flex items-center gap-2">
                      <TokenOnChain symbol={dest.token} chainId={dest.chainId} size={20} />
                      {dest.label}
                    </span>
                  ) : (
                    <span className="font-mono text-xs">{t.destinationId}</span>
                  )}
                </Fact>
                {dest && (
                  <Fact icon={Wallet} label="Address">
                    <Addr value={dest.address} chainId={dest.chainId} />
                  </Fact>
                )}
                <Fact icon={MODE_META[t.mode].icon} label="Mode">
                  {MODE_META[t.mode].label}
                </Fact>
                <Fact icon={Calendar} label="Created">
                  <span className="figure">{fmtLocal(t.createdAt)}</span>
                </Fact>
                <Fact icon={Hash} label="Transfer id">
                  <Addr value={t.id} />
                </Fact>
                <Fact icon={Layers} label="Batch id">
                  <Addr value={t.batchId} />
                </Fact>
                <Fact icon={ArrowsLeftRight} label="Legs">
                  <span className="figure">
                    {t.legCount}
                    {t.skippedCount > 0 && <Muted> · {t.skippedCount} skipped</Muted>}
                  </span>
                </Fact>
              </dl>
            </SheetSection>
            <SheetSection title="Leg status">
              <LegPills status={t.status} />
            </SheetSection>
          </div>
        ) : t.skippedCount === 0 ? (
          <EmptyState compact icon={CheckCircle2} title="Nothing skipped" />
        ) : t.skippedReasons.length === 0 ? (
          <Callout>{t.skippedCount} skipped — reasons not recorded.</Callout>
        ) : (
          <SkippedList reasons={t.skippedReasons} dec={dec} token={token} chainId={dest?.chainId} />
        )}
      </SheetBody>
    </SheetContent>
  )
}

/* ── Delete ─────────────────────────────────────────────────── */

function DeleteDestinationDialog({
  d,
  onClose,
  onChanged,
}: {
  d: TreasuryDestination
  onClose: () => void
  onChanged: () => void
}) {
  const del = useMutation({
    mutationFn: () =>
      api<unknown>(`${BASE}/destinations/${encodeURIComponent(d.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Destination deleted')
      onClose()
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Delete failed')),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5" /> Delete destination
          </DialogTitle>
          <DialogDescription>
            Removes the allow-list entry. Only possible while the destination
            has no transfers; once it has any, prefer{' '}
            <span className="font-medium">Disable</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3">
          <TokenOnChain symbol={d.token} chainId={d.chainId} size={32} />
          <div className="min-w-0 text-sm">
            <div className="font-medium">{d.label}</div>
            <div className="font-mono text-xs text-[var(--fg-2)]">
              chain {d.chainId} · {d.token} · {d.exchange}
            </div>
            <div className="mt-0.5 text-xs text-[var(--fg-2)]">
              address: <Addr value={d.address} chainId={d.chainId} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => del.mutate()}
            disabled={del.isPending}
          >
            {del.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Form (create + edit) ───────────────────────────────────── */

type DestinationFormProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
  chains: ChainInventoryEntry[] | undefined
} & (
  | { mode: 'create'; destination?: undefined }
  | { mode: 'edit'; destination: TreasuryDestination }
)

function DestinationFormDialog(props: DestinationFormProps) {
  const isEdit = props.mode === 'edit'
  const initial = props.destination
  const chains = props.chains
  const initialDec = initial
    ? (findToken(chains, initial.chainId, initial.token)?.decimals ?? null)
    : null

  const [label, setLabel] = React.useState(initial?.label ?? '')
  const [exchange, setExchange] = React.useState<TreasuryDestination['exchange']>(
    initial?.exchange ?? 'kraken',
  )
  const [chainId, setChainId] = React.useState(
    initial ? String(initial.chainId) : '',
  )
  const [token, setToken] = React.useState(initial?.token ?? '')
  const [address, setAddress] = React.useState(initial?.address ?? '')
  const [memo, setMemo] = React.useState(initial?.memo ?? '')
  const [exchangeMin, setExchangeMin] = React.useState(
    initial ? fromRaw(initial.exchangeMinRaw, initialDec) : '',
  )
  const [minTransferUsd, setMinTransferUsd] = React.useState(
    initial?.minTransferUsd ?? '',
  )
  const [maxPerTransferUsd, setMaxPerTransferUsd] = React.useState(
    initial?.maxPerTransferUsd ?? '',
  )
  const [maxDailyUsd, setMaxDailyUsd] = React.useState(initial?.maxDailyUsd ?? '')
  const [keepFloat, setKeepFloat] = React.useState(
    initial ? fromRaw(initial.keepFloatRaw, initialDec) : '',
  )
  const [autoInterval, setAutoInterval] = React.useState(
    initial?.autoIntervalHours != null ? String(initial.autoIntervalHours) : '',
  )

  const chainOptions = React.useMemo(
    () =>
      (chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chains],
  )
  const selectedChain = chainOptions.find((c) => c.chainId === parseInt(chainId, 10))
  const tokenOptions: ChainToken[] = selectedChain?.tokens ?? []
  const tokenMeta = tokenOptions.find(
    (t) => t.symbol.toUpperCase() === token.toUpperCase(),
  )
  const dec = isEdit ? initialDec : (tokenMeta?.decimals ?? null)
  const symbol = isEdit ? initial!.token : (tokenMeta?.symbol ?? token)
  const family = selectedChain?.family
  const addrPlaceholder =
    family === 'tron'
      ? 'T…'
      : family === 'solana'
        ? 'base58…'
        : family === 'utxo'
          ? 'bc1…'
          : family === 'monero'
            ? '4…'
            : '0x…'

  const rawHint = (v: string) => {
    if (!v.trim()) return null
    const raw = toRaw(v, dec)
    return (
      <span className="font-mono text-[var(--fg-2)]">
        {raw != null ? `raw ${raw}` : 'invalid amount'}
      </span>
    )
  }

  const save = useMutation({
    mutationFn: () => {
      if (!label.trim()) throw new ApiError('Label required', 400)
      const usd = (v: string, name: string): string | undefined => {
        const s = v.trim()
        if (!s) return undefined
        if (!isUsd(s))
          throw new ApiError(`${name} must be a USD decimal (e.g. 250.00)`, 400)
        return s
      }
      const amt = (v: string, name: string): string | undefined => {
        const s = v.trim()
        if (!s) return undefined
        const raw = toRaw(s, dec)
        if (raw == null)
          throw new ApiError(
            dec != null
              ? `${name} must be a decimal with at most ${dec} places`
              : `${name} must be a raw integer (token decimals unknown)`,
            400,
          )
        return raw
      }
      const hours = (v: string): number | null => {
        const s = v.trim()
        if (!s) return null
        const n = Number(s)
        if (!Number.isFinite(n) || n <= 0)
          throw new ApiError('Auto interval must be a positive number of hours', 400)
        return n
      }

      if (!isEdit) {
        if (!/^\d+$/.test(chainId.trim())) throw new ApiError('Pick a chain', 400)
        if (!token.trim()) throw new ApiError('Pick a token', 400)
        if (address.trim().length < 8)
          throw new ApiError('Destination address required', 400)
        const body: Record<string, unknown> = {
          label: label.trim(),
          exchange,
          chainId: parseInt(chainId, 10),
          token: token.trim().toUpperCase(),
          address: address.trim(),
        }
        if (memo.trim()) body.memo = memo.trim()
        const em = amt(exchangeMin, 'Exchange minimum')
        if (em !== undefined) body.exchangeMinRaw = em
        const mn = usd(minTransferUsd, 'Min transfer')
        if (mn !== undefined) body.minTransferUsd = mn
        const mp = usd(maxPerTransferUsd, 'Per-transfer cap')
        if (mp !== undefined) body.maxPerTransferUsd = mp
        const md = usd(maxDailyUsd, 'Daily cap')
        if (md !== undefined) body.maxDailyUsd = md
        const kf = amt(keepFloat, 'Float')
        if (kf !== undefined) body.keepFloatRaw = kf
        const h = hours(autoInterval)
        if (h != null) body.autoIntervalHours = h
        return api<{ destination: TreasuryDestination }>(`${BASE}/destinations`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }

      // Edit mode — only send changed fields. Empty amount/USD inputs mean
      // "unchanged"; an empty interval means "manual only" (`null`).
      const patch: Record<string, unknown> = {}
      if (label.trim() !== initial!.label) patch.label = label.trim()
      const em = amt(exchangeMin, 'Exchange minimum')
      if (em !== undefined && em !== initial!.exchangeMinRaw) patch.exchangeMinRaw = em
      const mn = usd(minTransferUsd, 'Min transfer')
      if (mn !== undefined && mn !== initial!.minTransferUsd) patch.minTransferUsd = mn
      const mp = usd(maxPerTransferUsd, 'Per-transfer cap')
      if (mp !== undefined && mp !== initial!.maxPerTransferUsd)
        patch.maxPerTransferUsd = mp
      const md = usd(maxDailyUsd, 'Daily cap')
      if (md !== undefined && md !== initial!.maxDailyUsd) patch.maxDailyUsd = md
      const kf = amt(keepFloat, 'Float')
      if (kf !== undefined && kf !== initial!.keepFloatRaw) patch.keepFloatRaw = kf
      const h = hours(autoInterval)
      if (h !== initial!.autoIntervalHours) patch.autoIntervalHours = h
      if (Object.keys(patch).length === 0)
        throw new ApiError('Nothing to update', 400)
      return api<{ destination: TreasuryDestination }>(
        `${BASE}/destinations/${encodeURIComponent(initial!.id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      )
    },
    onSuccess: () => {
      toast.success(
        isEdit
          ? 'Destination updated'
          : 'Destination created — disabled until verified',
      )
      props.onSaved()
      props.onOpenChange(false)
    },
    onError: (e) => toast.error(errText(e, 'Save failed')),
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="size-5" />
            {isEdit ? 'Edit destination' : 'New treasury destination'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Chain, token, address and exchange are fixed — add a new destination to change the route. Changing the auto interval reschedules the next run.'
              : 'One allow-listed external address per (chain, token). The address must not be gateway-controlled and must not be a token contract. The destination starts disabled and unverified.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_150px] sm:gap-3">
            <Field label="Label">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Kraken USDT (Tron)"
              />
            </Field>
            <Field label="Exchange">
              {isEdit ? (
                <Input value={initial!.exchange} disabled className="font-mono" />
              ) : (
                <Select
                  value={exchange}
                  onValueChange={(v) =>
                    setExchange(v as TreasuryDestination['exchange'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kraken">Kraken</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          {isEdit ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 text-sm">
              <TokenOnChain symbol={initial!.token} chainId={initial!.chainId} size={32} />
              <div className="min-w-0">
                <div className="font-mono text-xs">
                  {chainName(chains, initial!.chainId)} ({initial!.chainId}) ·{' '}
                  {initial!.token}
                </div>
                <div className="mt-1 text-xs break-all text-[var(--fg-2)]">
                  address:{' '}
                  <Addr value={initial!.address} chainId={initial!.chainId} truncated={false} />
                </div>
                {initial!.memo && (
                  <div className="mt-1 font-mono text-xs text-[var(--fg-2)]">
                    memo: {initial!.memo}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px] sm:gap-3">
                <Field label="Chain">
                  <Select
                    value={chainId}
                    onValueChange={(v) => {
                      setChainId(v)
                      setToken('')
                    }}
                    disabled={chainOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={chains ? 'Pick chain' : 'Loading…'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {chainOptions.map((c) => (
                        <SelectItem key={c.chainId} value={String(c.chainId)}>
                          <span className="flex items-center gap-2">
                            <ChainPill chainId={c.chainId} iconOnly size={16} />
                            <span>{c.displayName}</span>
                            <span className="font-mono text-2xs text-[var(--fg-3)]">
                              {c.chainId}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Token">
                  <Select
                    value={token}
                    onValueChange={setToken}
                    disabled={tokenOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={chainId ? 'Pick token' : 'Pick chain first'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {tokenOptions.map((t) => (
                        <SelectItem key={t.symbol} value={t.symbol}>
                          <span className="flex items-center gap-2">
                            <TokenIcon symbol={t.symbol} size={16} />
                            <span className="font-mono">{t.symbol}</span>
                            <span className="text-2xs text-[var(--fg-3)]">
                              {t.displayName}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field
                label="Deposit address"
                hint="The exchange's deposit address for this exact chain and token. The gateway rejects its own addresses and token contracts."
              >
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="font-mono"
                  placeholder={addrPlaceholder}
                />
              </Field>

              <Field label="Memo / tag (optional)">
                <Input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="font-mono"
                  placeholder="only if the exchange requires one"
                />
              </Field>
            </>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              label={`Exchange minimum (${symbol || 'token'})`}
              hint={
                <>
                  Exchange deposit minimum; also the verification floor.{' '}
                  {rawHint(exchangeMin)}
                </>
              }
            >
              <Input
                inputMode="decimal"
                value={exchangeMin}
                onChange={(e) => setExchangeMin(e.target.value)}
                className="font-mono"
                placeholder={`default ${DEFAULTS.exchangeMin}`}
              />
            </Field>
            <Field
              label={`Float to keep (${symbol || 'token'})`}
              hint={
                <>
                  Always left in the gateway for store payouts.{' '}
                  {rawHint(keepFloat)}
                </>
              }
            >
              <Input
                inputMode="decimal"
                value={keepFloat}
                onChange={(e) => setKeepFloat(e.target.value)}
                className="font-mono"
                placeholder={`default ${DEFAULTS.keepFloat}`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-3">
            <UsdField
              label="Min transfer"
              value={minTransferUsd}
              onChange={setMinTransferUsd}
              placeholder={`default ${DEFAULTS.minTransferUsd}`}
            />
            <UsdField
              label="Per-transfer cap"
              value={maxPerTransferUsd}
              onChange={setMaxPerTransferUsd}
              placeholder={`default ${DEFAULTS.maxPerTransferUsd}`}
            />
            <UsdField
              label="Daily cap (24 h)"
              value={maxDailyUsd}
              onChange={setMaxDailyUsd}
              placeholder={`default ${DEFAULTS.maxDailyUsd}`}
            />
          </div>

          <Field
            label="Auto interval (hours, optional)"
            hint={
              isEdit
                ? 'Empty = manual only (clears the schedule).'
                : 'Empty = manual only. Set to run on a schedule once the destination is verified and enabled.'
            }
            right={
              autoInterval ? (
                <button
                  type="button"
                  onClick={() => setAutoInterval('')}
                  className="cursor-pointer text-xs text-[var(--fg-3)] hover:text-foreground"
                >
                  Clear
                </button>
              ) : null
            }
          >
            <Input
              type="number"
              min={1}
              step={1}
              value={autoInterval}
              onChange={(e) => setAutoInterval(e.target.value)}
              className="font-mono"
              placeholder="manual"
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isEdit ? (
                <Pencil className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
              {save.isPending
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Create destination'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UsdField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-[var(--fg-3)]">
          $
        </span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-6 font-mono"
          placeholder={placeholder}
        />
      </div>
    </Field>
  )
}

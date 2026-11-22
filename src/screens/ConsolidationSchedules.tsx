import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowsLeftRight,
  CalendarClock,
  ChevronDown,
  Clock,
  Fuel,
  Hash,
  Layers,
  ListBullets,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Timer,
  Trash2,
} from '@/components/icons'

import { useUrlParam } from '@/lib/useUrlParam'
import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtLocal, formatUnits, useNow } from '@/lib/format'
import type {
  AutoConsolidationSchedule,
  BalancesSnapshot,
  ChainInventoryEntry,
  ChainToken,
  ConsolidationStatusResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, TableCard, TableToolbar, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States'
import { Status, StatusPill } from '@/components/StatusPill'
import { SegmentedBar } from '@/components/charts'
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
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'

/**
 * Per-chain suggested per-source dust floor for USDT/USDC consolidation.
 * The map values are smallest-unit decimal strings (6 decimals on every
 * supported stable token) meant for one-click pre-fill in the form. The
 * principle: only sweep a source if doing so recovers more than the per-tx
 * gas cost — anything below this floor is dust where consolidating is
 * net-negative.
 */
const SUGGESTED_MIN_RAW: Record<number, { raw: string; label: string }> = {
  1: { raw: '50000000', label: '50 (≈ $50 of USDT/USDC)' },
  137: { raw: '100000', label: '0.1 (Polygon, gas ≈ $0.01)' },
  8453: { raw: '500000', label: '0.5 (Base, gas ≈ $0.05)' },
  42161: { raw: '500000', label: '0.5 (Arbitrum, gas ≈ $0.05)' },
  10: { raw: '500000', label: '0.5 (Optimism, gas ≈ $0.05)' },
  56: { raw: '1000000', label: '1 (BSC, gas ≈ $0.20)' },
  43114: { raw: '5000000', label: '5 (Avalanche, gas ≈ $0.50)' },
  728126428: { raw: '1', label: '0.000001 (Tron, ~free with energy)' },
}

const CHAINS_Q = {
  queryKey: ['gw', 'chains'] as const,
  queryFn: () => api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
  refetchInterval: 120_000,
  staleTime: 30_000,
}

const SCHEDULES_Q = {
  queryKey: ['gw', 'consolidation-schedules'] as const,
  queryFn: () =>
    api<{ schedules: AutoConsolidationSchedule[] }>(
      '/api/gw/admin/consolidation-schedules',
    ),
  refetchInterval: 30_000,
}

const BALANCES_Q = {
  queryKey: ['gw', 'balances', 'db'] as const,
  queryFn: () =>
    api<{ snapshot: BalancesSnapshot; cached: boolean }>(
      '/api/gw/admin/balances',
    ),
  staleTime: 30_000,
}

/** Same request as before; shared cache between table row and sheet. */
function useLastRun(id: string | null) {
  return useQuery({
    enabled: id != null,
    queryKey: ['gw', 'consolidations', id ?? ''] as const,
    queryFn: () =>
      api<ConsolidationStatusResponse>(
        `/api/gw/admin/pool/consolidations/${encodeURIComponent(id!)}`,
      ),
    staleTime: 60_000,
  })
}

function useTokenDecimals(schedule: AutoConsolidationSchedule): number | null {
  const chainsQ = useQuery(CHAINS_Q)
  const chain = chainsQ.data?.chains.find((c) => c.chainId === schedule.chainId)
  const tokenMeta = chain?.tokens.find(
    (t) => t.symbol.toUpperCase() === schedule.token.toUpperCase(),
  )
  return tokenMeta?.decimals ?? null
}

function useToggleSchedule(schedule: AutoConsolidationSchedule, onChanged: () => void) {
  return useMutation({
    mutationFn: () =>
      api<{ schedule: AutoConsolidationSchedule }>(
        `/api/gw/admin/consolidation-schedules/${encodeURIComponent(schedule.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !schedule.enabled }),
        },
      ),
    onSuccess: () => {
      toast.success(schedule.enabled ? 'Schedule disabled' : 'Schedule enabled')
      onChanged()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Update failed'),
  })
}

export function ConsolidationSchedulesPage() {
  const qc = useQueryClient()
  const q = useQuery(SCHEDULES_Q)
  const [editing, setEditing] = React.useState<AutoConsolidationSchedule | null>(
    null,
  )
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<AutoConsolidationSchedule | null>(null)
  const [detailId, setDetailId] = useUrlParam('schedule')
  const now = useNow(15_000)

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['gw', 'consolidation-schedules'] })

  const schedules = React.useMemo(() => q.data?.schedules ?? [], [q.data])
  const paged = usePaged(schedules, 25)
  const detail = schedules.find((s) => s.id === detailId) ?? null

  const enabledCount = schedules.filter((s) => s.enabled).length
  const overdueCount = schedules.filter((s) => s.enabled && s.nextRunDue - now < 0).length
  const nextDue = schedules
    .filter((s) => s.enabled)
    .reduce<AutoConsolidationSchedule | null>(
      (a, s) => (a == null || s.nextRunDue < a.nextRunDue ? s : a),
      null,
    )

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Auto-consolidation"
        description="Recurring sweeps per chain and token"
        actions={
          <>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New schedule
            </Button>
          </>
        }
      />

      <ScheduleFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={refresh}
      />
      {editing && (
        <ScheduleFormDialog
          mode="edit"
          open={editing != null}
          onOpenChange={(v) => !v && setEditing(null)}
          schedule={editing}
          onSaved={() => {
            refresh()
            setEditing(null)
          }}
        />
      )}
      {deleting && (
        <DeleteScheduleDialog
          schedule={deleting}
          open={deleting != null}
          onOpenChange={(v) => !v && setDeleting(null)}
          onDeleted={() => {
            if (detailId === deleting.id) setDetailId(null)
            setDeleting(null)
            refresh()
          }}
        />
      )}

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load schedules"
          message={q.error instanceof Error ? q.error.message : 'Error'}
        />
      ) : schedules.length === 0 ? (
        <NoSchedules onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-5 xl:grid-cols-4">
            <Tile label="Schedules" value={schedules.length}>
              <SegmentedBar
                parts={[
                  { key: 'on', name: 'Enabled', value: enabledCount, color: 'var(--st-ok-dot)' },
                  { key: 'off', name: 'Disabled', value: schedules.length - enabledCount, color: 'var(--chart-muted)' },
                ]}
              />
            </Tile>
            <Tile label="Enabled" value={enabledCount} sub={`${schedules.length - enabledCount} disabled`} />
            <Tile
              label="Overdue"
              value={overdueCount}
              tone={overdueCount > 0 ? 'warn' : undefined}
              sub={overdueCount > 0 ? 'Past due' : 'On time'}
            />
            <Tile
              label="Next run"
              value={nextDue ? fmtRelDelta(nextDue.nextRunDue - now) : '—'}
              sub={nextDue ? `${nextDue.token} · ${chainInfo(nextDue.chainId).name}` : 'None enabled'}
            />
          </div>

          <TableCard
            toolbar={<TableToolbar title="Schedules" count={schedules.length} />}
            footer={
              paged.total > paged.pageSize ? (
                <Pager
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hasNext={paged.page < paged.pageCount - 1}
                  onPage={paged.setPage}
                  noun="schedules"
                />
              ) : undefined
            }
          >
            <TableWrap>
              <Table className="min-w-[900px]">
                <THead>
                  <tr>
                    <Th>Schedule</Th>
                    <Th>Status</Th>
                    <Th>Target</Th>
                    <Th align="right">Every</Th>
                    <Th align="right">Next run</Th>
                    <Th align="right">Last run</Th>
                    <Th className="w-12">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {paged.rows.map((s) => (
                    <ScheduleRow
                      key={s.id}
                      schedule={s}
                      now={now}
                      onOpen={() => setDetailId(s.id)}
                      onEdit={() => setEditing(s)}
                      onDelete={() => setDeleting(s)}
                      onChanged={refresh}
                    />
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </TableCard>
        </>
      )}

      <ScheduleSheet
        schedule={detail}
        now={now}
        onOpenChange={(v) => !v && setDetailId(null)}
        onEdit={() => detail && setEditing(detail)}
        onDelete={() => detail && setDeleting(detail)}
        onChanged={refresh}
      />
    </div>
  )
}

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

function NoSchedules({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      framed
      icon={CalendarClock}
      title="No schedules yet"
      description="One per chain and token keeps balances pooled automatically."
      action={
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" /> Create schedule
        </Button>
      }
    />
  )
}

function ScheduleStatus({ schedule, now }: { schedule: AutoConsolidationSchedule; now: number }) {
  const overdue = schedule.enabled && schedule.nextRunDue - now < 0
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {schedule.enabled ? (
        <StatusPill tone="ok">Enabled</StatusPill>
      ) : (
        <StatusPill tone="off" icon={Pause}>
          Disabled
        </StatusPill>
      )}
      {overdue && (
        <StatusPill tone="warn" size="sm">
          Overdue
        </StatusPill>
      )}
    </span>
  )
}

/* ── table row ───────────────────────────────────────────── */

function ScheduleRow({
  schedule,
  now,
  onOpen,
  onEdit,
  onDelete,
  onChanged,
}: {
  schedule: AutoConsolidationSchedule
  now: number
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const toggle = useToggleSchedule(schedule, onChanged)
  const dueIn = schedule.nextRunDue - now
  const overdue = schedule.enabled && dueIn < 0
  const info = chainInfo(schedule.chainId)

  return (
    <Tr
      interactive
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
    >
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <TokenOnChain symbol={schedule.token} chainId={schedule.chainId} size={32} />
          <div className="min-w-0">
            <div className="truncate font-medium">{schedule.token}</div>
            <div className="truncate text-xs text-[var(--fg-2)]">{info.name}</div>
          </div>
        </div>
      </Td>
      <Td>
        <ScheduleStatus schedule={schedule} now={now} />
      </Td>
      <Td>
        <Addr value={schedule.targetAddress} chainId={schedule.chainId} />
      </Td>
      <Td align="right" className="text-[var(--fg-1)]">
        {schedule.intervalHours}h
      </Td>
      <Td
        align="right"
        className={cn('text-sm whitespace-nowrap', overdue ? 'text-[var(--st-warn)]' : 'text-[var(--fg-2)]')}
      >
        <span title={fmtLocal(schedule.nextRunDue)}>{fmtRelDelta(dueIn)}</span>
      </Td>
      <Td align="right" className="whitespace-nowrap">
        <LastRunCell schedule={schedule} now={now} />
      </Td>
      <Td className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Schedule actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onSelect={() => toggle.mutate()}
              disabled={toggle.isPending}
              title="Soft on/off — preserves last-run snapshot"
            >
              {schedule.enabled ? <Pause /> : <Play />}
              {schedule.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Td>
    </Tr>
  )
}

function LastRunCell({ schedule, now }: { schedule: AutoConsolidationSchedule; now: number }) {
  const q = useLastRun(schedule.lastConsolidationId)
  if (schedule.lastRunAt == null) return <span className="text-sm text-[var(--fg-3)]">Never</span>
  const summary = q.data?.summary
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-sm text-[var(--fg-2)]" title={fmtLocal(schedule.lastRunAt)}>
        {fmtRelDelta(schedule.lastRunAt - now)}
      </span>
      {summary ? (
        <RunPill summary={summary} size="sm" />
      ) : schedule.lastLegCount != null ? (
        <span className="figure text-xs text-[var(--fg-3)]">{schedule.lastLegCount} legs</span>
      ) : null}
    </div>
  )
}

function RunPill({
  summary,
  size,
}: {
  summary: ConsolidationStatusResponse['summary']
  size?: 'sm' | 'md'
}) {
  if (summary.failed > 0)
    return (
      <StatusPill tone="bad" size={size}>
        {summary.failed} failed
      </StatusPill>
    )
  if (summary.pendingOrInFlight > 0)
    return (
      <StatusPill tone="run" size={size}>
        {summary.pendingOrInFlight} in flight
      </StatusPill>
    )
  if (summary.total > 0 && summary.confirmed === summary.total)
    return (
      <StatusPill tone="ok" size={size}>
        {summary.total} confirmed
      </StatusPill>
    )
  return (
    <StatusPill tone="wait" size={size}>
      {summary.total} legs
    </StatusPill>
  )
}

/* ── detail sheet ────────────────────────────────────────── */

type Tab = 'overview' | 'lastrun'

function ScheduleSheet({
  schedule,
  now,
  onOpenChange,
  onEdit,
  onDelete,
  onChanged,
}: {
  schedule: AutoConsolidationSchedule | null
  now: number
  onOpenChange: (v: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = React.useState<Tab>('overview')
  const id = schedule?.id ?? null
  const [prevId, setPrevId] = React.useState<string | null>(id)
  if (prevId !== id) {
    setPrevId(id)
    if (id) setTab('overview')
  }
  return (
    <Sheet open={schedule != null} onOpenChange={onOpenChange}>
      <SheetContent>
        {schedule && (
          <ScheduleSheetBody
            schedule={schedule}
            now={now}
            tab={tab}
            onTab={setTab}
            onEdit={onEdit}
            onDelete={onDelete}
            onChanged={onChanged}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function ScheduleSheetBody({
  schedule,
  now,
  tab,
  onTab,
  onEdit,
  onDelete,
  onChanged,
}: {
  schedule: AutoConsolidationSchedule
  now: number
  tab: Tab
  onTab: (t: Tab) => void
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const dec = useTokenDecimals(schedule)
  const toggle = useToggleSchedule(schedule, onChanged)
  const lastQ = useLastRun(schedule.lastConsolidationId)
  const info = chainInfo(schedule.chainId)
  const dueIn = schedule.nextRunDue - now
  const overdue = schedule.enabled && dueIn < 0
  const summary = lastQ.data?.summary

  return (
    <>
      <SheetHero
        icon={CalendarClock}
        title={`${schedule.token} on ${info.name}`}
        meta={
          <>
            <ScheduleStatus schedule={schedule} now={now} />
            <ChainPill chainId={schedule.chainId} size={16} />
          </>
        }
        actions={<CopyButton value={schedule.id} />}
      >
        <div className="mt-5 rounded-2xl border border-border bg-[var(--bg-2)] p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-[var(--fg-2)]">Next run</div>
              <div
                className={cn(
                  'figure mt-0.5 text-2xl font-semibold',
                  overdue && 'text-[var(--st-warn)]',
                )}
                title={fmtLocal(schedule.nextRunDue)}
              >
                {schedule.enabled ? fmtRelDelta(dueIn) : 'Paused'}
              </div>
            </div>
            <div className="text-right text-xs text-[var(--fg-2)]">
              <div>Every</div>
              <div className="figure text-base font-semibold text-foreground">
                {schedule.intervalHours}h
              </div>
            </div>
          </div>
          {summary && summary.total > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--fg-2)]">
                <span>Last run</span>
                <span className="figure">
                  {summary.confirmed} / {summary.total} confirmed
                </span>
              </div>
              <LegsBar summary={summary} />
            </div>
          )}
        </div>
      </SheetHero>

      <SheetTabs<Tab>
        value={tab}
        onChange={onTab}
        tabs={[
          { value: 'overview', label: 'Overview', icon: ListBullets },
          {
            value: 'lastrun',
            label: 'Last run',
            icon: ArrowsLeftRight,
            count: lastQ.data?.legs.length ?? schedule.lastLegCount ?? undefined,
          },
        ]}
      />

      <SheetBody key={tab} className="fade-in">
        {tab === 'overview' ? (
          <div className="space-y-6">
            <SheetSection title="Settings">
              <dl className="divide-y divide-border rounded-xl border border-border">
                <Fact icon={Target} label="Target">
                  <Addr value={schedule.targetAddress} chainId={schedule.chainId} />
                </Fact>
                <Fact icon={Timer} label="Interval">
                  <span className="figure">every {schedule.intervalHours}h</span>
                </Fact>
                <Fact icon={SlidersHorizontal} label="Dust floor">
                  <span className="figure inline-flex items-center gap-1.5">
                    {dec != null ? (
                      <>
                        <TokenIcon symbol={schedule.token} size={14} />
                        {formatUnits(schedule.minSourceBalanceRaw, dec)} {schedule.token}
                      </>
                    ) : (
                      `${schedule.minSourceBalanceRaw} (raw)`
                    )}
                  </span>
                </Fact>
                <Fact icon={Hash} label="Max sources">
                  <span className="figure">{schedule.maxSourcesPerRun}</span>
                </Fact>
                <Fact icon={Fuel} label="Gas ceiling">
                  {schedule.maxFeeUsd ? (
                    <span className="figure" title="Firing defers while gas is above this">
                      ≤ ${schedule.maxFeeUsd}
                    </span>
                  ) : (
                    <span className="text-[var(--fg-3)]">None</span>
                  )}
                </Fact>
              </dl>
            </SheetSection>
            <SheetSection title="Timing">
              <dl className="divide-y divide-border rounded-xl border border-border">
                <Fact icon={Clock} label="Next run">
                  <span className={overdue ? 'text-[var(--st-warn)]' : undefined}>
                    {fmtLocal(schedule.nextRunDue)}
                    <span className="ml-1.5 text-[var(--fg-3)]">({fmtRelDelta(dueIn)})</span>
                  </span>
                </Fact>
                <Fact icon={CalendarClock} label="Last run">
                  {schedule.lastRunAt ? (
                    <span>
                      {fmtLocal(schedule.lastRunAt)}
                      <span className="ml-1.5 text-[var(--fg-3)]">
                        ({fmtRelDelta(schedule.lastRunAt - now)})
                      </span>
                    </span>
                  ) : (
                    <span className="text-[var(--fg-3)]">Never</span>
                  )}
                </Fact>
              </dl>
            </SheetSection>
          </div>
        ) : (
          <LastRunTab schedule={schedule} tokenDecimals={dec} query={lastQ} />
        )}
      </SheetBody>

      <SheetFooter className="justify-between">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            title="Soft on/off — preserves last-run snapshot"
          >
            {toggle.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : schedule.enabled ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {schedule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

function LegsBar({ summary }: { summary: ConsolidationStatusResponse['summary'] }) {
  return (
    <SegmentedBar
      className="h-2"
      parts={[
        { key: 'ok', name: 'Confirmed', value: summary.confirmed, color: 'var(--st-ok-dot)' },
        { key: 'run', name: 'In flight', value: summary.pendingOrInFlight, color: 'var(--st-run-dot)' },
        { key: 'bad', name: 'Failed', value: summary.failed, color: 'var(--st-bad-dot)' },
        { key: 'off', name: 'Canceled', value: summary.canceled, color: 'var(--st-wait-dot)' },
      ]}
    />
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

function LastRunTab({
  schedule,
  tokenDecimals,
  query,
}: {
  schedule: AutoConsolidationSchedule
  tokenDecimals: number | null
  query: ReturnType<typeof useLastRun>
}) {
  if (!schedule.lastConsolidationId) {
    return (
      <EmptyState
        compact
        framed
        icon={CalendarClock}
        title="No runs yet"
        description={schedule.enabled ? 'The first firing will show here.' : 'Enable the schedule to start.'}
      />
    )
  }
  const status = query.data
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {status && <RunPill summary={status.summary} />}
        {schedule.lastSkippedCount != null && schedule.lastSkippedCount > 0 && (
          <StatusPill tone="warn">{schedule.lastSkippedCount} skipped</StatusPill>
        )}
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-[var(--fg-3)]">
          {schedule.lastConsolidationId.slice(0, 8)}…
          <CopyButton value={schedule.lastConsolidationId} />
        </span>
      </div>

      <SheetSection title="Legs" icon={ArrowsLeftRight}>
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState
            title="Could not load last run"
            message={query.error instanceof Error ? query.error.message : undefined}
          />
        ) : status && status.legs.length > 0 ? (
          <LegsTable
            status={status}
            tokenDecimals={tokenDecimals}
            token={schedule.token}
            chainId={schedule.chainId}
          />
        ) : (
          <EmptyState compact framed icon={ArrowsLeftRight} title="No legs" />
        )}
      </SheetSection>

      {schedule.lastSkippedReasons && schedule.lastSkippedReasons.length > 0 && (
        <SkippedReasonsList
          reasons={schedule.lastSkippedReasons}
          tokenDecimals={tokenDecimals}
          token={schedule.token}
          chainId={schedule.chainId}
        />
      )}
    </div>
  )
}

function LegsTable({
  status,
  tokenDecimals,
  token,
  chainId,
}: {
  status: ConsolidationStatusResponse
  tokenDecimals: number | null
  token: string
  chainId: number
}) {
  const paged = usePaged(status.legs, 25)
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <TableWrap>
        <Table className="min-w-[440px]">
          <THead>
            <tr>
              <Th>Source</Th>
              <Th align="right">Amount</Th>
              <Th>Status</Th>
              <Th>Tx</Th>
            </tr>
          </THead>
          <TBody>
            {paged.rows.map((leg) => (
              <Tr key={leg.payoutId}>
                <Td>
                  <Addr value={leg.sourceAddress} chainId={chainId} />
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {tokenDecimals != null
                    ? `${formatUnits(leg.amountRaw, tokenDecimals)} ${token}`
                    : leg.amountRaw}
                </Td>
                <Td>
                  <Status value={leg.status} size="sm" />
                </Td>
                <Td>
                  {leg.txHash ? (
                    <Addr value={leg.txHash} chainId={chainId} kind="tx" />
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      {paged.total > paged.pageSize && (
        <div className="border-t border-border px-6 py-3">
          <Pager
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="legs"
          />
        </div>
      )}
    </div>
  )
}

function SkippedReasonsList({
  reasons,
  tokenDecimals,
  token,
  chainId,
}: {
  reasons: NonNullable<AutoConsolidationSchedule['lastSkippedReasons']>
  tokenDecimals: number | null
  token: string
  chainId: number
}) {
  const [open, setOpen] = React.useState<string | null>(null)
  // Group by reason code (the prefix before the `:`) so a long tail of dust
  // skips collapses into one line instead of dozens.
  const groups = React.useMemo(() => {
    const m = new Map<string, typeof reasons>()
    for (const r of reasons) {
      const code = r.reason.includes(':') ? r.reason.split(':')[0].trim() : r.reason
      const arr = m.get(code) ?? []
      arr.push(r)
      m.set(code, arr)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [reasons])
  return (
    <SheetSection title={`Skipped · ${reasons.length}`} icon={AlertTriangle}>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {groups.map(([code, rows]) => {
          const isOpen = open === code
          return (
            <div key={code}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : code)}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-mono text-xs font-medium text-[var(--st-warn)]">{code}</span>
                <span className="figure rounded-full bg-[var(--bg-active)] px-1.5 text-2xs text-[var(--fg-1)]">
                  {rows.length}
                </span>
                <ChevronDown
                  className={cn(
                    'ml-auto size-4 text-[var(--fg-3)] transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
              {isOpen && (
                <ul className="fade-in divide-y divide-border border-t border-border bg-[var(--bg-2)]">
                  {rows.slice(0, 50).map((r) => (
                    <li
                      key={r.sourceAddress + r.amountRaw}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                    >
                      <Addr value={r.sourceAddress} chainId={chainId} />
                      <span className="figure text-xs text-[var(--fg-2)]">
                        {tokenDecimals != null
                          ? `${formatUnits(r.amountRaw, tokenDecimals)} ${token}`
                          : r.amountRaw}
                      </span>
                      <span
                        className="ml-auto max-w-[220px] truncate font-mono text-2xs text-[var(--fg-3)]"
                        title={r.reason}
                      >
                        {r.reason.includes(':')
                          ? r.reason.slice(r.reason.indexOf(':') + 1).trim()
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </SheetSection>
  )
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

/* ── delete confirm ──────────────────────────────────────── */

function DeleteScheduleDialog({
  schedule,
  open,
  onOpenChange,
  onDeleted,
}: {
  schedule: AutoConsolidationSchedule
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted: () => void
}) {
  const del = useMutation({
    mutationFn: () =>
      api<{ deleted: true }>(
        `/api/gw/admin/consolidation-schedules/${encodeURIComponent(schedule.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      toast.success('Schedule deleted')
      onOpenChange(false)
      onDeleted()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Delete failed'),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5" /> Delete schedule
          </DialogTitle>
          <DialogDescription>
            Permanently removes the schedule and its last-run snapshot. Prefer{' '}
            <span className="font-medium">Disable</span> if you might re-enable
            it later — disabling preserves the forensic record of past firings.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 text-sm">
          <TokenOnChain symbol={schedule.token} chainId={schedule.chainId} size={32} />
          <div className="min-w-0">
            <div className="font-mono text-xs">
              chain {schedule.chainId} · {schedule.token}
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-[var(--fg-2)]">
              target: <Addr value={schedule.targetAddress} chainId={schedule.chainId} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={del.isPending}
          >
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

/* ── Form (create + edit) ────────────────────────────────────── */

type ScheduleFormProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
} & (
  | { mode: 'create'; schedule?: undefined }
  | { mode: 'edit'; schedule: AutoConsolidationSchedule }
)

function ScheduleFormDialog(props: ScheduleFormProps) {
  const isEdit = props.mode === 'edit'
  const initial = props.schedule
  const [chainId, setChainId] = React.useState<string>(
    initial?.chainId != null ? String(initial.chainId) : '',
  )
  const [token, setToken] = React.useState<string>(initial?.token ?? '')
  const [target, setTarget] = React.useState<string>(initial?.targetAddress ?? '')
  const [intervalHours, setIntervalHours] = React.useState<string>(
    String(initial?.intervalHours ?? 12),
  )
  const [minRaw, setMinRaw] = React.useState<string>(
    initial?.minSourceBalanceRaw ?? '',
  )
  const [maxSources, setMaxSources] = React.useState<string>(
    String(initial?.maxSourcesPerRun ?? 25),
  )
  // Empty string = no ceiling (`null` on the wire). Non-empty = USD decimal.
  const [maxFeeUsd, setMaxFeeUsd] = React.useState<string>(
    initial?.maxFeeUsd ?? '',
  )
  const [enabled, setEnabled] = React.useState<boolean>(initial?.enabled ?? true)

  const chainsQ = useQuery({ ...CHAINS_Q, enabled: props.open })
  const balancesQ = useQuery({ ...BALANCES_Q, enabled: props.open })

  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )
  const tokenOptions: ChainToken[] = React.useMemo(() => {
    const id = parseInt(chainId, 10)
    return chainOptions.find((c) => c.chainId === id)?.tokens ?? []
  }, [chainOptions, chainId])

  const tokenMeta = tokenOptions.find(
    (t) => t.symbol.toUpperCase() === token.toUpperCase(),
  )
  const tokenDecimals = tokenMeta?.decimals ?? null

  // Pool address candidates for the chosen chain, ranked by current
  // balance of the selected token (descending).
  const targetCandidates = React.useMemo(() => {
    const id = parseInt(chainId, 10)
    if (!Number.isFinite(id)) return []
    const tokSym = token.trim().toUpperCase()
    const families = balancesQ.data?.snapshot.families ?? []
    const rows: Array<{ address: string; raw: string }> = []
    for (const fam of families) {
      for (const ch of fam.chains) {
        if (ch.chainId !== id) continue
        for (const a of ch.addresses) {
          if (a.kind !== 'pool') continue
          const tokRow = a.tokens.find(
            (t) => t.token.toUpperCase() === tokSym,
          )
          rows.push({ address: a.address, raw: tokRow?.amountRaw ?? '0' })
        }
      }
    }
    rows.sort((a, b) => {
      const av = BigInt(a.raw || '0')
      const bv = BigInt(b.raw || '0')
      if (av === bv) return a.address.localeCompare(b.address)
      return av > bv ? -1 : 1
    })
    return rows
  }, [balancesQ.data, chainId, token])

  const suggestion =
    chainId && /^\d+$/.test(chainId)
      ? SUGGESTED_MIN_RAW[parseInt(chainId, 10)]
      : null

  const previewMin =
    minRaw && /^\d+$/.test(minRaw) && tokenDecimals != null
      ? `= ${formatUnits(minRaw, tokenDecimals)} ${tokenMeta?.symbol ?? token}`
      : null

  const save = useMutation({
    mutationFn: () => {
      if (!isEdit) {
        if (!/^\d+$/.test(chainId.trim())) throw new ApiError('Pick a chain', 400)
        if (!token.trim()) throw new ApiError('Pick a token', 400)
        if (target.trim().length < 8)
          throw new ApiError('Target address required', 400)
        if (!minRaw.trim() || !/^\d+$/.test(minRaw.trim()))
          throw new ApiError('Min source balance must be an integer', 400)
        const iv = parseInt(intervalHours, 10)
        if (!Number.isFinite(iv) || iv < 1 || iv > 720)
          throw new ApiError('Interval must be between 1 and 720 hours', 400)
        const ms = parseInt(maxSources, 10)
        if (!Number.isFinite(ms) || ms < 1 || ms > 200)
          throw new ApiError('Max sources must be between 1 and 200', 400)
        const fee = maxFeeUsd.trim()
        if (fee && !/^\d+(\.\d+)?$/.test(fee))
          throw new ApiError('Gas ceiling must be a USD decimal (e.g. 4.00)', 400)
        const body: Record<string, unknown> = {
          chainId: parseInt(chainId, 10),
          token: token.trim().toUpperCase(),
          targetAddress: target.trim(),
          intervalHours: iv,
          minSourceBalanceRaw: minRaw.trim(),
          maxSourcesPerRun: ms,
          enabled,
        }
        if (fee) body.maxFeeUsd = fee
        return api<{ schedule: AutoConsolidationSchedule }>(
          '/api/gw/admin/consolidation-schedules',
          { method: 'POST', body: JSON.stringify(body) },
        )
      }
      // Edit mode — only send changed fields. Compare against `initial`.
      const patch: Record<string, unknown> = {}
      if (target.trim() !== initial!.targetAddress)
        patch.targetAddress = target.trim()
      const iv = parseInt(intervalHours, 10)
      if (Number.isFinite(iv) && iv !== initial!.intervalHours)
        patch.intervalHours = iv
      if (minRaw.trim() !== initial!.minSourceBalanceRaw)
        patch.minSourceBalanceRaw = minRaw.trim()
      const ms = parseInt(maxSources, 10)
      if (Number.isFinite(ms) && ms !== initial!.maxSourcesPerRun)
        patch.maxSourcesPerRun = ms
      // maxFeeUsd: '' means "clear" → send `null`; non-empty means "set".
      // Only include in patch when it changed (current vs. `initial.maxFeeUsd`).
      const feeNext = maxFeeUsd.trim()
      const feePrev = initial!.maxFeeUsd ?? ''
      if (feeNext !== feePrev) {
        if (feeNext === '') {
          patch.maxFeeUsd = null
        } else {
          if (!/^\d+(\.\d+)?$/.test(feeNext))
            throw new ApiError(
              'Gas ceiling must be a USD decimal (e.g. 4.00)',
              400,
            )
          patch.maxFeeUsd = feeNext
        }
      }
      if (enabled !== initial!.enabled) patch.enabled = enabled
      if (Object.keys(patch).length === 0)
        throw new ApiError('Nothing to update', 400)
      return api<{ schedule: AutoConsolidationSchedule }>(
        `/api/gw/admin/consolidation-schedules/${encodeURIComponent(initial!.id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      )
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Schedule updated' : 'Schedule created')
      props.onSaved()
      props.onOpenChange(false)
    },
    onError: (e: ApiError) => {
      const map: Record<string, string> = {
        BAD_JSON: 'Body was not valid JSON',
        INVALID_CHAIN: 'No chain adapter wired for this chainId',
        INVALID_TOKEN: 'Token not registered on this chain',
        TARGET_NOT_IN_POOL:
          'Target address is not in the address pool for this family',
        SCHEDULE_ALREADY_EXISTS:
          'A schedule already exists for this (chain, token) pair — edit it instead',
        SCHEDULE_NOT_FOUND: 'Schedule no longer exists',
      }
      toast.error(map[e.code ?? ''] ?? e.message ?? 'Save failed')
    },
  })

  const usingPicker =
    targetCandidates.length > 0 &&
    (target === '' || targetCandidates.some((r) => r.address === target))

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" />
            {isEdit ? 'Edit schedule' : 'New schedule'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Interval changes keep the current cycle — nextRunDue is recomputed from lastRunAt (or createdAt).'
              : 'One schedule per chain and token.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-w-0 space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Chain">
              <Select
                value={chainId}
                onValueChange={(v) => {
                  setChainId(v)
                  setToken('')
                  setTarget('')
                  // Auto-fill the suggested dust floor when one is known.
                  const sug = SUGGESTED_MIN_RAW[parseInt(v, 10)]
                  if (sug && !isEdit) setMinRaw(sug.raw)
                }}
                disabled={isEdit || chainsQ.isLoading || chainOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={chainsQ.isLoading ? 'Loading…' : 'Pick chain'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {chainOptions.map((c) => (
                    <SelectItem key={c.chainId} value={String(c.chainId)}>
                      <span className="flex items-center gap-2">
                        <ChainIcon chainId={c.chainId} size={16} />
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
                disabled={isEdit || tokenOptions.length === 0}
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
                        <span className="font-medium">{t.symbol}</span>
                        <span className="text-xs text-[var(--fg-3)]">
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
            label="Target pool address"
            hint={
              targetCandidates.length > 0
                ? 'Top of the list holds the most — fewest legs.'
                : 'Must already be in the address pool for this family.'
            }
            right={
              targetCandidates.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setTarget('')}
                  className="cursor-pointer text-xs text-[var(--fg-2)] hover:text-foreground"
                >
                  {usingPicker ? 'Custom address' : 'Use picker'}
                </button>
              ) : null
            }
          >
            {usingPicker ? (
              <Select
                value={target}
                onValueChange={setTarget}
                disabled={balancesQ.isLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      balancesQ.isLoading ? 'Loading addresses…' : 'Pick address'
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {targetCandidates.map((row) => {
                    const has = row.raw !== '0'
                    const balLabel =
                      has && tokenDecimals != null
                        ? `${formatUnits(row.raw, tokenDecimals)} ${tokenMeta?.symbol ?? token}`
                        : null
                    return (
                      <SelectItem key={row.address} value={row.address}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">
                            {row.address.slice(0, 10)}…{row.address.slice(-6)}
                          </span>
                          {balLabel && (
                            <span className="figure text-xs text-[var(--st-ok)]">
                              {balLabel}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="font-mono"
                placeholder={
                  chainId === '728126428' ? 'T…' : chainId === '900' ? 'base58…' : '0x…'
                }
              />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Interval (hours)" hint="1–720">
              <Input
                type="number"
                min={1}
                max={720}
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
                className="figure"
              />
            </Field>
            <Field label="Max sources per run" hint="1–200">
              <Input
                type="number"
                min={1}
                max={200}
                value={maxSources}
                onChange={(e) => setMaxSources(e.target.value)}
                className="figure"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Dust floor (raw)"
              hint={
                previewMin ? (
                  <span className="figure">{previewMin}</span>
                ) : (
                  'Smaller sources are skipped.'
                )
              }
              right={
                suggestion ? (
                  <button
                    type="button"
                    onClick={() => setMinRaw(suggestion.raw)}
                    className="cursor-pointer text-xs font-medium text-foreground hover:underline"
                    title={`Suggested: ${suggestion.label}`}
                  >
                    Use suggested
                  </button>
                ) : null
              }
            >
              <Input
                value={minRaw}
                onChange={(e) => setMinRaw(e.target.value)}
                className="font-mono"
                placeholder="e.g. 50000000"
              />
            </Field>

            <Field
              label="Gas ceiling (USD)"
              hint={
                isEdit
                  ? 'Defers firing above this. Empty clears it.'
                  : 'Defers firing above this. Optional.'
              }
              right={
                maxFeeUsd ? (
                  <button
                    type="button"
                    onClick={() => setMaxFeeUsd('')}
                    className="cursor-pointer text-xs text-[var(--fg-2)] hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null
              }
            >
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--fg-3)]">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  value={maxFeeUsd}
                  onChange={(e) => setMaxFeeUsd(e.target.value)}
                  className="figure pl-7"
                  placeholder="No ceiling"
                />
              </div>
            </Field>
          </div>

          <label
            htmlFor="schedule-enabled"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <input
              id="schedule-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="text-sm font-medium">Enabled</span>
            <span className="ml-auto text-xs text-[var(--fg-2)]">
              Disabled schedules never fire.
            </span>
          </label>

          <DialogFooter className="items-center sm:justify-between">
            {!isEdit ? (
              <Link
                to="/pool"
                className="inline-flex items-center gap-1 text-xs text-[var(--fg-2)] hover:text-foreground"
                title="Use the manual flow on Address pool for one-shot consolidations"
              >
                <Layers className="size-3.5" /> One-off sweep
              </Link>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
                  <Layers className="size-4" />
                )}
                {save.isPending
                  ? 'Saving…'
                  : isEdit
                    ? 'Save changes'
                    : 'Create schedule'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

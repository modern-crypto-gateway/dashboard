import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowsLeftRight,
  ArrowUpRight,
  BadgeCheck,
  Coins,
  Landmark,
  Banknote,
  CandlestickChart,
  ChartPie,
  ChevronDown,
  ChevronRight,
  Clock,
  Dollar,
  FlaskConical,
  Gauge,
  Hash,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Scale,
  Tag,
  Timer,
  Zap,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtLocal, fmtRel, toDate, useNow } from '@/lib/format'
import type {
  ExchangeAction,
  ExchangeActionStatus,
  ExchangeMode,
  ExchangeOpenOrder,
  ExchangePolicy,
  ExchangeRunResult,
  ExchangeStatus,
  ExchangeWithdrawKey,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
import { TokenIcon } from '@/components/CryptoIcon'
import { Pager, RowAvatar, TableCard, TableToolbar, usePaged } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import {
  Callout,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from '@/components/States'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { BarTrend, Donut, SegmentedBar, SparkBars, type Point, type Slice } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/* ── Queries, constants ─────────────────────────────────────── */

const BASE = '/api/gw/admin/exchange/kraken'
/** Prefix shared by every exchange query — one invalidation covers all. */
const EXCHANGE_KEY = ['gw', 'exchange', 'kraken'] as const

const STATUS_Q = {
  queryKey: [...EXCHANGE_KEY, 'status'] as const,
  queryFn: () => api<ExchangeStatus>(BASE),
  refetchInterval: 30_000,
}

const ACTIONS_Q = {
  queryKey: [...EXCHANGE_KEY, 'actions'] as const,
  queryFn: () =>
    api<{ actions: ExchangeAction[] }>(`${BASE}/actions?limit=50`),
  refetchInterval: 30_000,
}

const POLICY_HINT = 'set via KRAKEN_AUTOSELL* / KRAKEN_WITHDRAW* on the worker'

const PAGE_SIZE = 25
const CHART_DAYS = 14

/** Operator-facing text for `ExchangeRunResult.reason` when `ran` is false. */
const REASON_TEXT: Record<string, string> = {
  disabled:
    'auto-sell is off or the Kraken API key is not configured on the worker',
  throttled: 'the previous run was less than the interval ago',
}

/** validated grey, open blue, filled green, canceled muted, failed red, requested amber, completed green. */
const ACTION_TONE: Record<ExchangeActionStatus, StatusTone> = {
  validated: 'wait',
  open: 'info',
  filled: 'ok',
  canceled: 'off',
  failed: 'bad',
  requested: 'warn',
  completed: 'ok',
}

const ORDER_TONE: Record<ExchangeOpenOrder['status'], StatusTone> = {
  pending: 'warn',
  open: 'info',
  closed: 'ok',
  canceled: 'off',
  expired: 'wait',
}

const SLICE_COLORS = [
  'var(--chart-1-fill)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--st-info-dot)',
  'var(--st-warn-dot)',
]

/* ── Helpers ────────────────────────────────────────────────── */

function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback
  return e instanceof Error ? e.message : fallback
}

/** USD decimal string → `$1,234.56` (always two decimals); null → em dash. */
function usd2(v: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return v
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** True when a non-negative decimal string is not zero — no numeric parsing needed. */
const isPositive = (s: string | null | undefined): boolean =>
  s != null && /[1-9]/.test(s)

const shortId = (s: string): string =>
  s.length > 10 ? `${s.slice(0, 8)}…` : s

const num = (s: string | null | undefined): number => {
  const n = parseFloat(s ?? '')
  return Number.isFinite(n) ? n : 0
}

/** The 409 body of `POST /run` is a plain run result; `api()` keeps it in `details`. */
function readRunResult(x: unknown): ExchangeRunResult | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Partial<ExchangeRunResult>
  return typeof r.ran === 'boolean' && typeof r.mode === 'string'
    ? (r as ExchangeRunResult)
    : null
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
function rel(x: number | null | undefined): string {
  const d = toDate(x)
  return d ? fmtRel(Math.floor(d.getTime() / 1000)) : '—'
}

function runSummary(r: ExchangeRunResult): string {
  return `placed ${r.placed} · requoted ${r.requoted} · market ${r.marketFallbacks} · filled ${r.filled} · canceled ${r.canceled} · withdrawals ${r.withdrawals}`
}

/** Kraken asset code → common ticker (XXBT → BTC, ZUSD → USD). */
function krakenSymbol(asset: string): string {
  const a = asset.toUpperCase().replace(/\.[A-Z]$/, '')
  const map: Record<string, string> = { XXBT: 'BTC', XBT: 'BTC', XXDG: 'DOGE', XDG: 'DOGE' }
  if (map[a]) return map[a]
  if (a.length === 4 && (a[0] === 'X' || a[0] === 'Z')) return a.slice(1)
  return a
}

/** Token logo for a Kraken asset; a dollar tile for fiat USD. */
function AssetIcon({ asset, size = 32 }: { asset: string; size?: number }) {
  const sym = krakenSymbol(asset)
  if (sym === 'USD')
    return (
      <span
        title="USD"
        className="grid shrink-0 place-items-center rounded-full bg-[var(--st-ok-bg)] text-[var(--st-ok)]"
        style={{ width: size, height: size }}
      >
        <Dollar className="size-[55%]" weight="bold" />
      </span>
    )
  return <TokenIcon symbol={sym} size={size} />
}

/** Counts per local day, oldest first, ending today. */
function dailyCounts<T>(
  rows: T[],
  at: (r: T) => number,
  pick: (r: T) => string | null,
  keys: string[],
  days: number,
): Point[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (days - 1) * 86_400_000
  const out: Point[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(start + i * 86_400_000)
    const p: Point = {
      key: String(d.getTime()),
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }
    for (const k of keys) p[k] = 0
    return p
  })
  for (const r of rows) {
    const k = pick(r)
    const d = toDate(at(r))
    if (!k || !d) continue
    const day = new Date(d)
    day.setHours(0, 0, 0, 0)
    const i = Math.round((day.getTime() - start) / 86_400_000)
    if (i >= 0 && i < days) out[i][k] = Number(out[i][k]) + 1
  }
  return out
}

const fmtCount = (n: number) => String(Math.round(n))

/* ── Page ───────────────────────────────────────────────────── */

export function ExchangePage() {
  const qc = useQueryClient()
  const statusQ = useQuery(STATUS_Q)
  const actionsQ = useQuery(ACTIONS_Q)
  const now = useNow(15_000)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  // Result of the last run triggered from this screen — shown until the
  // server's `lastRun` catches up (or is newer).
  const [manualRun, setManualRun] = React.useState<ExchangeRunResult | null>(
    null,
  )

  const status = statusQ.data
  const actions = React.useMemo(
    () => actionsQ.data?.actions ?? [],
    [actionsQ.data],
  )

  const invalidate = () => qc.invalidateQueries({ queryKey: EXCHANGE_KEY })

  const announce = (r: ExchangeRunResult) => {
    const label = r.dryRun ? 'Dry run' : 'Run'
    if (!r.ran) {
      const why = r.reason ? (REASON_TEXT[r.reason] ?? r.reason) : 'unknown reason'
      toast.warning(`${label} did not execute — ${why}`)
      return
    }
    if (r.errors.length > 0) {
      toast.warning(
        `${label} finished with ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}`,
        { description: runSummary(r) },
      )
    } else {
      toast.success(`${label} complete`, { description: runSummary(r) })
    }
  }

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ExchangeRunResult>(`${BASE}/run`, {
        method: 'POST',
        body: JSON.stringify({ dryRun }),
      }),
    onSuccess: (r) => {
      setManualRun(r)
      announce(r)
      invalidate()
    },
    onError: (e) => {
      // 409 carries a run result with `ran=false` + `reason` instead of an
      // `{ error }` envelope.
      const r = e instanceof ApiError ? readRunResult(e.details) : null
      if (r) {
        setManualRun(r)
        announce(r)
        invalidate()
        return
      }
      toast.error(errText(e, 'Run failed'))
    },
  })

  const configured = status?.configured ?? false
  const mode: ExchangeMode | undefined = status?.policy.mode
  const latestRun = React.useMemo(() => {
    const server = status?.lastRun ?? null
    if (!manualRun) return server
    if (!server) return manualRun
    return server.at >= manualRun.at ? server : manualRun
  }, [status?.lastRun, manualRun])

  const runDisabledTitle = !status
    ? 'Loading…'
    : !configured
      ? 'Kraken API key is not set on the worker'
      : mode === 'off'
        ? 'Auto-sell mode is off — set KRAKEN_AUTOSELL_MODE on the worker'
        : run.isPending
          ? 'A run is in progress'
          : 'Places real orders when the mode is on'
  const canRun = !!status && configured && mode !== 'off' && !run.isPending
  const canDryRun = !!status && configured && !run.isPending

  const startRun = () => {
    if (mode === 'on') setConfirmOpen(true)
    else run.mutate(false)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <>
            Exchange
            <InfoTip>
              Funds sent to Kraken are sold to USD with post-only limit sells at
              the best ask; stale orders are re-quoted, then market-sold. When
              enabled, USD above a threshold is withdrawn to the saved bank
              account. Dry-run validates every order without placing it.
            </InfoTip>
          </>
        }
        description="Kraken auto-sell to USD."
        actions={
          <>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Refresh (live read)"
              title="Refresh — reads Kraken live"
              onClick={async () => {
                try {
                  const live = await api<ExchangeStatus>(`${BASE}?live=1`)
                  qc.setQueryData(STATUS_Q.queryKey, live)
                  if (live.error) toast.warning(live.error)
                } catch (e) {
                  toast.error(e instanceof ApiError ? e.message : String(e))
                }
                actionsQ.refetch()
              }}
              disabled={statusQ.isFetching}
            >
              <RefreshCw className={cn('size-4', statusQ.isFetching && 'animate-spin')} />
            </Button>
            <span
              title={
                canDryRun
                  ? 'Validates every order with Kraken without placing it'
                  : runDisabledTitle
              }
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => run.mutate(true)}
                disabled={!canDryRun}
              >
                {run.isPending && run.variables === true ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FlaskConical className="size-4" />
                )}
                Dry run now
              </Button>
            </span>
            <span title={runDisabledTitle}>
              <Button size="sm" onClick={startRun} disabled={!canRun}>
                {run.isPending && run.variables === false ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Run now
              </Button>
            </span>
          </>
        }
      />

      {status?.snapshotAt != null && <SnapshotBar status={status} />}
      {status?.error && (
        <Callout tone="warn">
          Kraken API error while loading live data — balances and open
          orders may be stale or empty:{' '}
          <span className="font-mono break-all">{status.error}</span>
        </Callout>
      )}

      <RunConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        policy={status?.policy}
        onConfirm={() => {
          setConfirmOpen(false)
          run.mutate(false)
        }}
      />

      {statusQ.isLoading ? (
        <StatusSkeleton />
      ) : statusQ.isError ? (
        <ErrorState
          title="Could not load the exchange status"
          message={errText(statusQ.error, 'Could not load the exchange status')}
        />
      ) : status ? (
        <>
          <RouteCard status={status} run={latestRun} now={now} />
          {!configured && <NotConfigured />}
          <SummaryTiles status={status} actions={actions} run={latestRun} now={now} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <ActivityCard actions={actions} loading={actionsQ.isLoading} />
            {configured ? (
              <BalanceMix rows={status.balances} />
            ) : (
              <PolicyCard policy={status.policy} />
            )}
          </div>
          {configured && <BalanceCards rows={status.balances} />}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {configured && <PolicyCard policy={status.policy} />}
            <LastRunCard run={latestRun} now={now} />
          </div>
          {configured && (
            <>
              <OpenOrdersTable orders={status.openOrders} />
              <WithdrawKeyCards
                keys={status.withdrawKeys}
                activeKey={status.policy.withdraw.key}
              />
            </>
          )}
        </>
      ) : null}

      <ActionsJournal
        actions={actions}
        isLoading={actionsQ.isLoading}
        isFetching={actionsQ.isFetching}
        error={actionsQ.error}
        onRefresh={() => actionsQ.refetch()}
      />
    </div>
  )
}

function NotConfigured() {
  return (
    <EmptyState
      framed
      icon={KeyRound}
      title="Kraken is not configured"
      description={
        <>
          Set <span className="font-mono">KRAKEN_API_KEY</span> /{' '}
          <span className="font-mono">KRAKEN_API_SECRET</span> as worker secrets and
          redeploy. The journal below still shows past actions.
        </>
      }
    />
  )
}

function StatusSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[300px] w-full rounded-lg" />
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
    </div>
  )
}

/* ── Pieces ─────────────────────────────────────────────────── */

function StatTile({
  label,
  icon: Icon,
  value,
  sub,
  footer,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-[var(--fg-2)]">
        {label}
        {Icon && <Icon className="size-4 text-[var(--fg-3)]" />}
      </div>
      <div className="figure mt-2 flex min-h-8 items-center text-xl font-semibold">{value}</div>
      <div className="mt-1 min-h-4 truncate text-xs text-[var(--fg-2)]">{sub}</div>
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

function CardHead({
  title,
  icon: Icon,
  right,
  sub,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  right?: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.01em]">
          {Icon && <Icon className="size-5 text-[var(--fg-2)]" />}
          {title}
        </h2>
        {sub && <p className="mt-1 text-sm text-[var(--fg-2)]">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
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

function ModePill({ mode }: { mode: ExchangeMode }) {
  if (mode === 'on')
    return (
      <StatusPill tone="ok" icon={Play}>
        On
      </StatusPill>
    )
  if (mode === 'dry-run')
    return (
      <StatusPill tone="info" icon={FlaskConical}>
        Dry run
      </StatusPill>
    )
  return (
    <StatusPill tone="off" icon={Pause}>
      Off
    </StatusPill>
  )
}

function WithdrawPill({ w }: { w: ExchangePolicy['withdraw'] }) {
  return (
    <span title={w.enabled ? (w.key ?? undefined) : undefined}>
      <StatusPill tone={w.enabled ? 'ok' : 'off'} icon={Banknote}>
        {w.enabled ? 'Withdraw on' : 'Withdraw off'}
      </StatusPill>
    </span>
  )
}

/* ── Summary ────────────────────────────────────────────────── */

function balanceSlices(rows: ExchangeStatus['balances']): Slice[] {
  const all = rows
    .map((r) => ({ key: r.asset, name: krakenSymbol(r.asset), value: num(r.usd) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
  const head = all.length <= 6 ? all : all.slice(0, 5)
  const rest = all.length <= 6 ? 0 : all.slice(5).reduce((a, s) => a + s.value, 0)
  const slices = head.map((s, i) => ({ ...s, color: SLICE_COLORS[i % SLICE_COLORS.length] }))
  if (rest > 0) slices.push({ key: 'other', name: 'Other', value: rest, color: 'var(--chart-muted)' })
  return slices
}

function totalUsdOf(rows: ExchangeStatus['balances']): string | null {
  let sum = 0
  let any = false
  for (const r of rows) {
    if (r.usd == null) continue
    const n = parseFloat(r.usd)
    if (Number.isFinite(n)) {
      sum += n
      any = true
    }
  }
  return any ? sum.toFixed(2) : null
}

function InfoTip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={cn(
            'grid size-6 shrink-0 cursor-help place-items-center rounded-full text-[var(--fg-3)] hover:text-foreground',
            className,
          )}
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty font-normal">{children}</TooltipContent>
    </Tooltip>
  )
}

/** One slim line: snapshot freshness, or the lockout. */
function SnapshotBar({ status }: { status: ExchangeStatus }) {
  const locked = status.lockedUntil != null
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2 text-sm',
        locked
          ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]'
          : 'border-border bg-card shadow-[var(--shadow-sm)]',
      )}
      role={locked ? 'alert' : undefined}
    >
      {locked ? (
        <StatusPill tone="warn" icon={Lock}>
          Locked out
        </StatusPill>
      ) : (
        <StatusPill tone="ok" icon={Clock}>
          Snapshot
        </StatusPill>
      )}
      <span className="text-[var(--fg-2)]">
        Kraken data as of{' '}
        <span className="figure font-medium text-foreground" title={fmtLocal(status.snapshotAt)}>
          {rel(status.snapshotAt)}
        </span>
      </span>
      {locked && (
        <span className="text-[var(--fg-1)]">
          · locked out until{' '}
          <span className="figure font-medium">{fmtLocal(status.lockedUntil)}</span>
        </span>
      )}
      <InfoTip className="ml-auto">
        Balances, open orders and withdrawal keys are a snapshot written by every run.
        Refresh reads Kraken live (one serialized read).
      </InfoTip>
    </div>
  )
}

/* ── Route (treasury → Kraken → bank) ───────────────────────── */

function RouteNode({
  icon: Icon,
  title,
  sub,
  pills,
  children,
}: {
  icon: React.ComponentType<{ className?: string; weight?: 'duotone' }>
  title: string
  sub?: React.ReactNode
  pills?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-xl border border-border bg-[var(--bg-2)] p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-foreground ring-1 ring-border">
          <Icon weight="duotone" className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {sub && <div className="truncate text-xs text-[var(--fg-2)]">{sub}</div>}
        </div>
      </div>
      {children && <div className="flex min-h-8 items-center">{children}</div>}
      {pills && <div className="mt-auto flex flex-wrap items-center gap-1.5">{pills}</div>}
    </div>
  )
}

function RouteArrow({
  label,
  icon: Icon,
  off,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  off?: boolean
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center gap-2 text-xs font-medium lg:w-24 lg:flex-col',
        off ? 'text-[var(--fg-3)]' : 'text-[var(--fg-1)]',
      )}
    >
      <span
        className={cn(
          'grid size-8 place-items-center rounded-full ring-1',
          off
            ? 'bg-card ring-border'
            : 'bg-[var(--accent-bg)] text-[var(--accent-ink)] ring-[var(--accent-border)]',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex items-center gap-1">
        {label}
        <ArrowRight className="hidden size-3.5 lg:inline" />
        <ArrowDown className="size-3.5 lg:hidden" />
      </span>
    </div>
  )
}

function runPill(run: ExchangeRunResult | null) {
  if (!run) return <StatusPill tone="wait">No run yet</StatusPill>
  if (!run.ran)
    return (
      <span title={run.reason}>
        <StatusPill tone="warn">Did not run</StatusPill>
      </span>
    )
  if (run.errors.length > 0)
    return (
      <StatusPill tone="bad">
        {run.errors.length} error{run.errors.length === 1 ? '' : 's'}
      </StatusPill>
    )
  return <StatusPill tone="ok">{run.dryRun ? 'Dry run ok' : 'Run ok'}</StatusPill>
}

function RouteCard({
  status,
  run,
  now,
}: {
  status: ExchangeStatus
  run: ExchangeRunResult | null
  now: number
}) {
  const p = status.policy
  const sellable = Object.keys(p.sellable)
  const locked = status.lockedUntil != null
  const usdRow = status.balances.find((b) => krakenSymbol(b.asset) === 'USD')
  return (
    <Card className="p-6">
      <CardHead
        title="Route"
        icon={ArrowsLeftRight}
        right={
          <InfoTip>
            The treasury sends pool balances to Kraken deposit addresses. Auto-sell
            places post-only limit sells at the best ask, re-quotes stale orders, then
            market-sells. Optional withdrawal moves USD to the bank account saved at
            Kraken.
          </InfoTip>
        }
      />
      <div className="mt-5 flex flex-col items-stretch gap-3 lg:flex-row">
        <RouteNode
          icon={Landmark}
          title="Treasury"
          sub="Pool sweeps"
          pills={
            <StatusPill tone="info" icon={Coins}>
              {sellable.length} sellable
            </StatusPill>
          }
        >
          {sellable.length === 0 ? (
            <span className="text-sm text-[var(--fg-3)]">No sellable assets</span>
          ) : (
            <span className="flex items-center">
              {sellable.slice(0, 6).map((a, i) => (
                <span
                  key={a}
                  className="rounded-full ring-2 ring-[var(--bg-2)]"
                  style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                >
                  <AssetIcon asset={a} size={28} />
                </span>
              ))}
              {sellable.length > 6 && (
                <span className="figure ml-2 text-xs text-[var(--fg-2)]">+{sellable.length - 6}</span>
              )}
            </span>
          )}
        </RouteNode>

        <RouteArrow label="Sell" icon={CandlestickChart} off={p.mode === 'off'} />

        <RouteNode
          icon={CandlestickChart}
          title="Kraken"
          sub={`every ${p.intervalMinutes} min`}
          pills={
            <>
              {status.configured ? (
                <ModePill mode={p.mode} />
              ) : (
                <StatusPill tone="warn" icon={KeyRound}>
                  Not configured
                </StatusPill>
              )}
              {locked && (
                <span title={`locked out until ${fmtLocal(status.lockedUntil)}`}>
                  <StatusPill tone="warn" icon={Lock}>
                    Locked
                  </StatusPill>
                </span>
              )}
            </>
          }
        >
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {runPill(run)}
            {run && (
              <span className="text-[var(--fg-2)]" title={fmtLocal(run.at, { seconds: true })}>
                {fmtRelDelta(run.at - now)}
              </span>
            )}
          </span>
        </RouteNode>

        <RouteArrow label="Withdraw" icon={Banknote} off={!p.withdraw.enabled} />

        <RouteNode
          icon={Banknote}
          title="Bank"
          sub={p.withdraw.key ?? 'No withdrawal key'}
          pills={<WithdrawPill w={p.withdraw} />}
        >
          <span className="flex items-center gap-2">
            <AssetIcon asset="ZUSD" size={28} />
            <span className="figure text-lg font-semibold">
              {usdRow ? usd2(usdRow.usd ?? usdRow.available) : '—'}
            </span>
          </span>
        </RouteNode>
      </div>
    </Card>
  )
}

/* ── Summary tiles ──────────────────────────────────────────── */

function SummaryTiles({
  status,
  actions,
  run,
  now,
}: {
  status: ExchangeStatus
  actions: ExchangeAction[]
  run: ExchangeRunResult | null
  now: number
}) {
  const p = status.policy
  const total = num(totalUsdOf(status.balances))
  const usdRow = status.balances.find((b) => krakenSymbol(b.asset) === 'USD')
  const usd = num(usdRow?.usd ?? usdRow?.available)
  const crypto = Math.max(0, total - usd)
  const slices = balanceSlices(status.balances.filter((b) => krakenSymbol(b.asset) !== 'USD'))
  const pending = status.openOrders.filter((o) => o.status === 'pending').length
  const perDay = React.useMemo(
    () =>
      dailyCounts(actions, (a) => a.createdAt, () => 'n', ['n'], CHART_DAYS).map((x) =>
        Number(x.n),
      ),
    [actions],
  )
  const nextAt = run && p.mode !== 'off' ? run.at + p.intervalMinutes * 60_000 : null
  const dash = <span className="text-[var(--fg-3)]">—</span>
  return (
    <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatTile
        label="USD balance"
        icon={Dollar}
        value={status.configured ? usd2(usd.toFixed(2)) : dash}
        sub={usdRow && isPositive(usdRow.holdTrade) ? `held ${usdRow.holdTrade}` : 'Ready to withdraw'}
      />
      <StatTile
        label="Crypto value"
        icon={Coins}
        value={status.configured ? `≈ ${usd2(crypto.toFixed(2))}` : dash}
        sub={`${slices.length} asset${slices.length === 1 ? '' : 's'} at bid`}
        footer={<SegmentedBar parts={slices} />}
      />
      <StatTile
        label="Open orders"
        icon={CandlestickChart}
        value={status.configured ? status.openOrders.length : dash}
        sub={pending > 0 ? `${pending} pending` : 'None pending'}
      />
      <StatTile
        label="Last run"
        icon={Activity}
        value={runPill(run)}
        sub={
          run ? (
            <span title={fmtLocal(run.at, { seconds: true })}>
              {fmtRelDelta(run.at - now)} · placed {run.placed} · filled {run.filled}
            </span>
          ) : undefined
        }
        footer={<SparkBars values={perDay} height={28} />}
      />
      <StatTile
        label="Next run"
        icon={Timer}
        value={
          p.mode === 'off' ? (
            <ModePill mode="off" />
          ) : nextAt == null ? (
            dash
          ) : nextAt <= now ? (
            'Due'
          ) : (
            <span title={fmtLocal(nextAt)}>{fmtRelDelta(nextAt - now)}</span>
          )
        }
        sub={`every ${p.intervalMinutes} min`}
      />
    </div>
  )
}

function ActivityCard({ actions, loading }: { actions: ExchangeAction[]; loading: boolean }) {
  const data = React.useMemo(
    () =>
      dailyCounts(
        actions,
        (a) => a.createdAt,
        (a) => (a.kind === 'withdraw' ? 'withdrawals' : 'orders'),
        ['orders', 'withdrawals'],
        CHART_DAYS,
      ),
    [actions],
  )
  const any = data.some((p) => Number(p.orders) + Number(p.withdrawals) > 0)
  return (
    <Card className="p-6">
      <CardHead
        title="Activity"
        sub={`Journal actions per day · ${CHART_DAYS}D`}
        right={
          <div className="flex items-center gap-4 text-xs text-[var(--fg-2)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-[var(--chart-1-fill)]" /> Orders
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-[var(--chart-2)]" /> Withdrawals
            </span>
          </div>
        }
      />
      <div className="mt-6">
        {loading ? (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        ) : !any ? (
          <EmptyState compact icon={Activity} title="No activity in this range" className="h-[220px]" />
        ) : (
          <BarTrend
            height={220}
            data={data}
            format={fmtCount}
            axisFormat={fmtCount}
            series={[
              { key: 'orders', name: 'Orders', color: 'var(--chart-1-fill)' },
              { key: 'withdrawals', name: 'Withdrawals', color: 'var(--chart-2)' },
            ]}
          />
        )}
      </div>
    </Card>
  )
}

function BalanceMix({ rows }: { rows: ExchangeStatus['balances'] }) {
  const slices = balanceSlices(rows)
  const total = slices.reduce((a, s) => a + s.value, 0)
  return (
    <Card className="p-6">
      <CardHead title="Balance mix" icon={ChartPie} />
      {slices.length === 0 ? (
        <EmptyState compact title="No priced balances" />
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row xl:flex-col">
          <Donut
            slices={slices}
            size={168}
            thickness={20}
            center={
              <div>
                <div className="figure text-lg font-semibold">{usd2(total.toFixed(2))}</div>
                <div className="text-2xs text-[var(--fg-2)]">total</div>
              </div>
            }
          />
          <ul className="w-full space-y-2">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                {s.key !== 'other' && <AssetIcon asset={s.key} size={16} />}
                <span className="truncate">{s.name}</span>
                <span className="figure ml-auto font-medium">{usd2(s.value.toFixed(2))}</span>
                <span className="figure w-12 text-right text-xs text-[var(--fg-2)]">
                  {((s.value / total) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/* ── Policy + last run ──────────────────────────────────────── */

function PolicyCard({ policy }: { policy: ExchangePolicy }) {
  const sellable = Object.entries(policy.sellable)
  return (
    <Card className="p-6">
      <CardHead
        title="Policy"
        icon={CandlestickChart}
        right={
          <>
            <ModePill mode={policy.mode} />
            <WithdrawPill w={policy.withdraw} />
            <InfoTip>Read-only — {POLICY_HINT}.</InfoTip>
          </>
        }
      />
      <dl className="mt-5 divide-y divide-border rounded-xl border border-border">
        <Fact icon={Scale} label="Min order">
          <span className="figure">{usd2(policy.minOrderUsd)}</span>
        </Fact>
        <Fact icon={Gauge} label="Sell cap (24 h)">
          <span className="figure">{usd2(policy.dailyCapUsd)}</span>
        </Fact>
        <Fact icon={RefreshCw} label="Re-quote">
          <span className="figure" title="then market sell">
            after {policy.requoteMinutes} min · max {policy.maxRequotes}
          </span>
        </Fact>
        <Fact icon={Timer} label="Interval">
          <span className="figure">every {policy.intervalMinutes} min</span>
        </Fact>
        <Fact icon={Zap} label="Sellable">
          {sellable.length === 0 ? (
            <span className="text-[var(--fg-3)]">none</span>
          ) : (
            <span className="flex flex-wrap justify-end gap-1.5">
              {sellable.map(([asset, pair]) => (
                <Badge key={asset} variant="outline" className="gap-1.5 pl-1 font-mono" title={`${asset} → ${pair}`}>
                  <AssetIcon asset={asset} size={14} />
                  {pair}
                </Badge>
              ))}
            </span>
          )}
        </Fact>
        <Fact icon={Banknote} label="Withdraw">
          <span
            className={cn('figure', !policy.withdraw.enabled && 'text-[var(--fg-3)]')}
            title={`key ${policy.withdraw.key ?? '—'}`}
          >
            {!policy.withdraw.enabled && 'disabled · '}
            {policy.withdraw.asset} · min {usd2(policy.withdraw.minUsd)} · daily{' '}
            {usd2(policy.withdraw.dailyCapUsd)}
          </span>
        </Fact>
        {policy.withdraw.key && (
          <Fact icon={KeyRound} label="Withdraw key">
            <span className="font-mono text-xs">{policy.withdraw.key}</span>
          </Fact>
        )}
        <Fact icon={Tag} label="userref">
          <span className="font-mono text-xs">{policy.userref}</span>
        </Fact>
      </dl>
    </Card>
  )
}

function LastRunCard({
  run,
  now,
}: {
  run: ExchangeRunResult | null
  now: number
}) {
  const counts: Array<[string, number, boolean?]> = run
    ? [
        ['Synced', run.synced],
        ['Placed', run.placed, run.placed > 0],
        ['Re-quoted', run.requoted],
        ['Market', run.marketFallbacks, run.marketFallbacks > 0],
        ['Filled', run.filled],
        ['Canceled', run.canceled],
        ['Withdrawals', run.withdrawals, run.withdrawals > 0],
        ['Skipped', run.skipped.length],
      ]
    : []
  return (
    <Card className="p-6">
      <CardHead
        title="Last run"
        icon={Clock}
        sub={
          run ? (
            <span className="figure" title={fmtLocal(run.at, { seconds: true })}>
              {fmtLocal(run.at, { seconds: true })} · {fmtRelDelta(run.at - now)}
            </span>
          ) : undefined
        }
        right={
          run && (
            <>
              <ModePill mode={run.mode} />
              {run.dryRun && (
                <StatusPill tone="info" icon={FlaskConical}>
                  Dry run
                </StatusPill>
              )}
              {!run.ran && (
                <span title={run.reason}>
                  <StatusPill tone="warn">
                    Did not run{run.reason ? ` · ${run.reason}` : ''}
                  </StatusPill>
                </span>
              )}
            </>
          )
        }
      />
      <div className="mt-5 space-y-4">
        {!run ? (
          <EmptyState
            compact
            icon={Clock}
            title="No run yet"
            description="The worker runs on its interval, or trigger one above."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
              {counts.map(([label, v, accent]) => (
                <div
                  key={label}
                  className={cn('px-3 py-2.5', accent ? 'bg-[var(--accent-bg)]' : 'bg-card')}
                >
                  <div className="truncate text-xs text-[var(--fg-2)]">{label}</div>
                  <div className="figure mt-0.5 text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            {run.skipped.length > 0 && <SkippedList skipped={run.skipped} />}
            {run.errors.length > 0 && (
              <Callout tone="danger">
                <ul className="space-y-1">
                  {run.errors.map((e, i) => (
                    <li
                      key={i}
                      className="font-mono text-xs break-all text-destructive"
                    >
                      {e}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function SkippedList({
  skipped,
}: {
  skipped: ExchangeRunResult['skipped']
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
        {open ? 'Hide' : 'Show'} skipped · {skipped.length}
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {skipped.map((s, i) => (
            <li
              key={`${s.asset}-${i}`}
              className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
            >
              <AssetIcon asset={s.asset} size={16} />
              <span className="font-mono text-xs">{s.asset}</span>
              <span
                className="ml-auto max-w-full truncate font-mono text-xs text-[var(--fg-2)] sm:max-w-[300px]"
                title={s.reason}
              >
                {s.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Run confirmation (mode on = real orders) ───────────────── */

function RunConfirmDialog({
  open,
  onOpenChange,
  policy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  policy: ExchangePolicy | undefined
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-5" /> Run auto-sell now
          </DialogTitle>
          <DialogDescription>
            Mode is <span className="font-mono">on</span>: this places real
            post-only limit sells at Kraken for every sellable balance above
            the minimum order
            {policy?.withdraw.enabled
              ? ' and requests a bank withdrawal when USD exceeds the withdrawal minimum'
              : ''}
            . Use <span className="font-medium">Dry run now</span> to validate
            without placing anything.
          </DialogDescription>
        </DialogHeader>
        {policy && (
          <div className="figure rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 text-sm">
            min order {usd2(policy.minOrderUsd)} · 24 h cap{' '}
            {usd2(policy.dailyCapUsd)}
            {policy.withdraw.enabled &&
              ` · withdraw ≥ ${usd2(policy.withdraw.minUsd)} to ${policy.withdraw.key ?? '—'}`}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            <Play className="size-4" /> Run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Balances ───────────────────────────────────────────────── */

function BalanceCards({ rows }: { rows: ExchangeStatus['balances'] }) {
  const sorted = React.useMemo(
    () => rows.slice().sort((a, b) => num(b.usd) - num(a.usd)),
    [rows],
  )
  const total = sorted.reduce((a, r) => a + num(r.usd), 0)
  const paged = usePaged(sorted, PAGE_SIZE)
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Balances</h2>
        <span className="figure rounded-full bg-[var(--bg-active)] px-2 py-0.5 text-xs font-medium text-[var(--fg-1)]">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState framed compact icon={Dollar} title="No balances reported" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {paged.rows.map((r) => {
              const share = total > 0 ? (num(r.usd) / total) * 100 : 0
              const sym = krakenSymbol(r.asset)
              return (
                <Card key={r.asset} className="flex flex-col p-5">
                  <div className="flex items-center gap-3">
                    <AssetIcon asset={r.asset} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{sym}</div>
                      <div className="truncate font-mono text-xs text-[var(--fg-3)]" title={r.asset}>
                        {r.pair ?? (r.asset === 'ZUSD' ? 'USD' : 'not sellable')}
                      </div>
                    </div>
                    <span className="figure text-xs text-[var(--fg-2)]">{share.toFixed(1)}%</span>
                  </div>
                  <div className="mt-4">
                    <div className="figure truncate text-xl font-semibold" title={`balance ${r.balance}`}>
                      {usd2(r.usd)}
                    </div>
                    <div className="figure mt-0.5 truncate text-xs text-[var(--fg-2)]">
                      {r.available} {sym}
                      {r.price && <span className="text-[var(--fg-3)]"> · bid {r.price}</span>}
                    </div>
                    {isPositive(r.holdTrade) && (
                      <div className="figure mt-0.5 text-xs text-[var(--st-warn)]">
                        held {r.holdTrade}
                      </div>
                    )}
                  </div>
                  <div className="mt-auto pt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--chart-muted)]">
                      <div
                        className="h-full rounded-full bg-[var(--chart-1-fill)]"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          {rows.length > PAGE_SIZE && (
            <Pager
              page={paged.page}
              pageSize={PAGE_SIZE}
              total={paged.total}
              hasNext={paged.page < paged.pageCount - 1}
              onPage={paged.setPage}
              noun="assets"
            />
          )}
        </>
      )}
    </section>
  )
}

/* ── Open orders ────────────────────────────────────────────── */

function OpenOrdersTable({ orders }: { orders: ExchangeOpenOrder[] }) {
  const paged = usePaged(orders, PAGE_SIZE)
  return (
    <TableCard
      toolbar={<TableToolbar title="Open orders" count={orders.length} />}
      footer={
        orders.length > PAGE_SIZE && (
          <Pager
            page={paged.page}
            pageSize={PAGE_SIZE}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="orders"
          />
        )
      }
    >
      {orders.length === 0 ? (
        <EmptyState compact icon={CandlestickChart} title="No open orders" />
      ) : (
        <TableWrap>
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <Th>Pair</Th>
                <Th>Status</Th>
                <Th align="right">Filled</Th>
                <Th align="right">Cost / fee</Th>
                <Th align="right">Avg price</Th>
                <Th>Txid</Th>
                <Th align="right">Opened</Th>
              </tr>
            </THead>
            <TBody>
              {paged.rows.map((o) => {
                const vol = num(o.volume)
                const pct = vol > 0 ? Math.min(100, (num(o.volumeExecuted) / vol) * 100) : 0
                return (
                  <Tr key={o.txid}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <RowAvatar icon={CandlestickChart} />
                        <span className="font-mono font-medium">{o.pair}</span>
                      </div>
                    </Td>
                    <Td>
                      <StatusPill tone={ORDER_TONE[o.status] ?? 'wait'}>{o.status}</StatusPill>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      <div>
                        {o.volumeExecuted}
                        <span className="text-[var(--fg-3)]"> / {o.volume}</span>
                      </div>
                      <div className="mt-1 ml-auto h-1 w-20 overflow-hidden rounded-full bg-[var(--chart-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--st-ok-dot)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-[var(--fg-2)]">
                      {o.cost} / {o.fee}
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-[var(--fg-2)]">
                      {o.averagePrice ?? '—'}
                    </Td>
                    <Td>
                      <Addr value={o.txid} />
                    </Td>
                    <Td
                      align="right"
                      className="text-sm whitespace-nowrap text-[var(--fg-2)]"
                      title={fmtLocal(o.openedAt)}
                    >
                      {rel(o.openedAt)}
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </TableCard>
  )
}

/* ── Withdrawal keys ────────────────────────────────────────── */

function WithdrawKeyCards({
  keys,
  activeKey,
}: {
  keys: ExchangeWithdrawKey[]
  activeKey: string | null
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Withdrawal keys</h2>
        <span className="figure rounded-full bg-[var(--bg-active)] px-2 py-0.5 text-xs font-medium text-[var(--fg-1)]">
          {keys.length}
        </span>
        <InfoTip>
          Fiat destinations saved in the Kraken UI · copy the exact name into
          KRAKEN_WITHDRAW_KEY
        </InfoTip>
      </div>
      {keys.length === 0 ? (
        <EmptyState
          framed
          compact
          icon={KeyRound}
          title="No withdrawal keys saved at Kraken"
          description="Add a bank account in the Kraken UI first."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {keys.map((k) => {
            const active = activeKey != null && k.key === activeKey
            return (
              <Card
                key={`${k.key}-${k.address}`}
                className={cn(
                  'flex items-start gap-3 p-5',
                  active && 'border-[var(--accent-border)] bg-[var(--accent-bg)]',
                )}
              >
                <RowAvatar icon={Banknote} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-mono text-sm font-medium">{k.key}</span>
                    <CopyButton value={k.key} label="Copy key" />
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-xs text-[var(--fg-2)]"
                    title={k.address}
                  >
                    {k.address}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <StatusPill tone={k.verified ? 'ok' : 'warn'}>
                      {k.verified ? 'Verified' : 'Unverified'}
                    </StatusPill>
                    {active && (
                      <StatusPill tone="info" icon={BadgeCheck}>
                        In use
                      </StatusPill>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ── Actions journal ────────────────────────────────────────── */

const KIND_META: Record<
  ExchangeAction['kind'],
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  sell: { label: 'Sell', icon: ArrowUpRight },
  market_sell: { label: 'Market sell', icon: Zap },
  withdraw: { label: 'Withdraw', icon: Banknote },
}

function ActionsJournal({
  actions,
  isLoading,
  isFetching,
  error,
  onRefresh,
}: {
  actions: ExchangeAction[]
  isLoading: boolean
  isFetching: boolean
  error: unknown
  onRefresh: () => void
}) {
  const paged = usePaged(actions, PAGE_SIZE)
  return (
    <TableCard
      toolbar={
        <TableToolbar title="Actions journal" count={actions.length}>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh journal"
            title="Refresh"
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          </Button>
        </TableToolbar>
      }
      footer={
        actions.length > 0 && (
          <Pager
            page={paged.page}
            pageSize={PAGE_SIZE}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="actions"
          />
        )
      }
    >
      {isLoading ? (
        <ListSkeleton rows={5} className="rounded-none border-0" />
      ) : error ? (
        <div className="p-5">
          <ErrorState
            title="Could not load the journal"
            message={errText(error, 'Could not load the journal')}
          />
        </div>
      ) : actions.length === 0 ? (
        <EmptyState compact icon={Activity} title="No actions yet" />
      ) : (
        <TableWrap>
          <Table className="min-w-[980px]">
            <THead>
              <tr>
                <Th>Action</Th>
                <Th>Status</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Price</Th>
                <Th align="right">USD</Th>
                <Th>Ref</Th>
                <Th align="right">Time</Th>
              </tr>
            </THead>
            <TBody>
              {paged.rows.map((a) => (
                <ActionRow key={a.id} a={a} />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </TableCard>
  )
}

function ActionRow({ a }: { a: ExchangeAction }) {
  const [open, setOpen] = React.useState(false)
  const hasDetails =
    a.error != null || a.executedVolume != null || a.cost != null || a.fee != null
  const kind = KIND_META[a.kind] ?? KIND_META.sell
  const KindIcon = kind.icon
  const toggle = () => hasDetails && setOpen((v) => !v)
  return (
    <>
      <Tr
        interactive={hasDetails}
        tabIndex={hasDetails ? 0 : undefined}
        aria-expanded={hasDetails ? open : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (hasDetails && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            toggle()
          }
        }}
        className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
      >
        <Td>
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <AssetIcon asset={a.asset} />
              <span
                className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-card text-[var(--fg-1)] ring-2 ring-[var(--bg-1)]"
                title={kind.label}
              >
                <KindIcon className="size-3" />
              </span>
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-medium">
                {kind.label}
                {hasDetails &&
                  (open ? (
                    <ChevronDown className="size-3.5 text-[var(--fg-3)]" />
                  ) : (
                    <ChevronRight className="size-3.5 text-[var(--fg-3)]" />
                  ))}
              </div>
              <div className="font-mono text-xs text-[var(--fg-3)]">
                {a.asset}
                {a.pair && ` · ${a.pair}`}
              </div>
            </div>
          </div>
        </Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={ACTION_TONE[a.status] ?? 'wait'}>{a.status}</StatusPill>
            {a.dryRun === 1 && (
              <span title="Dry run" className="text-[var(--st-info)]">
                <FlaskConical className="size-4" />
              </span>
            )}
            {(a.requotes > 0 || a.requoteOf) && (
              <Badge
                variant="outline"
                className="figure"
                title={a.requoteOf ? `re-quote of ${a.requoteOf}` : 'requotes'}
              >
                <RefreshCw /> {a.requotes}
              </Badge>
            )}
            {a.error && (
              <span title={a.error} className="text-destructive">
                <AlertTriangle className="size-4" />
              </span>
            )}
          </div>
        </Td>
        <Td align="right" className="whitespace-nowrap">
          <div>{a.volume}</div>
          {a.executedVolume != null && a.executedVolume !== a.volume && (
            <div className="text-xs text-[var(--fg-3)]">exec {a.executedVolume}</div>
          )}
        </Td>
        <Td align="right" className="whitespace-nowrap text-[var(--fg-2)]">
          {a.price ?? <span className="text-[var(--fg-3)]">market</span>}
        </Td>
        <Td align="right" className="font-medium whitespace-nowrap">
          {usd2(a.usdEstimate)}
        </Td>
        <Td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {a.exchangeRef ? (
            <Addr value={a.exchangeRef} />
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </Td>
        <Td
          align="right"
          className="text-sm whitespace-nowrap text-[var(--fg-2)]"
          title={
            fmtLocal(a.createdAt, { seconds: true }) +
            (a.updatedAt !== a.createdAt
              ? ` · updated ${fmtLocal(a.updatedAt, { seconds: true })}`
              : '')
          }
        >
          {rel(a.createdAt)}
        </Td>
      </Tr>
      {open && (
        <Tr className="bg-[var(--bg-2)] hover:bg-[var(--bg-2)]">
          <Td colSpan={7} className="py-3">
            <div className="fade-in space-y-2">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-[var(--fg-2)]">
                <span className="inline-flex items-center gap-1">
                  <Hash className="size-3.5" /> <Addr value={a.id} />
                </span>
                {a.requoteOf && (
                  <span className="inline-flex items-center gap-1">
                    re-quote of <Addr value={a.requoteOf} />
                    <span className="text-[var(--fg-3)]">({shortId(a.requoteOf)})</span>
                  </span>
                )}
                {a.executedVolume != null && (
                  <span className="figure">executed {a.executedVolume}</span>
                )}
                {a.cost != null && <span className="figure">cost {a.cost}</span>}
                {a.fee != null && <span className="figure">fee {a.fee}</span>}
                {a.updatedAt !== a.createdAt && (
                  <span className="figure">updated {fmtLocal(a.updatedAt, { seconds: true })}</span>
                )}
              </div>
              {a.error && (
                <div className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 font-mono text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span className="break-all whitespace-pre-wrap">{a.error}</span>
                </div>
              )}
            </div>
          </Td>
        </Tr>
      )}
    </>
  )
}

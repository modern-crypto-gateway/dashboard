import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  Clock,
  FlaskConical,
  KeyRound,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { fmtLocal, useNow } from '@/lib/format'
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
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

/** Operator-facing text for `ExchangeRunResult.reason` when `ran` is false. */
const REASON_TEXT: Record<string, string> = {
  disabled:
    'auto-sell is off or the Kraken API key is not configured on the worker',
  throttled: 'the previous run was less than the interval ago',
}

type BadgeVariant = NonNullable<BadgeProps['variant']>

/** Spec: validated grey, open blue, filled green, canceled muted, failed red, requested amber, completed green. */
const ACTION_STATUS_BADGE: Record<
  ExchangeActionStatus,
  { variant: BadgeVariant; className?: string }
> = {
  validated: { variant: 'default' },
  open: { variant: 'accent' },
  filled: { variant: 'success' },
  canceled: { variant: 'outline', className: 'text-[var(--fg-3)]' },
  failed: { variant: 'danger' },
  requested: { variant: 'warn' },
  completed: { variant: 'success' },
}

const ORDER_STATUS_BADGE: Record<
  ExchangeOpenOrder['status'],
  { variant: BadgeVariant; className?: string }
> = {
  pending: { variant: 'warn' },
  open: { variant: 'accent' },
  closed: { variant: 'success' },
  canceled: { variant: 'outline', className: 'text-[var(--fg-3)]' },
  expired: { variant: 'default' },
}

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

function runSummary(r: ExchangeRunResult): string {
  return `placed ${r.placed} · requoted ${r.requoted} · market ${r.marketFallbacks} · filled ${r.filled} · canceled ${r.canceled} · withdrawals ${r.withdrawals}`
}

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
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Exchange
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-2)]">
            Funds the treasury sends to Kraken are sold automatically to USD
            and, when enabled, USD above a threshold is withdrawn to the bank
            account saved in the Kraken UI. Orders are post-only limit sells
            at the best ask (maker fee); a stale order is re-quoted after N
            minutes and after the last re-quote becomes a market sell. In{' '}
            <span className="font-mono">dry-run</span> mode every order is
            validated with Kraken but never placed and withdrawals are
            journaled as validated only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status?.snapshotAt != null && (
            <span
              className="text-xs text-muted-foreground"
              title="Balances, open orders and withdrawal keys are a snapshot written by every run. Refresh reads Kraken live (one serialized read)."
            >
              Kraken data as of {fmtLocal(status.snapshotAt)}
              {status.lockedUntil != null
                ? ` · locked out until ${fmtLocal(status.lockedUntil)}`
                : ''}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
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
            <RefreshCw
              className={
                'size-3.5' + (statusQ.isFetching ? ' animate-spin' : '')
              }
            />
            Refresh
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
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              Dry run now
            </Button>
          </span>
          <span title={runDisabledTitle}>
            <Button size="sm" onClick={startRun} disabled={!canRun}>
              {run.isPending && run.variables === false ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run now
            </Button>
          </span>
        </div>
      </div>

      <RunConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        policy={status?.policy}
        onConfirm={() => {
          setConfirmOpen(false)
          run.mutate(false)
        }}
      />

      {status?.error && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-xs text-warn">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            Kraken API error while loading live data — balances and open
            orders may be stale or empty:{' '}
            <span className="font-mono">{status.error}</span>
          </span>
        </div>
      )}

      {statusQ.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">
          Loading…
        </Card>
      ) : statusQ.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {errText(statusQ.error, 'Could not load the exchange status')}
        </Card>
      ) : status ? (
        <>
          {!configured && <NotConfigured />}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PolicyCard policy={status.policy} />
            <LastRunCard run={latestRun} now={now} />
          </div>
          {configured && (
            <>
              <BalancesCard rows={status.balances} />
              <OpenOrdersCard orders={status.openOrders} />
              <WithdrawKeysCard
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
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <KeyRound className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">
        Kraken is not configured.
      </div>
      <p className="mx-auto mt-1 max-w-md text-xs text-[var(--fg-2)]">
        The worker has no <span className="font-mono">KRAKEN_API_KEY</span> /{' '}
        <span className="font-mono">KRAKEN_API_SECRET</span>. Set them as
        Cloudflare secrets and redeploy; balances, open orders and runs are
        unavailable until then. The journal below still shows past actions.
      </p>
    </Card>
  )
}

/* ── Policy + last run ──────────────────────────────────────── */

function ModeBadge({ mode }: { mode: ExchangeMode }) {
  if (mode === 'on')
    return (
      <Badge variant="success">
        <Play className="size-3" /> on
      </Badge>
    )
  if (mode === 'dry-run')
    return (
      <Badge variant="accent">
        <FlaskConical className="size-3" /> dry-run
      </Badge>
    )
  return (
    <Badge variant="default">
      <Pause className="size-3" /> off
    </Badge>
  )
}

function WithdrawBadge({ w }: { w: ExchangePolicy['withdraw'] }) {
  if (!w.enabled)
    return (
      <Badge variant="default">
        <Banknote className="size-3" /> withdraw off
      </Badge>
    )
  return (
    <Badge variant="success" title={w.key ?? undefined}>
      <Banknote className="size-3" /> withdraw on
      {w.key && <span className="font-mono">→ {w.key}</span>}
    </Badge>
  )
}

function PolicyCard({ policy }: { policy: ExchangePolicy }) {
  const sellable = Object.entries(policy.sellable)
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
        <CandlestickChart className="size-4 text-[var(--fg-2)]" />
        <div className="text-base font-semibold tracking-tight">Policy</div>
        <ModeBadge mode={policy.mode} />
        <WithdrawBadge w={policy.withdraw} />
      </div>
      <CardContent className="space-y-3 pt-5">
        <KeyVal label="Min order">
          <span className="font-mono">{usd2(policy.minOrderUsd)}</span>
        </KeyVal>
        <KeyVal label="Sell cap (24 h)">
          <span className="font-mono">{usd2(policy.dailyCapUsd)}</span>
        </KeyVal>
        <KeyVal label="Re-quote">
          <span className="font-mono">
            after {policy.requoteMinutes} min · max {policy.maxRequotes}
            <span className="ml-1.5 text-[10.5px] text-[var(--fg-3)]">
              then market sell
            </span>
          </span>
        </KeyVal>
        <KeyVal label="Interval">
          <span className="font-mono">every {policy.intervalMinutes} min</span>
        </KeyVal>
        <KeyVal label="Sellable">
          {sellable.length === 0 ? (
            <span className="text-[var(--fg-3)]">none</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {sellable.map(([asset, pair]) => (
                <Badge key={asset} variant="outline" className="font-mono">
                  {asset} → {pair}
                </Badge>
              ))}
            </span>
          )}
        </KeyVal>
        <KeyVal label="Withdraw">
          {policy.withdraw.enabled ? (
            <span className="font-mono">
              {policy.withdraw.asset} · min {usd2(policy.withdraw.minUsd)} ·
              daily {usd2(policy.withdraw.dailyCapUsd)}
              <span className="ml-1.5 text-[10.5px] text-[var(--fg-3)]">
                key {policy.withdraw.key ?? '—'}
              </span>
            </span>
          ) : (
            <span className="text-[var(--fg-3)]">
              disabled
              <span className="ml-1.5 font-mono text-[10.5px]">
                ({policy.withdraw.asset} · min {usd2(policy.withdraw.minUsd)} ·
                daily {usd2(policy.withdraw.dailyCapUsd)})
              </span>
            </span>
          )}
        </KeyVal>
        <KeyVal label="userref">
          <span className="font-mono">{policy.userref}</span>
        </KeyVal>
        <div className="text-[11px] text-[var(--fg-3)]">
          Read-only — {POLICY_HINT}.
        </div>
      </CardContent>
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
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
        <Clock className="size-4 text-[var(--fg-2)]" />
        <div className="text-base font-semibold tracking-tight">Last run</div>
        {run && (
          <>
            <ModeBadge mode={run.mode} />
            {run.dryRun && (
              <Badge variant="accent">
                <FlaskConical className="size-3" /> dry run
              </Badge>
            )}
            {!run.ran && (
              <Badge variant="warn" title={run.reason}>
                <AlertTriangle className="size-3" /> did not run
                {run.reason && <span>· {run.reason}</span>}
              </Badge>
            )}
            <span className="ml-auto font-mono text-xs text-[var(--fg-2)]">
              {fmtLocal(run.at, { seconds: true })}
              <span className="ml-1.5 text-[var(--fg-3)]">
                ({fmtRelDelta(run.at - now)})
              </span>
            </span>
          </>
        )}
      </div>
      <CardContent className="space-y-3 pt-5">
        {!run ? (
          <div className="text-sm text-[var(--fg-3)]">
            No run recorded yet — the worker runs on its interval, or trigger
            one above.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Synced" value={String(run.synced)} />
              <Stat
                label="Placed"
                value={String(run.placed)}
                accent={run.placed > 0}
              />
              <Stat label="Re-quoted" value={String(run.requoted)} />
              <Stat
                label="Market fallbacks"
                value={String(run.marketFallbacks)}
                accent={run.marketFallbacks > 0}
              />
              <Stat label="Filled" value={String(run.filled)} />
              <Stat label="Canceled" value={String(run.canceled)} />
              <Stat
                label="Withdrawals"
                value={String(run.withdrawals)}
                accent={run.withdrawals > 0}
              />
              <Stat label="Skipped" value={String(run.skipped.length)} />
            </div>
            {run.skipped.length > 0 && (
              <SkippedList skipped={run.skipped} />
            )}
            {run.errors.length > 0 && (
              <ul className="space-y-1 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2">
                {run.errors.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 font-mono text-[11px] text-destructive"
                  >
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span className="break-all">{e}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
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
        className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-warn hover:underline"
      >
        <AlertTriangle className="size-3" />
        {open ? 'Hide' : 'Show'} skipped · {skipped.length}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 rounded-md border border-warn/40 bg-warn/10 p-2">
          {skipped.map((s, i) => (
            <li
              key={`${s.asset}-${i}`}
              className="flex flex-wrap items-center gap-2 rounded border border-warn/30 bg-card px-2 py-1 text-xs"
            >
              <span className="font-mono">{s.asset}</span>
              <span
                className="ml-auto max-w-[360px] truncate font-mono text-[10px] text-[var(--fg-3)]"
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

function KeyVal({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 text-sm">
      <span className="pt-0.5 text-[11px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        accent
          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
          : 'border-border bg-[var(--bg-2)]',
      )}
    >
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm" title={value}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-[var(--fg-2)]">{sub}</div>}
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
            <Play className="size-4" /> Run auto-sell now
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
          <div className="rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs">
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
            <Play className="size-3.5" /> Run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Balances ───────────────────────────────────────────────── */

function BalancesCard({ rows }: { rows: ExchangeStatus['balances'] }) {
  const totalUsd = React.useMemo(() => {
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
  }, [rows])
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="text-base font-semibold tracking-tight">Balances</div>
        <span className="text-xs text-[var(--fg-2)]">
          Kraken snapshot · {rows.length} asset{rows.length === 1 ? '' : 's'}
        </span>
        {totalUsd != null && (
          <span className="ml-auto font-mono text-xs text-[var(--fg-2)]">
            ≈ {usd2(totalUsd)} total
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">
          No balances reported.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-4 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Price (bid)</th>
                <th className="px-3 py-2 text-right">USD value</th>
                <th className="px-4 py-2 text-left">Pair</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-mono font-medium">{r.asset}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    <div>{r.available}</div>
                    {isPositive(r.holdTrade) && (
                      <div
                        className="text-[10.5px] text-warn"
                        title={`balance ${r.balance}`}
                      >
                        held {r.holdTrade}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--fg-2)]">
                    {r.price ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    {usd2(r.usd)}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {r.pair ?? (
                      <span className="text-[var(--fg-3)]">
                        {r.asset === 'ZUSD' ? 'USD' : 'not sellable'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ── Open orders ────────────────────────────────────────────── */

function OpenOrdersCard({ orders }: { orders: ExchangeOpenOrder[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="text-base font-semibold tracking-tight">
          Open orders
        </div>
        <span className="text-xs text-[var(--fg-2)]">
          Kraken snapshot · {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">
          No open orders.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-4 py-2 text-left">Pair</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-right">Executed</th>
                <th className="px-3 py-2 text-right">Cost / fee</th>
                <th className="px-3 py-2 text-right">Avg price</th>
                <th className="px-3 py-2 text-left">Opened</th>
                <th className="px-4 py-2 text-left">Txid</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const sb = ORDER_STATUS_BADGE[o.status] ?? {
                  variant: 'default' as const,
                }
                return (
                  <tr key={o.txid} className="border-t border-border align-top">
                    <td className="px-4 py-2 font-mono font-medium">{o.pair}</td>
                    <td className="px-3 py-2">
                      <Badge variant={sb.variant} className={sb.className}>
                        {o.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {o.volume}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {o.volumeExecuted}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--fg-2)]">
                      {o.cost} / {o.fee}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--fg-2)]">
                      {o.averagePrice ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {fmtLocal(o.openedAt)}
                    </td>
                    <td className="px-4 py-2">
                      <Addr value={o.txid} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ── Withdrawal keys ────────────────────────────────────────── */

function WithdrawKeysCard({
  keys,
  activeKey,
}: {
  keys: ExchangeWithdrawKey[]
  activeKey: string | null
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <KeyRound className="size-4 text-[var(--fg-2)]" />
        <div className="text-base font-semibold tracking-tight">
          Saved withdrawal keys
        </div>
        <span className="text-xs text-[var(--fg-2)]">
          fiat destinations saved in the Kraken UI · copy the exact name into{' '}
          <span className="font-mono">KRAKEN_WITHDRAW_KEY</span>
        </span>
      </div>
      {keys.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">
          No withdrawal keys saved at Kraken — add a bank account in the
          Kraken UI first.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((k) => {
            const active = activeKey != null && k.key === activeKey
            return (
              <li
                key={`${k.key}-${k.address}`}
                className={cn(
                  'flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm',
                  active && 'bg-[var(--accent-bg)]',
                )}
              >
                <span className="font-mono">{k.key}</span>
                <CopyButton value={k.key} label="Copy key" />
                {k.verified ? (
                  <Badge variant="success">
                    <BadgeCheck className="size-3" /> verified
                  </Badge>
                ) : (
                  <Badge variant="warn">
                    <AlertTriangle className="size-3" /> unverified
                  </Badge>
                )}
                {active && <Badge variant="accent">in use</Badge>}
                <span
                  className="ml-auto max-w-[420px] truncate font-mono text-xs text-[var(--fg-2)]"
                  title={k.address}
                >
                  {k.address}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/* ── Actions journal ────────────────────────────────────────── */

function KindBadge({ kind }: { kind: ExchangeAction['kind'] }) {
  if (kind === 'market_sell')
    return (
      <Badge variant="warn">
        <AlertTriangle className="size-3" /> market sell
      </Badge>
    )
  if (kind === 'withdraw')
    return (
      <Badge variant="accent">
        <Banknote className="size-3" /> withdraw
      </Badge>
    )
  return <Badge variant="outline">sell</Badge>
}

function ActionStatusBadge({ status }: { status: ExchangeActionStatus }) {
  const sb = ACTION_STATUS_BADGE[status] ?? { variant: 'default' as const }
  return (
    <Badge variant={sb.variant} className={sb.className}>
      {status}
    </Badge>
  )
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
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="text-base font-semibold tracking-tight">
          Actions journal
        </div>
        <span className="text-xs text-[var(--fg-2)]">newest first · last 50</span>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isFetching}
          >
            <RefreshCw
              className={'size-3.5' + (isFetching ? ' animate-spin' : '')}
            />
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-destructive">
          {errText(error, 'Could not load the journal')}
        </div>
      ) : actions.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">
          No actions yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Asset / pair</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">USD</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-4 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <ActionRow key={a.id} a={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function ActionRow({ a }: { a: ExchangeAction }) {
  const [open, setOpen] = React.useState(false)
  const hasDetails =
    a.error != null || a.executedVolume != null || a.cost != null || a.fee != null
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-2 font-mono whitespace-nowrap">
          <div>{fmtLocal(a.createdAt, { seconds: true })}</div>
          {a.updatedAt !== a.createdAt && (
            <div
              className="text-[10.5px] text-[var(--fg-3)]"
              title="last update"
            >
              upd {fmtLocal(a.updatedAt, { seconds: true })}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <KindBadge kind={a.kind} />
        </td>
        <td className="px-3 py-2 font-mono whitespace-nowrap">
          <div className="font-medium">{a.asset}</div>
          {a.pair && (
            <div className="text-[10.5px] text-[var(--fg-3)]">{a.pair}</div>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          <div>{a.volume}</div>
          {a.executedVolume != null && a.executedVolume !== a.volume && (
            <div className="text-[10.5px] text-[var(--fg-3)]">
              exec {a.executedVolume}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--fg-2)]">
          {a.price ?? <span className="text-[var(--fg-3)]">market</span>}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          {usd2(a.usdEstimate)}
        </td>
        <td className="px-3 py-2">
          <ActionStatusBadge status={a.status} />
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {a.dryRun === 1 && (
              <Badge variant="accent">
                <FlaskConical className="size-3" /> dry run
              </Badge>
            )}
            {(a.requotes > 0 || a.requoteOf) && (
              <Badge
                variant="outline"
                className="font-mono"
                title={a.requoteOf ? `re-quote of ${a.requoteOf}` : undefined}
              >
                <RefreshCw className="size-3" /> requote #{a.requotes}
                {a.requoteOf && (
                  <span className="text-[var(--fg-3)]">
                    of {shortId(a.requoteOf)}
                  </span>
                )}
              </Badge>
            )}
            {a.dryRun !== 1 && !(a.requotes > 0 || a.requoteOf) && (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          {a.exchangeRef ? (
            <Addr value={a.exchangeRef} />
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </td>
        <td className="px-4 py-2">
          {hasDetails ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={cn(
                'inline-flex max-w-[260px] cursor-pointer items-center gap-1 hover:underline',
                a.error ? 'text-destructive' : 'text-primary',
              )}
              title={a.error ?? 'Show execution details'}
            >
              {open ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <ChevronRight className="size-3 shrink-0" />
              )}
              <span className="truncate font-mono text-[11px]">
                {a.error ?? 'details'}
              </span>
            </button>
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-[var(--bg-2)]">
          <td colSpan={10} className="px-4 py-2.5">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-1.5 text-xs">
              <span className="font-mono text-[var(--fg-2)]">
                id <Addr value={a.id} />
              </span>
              {a.requoteOf && (
                <span className="font-mono text-[var(--fg-2)]">
                  re-quote of <Addr value={a.requoteOf} />
                </span>
              )}
              {a.executedVolume != null && (
                <span className="font-mono">executed {a.executedVolume}</span>
              )}
              {a.cost != null && (
                <span className="font-mono">cost {a.cost}</span>
              )}
              {a.fee != null && <span className="font-mono">fee {a.fee}</span>}
            </div>
            {a.error && (
              <div className="mt-1.5 flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-2.5 py-2 font-mono text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span className="break-all whitespace-pre-wrap">{a.error}</span>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

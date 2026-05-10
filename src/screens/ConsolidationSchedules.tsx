import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

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

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

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

export function ConsolidationSchedulesPage() {
  const qc = useQueryClient()
  const q = useQuery(SCHEDULES_Q)
  const [editing, setEditing] = React.useState<AutoConsolidationSchedule | null>(
    null,
  )
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Auto-consolidation
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-2)]">
            Recurring sweeps of fragmented (chain, token) balances into a
            single pool address. Each schedule fires every{' '}
            <span className="font-mono">intervalHours</span>; sources below{' '}
            <span className="font-mono">minSourceBalanceRaw</span> are silently
            skipped so the cron doesn't burn more in gas than it recovers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw
              className={'size-3.5' + (q.isFetching ? ' animate-spin' : '')}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New schedule
          </Button>
        </div>
      </div>

      <ScheduleFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ['gw', 'consolidation-schedules'] })
        }
      />
      {editing && (
        <ScheduleFormDialog
          mode="edit"
          open={editing != null}
          onOpenChange={(v) => !v && setEditing(null)}
          schedule={editing}
          onSaved={() => {
            qc.invalidateQueries({
              queryKey: ['gw', 'consolidation-schedules'],
            })
            setEditing(null)
          }}
        />
      )}

      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">
          Loading…
        </Card>
      ) : q.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : 'Error'}
        </Card>
      ) : (q.data?.schedules.length ?? 0) === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {q.data!.schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onEdit={() => setEditing(s)}
              onChanged={() =>
                qc.invalidateQueries({
                  queryKey: ['gw', 'consolidation-schedules'],
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <CalendarClock className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">
        No auto-consolidation schedules yet.
      </div>
      <p className="mx-auto mt-1 max-w-md text-xs text-[var(--fg-2)]">
        Schedule one per (chain, token) pair to keep balances pooled into a
        single address without operator action.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreate}>
        <Plus className="size-3.5" /> Create schedule
      </Button>
    </Card>
  )
}

function ScheduleCard({
  schedule,
  onEdit,
  onChanged,
}: {
  schedule: AutoConsolidationSchedule
  onEdit: () => void
  onChanged: () => void
}) {
  const info = chainInfo(schedule.chainId)
  const chainsQ = useQuery(CHAINS_Q)
  const chain = chainsQ.data?.chains.find((c) => c.chainId === schedule.chainId)
  const tokenMeta = chain?.tokens.find(
    (t) => t.symbol.toUpperCase() === schedule.token.toUpperCase(),
  )
  const dec = tokenMeta?.decimals ?? null

  const togglePending = useMutation({
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

  const now = useNow(15_000)
  const dueIn = schedule.nextRunDue - now
  const overdue = schedule.enabled && dueIn < 0
  const lastRunAge =
    schedule.lastRunAt != null ? now - schedule.lastRunAt : null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <span
          className="size-3 rounded-sm"
          style={{ background: info.color }}
        />
        <div className="text-base font-semibold tracking-tight">
          {info.name}
        </div>
        <Badge variant="outline" className="font-mono">
          {schedule.token}
        </Badge>
        {schedule.enabled ? (
          <Badge variant="success">
            <Play className="size-3" /> enabled
          </Badge>
        ) : (
          <Badge variant="default">
            <Pause className="size-3" /> disabled
          </Badge>
        )}
        {overdue && (
          <Badge variant="warn">
            <AlertTriangle className="size-3" /> overdue
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => togglePending.mutate()}
            disabled={togglePending.isPending}
            title="Soft on/off — preserves last-run snapshot"
          >
            {schedule.enabled ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {schedule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <DeleteScheduleButton schedule={schedule} onChanged={onChanged} />
        </div>
      </div>
      <CardContent className="grid grid-cols-1 gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-3">
          <KeyVal label="Target address">
            <Addr value={schedule.targetAddress} truncated={false} />
          </KeyVal>
          <KeyVal label="Interval">
            <span className="font-mono">
              every {schedule.intervalHours}h
            </span>
          </KeyVal>
          <KeyVal label="Per-source dust floor">
            <span className="font-mono">
              {dec != null
                ? `${formatUnits(schedule.minSourceBalanceRaw, dec)} ${schedule.token}`
                : `${schedule.minSourceBalanceRaw} (raw)`}
            </span>
          </KeyVal>
          <KeyVal label="Max sources / run">
            <span className="font-mono">{schedule.maxSourcesPerRun}</span>
          </KeyVal>
        </div>
        <div className="space-y-3">
          <KeyVal label="Next firing">
            <span
              className={cn(
                'font-mono',
                overdue ? 'text-warn' : 'text-foreground',
              )}
            >
              {fmtLocal(schedule.nextRunDue)}
              <span className="ml-1.5 text-[var(--fg-3)]">
                ({fmtRelDelta(dueIn)})
              </span>
            </span>
          </KeyVal>
          <KeyVal label="Last firing">
            {schedule.lastRunAt ? (
              <span className="font-mono">
                {fmtLocal(schedule.lastRunAt)}
                <span className="ml-1.5 text-[var(--fg-3)]">
                  ({fmtRelDelta(-lastRunAge!)})
                </span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">never</span>
            )}
          </KeyVal>
          <KeyVal label="Last result">
            {schedule.lastConsolidationId ? (
              <LastRunSummary
                schedule={schedule}
                tokenDecimals={dec}
              />
            ) : (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </KeyVal>
        </div>
      </CardContent>
    </Card>
  )
}

function KeyVal({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 text-sm">
      <span className="pt-0.5 text-[11px] uppercase tracking-[0.08em] text-[var(--fg-3)]">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function LastRunSummary({
  schedule,
  tokenDecimals,
}: {
  schedule: AutoConsolidationSchedule
  tokenDecimals: number | null
}) {
  // Lightweight peek into the last consolidation — no polling, just one
  // fetch on render so operators can see how the most recent firing went.
  const id = schedule.lastConsolidationId!
  const q = useQuery({
    queryKey: ['gw', 'consolidations', id] as const,
    queryFn: () =>
      api<ConsolidationStatusResponse>(
        `/api/gw/admin/pool/consolidations/${encodeURIComponent(id)}`,
      ),
    staleTime: 60_000,
  })
  const summary = q.data?.summary

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline">
          legs: <span className="font-mono">{schedule.lastLegCount ?? '?'}</span>
        </Badge>
        {schedule.lastSkippedCount != null && schedule.lastSkippedCount > 0 && (
          <Badge variant="warn">
            skipped:{' '}
            <span className="font-mono">{schedule.lastSkippedCount}</span>
          </Badge>
        )}
        {summary && summary.confirmed === summary.total && summary.total > 0 && (
          <Badge variant="success">
            <CheckCircle2 className="size-3" /> all confirmed
          </Badge>
        )}
        {summary && summary.pendingOrInFlight > 0 && (
          <Badge variant="warn">
            <Loader2 className="size-3 animate-spin" />{' '}
            {summary.pendingOrInFlight} in flight
          </Badge>
        )}
        {summary && summary.failed > 0 && (
          <Badge variant="danger">
            <AlertTriangle className="size-3" /> {summary.failed} failed
          </Badge>
        )}
      </div>
      {summary && (
        <LastRunLegs
          status={q.data!}
          tokenDecimals={tokenDecimals}
          token={schedule.token}
        />
      )}
    </div>
  )
}

function LastRunLegs({
  status,
  tokenDecimals,
  token,
}: {
  status: ConsolidationStatusResponse
  tokenDecimals: number | null
  token: string
}) {
  const [open, setOpen] = React.useState(false)
  if (status.legs.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-primary hover:underline cursor-pointer"
      >
        {open ? 'Hide' : 'Show'} {status.legs.length} leg
        {status.legs.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-2 py-1.5 text-left">Source</th>
                <th className="px-2 py-1.5 text-left">Amount</th>
                <th className="px-2 py-1.5 text-left">Status</th>
                <th className="px-2 py-1.5 text-left">Tx</th>
              </tr>
            </thead>
            <tbody>
              {status.legs.map((leg) => (
                <tr key={leg.payoutId} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <Addr value={leg.sourceAddress} />
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {tokenDecimals != null
                      ? `${formatUnits(leg.amountRaw, tokenDecimals)} ${token}`
                      : leg.amountRaw}
                  </td>
                  <td className="px-2 py-1.5">
                    <LegBadge status={leg.status} />
                  </td>
                  <td className="px-2 py-1.5">
                    {leg.txHash ? (
                      <Addr value={leg.txHash} />
                    ) : (
                      <span className="text-[var(--fg-3)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LegBadge({
  status,
}: {
  status: ConsolidationStatusResponse['legs'][number]['status']
}) {
  if (status === 'confirmed') return <Badge variant="success">{status}</Badge>
  if (status === 'failed' || status === 'canceled')
    return <Badge variant="danger">{status}</Badge>
  if (status === 'submitted' || status === 'topping-up' || status === 'reserved')
    return <Badge variant="warn">{status}</Badge>
  return <Badge variant="default">{status}</Badge>
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

function DeleteScheduleButton({
  schedule,
  onChanged,
}: {
  schedule: AutoConsolidationSchedule
  onChanged: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const del = useMutation({
    mutationFn: () =>
      api<{ deleted: true }>(
        `/api/gw/admin/consolidation-schedules/${encodeURIComponent(schedule.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      toast.success('Schedule deleted')
      setOpen(false)
      onChanged()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Delete failed'),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive">
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4" /> Delete schedule
          </DialogTitle>
          <DialogDescription>
            Permanently removes the schedule and its last-run snapshot. Prefer{' '}
            <span className="font-medium">Disable</span> if you might re-enable
            it later — disabling preserves the forensic record of past firings.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-secondary px-3 py-2 text-sm">
          <div className="font-mono text-xs">
            chain {schedule.chainId} · {schedule.token}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-2)]">
            target: <Addr value={schedule.targetAddress} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={del.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {del.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
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
        return api<{ schedule: AutoConsolidationSchedule }>(
          '/api/gw/admin/consolidation-schedules',
          {
            method: 'POST',
            body: JSON.stringify({
              chainId: parseInt(chainId, 10),
              token: token.trim().toUpperCase(),
              targetAddress: target.trim(),
              intervalHours: iv,
              minSourceBalanceRaw: minRaw.trim(),
              maxSourcesPerRun: ms,
              enabled,
            }),
          },
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />
            {isEdit ? 'Edit schedule' : 'New auto-consolidation schedule'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing intervalHours recomputes nextRunDue from the existing baseline (lastRunAt or createdAt) — it does not reset the cycle.'
              : 'One schedule per (chain, token) pair. The cron uses the same consolidation_sweep flow as the manual endpoint, just on a fixed cadence.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid grid-cols-[1fr_140px] gap-2">
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
                        <span>{c.displayName}</span>
                        <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
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
                        <span className="font-mono">{t.symbol}</span>
                        <span className="text-[10.5px] text-[var(--fg-3)]">
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
                ? 'Pick the pool address with the most existing balance (top of the list) to minimize legs.'
                : 'Must already exist in address_pool for this family.'
            }
            right={
              targetCandidates.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setTarget('')}
                  className="text-[11px] text-[var(--fg-3)] hover:text-foreground cursor-pointer"
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
                          <span className="font-mono text-[11.5px]">
                            {row.address.slice(0, 10)}…{row.address.slice(-6)}
                          </span>
                          {balLabel && (
                            <span className="font-mono text-[10.5px] text-success">
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

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field
              label="Interval (hours)"
              hint="1–720 (max 30 days)"
            >
              <Input
                type="number"
                min={1}
                max={720}
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label="Max sources per run" hint="Cap on legs per cron tick.">
              <Input
                type="number"
                min={1}
                max={200}
                value={maxSources}
                onChange={(e) => setMaxSources(e.target.value)}
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Per-source dust floor (raw)"
            hint={
              <>
                Smallest unit. Sources holding less than this are silently
                skipped at fire time so the cron doesn't burn more in gas than
                it recovers. {previewMin && (
                  <span className="font-mono text-[var(--fg-2)]">{previewMin}</span>
                )}
              </>
            }
            right={
              suggestion ? (
                <button
                  type="button"
                  onClick={() => setMinRaw(suggestion.raw)}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                  title={`Suggested: ${suggestion.label}`}
                >
                  Use suggested ({suggestion.label})
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

          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
            <input
              id="schedule-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <label
              htmlFor="schedule-enabled"
              className="cursor-pointer text-sm"
            >
              Enabled
            </label>
            <span className="ml-auto text-xs text-[var(--fg-3)]">
              Disabled schedules are skipped by the cron entirely.
            </span>
          </div>

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
                <Loader2 className="size-3.5 animate-spin" />
              ) : isEdit ? (
                <Pencil className="size-3.5" />
              ) : (
                <Layers className="size-3.5" />
              )}
              {save.isPending
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Create schedule'}
            </Button>
          </DialogFooter>
        </form>

        {!isEdit && (
          <p className="text-[11px] text-[var(--fg-3)]">
            Use the manual flow on{' '}
            <a href="/pool" className="inline-flex items-center gap-0.5 text-primary hover:underline">
              Address pool <ExternalLink className="size-3" />
            </a>{' '}
            for one-shot consolidations.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

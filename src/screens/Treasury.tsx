import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  FlaskConical,
  Landmark,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import {
  fmtLocal,
  fmtNum,
  fmtUsd,
  formatUnits,
  parseUnits,
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

/* ── Page ───────────────────────────────────────────────────── */

export function TreasuryPage() {
  const qc = useQueryClient()
  const destQ = useQuery(DESTINATIONS_Q)
  const chainsQ = useQuery(CHAINS_Q)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TreasuryDestination | null>(null)
  const [transferFilter, setTransferFilter] = React.useState<string>('all')

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

  // Destinations grouped by chain (sorted by display name), then token, label.
  const groups = React.useMemo(() => {
    const m = new Map<number, TreasuryDestination[]>()
    for (const d of destinations) {
      const arr = m.get(d.chainId) ?? []
      arr.push(d)
      m.set(d.chainId, arr)
    }
    return [...m.entries()]
      .map(([chainId, rows]) => ({
        chainId,
        name: chainName(chains, chainId),
        rows: rows
          .slice()
          .sort(
            (a, b) =>
              a.token.localeCompare(b.token) || a.label.localeCompare(b.label),
          ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [destinations, chains])

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

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Treasury
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-2)]">
            Allow-listed external addresses (Kraken deposit addresses) that
            receive pool balances through the gateway's own payout rails, one
            per (chain, token). Stablecoin credits younger than the refund hold
            stay on their receiving address; a{' '}
            <span className="font-mono">float</span> of each token is always
            kept for merchant payouts; per-transfer and rolling 24 h USD caps
            bound every run. A new destination starts disabled and unverified:
            send a small verification transfer, confirm it arrived at the
            exchange, mark it verified, then enable it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              destQ.refetch()
              transfersQ.refetch()
            }}
            disabled={destQ.isFetching}
          >
            <RefreshCw
              className={'size-3.5' + (destQ.isFetching ? ' animate-spin' : '')}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> Add destination
          </Button>
        </div>
      </div>

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

      {destQ.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">
          Loading…
        </Card>
      ) : destQ.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {destQ.error instanceof Error ? destQ.error.message : 'Error'}
        </Card>
      ) : destinations.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.chainId} className="space-y-3">
              <div className="flex items-center gap-2 px-0.5">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: chainInfo(g.chainId).color }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-2)]">
                  {g.name}
                </span>
                <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
                  {g.chainId} · {g.rows.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {g.rows.map((d) => (
                  <DestinationCard
                    key={d.id}
                    d={d}
                    chains={chains}
                    hasTransfers={destsWithTransfers.has(d.id)}
                    onEdit={() => setEditing(d)}
                    onChanged={invalidate}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <TransfersSection
        transfers={transfers}
        isLoading={transfersQ.isLoading}
        isFetching={transfersQ.isFetching}
        error={transfersQ.error}
        onRefresh={() => transfersQ.refetch()}
        destinations={destinations}
        chains={chains}
        filter={transferFilter}
        onFilterChange={setTransferFilter}
      />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <Landmark className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">
        No treasury destinations yet.
      </div>
      <p className="mx-auto mt-1 max-w-md text-xs text-[var(--fg-2)]">
        Add one per (chain, token) route you want to sweep to the exchange.
        It starts disabled; verify it with a small test transfer before
        enabling.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreate}>
        <Plus className="size-3.5" /> Add destination
      </Button>
    </Card>
  )
}

/* ── Destination card ───────────────────────────────────────── */

function DestinationCard({
  d,
  chains,
  hasTransfers,
  onEdit,
  onChanged,
}: {
  d: TreasuryDestination
  chains: ChainInventoryEntry[] | undefined
  hasTransfers: boolean
  onEdit: () => void
  onChanged: () => void
}) {
  const info = chainInfo(d.chainId)
  const name = chainName(chains, d.chainId)
  const dec = findToken(chains, d.chainId, d.token)?.decimals ?? null
  const now = useNow(15_000)
  const verified = d.verifiedAt != null
  const auto = d.autoIntervalHours != null
  const overdue =
    d.enabled && auto && d.nextRunDue != null && d.nextRunDue < now

  const [expanded, setExpanded] = React.useState(false)
  const [verifyOpen, setVerifyOpen] = React.useState(false)
  const [transferOpen, setTransferOpen] = React.useState(false)

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

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="size-3 rounded-sm" style={{ background: info.color }} />
        <div className="text-base font-semibold tracking-tight">{d.label}</div>
        <Badge variant="outline">{d.exchange}</Badge>
        <span className="text-sm text-[var(--fg-2)]">{name}</span>
        <Badge variant="outline" className="font-mono">
          {d.token}
        </Badge>
        {verified ? (
          <Badge variant="success">
            <BadgeCheck className="size-3" /> Verified
          </Badge>
        ) : (
          <Badge variant="warn">
            <AlertTriangle className="size-3" /> Awaiting verification
          </Badge>
        )}
        {d.enabled ? (
          <Badge variant="success">
            <Play className="size-3" /> Enabled
          </Badge>
        ) : (
          <Badge variant="default">
            <Pause className="size-3" /> Disabled
          </Badge>
        )}
        {auto && (
          <Badge variant="accent" title={`next ${fmtLocal(d.nextRunDue)}`}>
            <Clock className="size-3" /> Auto every {d.autoIntervalHours} h
          </Badge>
        )}
        {overdue && (
          <Badge variant="warn">
            <AlertTriangle className="size-3" /> overdue
          </Badge>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span title={transferTitle}>
            <Button
              size="sm"
              disabled={!canTransfer}
              onClick={() => setTransferOpen(true)}
            >
              <Send className="size-3.5" /> Transfer now
            </Button>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVerifyOpen(true)}
            title="Send a small test transfer to this address"
          >
            <FlaskConical className="size-3.5" /> Verify
          </Button>
          {!verified && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markVerified.mutate()}
              disabled={markVerified.isPending}
              title="After the test transfer confirmed on-chain and arrived at the exchange"
            >
              {markVerified.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <BadgeCheck className="size-3.5" />
              )}
              Mark verified
            </Button>
          )}
          <span title={toggleTitle}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggle.mutate()}
              disabled={(!verified && !d.enabled) || toggle.isPending}
            >
              {d.enabled ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              {d.enabled ? 'Disable' : 'Enable'}
            </Button>
          </span>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <DeleteDestinationButton
            d={d}
            hasTransfers={hasTransfers}
            onChanged={onChanged}
          />
        </div>
      </div>

      <CardContent className="grid grid-cols-1 gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-3">
          <KeyVal label="Address">
            <Addr value={d.address} truncated={false} />
          </KeyVal>
          {d.memo && (
            <KeyVal label="Memo">
              <span className="font-mono">{d.memo}</span>
            </KeyVal>
          )}
          <KeyVal label="Exchange minimum">
            <span className="font-mono">
              {fmtAmt(d.exchangeMinRaw, dec, d.token)}
            </span>
          </KeyVal>
          <KeyVal label="Float kept">
            <span className="font-mono">
              {fmtAmt(d.keepFloatRaw, dec, d.token)}
              <span className="ml-1.5 text-[10.5px] text-[var(--fg-3)]">
                always left for merchant payouts
              </span>
            </span>
          </KeyVal>
          <KeyVal label="Caps (USD)">
            <span className="font-mono">
              min {fmtUsd(d.minTransferUsd)} · per transfer{' '}
              {fmtUsd(d.maxPerTransferUsd)} · daily {fmtUsd(d.maxDailyUsd)}
            </span>
          </KeyVal>
        </div>
        <div className="space-y-3">
          <KeyVal label="Schedule">
            {auto ? (
              <span className="font-mono">every {d.autoIntervalHours}h</span>
            ) : (
              <span className="text-[var(--fg-3)]">manual only</span>
            )}
          </KeyVal>
          <KeyVal label="Next run">
            {auto && d.nextRunDue != null ? (
              <span
                className={cn(
                  'font-mono',
                  overdue ? 'text-warn' : 'text-foreground',
                )}
              >
                {fmtLocal(d.nextRunDue)}
                <span className="ml-1.5 text-[var(--fg-3)]">
                  ({fmtRelDelta(d.nextRunDue - now)})
                </span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </KeyVal>
          <KeyVal label="Last run">
            {d.lastRunAt != null ? (
              <span className="font-mono">
                {fmtLocal(d.lastRunAt)}
                <span className="ml-1.5 text-[var(--fg-3)]">
                  ({fmtRelDelta(d.lastRunAt - now)})
                </span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">never</span>
            )}
          </KeyVal>
          <KeyVal label="Last transfer">
            {d.lastTransferId ? (
              <Addr value={d.lastTransferId} />
            ) : (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </KeyVal>
          <KeyVal label="Verified at">
            {verified ? (
              <span className="font-mono">{fmtLocal(d.verifiedAt)}</span>
            ) : (
              <span className="text-[var(--fg-3)]">not yet</span>
            )}
          </KeyVal>
        </div>
      </CardContent>

      <div className="border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {expanded ? 'Hide' : 'Show'} eligibility
        </button>
        {expanded && (
          <div className="mt-3">
            <EligibilityPanel destinationId={d.id} token={d.token} />
          </div>
        )}
      </div>

      {verifyOpen && (
        <VerifyDialog
          d={d}
          dec={dec}
          onClose={() => setVerifyOpen(false)}
          onChanged={onChanged}
        />
      )}
      {transferOpen && (
        <TransferDialog
          d={d}
          dec={dec}
          onClose={() => setTransferOpen(false)}
          onChanged={onChanged}
        />
      )}
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

/* ── Eligibility ────────────────────────────────────────────── */

function EligibilityPanel({
  destinationId,
  token,
}: {
  destinationId: string
  token: string
}) {
  const q = useQuery({
    queryKey: [...TREASURY_KEY, 'destinations', destinationId] as const,
    queryFn: () =>
      api<{ destination: TreasuryDestination; eligibility: TreasuryEligibility }>(
        `${BASE}/destinations/${encodeURIComponent(destinationId)}`,
      ),
    refetchInterval: 30_000,
  })
  if (q.isLoading)
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--fg-2)]">
        <Loader2 className="size-3 animate-spin" /> Computing eligibility…
      </div>
    )
  if (q.isError)
    return (
      <div className="text-xs text-destructive">
        {errText(q.error, 'Could not load eligibility')}
      </div>
    )
  if (!q.data) return null
  return (
    <EligibilityView e={q.data.eligibility} token={token} sources="open" />
  )
}

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
    <div className="space-y-3">
      {e.blocked && (
        <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            Blocked — <span className="font-mono">{e.blocked}</span>:{' '}
            {BLOCKED_TEXT[e.blocked]}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Spendable" value={fmtAmt(e.spendableRaw, dec, token)} />
        <Stat
          label={`Held for refunds · ${e.holdHours} h hold`}
          value={fmtAmt(e.heldForRefundsRaw, dec, token)}
        />
        <Stat label="Float kept" value={fmtAmt(e.keepFloatRaw, dec, token)} />
        <Stat label="Per-transfer cap" value={fmtUsd(e.perTransferCapUsd)} />
        <Stat label="Daily remaining" value={fmtUsd(e.dailyRemainingUsd)} />
        <Stat
          label="Budget now"
          value={fmtAmt(e.budgetRaw, dec, token)}
          sub={fmtUsd(e.budgetUsd)}
          accent={e.blocked == null && e.budgetRaw !== '0'}
        />
        <Stat label="Rate" value={`1 ${token} = $${fmtNum(e.usdRate, 4)}`} />
        <Stat
          label="Sources"
          value={String(e.sources.length)}
          sub={`${e.sources.filter((s) => s.eligibleRaw !== '0').length} eligible`}
        />
      </div>
      {sources === 'open' ? (
        <SourcesTable e={e} token={token} />
      ) : (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-[11px] text-primary hover:underline">
            Show {e.sources.length} source{e.sources.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-1.5">
            <SourcesTable e={e} token={token} />
          </div>
        </details>
      )}
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

function SourcesTable({ e, token }: { e: TreasuryEligibility; token: string }) {
  const dec = e.decimals
  if (e.sources.length === 0)
    return (
      <div className="text-xs text-[var(--fg-3)]">
        No pool source holds this token.
      </div>
    )
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
          <tr>
            <th className="px-2 py-1.5 text-left">Source</th>
            <th className="px-2 py-1.5 text-right">Spendable</th>
            <th className="px-2 py-1.5 text-right">Held</th>
            <th className="px-2 py-1.5 text-right">Eligible</th>
          </tr>
        </thead>
        <tbody>
          {e.sources.map((s) => (
            <tr key={s.address} className="border-t border-border">
              <td className="px-2 py-1.5">
                <Addr value={s.address} />
              </td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatUnits(s.spendableRaw, dec)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-[var(--fg-2)]">
                {formatUnits(s.heldRaw, dec)}
              </td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right font-mono',
                  s.eligibleRaw !== '0' ? 'text-success' : 'text-[var(--fg-3)]',
                )}
              >
                {formatUnits(s.eligibleRaw, dec)} {token}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
            <FlaskConical className="size-4" /> Verify {d.label}
          </DialogTitle>
          <DialogDescription>
            Sends one small test payout from the pool to{' '}
            <span className="font-mono">{d.address}</span> on{' '}
            {chainInfo(d.chainId).name} ({d.token}). Once the leg is confirmed
            on-chain and you have seen it arrive at the exchange, come back and
            click <span className="font-medium">Mark verified</span>.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <TransferSummary t={result} dec={dec} token={d.token} />
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-3"
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
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono"
                placeholder={dec != null ? 'e.g. 10' : 'raw smallest unit'}
              />
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
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
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

/* ── Transfer-now dialog (dry run → confirm) ────────────────── */

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

  const applyMax = () => {
    const s = maxUsdInput.trim()
    if (s && !isUsd(s)) {
      toast.error('Max USD must be a decimal (e.g. 1500.00)')
      return
    }
    setMaxUsd(s)
  }

  const elig = preview.data?.eligibility
  const canSend =
    elig != null &&
    elig.blocked == null &&
    elig.budgetRaw !== '0' &&
    !preview.isFetching &&
    !send.isPending

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" /> Transfer to {d.label}
          </DialogTitle>
          <DialogDescription>
            The preview is a dry run against the live ledger — nothing moves
            until you confirm. Legs are planned as payouts from the pool
            sources below to <span className="font-mono">{d.address}</span>.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <TransferSummary t={result.transfer} dec={dec} token={d.token} />
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label="Max USD this run (optional)"
                  hint="Lower than the per-transfer cap only; empty = use the destination's cap."
                >
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-[var(--fg-3)]">
                      $
                    </span>
                    <Input
                      inputMode="decimal"
                      value={maxUsdInput}
                      onChange={(e) => setMaxUsdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          applyMax()
                        }
                      }}
                      className="pl-6 font-mono"
                      placeholder={`e.g. 1500 — cap ${fmtUsd(d.maxPerTransferUsd)}`}
                    />
                  </div>
                </Field>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-[22px]"
                onClick={applyMax}
                disabled={preview.isFetching || maxUsdInput.trim() === maxUsd}
              >
                <RefreshCw
                  className={
                    'size-3.5' + (preview.isFetching ? ' animate-spin' : '')
                  }
                />
                Update preview
              </Button>
            </div>

            {preview.isLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-6 text-xs text-[var(--fg-2)]">
                <Loader2 className="size-3.5 animate-spin" /> Running dry run…
              </div>
            ) : preview.isError ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>{errText(preview.error, 'Dry run failed')}</span>
              </div>
            ) : elig ? (
              <EligibilityView e={elig} token={d.token} sources="collapsed" />
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={send.isPending}
              >
                Cancel
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
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
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

/* ── Transfer rendering (shared) ───────────────────────────── */

function ModeBadge({ mode }: { mode: TreasuryTransfer['mode'] }) {
  if (mode === 'verification')
    return (
      <Badge variant="accent">
        <FlaskConical className="size-3" /> verification
      </Badge>
    )
  if (mode === 'scheduled')
    return (
      <Badge variant="default">
        <Clock className="size-3" /> scheduled
      </Badge>
    )
  return <Badge variant="outline">manual</Badge>
}

function TransferStatusBadges({ status }: { status: TreasuryTransfer['status'] }) {
  const pending = pendingLegs(status)
  const total = pending + status.confirmed + status.failed + status.canceled
  if (total === 0) return <Badge variant="default">no legs</Badge>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {pending > 0 && (
        <Badge variant="warn">
          <Loader2 className="size-3 animate-spin" /> {pending} pending
        </Badge>
      )}
      {status.confirmed > 0 && (
        <Badge variant="success">
          <BadgeCheck className="size-3" /> {status.confirmed} confirmed
        </Badge>
      )}
      {status.failed > 0 && (
        <Badge variant="danger">
          <AlertTriangle className="size-3" /> {status.failed} failed
        </Badge>
      )}
      {status.canceled > 0 && (
        <Badge variant="default">{status.canceled} canceled</Badge>
      )}
    </span>
  )
}

function TransferSummary({
  t,
  dec,
  token,
}: {
  t: TreasuryTransfer
  dec: number | null
  token: string
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge mode={t.mode} />
        <TransferStatusBadges status={t.status} />
      </div>
      <div className="font-mono text-xs">
        planned {fmtAmt(t.plannedAmountRaw, dec, token)} · {fmtUsd(t.plannedUsd)}{' '}
        · {t.legCount} leg{t.legCount === 1 ? '' : 's'}
        {t.skippedCount > 0 && ` · ${t.skippedCount} skipped`}
        {t.status.confirmedAmountRaw !== '0' &&
          ` · confirmed ${fmtAmt(t.status.confirmedAmountRaw, dec, token)}`}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg-2)]">
        <span>
          transfer <Addr value={t.id} />
        </span>
        <span>
          batch <Addr value={t.batchId} />
        </span>
        <span className="font-mono">{fmtLocal(t.createdAt)}</span>
      </div>
      {t.skippedReasons.length > 0 && (
        <SkippedReasonsList reasons={t.skippedReasons} dec={dec} token={token} />
      )}
    </div>
  )
}

function SkippedReasonsList({
  reasons,
  dec,
  token,
}: {
  reasons: TreasuryTransfer['skippedReasons']
  dec: number | null
  token: string
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
        {open ? 'Hide' : 'Show'} skipped sources · {reasons.length}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 rounded-md border border-warn/40 bg-warn/10 p-2">
          {reasons.slice(0, 50).map((r) => (
            <li
              key={r.sourceAddress + r.amountRaw + r.reason}
              className="flex flex-wrap items-center gap-2 rounded border border-warn/30 bg-card px-2 py-1 text-xs"
            >
              <Addr value={r.sourceAddress} />
              <span className="font-mono text-[10.5px] text-[var(--fg-2)]">
                {fmtAmt(r.amountRaw, dec, token)}
              </span>
              <span
                className="ml-auto max-w-[280px] truncate font-mono text-[10px] text-[var(--fg-3)]"
                title={r.reason}
              >
                {r.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
}) {
  const byId = React.useMemo(
    () => new Map(destinations.map((d) => [d.id, d])),
    [destinations],
  )
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="text-base font-semibold tracking-tight">
          Recent transfers
        </div>
        <span className="text-xs text-[var(--fg-2)]">newest first · last 50</span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={filter} onValueChange={onFilterChange}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="All destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All destinations</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="flex items-center gap-2">
                    <span>{d.label}</span>
                    <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
                      {chainName(chains, d.chainId)} · {d.token}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {errText(error, 'Could not load transfers')}
        </div>
      ) : transfers.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--fg-2)]">
          No transfers yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-left">Destination</th>
                <th className="px-3 py-2 text-right">Planned</th>
                <th className="px-3 py-2 text-right">Legs</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Ids</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
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
                    chains={chains}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function TransferRow({
  t,
  dest,
  dec,
  chains,
}: {
  t: TreasuryTransfer
  dest: TreasuryDestination | undefined
  dec: number | null
  chains: ChainInventoryEntry[] | undefined
}) {
  const [open, setOpen] = React.useState(false)
  const token = dest?.token ?? ''
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-2 font-mono whitespace-nowrap">
          {fmtLocal(t.createdAt)}
        </td>
        <td className="px-3 py-2">
          <ModeBadge mode={t.mode} />
        </td>
        <td className="px-3 py-2">
          {dest ? (
            <div>
              <div className="font-medium">{dest.label}</div>
              <div className="font-mono text-[10.5px] text-[var(--fg-3)]">
                {chainName(chains, dest.chainId)} · {dest.token}
              </div>
            </div>
          ) : (
            <span className="font-mono text-[var(--fg-3)]" title={t.destinationId}>
              {t.destinationId.slice(0, 8)}… (unknown destination)
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          <div>{fmtAmt(t.plannedAmountRaw, dec, token)}</div>
          <div className="text-[10.5px] text-[var(--fg-3)]">
            {fmtUsd(t.plannedUsd)}
          </div>
          {t.status.confirmedAmountRaw !== '0' &&
            t.status.confirmedAmountRaw !== t.plannedAmountRaw && (
              <div className="text-[10.5px] text-success">
                confirmed {fmtAmt(t.status.confirmedAmountRaw, dec, token)}
              </div>
            )}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          <div>{t.legCount}</div>
          {t.skippedCount > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-0.5 text-[10.5px] text-warn hover:underline"
            >
              {open ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {t.skippedCount} skipped
            </button>
          )}
        </td>
        <td className="px-3 py-2">
          <TransferStatusBadges status={t.status} />
        </td>
        <td className="px-4 py-2 text-[var(--fg-2)]">
          <div className="flex flex-col gap-0.5">
            <span>
              <span className="text-[10px] uppercase text-[var(--fg-3)]">tx </span>
              <Addr value={t.id} />
            </span>
            <span>
              <span className="text-[10px] uppercase text-[var(--fg-3)]">batch </span>
              <Addr value={t.batchId} />
            </span>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-[var(--bg-2)]">
          <td colSpan={7} className="px-4 py-2.5">
            {t.skippedReasons.length === 0 ? (
              <span className="text-[var(--fg-3)]">
                {t.skippedCount} skipped — reasons not recorded.
              </span>
            ) : (
              <ul className="space-y-1">
                {t.skippedReasons.slice(0, 50).map((r) => (
                  <li
                    key={r.sourceAddress + r.amountRaw + r.reason}
                    className="flex flex-wrap items-center gap-2 rounded border border-warn/30 bg-card px-2 py-1"
                  >
                    <Addr value={r.sourceAddress} />
                    <span className="font-mono text-[10.5px] text-[var(--fg-2)]">
                      {fmtAmt(r.amountRaw, dec, token)}
                    </span>
                    <span
                      className="ml-auto max-w-[360px] truncate font-mono text-[10px] text-[var(--fg-3)]"
                      title={r.reason}
                    >
                      {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Delete ─────────────────────────────────────────────────── */

function DeleteDestinationButton({
  d,
  hasTransfers,
  onChanged,
}: {
  d: TreasuryDestination
  hasTransfers: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const del = useMutation({
    mutationFn: () =>
      api<unknown>(`${BASE}/destinations/${encodeURIComponent(d.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Destination deleted')
      setOpen(false)
      onChanged()
    },
    onError: (e) => toast.error(errText(e, 'Delete failed')),
  })
  if (hasTransfers) {
    return (
      <span title="This destination has transfers and cannot be deleted — disable it instead">
        <Button size="sm" variant="outline" className="text-destructive" disabled>
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </span>
    )
  }
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
            <Trash2 className="size-4" /> Delete destination
          </DialogTitle>
          <DialogDescription>
            Removes the allow-list entry. Only possible while the destination
            has no transfers; once it has any, prefer{' '}
            <span className="font-medium">Disable</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-secondary px-3 py-2 text-sm">
          <div className="font-medium">{d.label}</div>
          <div className="font-mono text-xs">
            chain {d.chainId} · {d.token} · {d.exchange}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-2)]">
            address: <Addr value={d.address} />
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
            <Landmark className="size-4" />
            {isEdit ? 'Edit destination' : 'New treasury destination'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Chain, token, address and exchange are fixed — add a new destination to change the route. Changing the auto interval reschedules the next run.'
              : 'One allow-listed external address per (chain, token). The address must not be gateway-controlled and must not be a token contract. The destination starts disabled and unverified.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid grid-cols-[1fr_150px] gap-2">
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
            <div className="rounded-md border border-border bg-secondary px-3 py-2 text-sm">
              <div className="font-mono text-xs">
                {chainName(chains, initial!.chainId)} ({initial!.chainId}) ·{' '}
                {initial!.token}
              </div>
              <div className="mt-1 text-xs text-[var(--fg-2)]">
                address: <Addr value={initial!.address} truncated={false} />
              </div>
              {initial!.memo && (
                <div className="mt-1 font-mono text-xs text-[var(--fg-2)]">
                  memo: {initial!.memo}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_140px] gap-2">
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

          <div className="grid grid-cols-2 gap-2">
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
                  Always left in the gateway for merchant payouts.{' '}
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

          <div className="grid grid-cols-3 gap-2">
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
                  className="cursor-pointer text-[11px] text-[var(--fg-3)] hover:text-foreground"
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
                <Loader2 className="size-3.5 animate-spin" />
              ) : isEdit ? (
                <Pencil className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
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
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-[var(--fg-3)]">
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

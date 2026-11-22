import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  CalendarClock,
  ExternalLink,
  Fuel,
  Layers,
  LifeBuoy,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { explorerAddressUrl } from '@/lib/chains'
import { fmtRel, formatUnits, truncateAddr } from '@/lib/format'
import { useHeldQueue } from '@/lib/held'
import type {
  ChainInventoryEntry,
  HeldLeg,
  RecoverPayoutResponse,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import {
  Callout,
  EmptyState,
  ErrorState,
} from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

function useChains() {
  return useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    staleTime: 120_000,
  })
}

/** Compact "stuck for" label from a positive ms diff. */
function fmtAge(ms: number | null): string {
  if (ms == null || ms <= 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h`
}

/** Held legs are bad regardless; escalate the colour the longer they're stuck. */
function ageTone(ms: number | null): 'warn' | 'danger' {
  return ms != null && ms >= 24 * 3_600_000 ? 'danger' : 'warn'
}

function unixOf(iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return isFinite(t) ? Math.floor(t / 1000) : 0
}

export function HeldPayoutsPage() {
  const [chainId, setChainId] = React.useState('')
  const [token, setToken] = React.useState('')
  const [recoverId, setRecoverId] = React.useState<string | null>(null)

  const chainsQ = useChains()

  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )

  // Token options: narrow to the selected chain when one is picked, otherwise
  // the distinct union across all wired chains (the API filters token
  // independently of chain).
  const tokenOptions = React.useMemo(() => {
    const id = parseInt(chainId, 10)
    const src = Number.isFinite(id)
      ? chainOptions.filter((c) => c.chainId === id)
      : chainOptions
    const seen = new Map<string, string>()
    for (const c of src) {
      for (const t of c.tokens) {
        const sym = t.symbol.toUpperCase()
        if (!seen.has(sym)) seen.set(sym, t.symbol)
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [chainOptions, chainId])

  const decimalsOf = React.useCallback(
    (cid: number, sym: string): number | null => {
      const chain = chainsQ.data?.chains.find((c) => c.chainId === cid)
      const tok = chain?.tokens.find(
        (t) => t.symbol.toUpperCase() === sym.toUpperCase(),
      )
      return tok?.decimals ?? null
    },
    [chainsQ.data],
  )

  const held = useHeldQueue({
    chainId: chainId ? parseInt(chainId, 10) : null,
    token: token || null,
  })

  const legs = held.data?.held ?? []
  const target = legs.find((l) => l.id === recoverId) ?? null
  const filtered = chainId !== '' || token !== ''
  const oldest = legs.reduce(
    (m, l) => (l.heldForMs != null && l.heldForMs > m ? l.heldForMs : m),
    0,
  )

  const qc = useQueryClient()
  const onRecovered = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['gw', 'payouts', 'held'] })
  }, [qc])

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        eyebrow="Payments"
        title={
          <>
            <LifeBuoy className="size-5 text-[var(--fg-2)]" />
            Held payouts
          </>
        }
        description={
          <>
            Legs whose broadcast errored ambiguously (a transport hiccup) and
            are stuck mid-flight — most often an auto-consolidation sweep that
            actually landed on-chain but couldn&rsquo;t be confirmed. Paste the
            successful OUT hash from the explorer to drive the leg back to{' '}
            <span className="font-mono">submitted</span>; the confirm cron takes
            it from there.
          </>
        }
        actions={
          <>
            <Select
              value={chainId || 'all'}
              onValueChange={(v) => {
                setChainId(v === 'all' ? '' : v)
                setToken('')
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-sm">
                <SelectValue placeholder="All chains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All chains</SelectItem>
                {chainOptions.map((c) => (
                  <SelectItem key={c.chainId} value={String(c.chainId)}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={token || 'all'}
              onValueChange={(v) => setToken(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-8 w-[130px] text-sm">
                <SelectValue placeholder="All tokens" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tokens</SelectItem>
                {tokenOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => held.refetch()}
              disabled={held.isFetching}
            >
              <RefreshCw
                className={'size-3.5' + (held.isFetching ? ' animate-spin' : '')}
              />
              Refresh
            </Button>
          </>
        }
      />

      {held.isLoading ? (
        <ListSkeleton />
      ) : held.isError ? (
        <ErrorCard
          message={
            held.error instanceof ApiError && held.error.code === 'NOT_CONFIGURED'
              ? 'Admin surface is disabled (no ADMIN_KEY). Contact ops.'
              : held.error instanceof Error
                ? held.error.message
                : 'Could not load the recovery queue.'
          }
        />
      ) : legs.length === 0 ? (
        filtered ? (
          <NoMatch
            onClear={() => {
              setChainId('')
              setToken('')
            }}
          />
        ) : (
          <ClearState />
        )
      ) : (
        <>
          <SummaryStrip count={legs.length} oldestMs={oldest} />
          <HeldList
            rows={legs}
            decimalsOf={decimalsOf}
            onRecover={setRecoverId}
          />
        </>
      )}

      <RecoverDialog
        leg={target}
        open={recoverId !== null}
        onOpenChange={(v) => !v && setRecoverId(null)}
        decimals={target ? decimalsOf(target.chainId, target.token) : null}
        onRecovered={onRecovered}
      />
    </div>
  )
}

/* ── summary ───────────────────────────────────────────────── */

function SummaryStrip({ count, oldestMs }: { count: number; oldestMs: number }) {
  return (
    <Callout tone="warn">
      <span className="text-foreground">
        <span className="font-mono font-semibold tabular-nums">{count}</span> leg
        {count === 1 ? '' : 's'} awaiting operator recovery
      </span>
      {oldestMs > 0 && (
        <span className="text-[var(--fg-2)]">
          {' '}
          · oldest stuck for{' '}
          <span className="font-mono tabular-nums text-warn">{fmtAge(oldestMs)}</span>
        </span>
      )}
    </Callout>
  )
}

/* ── list / row ────────────────────────────────────────────── */

function HeldList({
  rows,
  decimalsOf,
  onRecover,
}: {
  rows: HeldLeg[]
  decimalsOf: (chainId: number, sym: string) => number | null
  onRecover: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden h-9 grid-cols-[minmax(0,1.6fr)_160px_150px_120px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-4 text-2xs font-medium uppercase tracking-[0.06em] text-[var(--fg-2)] sm:grid">
        <div>Leg / route</div>
        <div className="text-right">Amount</div>
        <div>Held for</div>
        <div className="text-right">Action</div>
      </div>
      <ul>
        {rows.map((leg) => (
          <HeldRow
            key={leg.id}
            leg={leg}
            decimals={decimalsOf(leg.chainId, leg.token)}
            onRecover={() => onRecover(leg.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function HeldRow({
  leg,
  decimals,
  onRecover,
}: {
  leg: HeldLeg
  decimals: number | null
  onRecover: () => void
}) {
  const amount =
    decimals != null ? formatUnits(leg.amountRaw, decimals) : leg.amountRaw
  const tone = ageTone(leg.heldForMs)

  return (
    <li className="border-b border-border last:border-0">
      <div className="grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.6fr)_160px_150px_120px] sm:gap-4">
        {/* Leg + route */}
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {leg.kind === 'consolidation_sweep' ? (
              <Badge variant="accent" className="uppercase tracking-[0.06em]">
                <Layers className="size-3" /> consolidation
              </Badge>
            ) : (
              <Badge variant="outline" className="uppercase tracking-[0.06em]">
                standard
              </Badge>
            )}
            <Badge variant="warn" className="lowercase">
              {leg.status}
            </Badge>
            {leg.topUpTxHash && (
              <span
                className="inline-flex items-center text-[var(--fg-3)]"
                title="Gas was auto-sponsored before the broadcast"
              >
                <Fuel className="size-3" />
              </span>
            )}
            <span className="font-mono text-xs text-[var(--fg-2)]">
              {truncateAddr(leg.id, 8, 6)}
            </span>
            <CopyButton value={leg.id} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--fg-2)]">
            <ExplorerAddr chainId={leg.chainId} value={leg.sourceAddress} />
            <ArrowRight className="size-3 shrink-0 text-[var(--fg-3)]" />
            <ExplorerAddr chainId={leg.chainId} value={leg.destinationAddress} />
          </div>
          {leg.lastError && (
            <div
              className="truncate font-mono text-2xs text-[var(--fg-2)]"
              title={leg.lastError}
            >
              {leg.lastError}
            </div>
          )}
        </div>

        {/* Amount + chain */}
        <div className="min-w-0 sm:text-right">
          <div className="truncate font-mono text-sm tabular-nums">
            {amount} <span className="text-[var(--fg-3)]">{leg.token}</span>
          </div>
          <div className="mt-0.5 flex sm:justify-end">
            <ChainPill chainId={leg.chainId} />
          </div>
        </div>

        {/* Held for */}
        <div className="min-w-0">
          <Badge variant={tone}>{fmtAge(leg.heldForMs)}</Badge>
          {leg.broadcastAttemptedAt && (
            <div className="mt-1 text-xs text-[var(--fg-2)]">
              tried {fmtRel(unixOf(leg.broadcastAttemptedAt))}
            </div>
          )}
        </div>

        {/* Action */}
        <div className="sm:text-right">
          <Button size="sm" onClick={onRecover}>
            <RotateCcw className="size-3.5" /> Recover
          </Button>
        </div>
      </div>
    </li>
  )
}

function ExplorerAddr({
  chainId,
  value,
}: {
  chainId: number
  value: string
}) {
  const url = explorerAddressUrl(chainId, value)
  if (!url) return <Addr value={value} />
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
        title="Open in block explorer"
      >
        {truncateAddr(value)}
        <ExternalLink className="size-3 shrink-0" />
      </a>
      <CopyButton value={value} />
    </span>
  )
}

/* ── recover dialog ────────────────────────────────────────── */

function recoverErrorMessage(e: ApiError): string {
  // Every 4xx carries a specific, operator-safe `message`; prefer it for the
  // codes where the server spells out the expected transfer or the exact zod
  // issue. Fall back to a friendly default for the rest.
  switch (e.code) {
    case 'RECOVERY_TX_MISMATCH':
    case 'VALIDATION':
      return e.message || 'Tx doesn’t match this leg’s transfer — re-check the hash.'
    case 'BAD_JSON':
      return 'Invalid request body.'
    case 'PAYOUT_NOT_FOUND':
      return 'Payout not found — it may have been recovered already.'
    case 'PAYOUT_NOT_RECOVERABLE':
      return 'This leg can’t be recovered in its current state (already confirmed/failed, or raced).'
    case 'RECOVERY_TX_ALREADY_USED':
      return 'This tx is already recorded on another payout.'
    case 'RECOVERY_TX_NOT_MINED':
      return 'Tx not mined yet — retry once it confirms.'
    case 'RECOVERY_TX_REVERTED':
      return 'That tx reverted (moved no funds) — pick the successful transfer.'
    case 'UNAUTHORIZED':
      return 'Unauthorized — re-authenticate and try again.'
    case 'NOT_CONFIGURED':
      return 'Admin surface is disabled (no ADMIN_KEY). Contact ops.'
    default:
      return e.message || 'Recovery failed.'
  }
}

function RecoverDialog({
  leg,
  open,
  onOpenChange,
  decimals,
  onRecovered,
}: {
  leg: HeldLeg | null
  open: boolean
  onOpenChange: (v: boolean) => void
  decimals: number | null
  onRecovered: () => void
}) {
  const [txHash, setTxHash] = React.useState('')
  // Hold the failure text in local state (not the mutation's) so it clears on
  // reopen without a render-phase mutation.reset().
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)

  const recover = useMutation({
    mutationFn: () => {
      if (!leg) throw new ApiError('No leg selected', 400)
      const h = txHash.trim()
      if (!TX_HASH_RE.test(h)) {
        throw new ApiError(
          'txHash must be 0x + 64 hex chars.',
          400,
          'VALIDATION',
        )
      }
      return api<RecoverPayoutResponse>(
        `/api/gw/admin/payouts/${encodeURIComponent(leg.id)}/recover`,
        { method: 'POST', body: JSON.stringify({ txHash: h }) },
      )
    },
    onSuccess: () => {
      toast.success('Leg recovered — now submitted', {
        description: 'The confirm cron will flip it to confirmed shortly.',
      })
      onRecovered()
      onOpenChange(false)
    },
    onError: (e: ApiError) => {
      const msg = recoverErrorMessage(e)
      setErrorMsg(msg)
      toast.error(msg)
    },
  })

  // Clear the input + any prior error on each closed → open transition — the
  // render-phase reset idiom (own state only), as used by BumpFeeDialog.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setTxHash('')
      setErrorMsg(null)
    }
  }

  const srcUrl = leg ? explorerAddressUrl(leg.chainId, leg.sourceAddress) : null
  const amount =
    leg && decimals != null
      ? formatUnits(leg.amountRaw, decimals)
      : leg?.amountRaw ?? ''
  const trimmed = txHash.trim()
  const malformed = trimmed.length > 0 && !TX_HASH_RE.test(trimmed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {leg && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <LifeBuoy className="size-4" /> Recover held leg
              </DialogTitle>
              <DialogDescription>
                Verifies the on-chain transfer matches this leg
                (source&nbsp;→&nbsp;destination, token, amount), then drives it
                to <span className="font-mono">submitted</span>. Paste the
                real, successful OUT hash from the explorer — not a reverted
                retry.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                recover.mutate()
              }}
            >
              <div className="space-y-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">amount</span>
                  <span className="font-mono tabular-nums">
                    {amount} {leg.token}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">from</span>
                  {srcUrl ? (
                    <a
                      href={srcUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    >
                      {truncateAddr(leg.sourceAddress, 8, 6)}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <Addr value={leg.sourceAddress} />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">to</span>
                  <Addr value={leg.destinationAddress} />
                </div>
                {srcUrl && (
                  <p className="border-t border-border pt-2 text-xs text-[var(--fg-2)]">
                    Open the source address, find the successful{' '}
                    <span className="font-medium text-foreground">OUT</span>{' '}
                    transfer of {amount} {leg.token}, and copy its tx hash.
                  </p>
                )}
              </div>

              <Field
                label="Successful tx hash"
                hint="0x + 64 hex chars. The OUT transfer — not the reverted retry."
                error={malformed ? 'Must be 0x + 64 hex chars.' : undefined}
              >
                <Input
                  value={txHash}
                  onChange={(e) => {
                    setTxHash(e.target.value)
                    if (errorMsg) setErrorMsg(null)
                  }}
                  className="font-mono text-xs"
                  placeholder="0x51c2d6933af52e8d0de441cfb3d0f9024ddae061f79bd82633f45dd86420ee00"
                  autoFocus
                  spellCheck={false}
                />
              </Field>

              {errorMsg && (
                <Callout tone="danger" className="rounded-md px-3 py-2.5 text-xs">
                  <span className="whitespace-pre-wrap break-words">
                    {errorMsg}
                  </span>
                </Callout>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={recover.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={recover.isPending || !TX_HASH_RE.test(trimmed)}
                >
                  {recover.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  {recover.isPending ? 'Verifying…' : 'Verify & recover'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── skeleton / empty / error ──────────────────────────────── */

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden h-9 border-b border-border bg-[var(--bg-2)] sm:block" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-1 items-center gap-3 border-b border-border px-4 py-3.5 last:border-0 sm:grid-cols-[minmax(0,1.6fr)_160px_150px_120px] sm:gap-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-4 w-24 sm:ml-auto" />
          <Skeleton className="h-5 w-16" />
          <div className="flex sm:justify-end">
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ClearState() {
  return (
    <EmptyState
      framed
      icon={ShieldCheck}
      title="Recovery queue is clear"
      description={
        <>
          No legs are stuck. Ambiguous broadcasts the auto-reconciler can
          re-drive on its own never land here — only ones that need an
          operator&rsquo;s eyes do.
        </>
      }
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/consolidation-schedules">
            <CalendarClock className="size-3.5" /> Auto-consolidation
          </Link>
        </Button>
      }
    />
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      framed
      compact
      title="No held legs match these filters"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-3.5" /> Clear filters
        </Button>
      }
    />
  )
}

function ErrorCard({ message }: { message: string }) {
  return <ErrorState title="Could not load held payouts" message={message} />
}

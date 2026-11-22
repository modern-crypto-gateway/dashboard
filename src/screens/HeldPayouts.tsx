import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Clock,
  Fuel,
  Layers,
  LifeBuoy,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { explorerAddressUrl } from '@/lib/chains'
import { fmtLocal, fmtRel, formatUnits, truncateAddr } from '@/lib/format'
import { useHeldQueue } from '@/lib/held'
import type {
  ChainInventoryEntry,
  HeldLeg,
  RecoverPayoutResponse,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { SegmentedBar } from '@/components/charts'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, TableCard, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import {
  Callout,
  EmptyState,
  ErrorState,
} from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
const PAGE_SIZE = 25

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
function ageTone(ms: number | null): 'warn' | 'bad' {
  return ms != null && ms >= 24 * 3_600_000 ? 'bad' : 'warn'
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

  const legs = React.useMemo(() => held.data?.held ?? [], [held.data])
  const paged = usePaged(legs, PAGE_SIZE)
  const target = legs.find((l) => l.id === recoverId) ?? null
  const filtered = chainId !== '' || token !== ''

  const summary = React.useMemo(() => {
    let oldest = 0
    let sweeps = 0
    const chains = new Map<number, number>()
    for (const l of legs) {
      if (l.heldForMs != null && l.heldForMs > oldest) oldest = l.heldForMs
      if (l.kind === 'consolidation_sweep') sweeps++
      chains.set(l.chainId, (chains.get(l.chainId) ?? 0) + 1)
    }
    return {
      oldest,
      sweeps,
      standard: legs.length - sweeps,
      chains: [...chains.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [legs])

  const qc = useQueryClient()
  const onRecovered = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['gw', 'payouts', 'held'] })
  }, [qc])

  const clearFilters = () => {
    setChainId('')
    setToken('')
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Held payouts"
        description="Stuck legs awaiting recovery"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => held.refetch()}
            disabled={held.isFetching}
          >
            <RefreshCw className={cn('size-4', held.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {held.isError ? (
        <ErrorCard
          message={
            held.error instanceof ApiError && held.error.code === 'NOT_CONFIGURED'
              ? 'Admin surface is disabled (no ADMIN_KEY). Contact ops.'
              : held.error instanceof Error
                ? held.error.message
                : 'Could not load the recovery queue.'
          }
        />
      ) : !held.isLoading && legs.length === 0 && !filtered ? (
        <ClearState />
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-5 xl:grid-cols-4">
            <Tile
              label="Held legs"
              loading={held.isLoading}
              value={legs.length}
              icon={LifeBuoy}
              tint="bg-[var(--st-warn-bg)] text-[var(--st-warn)]"
            />
            <Tile
              label="Oldest stuck"
              loading={held.isLoading}
              value={
                <span className={summary.oldest >= 24 * 3_600_000 ? 'text-[var(--st-bad)]' : undefined}>
                  {fmtAge(summary.oldest || null)}
                </span>
              }
              icon={Clock}
              tint={
                summary.oldest >= 24 * 3_600_000
                  ? 'bg-[var(--st-bad-bg)] text-[var(--st-bad)]'
                  : 'bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border'
              }
            />
            <Tile
              label="Kind"
              loading={held.isLoading}
              value={
                <span className="flex items-baseline gap-3">
                  <span title="Consolidation sweeps">
                    {summary.sweeps}
                    <Layers className="ml-1 inline size-4 align-[-2px] text-[var(--fg-2)]" />
                  </span>
                  <span title="Standard payouts">
                    {summary.standard}
                    <Send className="ml-1 inline size-4 align-[-2px] text-[var(--fg-2)]" />
                  </span>
                </span>
              }
              footer={
                <SegmentedBar
                  parts={[
                    { key: 'sweep', name: 'Consolidation', value: summary.sweeps, color: 'var(--chart-2)' },
                    { key: 'std', name: 'Standard', value: summary.standard, color: 'var(--chart-1-fill)' },
                  ]}
                />
              }
            />
            <Tile
              label="Networks"
              loading={held.isLoading}
              value={summary.chains.length}
              footer={
                summary.chains.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.chains.slice(0, 8).map(([id, n]) => (
                      <span key={id} title={`${n} held`} className="inline-flex">
                        <ChainIcon chainId={id} size={20} />
                      </span>
                    ))}
                  </div>
                ) : undefined
              }
            />
          </div>

          <TableCard
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">Recovery queue</h2>
                <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                  <Select
                    value={chainId || 'all'}
                    onValueChange={(v) => {
                      setChainId(v === 'all' ? '' : v)
                      setToken('')
                      paged.setPage(0)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[160px] text-sm" aria-label="Chain">
                      <SelectValue placeholder="All chains" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All chains</SelectItem>
                      {chainOptions.map((c) => (
                        <SelectItem key={c.chainId} value={String(c.chainId)}>
                          <span className="inline-flex items-center gap-2">
                            <ChainIcon chainId={c.chainId} size={16} />
                            {c.displayName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={token || 'all'}
                    onValueChange={(v) => {
                      setToken(v === 'all' ? '' : v)
                      paged.setPage(0)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-sm" aria-label="Token">
                      <SelectValue placeholder="All tokens" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tokens</SelectItem>
                      {tokenOptions.map((t) => (
                        <SelectItem key={t} value={t}>
                          <span className="inline-flex items-center gap-2">
                            <TokenIcon symbol={t} size={16} />
                            {t}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filtered && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Clear filters"
                      title="Clear filters"
                      onClick={clearFilters}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            }
            footer={
              paged.total > 0 ? (
                <Pager
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hasNext={paged.page < paged.pageCount - 1}
                  onPage={paged.setPage}
                  noun="legs"
                />
              ) : undefined
            }
          >
            {held.isLoading ? (
              <ListSkeleton />
            ) : legs.length === 0 ? (
              <NoMatch onClear={clearFilters} />
            ) : (
              <HeldTable
                rows={paged.rows}
                decimalsOf={decimalsOf}
                onRecover={setRecoverId}
              />
            )}
          </TableCard>
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

/* ── table ─────────────────────────────────────────────────── */

function HeldTable({
  rows,
  decimalsOf,
  onRecover,
}: {
  rows: HeldLeg[]
  decimalsOf: (chainId: number, sym: string) => number | null
  onRecover: (id: string) => void
}) {
  return (
    <TableWrap>
      <Table className="min-w-[960px]">
        <THead>
          <tr>
            <Th>Leg</Th>
            <Th>Route</Th>
            <Th>Status</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Held for</Th>
            <Th className="w-28">
              <span className="sr-only">Action</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((leg) => {
            const decimals = decimalsOf(leg.chainId, leg.token)
            const amount =
              decimals != null ? formatUnits(leg.amountRaw, decimals) : leg.amountRaw
            const sweep = leg.kind === 'consolidation_sweep'
            return (
              <Tr key={leg.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <TokenOnChain symbol={leg.token} chainId={leg.chainId} size={32} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        {sweep ? (
                          <>
                            <Layers className="size-4 text-[var(--fg-2)]" />
                            Consolidation
                          </>
                        ) : (
                          <>
                            <Send className="size-4 text-[var(--fg-2)]" />
                            Payout
                          </>
                        )}
                        {leg.topUpTxHash && (
                          <span
                            className="text-[var(--fg-3)]"
                            title="Gas was auto-sponsored before the broadcast"
                          >
                            <Fuel className="size-3.5" />
                          </span>
                        )}
                        {leg.lastError && (
                          <span className="text-[var(--st-warn)]" title={leg.lastError}>
                            <AlertTriangle className="size-3.5" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 font-mono text-xs text-[var(--fg-3)]">
                        {truncateAddr(leg.id, 8, 6)}
                        <CopyButton value={leg.id} />
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <div className="flex items-center gap-1 text-[var(--fg-2)]">
                    <Addr value={leg.sourceAddress} chainId={leg.chainId} />
                    <ArrowRight className="size-3.5 shrink-0 text-[var(--fg-3)]" />
                    <Addr value={leg.destinationAddress} chainId={leg.chainId} />
                  </div>
                </Td>
                <Td>
                  <StatusPill tone="warn">{leg.status.replace(/-/g, ' ')}</StatusPill>
                </Td>
                <Td align="right">
                  <span className="inline-flex items-center justify-end gap-1.5 font-medium">
                    <TokenIcon symbol={leg.token} size={14} />
                    {amount}
                    <span className="font-normal text-[var(--fg-2)]">{leg.token}</span>
                  </span>
                </Td>
                <Td align="right">
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill tone={ageTone(leg.heldForMs)} icon={Clock}>
                      {fmtAge(leg.heldForMs)}
                    </StatusPill>
                    {leg.broadcastAttemptedAt && (
                      <span
                        className="text-xs text-[var(--fg-3)]"
                        title={fmtLocal(leg.broadcastAttemptedAt, { seconds: true })}
                      >
                        tried {fmtRel(unixOf(leg.broadcastAttemptedAt))}
                      </span>
                    )}
                  </div>
                </Td>
                <Td align="right" className="w-28">
                  <Button size="sm" onClick={() => onRecover(leg.id)}>
                    <RotateCcw className="size-4" /> Recover
                  </Button>
                </Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </TableWrap>
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
                <LifeBuoy className="size-5" /> Recover held leg
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
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault()
                recover.mutate()
              }}
            >
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="flex items-center gap-3 bg-[var(--bg-2)] px-4 py-3">
                  <TokenOnChain symbol={leg.token} chainId={leg.chainId} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--fg-2)]">Amount</div>
                    <div className="figure truncate font-semibold">
                      {amount} {leg.token}
                    </div>
                  </div>
                  <StatusPill tone="warn" size="sm">
                    {leg.status.replace(/-/g, ' ')}
                  </StatusPill>
                </div>
                <dl className="divide-y divide-border text-sm">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-[var(--fg-2)]">From</dt>
                    <dd className="min-w-0">
                      <Addr value={leg.sourceAddress} chainId={leg.chainId} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-[var(--fg-2)]">To</dt>
                    <dd className="min-w-0">
                      <Addr value={leg.destinationAddress} chainId={leg.chainId} />
                    </dd>
                  </div>
                </dl>
                {srcUrl && (
                  <p className="border-t border-border px-4 py-2.5 text-xs text-[var(--fg-2)]">
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
                <Callout tone="danger">
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
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
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

/* ── tiles / skeleton / empty / error ──────────────────────── */

function Tile({
  label,
  value,
  footer,
  loading,
  icon: Icon,
  tint,
}: {
  label: string
  value: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
  icon?: React.ComponentType<{ className?: string }>
  tint?: string
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--fg-2)]">{label}</span>
        {Icon && (
          <span className={cn('grid size-7 place-items-center rounded-full', tint)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {footer && !loading && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

function ListSkeleton() {
  return (
    <div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-border px-6 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-40" />
          </div>
          <Skeleton className="hidden h-3.5 w-48 md:block" />
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-8 w-24" />
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
      description="Only ambiguous broadcasts that need an operator land here."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/consolidation-schedules">
            <CalendarClock className="size-4" /> Auto-consolidation
          </Link>
        </Button>
      }
    />
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      compact
      title="No held legs match these filters"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" /> Clear filters
        </Button>
      }
    />
  )
}

function ErrorCard({ message }: { message: string }) {
  return <ErrorState title="Could not load held payouts" message={message} />
}

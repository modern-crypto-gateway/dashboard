import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Target,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { formatUnits } from '@/lib/format'
import type {
  BalancesSnapshot,
  ChainInventoryEntry,
  ConsolidationPlanResponse,
  ConsolidationStatusResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { Callout } from '@/components/States'
import { Status, StatusPill } from '@/components/StatusPill'
import { SegmentedBar } from '@/components/charts'
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
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from '@/components/ui/table'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Optional pre-fills — used when the dialog is opened from a payout
   * estimate that already knows which (chain, token) is fragmented. */
  prefillChainId?: number
  prefillToken?: string
  /** Called once when a plan is successfully posted, in case the parent
   * wants to refresh balances etc. */
  onPlanned?: (consolidationId: string) => void
}

type Step = 'plan' | 'review'

export function ConsolidateDialog({
  open,
  onOpenChange,
  prefillChainId,
  prefillToken,
  onPlanned,
}: Props) {
  const [chainId, setChainId] = React.useState<string>(
    prefillChainId != null ? String(prefillChainId) : '',
  )
  const [token, setToken] = React.useState<string>(prefillToken ?? '')
  const [target, setTarget] = React.useState<string>('')
  // Optional per-call overrides. Empty = let the server use its dynamic
  // dust floor / default cap.
  const [minRaw, setMinRaw] = React.useState<string>('')
  const [maxSources, setMaxSources] = React.useState<string>('')
  const [plan, setPlan] = React.useState<ConsolidationPlanResponse | null>(null)
  // Client-side review step between filling the form and posting the plan.
  const [step, setStep] = React.useState<Step>('plan')
  const [advanced, setAdvanced] = React.useState(false)

  // Reset form on every closed → open transition (pulling fresh prefills).
  const syncKey = `${open ? '1' : '0'}|${prefillChainId ?? ''}|${prefillToken ?? ''}`
  const [prevSyncKey, setPrevSyncKey] = React.useState(syncKey)
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey)
    if (open) {
      setChainId(prefillChainId != null ? String(prefillChainId) : '')
      setToken(prefillToken ?? '')
      setTarget('')
      setMinRaw('')
      setMaxSources('')
      setPlan(null)
      setStep('plan')
      setAdvanced(false)
    }
  }

  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    enabled: open,
    refetchInterval: 120_000,
    staleTime: 30_000,
  })

  // Pull pool addresses from the DB balances snapshot — fast (no RPC) and
  // gives us per-address token balances we can rank to help the operator
  // pick a target that already holds the most of `token`.
  const balancesQ = useQuery({
    queryKey: ['gw', 'balances', 'db'] as const,
    queryFn: () =>
      api<{ snapshot: BalancesSnapshot; cached: boolean }>(
        '/api/gw/admin/balances',
      ),
    enabled: open,
    staleTime: 30_000,
  })

  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )
  const tokenOptions = React.useMemo(() => {
    const id = parseInt(chainId, 10)
    return chainOptions.find((c) => c.chainId === id)?.tokens ?? []
  }, [chainOptions, chainId])

  const selectedToken = tokenOptions.find(
    (t) => t.symbol.toUpperCase() === token.toUpperCase(),
  )

  // Pool address candidates for the chosen chain, with their current balance
  // of the selected token (smallest units). Sorted: holders of `token` first
  // (descending balance), then any remaining pool addresses on the chain.
  const targetCandidates = React.useMemo(() => {
    const id = parseInt(chainId, 10)
    if (!Number.isFinite(id)) return []
    const tokSym = token.trim().toUpperCase()
    const families = balancesQ.data?.snapshot.families ?? []
    type Row = { address: string; tokenAmountRaw: string; allTokens: string }
    const rows: Row[] = []
    for (const fam of families) {
      for (const ch of fam.chains) {
        if (ch.chainId !== id) continue
        for (const a of ch.addresses) {
          if (a.kind !== 'pool') continue
          const tokRow = a.tokens.find(
            (t) => t.token.toUpperCase() === tokSym,
          )
          rows.push({
            address: a.address,
            tokenAmountRaw: tokRow?.amountRaw ?? '0',
            allTokens: a.tokens
              .map((t) => `${t.amountDecimal} ${t.token}`)
              .join(' · '),
          })
        }
      }
    }
    rows.sort((a, b) => {
      const av = BigInt(a.tokenAmountRaw || '0')
      const bv = BigInt(b.tokenAmountRaw || '0')
      if (av === bv) return a.address.localeCompare(b.address)
      return av > bv ? -1 : 1
    })
    return rows
  }, [balancesQ.data, chainId, token])

  const planMut = useMutation({
    mutationFn: () => {
      if (!/^\d+$/.test(chainId.trim())) {
        throw new ApiError('Pick a chain', 400)
      }
      if (!token.trim()) throw new ApiError('Pick a token', 400)
      if (target.trim().length < 8) {
        throw new ApiError('Target address is required', 400)
      }
      const min = minRaw.trim()
      if (min && !/^\d+$/.test(min)) {
        throw new ApiError('Dust floor must be an integer (smallest unit)', 400)
      }
      const cap = maxSources.trim()
      if (cap) {
        if (!/^\d+$/.test(cap)) {
          throw new ApiError('Max sources must be an integer', 400)
        }
        const n = parseInt(cap, 10)
        if (n < 1 || n > 200) {
          throw new ApiError('Max sources must be between 1 and 200', 400)
        }
      }
      const body: Record<string, unknown> = {
        chainId: parseInt(chainId, 10),
        token: token.trim().toUpperCase(),
        targetAddress: target.trim(),
      }
      if (min) body.minSourceBalanceRaw = min
      if (cap) body.maxSources = parseInt(cap, 10)
      return api<ConsolidationPlanResponse>('/api/gw/admin/pool/consolidate', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: (res) => {
      setPlan(res)
      const planned = res.legs.length
      const skipped = res.skipped.length
      toast.success(
        `Consolidation planned (${planned} leg${planned === 1 ? '' : 's'}${skipped > 0 ? `, ${skipped} skipped` : ''})`,
      )
      onPlanned?.(res.consolidationId)
    },
    onError: (e: ApiError) => {
      const map: Record<string, string> = {
        INVALID_CHAIN: 'Chain adapter not wired on this deployment',
        INVALID_TOKEN: 'Token is not registered on this chain',
        TARGET_NOT_IN_POOL: 'Target address is not in the HD pool for this family',
        NO_SOURCES_WITH_BALANCE:
          'No pool address (other than the target) holds this token',
      }
      toast.error(map[e.code ?? ''] ?? e.message ?? 'Consolidation failed')
    },
  })

  // Same gate the submit button always had.
  const canSubmit =
    !planMut.isPending && !!chainId && !!token && target.trim().length >= 8

  const usingPicker =
    targetCandidates.length > 0 &&
    (target === '' || targetCandidates.some((r) => r.address === target))

  const targetRow = targetCandidates.find((r) => r.address === target)
  const dec = selectedToken?.decimals
  const stageIndex = plan ? 2 : step === 'review' ? 1 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5" /> Consolidate balance
          </DialogTitle>
          <DialogDescription>
            Sweep a token split across pool addresses into one target.
          </DialogDescription>
        </DialogHeader>

        <Stages current={stageIndex} labels={['Plan', 'Review', 'Track']} />

        {!plan && step === 'plan' && (
          <form
            className="fade-in min-w-0 space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) setStep('review')
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Chain">
                <Select
                  value={chainId}
                  onValueChange={(v) => {
                    setChainId(v)
                    setToken('')
                  }}
                  disabled={chainsQ.isLoading || chainOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        chainsQ.isLoading ? 'Loading…' : 'Pick chain'
                      }
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
                  disabled={tokenOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        chainId ? 'Pick token' : 'Pick chain first'
                      }
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
              label="Target address"
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
                    {target && !targetCandidates.some((r) => r.address === target)
                      ? 'Use picker'
                      : 'Custom address'}
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
                        balancesQ.isLoading ? 'Loading addresses…' : 'Pick pool address'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {targetCandidates.map((row) => {
                      const has = row.tokenAmountRaw !== '0'
                      const balLabel =
                        has && dec != null
                          ? `${formatUnits(row.tokenAmountRaw, dec)} ${selectedToken!.symbol}`
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
                    chainId === '728126428' || chainId === '728'
                      ? 'T…'
                      : chainId === '900'
                        ? 'base58…'
                        : '0x…'
                  }
                />
              )}
            </Field>

            <div className="overflow-hidden rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                aria-expanded={advanced}
                className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
              >
                <SlidersHorizontal className="size-4 text-[var(--fg-2)]" />
                Overrides
                <span className="text-xs font-normal text-[var(--fg-3)]">optional</span>
                <ChevronDown
                  className={cn(
                    'ml-auto size-4 text-[var(--fg-3)] transition-transform duration-200',
                    advanced && 'rotate-180',
                  )}
                />
              </button>
              {advanced && (
                <div className="fade-in grid grid-cols-1 gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
                  <Field
                    label="Dust floor (raw)"
                    hint={
                      selectedToken?.decimals != null && /^\d+$/.test(minRaw)
                        ? `≈ ${formatUnits(minRaw, selectedToken.decimals)} ${selectedToken.symbol}`
                        : 'Empty = server floor.'
                    }
                  >
                    <Input
                      inputMode="numeric"
                      value={minRaw}
                      onChange={(e) => setMinRaw(e.target.value)}
                      className="font-mono"
                      placeholder="e.g. 10000000"
                    />
                  </Field>
                  <Field label="Max sources" hint="1–200. Empty = default.">
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={maxSources}
                      onChange={(e) => setMaxSources(e.target.value)}
                      className="figure"
                      placeholder="e.g. 50"
                    />
                  </Field>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={planMut.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                Review
                <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </form>
        )}

        {!plan && step === 'review' && (
          <div className="fade-in min-w-0 space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] p-4">
              <TokenOnChain symbol={token} chainId={parseInt(chainId, 10)} size={36} />
              <div className="min-w-0">
                <div className="font-semibold">{token.toUpperCase()}</div>
                <ChainPill chainId={parseInt(chainId, 10)} iconOnly={false} size={14} className="text-xs text-[var(--fg-2)]" />
              </div>
            </div>

            <dl className="divide-y divide-border rounded-xl border border-border">
              <Fact icon={Target} label="Target">
                <Addr value={target.trim()} chainId={parseInt(chainId, 10)} />
              </Fact>
              {targetRow && dec != null && targetRow.tokenAmountRaw !== '0' && (
                <Fact icon={Layers} label="Already holds">
                  <span className="figure">
                    {formatUnits(targetRow.tokenAmountRaw, dec)} {selectedToken?.symbol}
                  </span>
                </Fact>
              )}
              <Fact icon={SlidersHorizontal} label="Dust floor">
                {minRaw.trim() ? (
                  <span className="figure">
                    {dec != null && /^\d+$/.test(minRaw.trim())
                      ? `${formatUnits(minRaw.trim(), dec)} ${selectedToken?.symbol ?? ''}`
                      : minRaw.trim()}
                  </span>
                ) : (
                  <span className="text-[var(--fg-3)]">Server default</span>
                )}
              </Fact>
              <Fact icon={Hash} label="Max sources">
                {maxSources.trim() ? (
                  <span className="figure">{maxSources.trim()}</span>
                ) : (
                  <span className="text-[var(--fg-3)]">Server default</span>
                )}
              </Fact>
            </dl>

            <Callout tone="info">
              Account-model chains pick a single sender per payout. When a token
              is split across many pool addresses no single tx can send the
              aggregate. This plans one internal sweep per holder into{' '}
              <span className="font-mono">target</span>; each leg rides the
              normal executor cron through top-up → broadcast → confirmation.
              Store payouts from <span className="font-mono">target</span> will
              succeed once every leg confirms.
            </Callout>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('plan')}
                disabled={planMut.isPending}
              >
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                type="button"
                onClick={() => planMut.mutate()}
                disabled={!canSubmit}
              >
                {planMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Layers className="size-4" />
                )}
                {planMut.isPending ? 'Planning…' : 'Plan consolidation'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {plan && (
          <ConsolidationStatus
            plan={plan}
            tokenDecimals={selectedToken?.decimals ?? null}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stages({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((l, i) => {
        const done = i < current
        const on = i === current
        return (
          <li key={l} className="min-w-0">
            <div
              className={cn(
                'h-1.5 rounded-full',
                done ? 'bg-[var(--st-ok-dot)]' : on ? 'bg-foreground' : 'bg-[var(--chart-muted)]',
              )}
            />
            <div
              className={cn(
                'mt-1.5 flex items-center gap-1 truncate text-xs',
                done || on ? 'font-medium text-foreground' : 'text-[var(--fg-3)]',
              )}
            >
              {done && <Check className="size-3.5 text-[var(--st-ok)]" />}
              {l}
            </div>
          </li>
        )
      })}
    </ol>
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

function ConsolidationStatus({
  plan,
  tokenDecimals,
  onClose,
}: {
  plan: ConsolidationPlanResponse
  tokenDecimals: number | null
  onClose: () => void
}) {
  const statusQ = useQuery({
    queryKey: ['gw', 'consolidations', plan.consolidationId] as const,
    queryFn: () =>
      api<ConsolidationStatusResponse>(
        `/api/gw/admin/pool/consolidations/${encodeURIComponent(plan.consolidationId)}`,
      ),
    refetchInterval: (q) => {
      const data = q.state.data as ConsolidationStatusResponse | undefined
      // Stop polling once everything has reached a terminal state.
      if (data && data.summary.pendingOrInFlight === 0) return false
      return 5_000
    },
  })

  const summary = statusQ.data?.summary
  const done =
    summary != null &&
    summary.pendingOrInFlight === 0 &&
    summary.failed === 0 &&
    summary.confirmed === summary.total

  const fmt = (raw: string) =>
    tokenDecimals != null ? formatUnits(raw, tokenDecimals) : raw

  const legs = React.useMemo(
    () =>
      statusQ.data?.legs ??
      plan.legs.map((l) => ({
        ...l,
        status: 'planned' as const,
        txHash: null,
        topUpTxHash: null,
        lastError: null,
      })),
    [statusQ.data, plan.legs],
  )
  const paged = usePaged(legs, 25)
  const total = summary?.total ?? plan.legs.length

  return (
    <div className="fade-in min-w-0 space-y-5">
      <div className="rounded-xl border border-border bg-[var(--bg-2)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <TokenOnChain symbol={plan.token} chainId={plan.chainId} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 font-semibold">
              {plan.token}
              <span className="font-mono text-xs font-normal text-[var(--fg-3)]">
                {plan.consolidationId.slice(0, 8)}…{plan.consolidationId.slice(-6)}
              </span>
              <CopyButton value={plan.consolidationId} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--fg-2)]">
              <Target className="size-3.5" />
              <Addr value={plan.targetAddress} chainId={plan.chainId} />
            </div>
          </div>
          {summary ? (
            done ? (
              <StatusPill tone="ok">All confirmed</StatusPill>
            ) : summary.pendingOrInFlight > 0 ? (
              <StatusPill tone="run">{summary.pendingOrInFlight} in flight</StatusPill>
            ) : summary.failed > 0 ? (
              <StatusPill tone="bad">{summary.failed} failed</StatusPill>
            ) : null
          ) : (
            <StatusPill tone="wait">Planned</StatusPill>
          )}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--fg-2)]">Confirmed</div>
            <div className="figure text-xl font-semibold">
              {summary?.confirmed ?? 0}
              <span className="text-base font-medium text-[var(--fg-2)]"> / {total}</span>
            </div>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => statusQ.refetch()}
            disabled={statusQ.isFetching}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn('size-4', statusQ.isFetching && 'animate-spin')} />
          </Button>
        </div>
        <SegmentedBar
          className="mt-3 h-2"
          parts={[
            { key: 'ok', name: 'Confirmed', value: summary?.confirmed ?? 0, color: 'var(--st-ok-dot)' },
            { key: 'run', name: 'In flight', value: summary?.pendingOrInFlight ?? total, color: 'var(--st-run-dot)' },
            { key: 'bad', name: 'Failed', value: summary?.failed ?? 0, color: 'var(--st-bad-dot)' },
            { key: 'off', name: 'Canceled', value: summary?.canceled ?? 0, color: 'var(--st-wait-dot)' },
          ]}
        />
        {summary && (
          <div className="figure mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg-2)]">
            <span>{summary.confirmed} confirmed</span>
            <span>{summary.pendingOrInFlight} in flight</span>
            <span>{summary.failed} failed</span>
            <span>{summary.canceled} canceled</span>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <TableWrap>
          <Table className="min-w-[520px]">
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
                    <Addr value={leg.sourceAddress} chainId={plan.chainId} />
                  </Td>
                  <Td align="right" className="font-medium">
                    {fmt(leg.amountRaw)}
                  </Td>
                  <Td>
                    <Status value={leg.status} />
                    {leg.lastError && (
                      <div
                        className="mt-1 max-w-[220px] truncate font-mono text-2xs text-[var(--st-bad)]"
                        title={leg.lastError}
                      >
                        {leg.lastError}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {leg.txHash ? (
                      <Addr value={leg.txHash} chainId={plan.chainId} kind="tx" />
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

      {plan.skipped.length > 0 && (
        <Callout
          tone="warn"
          title={
            <>
              {plan.skipped.length} source{plan.skipped.length === 1 ? '' : 's'}{' '}
              skipped — fund a sponsor and re-run to pick up the rest
            </>
          }
        >
          <ul className="mt-1 space-y-1 text-xs">
            {plan.skipped.map((s) => (
              <li
                key={s.sourceAddress}
                className="flex flex-wrap items-center gap-2"
              >
                <Addr value={s.sourceAddress} chainId={plan.chainId} />
                <span className="figure text-[var(--fg-2)]">
                  {fmt(s.amountRaw)}
                </span>
                <span className="font-mono text-2xs text-[var(--fg-2)]">
                  {s.reason}
                </span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <DialogFooter>
        <Button onClick={onClose}>{done ? 'Done' : 'Close'}</Button>
      </DialogFooter>
    </div>
  )
}

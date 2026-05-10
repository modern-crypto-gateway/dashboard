import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { formatUnits } from '@/lib/format'
import type {
  BalancesSnapshot,
  ChainInventoryEntry,
  ConsolidationPlanResponse,
  ConsolidationStatusResponse,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
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
  const [plan, setPlan] = React.useState<ConsolidationPlanResponse | null>(null)

  // Reset form on every closed → open transition (pulling fresh prefills).
  const syncKey = `${open ? '1' : '0'}|${prefillChainId ?? ''}|${prefillToken ?? ''}`
  const [prevSyncKey, setPrevSyncKey] = React.useState(syncKey)
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey)
    if (open) {
      setChainId(prefillChainId != null ? String(prefillChainId) : '')
      setToken(prefillToken ?? '')
      setTarget('')
      setPlan(null)
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
      return api<ConsolidationPlanResponse>('/api/gw/admin/pool/consolidate', {
        method: 'POST',
        body: JSON.stringify({
          chainId: parseInt(chainId, 10),
          token: token.trim().toUpperCase(),
          targetAddress: target.trim(),
        }),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4" /> Consolidate token balance
          </DialogTitle>
          <DialogDescription>
            Account-model chains pick a single sender per payout. When a
            token is split across many pool addresses no single tx can send
            the aggregate. This plans one internal sweep per holder into{' '}
            <span className="font-mono">target</span>; each leg rides the
            normal executor cron through top-up → broadcast → confirmation.
            Poll status below; merchant payouts from <span className="font-mono">target</span>{' '}
            will succeed once every leg confirms.
          </DialogDescription>
        </DialogHeader>

        {!plan && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              planMut.mutate()
            }}
          >
            <div className="grid grid-cols-[1fr_140px] gap-2">
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
                      placeholder={
                        chainId ? 'Pick token' : 'Pick chain first'
                      }
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
              label="Target address"
              hint={
                targetCandidates.length > 0
                  ? 'Pick a pool address with the most existing token balance (top of the list) to minimize legs.'
                  : 'Pool address that receives every consolidated balance. MUST already exist in the address pool for this family.'
              }
              right={
                targetCandidates.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTarget('')}
                    className="text-[11px] text-[var(--fg-3)] hover:text-foreground cursor-pointer"
                  >
                    {target && !targetCandidates.some((r) => r.address === target)
                      ? 'Use picker'
                      : 'Custom address'}
                  </button>
                ) : null
              }
            >
              {targetCandidates.length > 0 &&
              (target === '' || targetCandidates.some((r) => r.address === target)) ? (
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
                      const dec = selectedToken?.decimals
                      const balLabel =
                        has && dec != null
                          ? `${formatUnits(row.tokenAmountRaw, dec)} ${selectedToken!.symbol}`
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
                    chainId === '728126428' || chainId === '728'
                      ? 'T…'
                      : chainId === '900'
                        ? 'base58…'
                        : '0x…'
                  }
                />
              )}
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={planMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  planMut.isPending ||
                  !chainId ||
                  !token ||
                  target.trim().length < 8
                }
              >
                {planMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Layers className="size-3.5" />
                )}
                {planMut.isPending ? 'Planning…' : 'Plan consolidation'}
              </Button>
            </DialogFooter>
          </form>
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs">
        <span className="eyebrow">Consolidation</span>
        <span className="font-mono">
          {plan.consolidationId.slice(0, 8)}…{plan.consolidationId.slice(-6)}
        </span>
        <span className="text-[var(--fg-3)]">·</span>
        <span className="font-mono">
          chain {plan.chainId} · {plan.token}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[var(--fg-2)]">
          <span>target</span>
          <Addr value={plan.targetAddress} />
        </span>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          {done ? (
            <Badge variant="success">
              <CheckCircle2 className="size-3" /> all legs confirmed
            </Badge>
          ) : summary.pendingOrInFlight > 0 ? (
            <Badge variant="warn">
              <Loader2 className="size-3 animate-spin" />{' '}
              {summary.pendingOrInFlight} in flight
            </Badge>
          ) : summary.failed > 0 ? (
            <Badge variant="danger">
              <AlertTriangle className="size-3" /> {summary.failed} failed
            </Badge>
          ) : null}
          <span className="text-[11px] text-[var(--fg-3)]">
            <span className="font-mono">{summary.confirmed}</span> confirmed ·{' '}
            <span className="font-mono">{summary.failed}</span> failed ·{' '}
            <span className="font-mono">{summary.canceled}</span> canceled ·{' '}
            <span className="font-mono">{summary.total}</span> total
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => statusQ.refetch()}
            disabled={statusQ.isFetching}
          >
            <RefreshCw
              className={`size-3.5 ${statusQ.isFetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-2)] text-[10.5px] uppercase tracking-wider text-[var(--fg-3)]">
            <tr>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Tx</th>
            </tr>
          </thead>
          <tbody>
            {(statusQ.data?.legs ?? plan.legs.map((l) => ({
              ...l,
              status: 'planned' as const,
              txHash: null,
              topUpTxHash: null,
              lastError: null,
            }))).map((leg) => (
              <tr key={leg.payoutId} className="border-t border-border">
                <td className="px-3 py-2 align-top">
                  <Addr value={leg.sourceAddress} />
                </td>
                <td className="px-3 py-2 align-top font-mono">
                  {fmt(leg.amountRaw)}
                </td>
                <td className="px-3 py-2 align-top">
                  <LegStatusBadge status={leg.status} />
                  {leg.lastError && (
                    <div className="mt-0.5 max-w-[260px] truncate font-mono text-[10px] text-destructive">
                      {leg.lastError}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
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

      {plan.skipped.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          <div className="eyebrow mb-1 text-warn">
            {plan.skipped.length} source{plan.skipped.length === 1 ? '' : 's'}{' '}
            skipped — fund a sponsor and re-run to pick up the rest
          </div>
          <ul className="space-y-1">
            {plan.skipped.map((s) => (
              <li
                key={s.sourceAddress}
                className="flex flex-wrap items-center gap-2"
              >
                <Addr value={s.sourceAddress} />
                <span className="font-mono text-[var(--fg-2)]">
                  {fmt(s.amountRaw)}
                </span>
                <span className="font-mono text-[10px] text-[var(--fg-3)]">
                  {s.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose}>{done ? 'Done' : 'Close'}</Button>
      </DialogFooter>
    </div>
  )
}

function LegStatusBadge({
  status,
}: {
  status: ConsolidationStatusResponse['legs'][number]['status']
}) {
  switch (status) {
    case 'confirmed':
      return <Badge variant="success">{status}</Badge>
    case 'failed':
    case 'canceled':
      return <Badge variant="danger">{status}</Badge>
    case 'submitted':
    case 'topping-up':
    case 'reserved':
      return <Badge variant="warn">{status}</Badge>
    default:
      return <Badge variant="default">{status}</Badge>
  }
}

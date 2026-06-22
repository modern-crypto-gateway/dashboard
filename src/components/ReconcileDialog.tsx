import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Scale,
  SlidersHorizontal,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { formatUnits, formatUnitsSigned } from '@/lib/format'
import type {
  ChainInventoryEntry,
  Family,
  ReconcileResponse,
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

/** Reconcile only covers account-model balances; UTXO/Monero are out of scope. */
const ACCOUNT_FAMILIES: Family[] = ['evm', 'tron', 'solana']

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Called after adjustments are written, so the parent can refetch balances. */
  onApplied?: (res: ReconcileResponse) => void
}

export function ReconcileDialog({ open, onOpenChange, onApplied }: Props) {
  const qc = useQueryClient()
  const [family, setFamily] = React.useState('')
  const [chainId, setChainId] = React.useState('')
  const [address, setAddress] = React.useState('')
  // The result currently on screen. `locked` freezes the scope inputs once a
  // preview exists so the subsequent Apply writes exactly what was reviewed.
  const [result, setResult] = React.useState<ReconcileResponse | null>(null)

  // Reset on each closed → open transition (render-phase, own state only).
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setFamily('')
      setChainId('')
      setAddress('')
      setResult(null)
    }
  }

  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    enabled: open,
    staleTime: 120_000,
  })

  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter(
          (c) =>
            c.wired &&
            ACCOUNT_FAMILIES.includes(c.family) &&
            (family === '' || c.family === family),
        )
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data, family],
  )

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

  const buildBody = (dryRun: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = { dryRun }
    if (family) body.family = family
    if (chainId) body.chainId = parseInt(chainId, 10)
    if (address.trim()) body.address = address.trim()
    return body
  }

  const reconcile = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ReconcileResponse>('/api/gw/admin/balances/reconcile', {
        method: 'POST',
        body: JSON.stringify(buildBody(dryRun)),
      }),
    onSuccess: (res) => {
      setResult(res)
      if (!res.dryRun) {
        toast.success(
          res.adjusted > 0
            ? `Wrote ${res.adjusted} adjustment${res.adjusted === 1 ? '' : 's'}`
            : 'Nothing to adjust — ledger already matched',
        )
        qc.invalidateQueries({ queryKey: ['balances'] })
        onApplied?.(res)
      }
    },
    onError: (e: ApiError) =>
      toast.error(e.message || 'Reconcile failed'),
  })

  const locked = result != null
  const applied = result != null && !result.dryRun
  const nonZero = result?.deltas.filter((d) => d.deltaRaw !== '0') ?? []
  const pendingDryRun = reconcile.isPending && reconcile.variables === true
  const pendingApply = reconcile.isPending && reconcile.variables === false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 overflow-x-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4" /> Reconcile ledger ↔ chain
          </DialogTitle>
          <DialogDescription>
            Probes each account-model pool address&rsquo;s live on-chain balance
            and compares it to the settled ledger. Preview is read-only; applying
            writes one adjustment row per nonzero delta to snap the ledger to
            chain. UTXO and Monero are out of scope.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Family" hint="Account-model only.">
              <Select
                value={family || 'all'}
                onValueChange={(v) => {
                  setFamily(v === 'all' ? '' : v)
                  setChainId('')
                }}
                disabled={locked}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All families" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All families</SelectItem>
                  {ACCOUNT_FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      <span className="uppercase tracking-wider">{f}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Chain">
              <Select
                value={chainId || 'all'}
                onValueChange={(v) => setChainId(v === 'all' ? '' : v)}
                disabled={locked || chainsQ.isLoading}
              >
                <SelectTrigger>
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
            </Field>
          </div>
          <Field
            label="Address"
            hint="Optional — narrow to a single pool address."
          >
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-xs"
              placeholder="0x… / T… / base58 (leave blank for all)"
              spellCheck={false}
              disabled={locked}
            />
          </Field>

          {result && (
            <ReconcileResult result={result} decimalsOf={decimalsOf} />
          )}
        </div>

        <DialogFooter className="gap-2">
          {!locked ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={reconcile.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => reconcile.mutate(true)}
                disabled={reconcile.isPending}
              >
                {pendingDryRun ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Scale className="size-3.5" />
                )}
                {pendingDryRun ? 'Probing…' : 'Preview drift'}
              </Button>
            </>
          ) : applied ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setResult(null)}
                disabled={reconcile.isPending}
              >
                <SlidersHorizontal className="size-3.5" /> Change scope
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={reconcile.isPending}
              >
                Close
              </Button>
              {nonZero.length > 0 && (
                <Button
                  type="button"
                  onClick={() => reconcile.mutate(false)}
                  disabled={reconcile.isPending}
                  className="bg-warn text-white hover:bg-warn/90"
                >
                  {pendingApply ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  {pendingApply
                    ? 'Writing…'
                    : `Apply ${nonZero.length} adjustment${nonZero.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReconcileResult({
  result,
  decimalsOf,
}: {
  result: ReconcileResponse
  decimalsOf: (chainId: number, sym: string) => number | null
}) {
  const nonZero = result.deltas.filter((d) => d.deltaRaw !== '0')

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.dryRun ? 'outline' : 'success'}>
          {result.dryRun ? 'preview' : `applied · ${result.adjusted} written`}
        </Badge>
        <span className="text-[11px] text-[var(--fg-3)]">
          <span className="font-mono">{result.checked}</span> probed ·{' '}
          <span className="font-mono">{nonZero.length}</span> drifting
          {result.errors.length > 0 && (
            <>
              {' '}
              ·{' '}
              <span className="text-warn">{result.errors.length} RPC error</span>
            </>
          )}
        </span>
        {!result.dryRun && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-success">
            <CheckCircle2 className="size-3" /> ledger snapped to chain
          </span>
        )}
      </div>

      {nonZero.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2.5 text-xs text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          No drift — every probed address matches the ledger.
        </div>
      ) : (
        <div className="max-h-[320px] min-w-0 overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="sticky top-0 bg-[var(--bg-2)] text-[10.5px] uppercase tracking-wider text-[var(--fg-3)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Address</th>
                <th className="px-3 py-2 text-left font-medium">Token</th>
                <th className="px-3 py-2 text-right font-medium">On-chain</th>
                <th className="px-3 py-2 text-right font-medium">Ledger</th>
                <th className="px-3 py-2 text-right font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {nonZero.map((d) => {
                const dec = decimalsOf(d.chainId, d.token)
                const info = chainInfo(d.chainId)
                const neg = d.deltaRaw.startsWith('-')
                return (
                  <tr
                    key={`${d.chainId}-${d.address}-${d.token}`}
                    className="border-t border-border align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <Addr value={d.address} />
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--fg-3)]">
                          <span
                            className="size-[6px] rounded-full"
                            style={{ background: info.color }}
                          />
                          {info.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono">{d.token}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {dec != null ? formatUnits(d.onChainRaw, dec) : d.onChainRaw}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--fg-2)]">
                      {dec != null ? formatUnits(d.ledgerRaw, dec) : d.ledgerRaw}
                    </td>
                    <td
                      className={
                        'px-3 py-2 text-right font-mono tabular-nums font-semibold ' +
                        (neg ? 'text-destructive' : 'text-success')
                      }
                    >
                      {neg ? '' : '+'}
                      {dec != null
                        ? formatUnitsSigned(d.deltaRaw, dec)
                        : d.deltaRaw}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          <div className="eyebrow mb-1 flex items-center gap-1.5 text-warn">
            <AlertTriangle className="size-3.5" />
            {result.errors.length} address
            {result.errors.length === 1 ? '' : 'es'} could not be probed —
            skipped, not adjusted
          </div>
          <ul className="space-y-1">
            {result.errors.map((er) => (
              <li
                key={`${er.chainId}-${er.address}`}
                className="flex flex-wrap items-center gap-2"
              >
                <Addr value={er.address} />
                <span className="text-[10px] text-[var(--fg-3)]">
                  {chainInfo(er.chainId).name}
                </span>
                <span className="font-mono text-[var(--fg-2)]">{er.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.dryRun && nonZero.length > 0 && (
        <p className="text-[11px] text-[var(--fg-2)]">
          Review the deltas above. Applying writes one adjustment row per
          nonzero delta and can&rsquo;t be auto-undone — scope to a chain or
          address first if you only trust some of these.
        </p>
      )}
    </div>
  )
}

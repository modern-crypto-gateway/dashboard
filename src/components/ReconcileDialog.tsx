import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Check,
  CheckCircle2,
  Loader2,
  Scale,
  SlidersHorizontal,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { formatUnits, formatUnitsSigned } from '@/lib/format'
import type {
  ChainInventoryEntry,
  Family,
  ReconcileResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { ChainIcon, FamilyIcon, TokenIcon } from '@/components/CryptoIcon'
import { ChainPill } from '@/components/ChainPill'
import { Field } from '@/components/Field'
import { Callout } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
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
  const step = applied ? 2 : locked ? 1 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 overflow-x-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-5" /> Reconcile ledger
          </DialogTitle>
          <DialogDescription>
            Probes each account-model pool address&rsquo;s live on-chain balance
            and compares it to the settled ledger. Preview is read-only; applying
            writes one adjustment row per nonzero delta to snap the ledger to
            chain. UTXO and Monero are out of scope.
          </DialogDescription>
        </DialogHeader>

        <Steps current={step} labels={['Scope', 'Preview', 'Apply']} />

        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Family">
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
                      <span className="flex items-center gap-2">
                        <FamilyIcon family={f} size={16} />
                        <span className="uppercase">{f}</span>
                      </span>
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
                      <span className="flex items-center gap-2">
                        <ChainIcon chainId={c.chainId} size={16} />
                        {c.displayName}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Address" hint="Optional — one pool address.">
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
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Scale className="size-4" />
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
                <SlidersHorizontal className="size-4" /> Change scope
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
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
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

/** Three-stage progress strip (Scope → Preview → Apply). */
function Steps({ current, labels }: { current: number; labels: string[] }) {
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

function ReconcileResult({
  result,
  decimalsOf,
}: {
  result: ReconcileResponse
  decimalsOf: (chainId: number, sym: string) => number | null
}) {
  const nonZero = result.deltas.filter((d) => d.deltaRaw !== '0')

  return (
    <div className="fade-in min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {result.dryRun ? (
          <StatusPill tone="info">Preview</StatusPill>
        ) : (
          <StatusPill tone="ok">Applied · {result.adjusted} written</StatusPill>
        )}
        {!result.dryRun && (
          <span className="text-xs text-[var(--st-ok)]">ledger snapped to chain</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ResultStat label="Probed" value={result.checked} />
        <ResultStat label="Drifting" value={nonZero.length} tone={nonZero.length > 0 ? 'warn' : undefined} />
        <ResultStat
          label="RPC errors"
          value={result.errors.length}
          tone={result.errors.length > 0 ? 'bad' : undefined}
        />
      </div>

      {nonZero.length === 0 ? (
        <Callout tone="success">
          No drift — every probed address matches the ledger.
        </Callout>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <TableWrap className="max-h-[320px] min-w-0 overflow-y-auto">
            <Table className="min-w-[560px]">
              <THead sticky className="bg-card">
                <tr>
                  <Th>Address</Th>
                  <Th>Token</Th>
                  <Th align="right">On-chain</Th>
                  <Th align="right">Ledger</Th>
                  <Th align="right">Delta</Th>
                </tr>
              </THead>
              <TBody>
                {nonZero.map((d) => {
                  const dec = decimalsOf(d.chainId, d.token)
                  const neg = d.deltaRaw.startsWith('-')
                  return (
                    <Tr key={`${d.chainId}-${d.address}-${d.token}`}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <ChainPill chainId={d.chainId} iconOnly size={16} />
                          <Addr value={d.address} chainId={d.chainId} />
                        </div>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <TokenIcon symbol={d.token} size={16} />
                          {d.token}
                        </span>
                      </Td>
                      <Td align="right">
                        {dec != null ? formatUnits(d.onChainRaw, dec) : d.onChainRaw}
                      </Td>
                      <Td align="right" className="text-[var(--fg-2)]">
                        {dec != null ? formatUnits(d.ledgerRaw, dec) : d.ledgerRaw}
                      </Td>
                      <Td
                        align="right"
                        className={cn(
                          'font-semibold',
                          neg ? 'text-[var(--st-bad)]' : 'text-[var(--st-ok)]',
                        )}
                      >
                        {neg ? '' : '+'}
                        {dec != null
                          ? formatUnitsSigned(d.deltaRaw, dec)
                          : d.deltaRaw}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          </TableWrap>
        </div>
      )}

      {result.errors.length > 0 && (
        <Callout
          tone="warn"
          title={
            <>
              {result.errors.length} address
              {result.errors.length === 1 ? '' : 'es'} could not be probed —
              skipped, not adjusted
            </>
          }
        >
          <ul className="mt-1 space-y-1 text-xs">
            {result.errors.map((er) => (
              <li
                key={`${er.chainId}-${er.address}`}
                className="flex flex-wrap items-center gap-2"
              >
                <ChainPill chainId={er.chainId} iconOnly size={14} />
                <Addr value={er.address} chainId={er.chainId} />
                <span className="font-mono break-all text-[var(--fg-2)]">{er.error}</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {result.dryRun && nonZero.length > 0 && (
        <Callout tone="warn">
          Review the deltas above. Applying writes one adjustment row per
          nonzero delta and can&rsquo;t be auto-undone — scope to a chain or
          address first if you only trust some of these.
        </Callout>
      )}
    </div>
  )
}

function ResultStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warn' | 'bad'
}) {
  return (
    <div className="rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3">
      <div className="text-xs text-[var(--fg-2)]">{label}</div>
      <div
        className={cn(
          'figure mt-0.5 text-lg font-semibold',
          tone === 'warn' && 'text-[var(--st-warn)]',
          tone === 'bad' && 'text-[var(--st-bad)]',
        )}
      >
        {value}
      </div>
    </div>
  )
}

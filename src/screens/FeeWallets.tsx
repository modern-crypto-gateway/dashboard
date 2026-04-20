import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Flame, KeyRound, Lock, RefreshCw, Wallet } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type {
  ChainInventoryEntry,
  Family,
  FeeWalletResult,
  FeeWalletRow,
} from '@/lib/types'
import {
  chainInfo,
  isLowGas,
  LOW_GAS_THRESHOLD,
  nativeBalanceDecimal,
} from '@/lib/chains'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function FeeWalletsPage() {
  const [chainId, setChainId] = React.useState('')
  const [label, setLabel] = React.useState('hot-1')

  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
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

  const selectedChain = chainOptions.find((c) => String(c.chainId) === chainId)

  React.useEffect(() => {
    if (chainOptions.length === 0 || selectedChain) return
    setChainId(String(chainOptions[0].chainId))
  }, [chainOptions, selectedChain])

  const register = useMutation({
    mutationFn: () => {
      if (!selectedChain) throw new Error('pick a chain')
      return api<{ feeWallet: FeeWalletResult }>('/api/gw/admin/fee-wallets', {
        method: 'POST',
        body: JSON.stringify({
          chainId: selectedChain.chainId,
          label: label.trim(),
          family: selectedChain.family,
        }),
      })
    },
    onSuccess: (res) => {
      toast.success(`Fee wallet registered for ${res.feeWallet.label}`, {
        description: `Fund ${res.feeWallet.address}`,
      })
    },
    onError: (e: ApiError | Error) =>
      toast.error(e.message || 'Could not register'),
  })

  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fee wallets</h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Register an HD-derived fee wallet for a chain. The gateway returns the
          address — fund it out-of-band so payouts can reserve it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>
            The <span className="font-mono">(address, private key)</span> is
            derived from <span className="font-mono">MASTER_SEED</span> at a
            deterministic index hashed from{' '}
            <span className="font-mono">(family, label)</span>. No keys travel
            over this API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-xl gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              register.mutate()
            }}
          >
            <Field
              label="Chain"
              hint="Family is derived from the chain. Only wired chains are listed."
            >
              <Select
                value={chainId}
                onValueChange={setChainId}
                disabled={chainsQ.isLoading || chainOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      chainsQ.isLoading
                        ? 'Loading…'
                        : chainOptions.length === 0
                          ? 'No wired chains'
                          : 'Select chain'
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
                        <span className="rounded border border-border bg-[var(--bg-2)] px-1 py-0 text-[10px] uppercase tracking-wider text-[var(--fg-2)]">
                          {c.family}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {selectedChain && selectedChain.feeWallets && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-1.5 text-[11.5px] text-[var(--fg-2)]">
                <AlertTriangle className="size-3 text-warn" />
                {selectedChain.displayName} already has at least one fee wallet.
                Registering another creates a separate derived address.
              </div>
            )}
            <Field
              label="Label"
              hint="Scope key (e.g. hot-1, cold-archive). Same label → same derived address on redeploy."
            >
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
                className="font-mono"
              />
            </Field>
            <div>
              <Button
                type="submit"
                disabled={
                  register.isPending || !selectedChain || label.trim() === ''
                }
              >
                <KeyRound className="size-3.5" />{' '}
                {register.isPending ? 'Registering…' : 'Register fee wallet'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <FeeWalletsList refreshKey={register.data?.feeWallet.address} />

      {register.data && (
        <Card>
          <CardHeader>
            <CardTitle>Derived address</CardTitle>
            <CardDescription>
              Fund this address externally. The same{' '}
              <span className="font-mono">(family, label)</span> always derives
              to the same address.
              {register.data.feeWallet.family === 'evm' &&
                register.data.feeWallet.chainIds.length > 1 && (
                  <>
                    {' '}
                    On EVM the same address is registered across every wired
                    chain — one top-up funds all of them.
                  </>
                )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5">
              <Wallet className="size-4 text-[var(--fg-2)]" />
              <span className="font-mono text-[11px] text-[var(--fg-2)]">
                {register.data.feeWallet.label} ·{' '}
                <span className="uppercase tracking-wider">
                  {register.data.feeWallet.family}
                </span>{' '}
                ·{' '}
                {register.data.feeWallet.chainIds.length === 1
                  ? `chain ${register.data.feeWallet.chainIds[0]}`
                  : `${register.data.feeWallet.chainIds.length} chains`}
              </span>
              <div className="flex-1" />
              <Addr value={register.data.feeWallet.address} truncated={false} />
            </div>
            {register.data.feeWallet.chainIds.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {register.data.feeWallet.chainIds.map((cid) => (
                  <span
                    key={cid}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--bg-2)] px-2 py-0.5 text-[11px]"
                  >
                    <span
                      className="size-[6px] rounded-full"
                      style={{ background: chainInfo(cid).color }}
                    />
                    <span className="text-[var(--fg-2)]">
                      {chainInfo(cid).name}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function FeeWalletsList({ refreshKey }: { refreshKey?: string }) {
  const [reservedOnly, setReservedOnly] = React.useState(false)
  const q = useQuery({
    queryKey: ['fee-wallets', 'list', reservedOnly, refreshKey] as const,
    queryFn: () => {
      const qs = new URLSearchParams({
        limit: '200',
        includeBalance: 'true',
      })
      if (reservedOnly) qs.set('reserved', 'true')
      return api<{ feeWallets: FeeWalletRow[] }>(
        `/api/gw/admin/fee-wallets?${qs.toString()}`,
      )
    },
    refetchInterval: reservedOnly ? 15_000 : 60_000,
  })

  const rows = q.data?.feeWallets ?? []

  const lowGasCount = React.useMemo(
    () =>
      rows.filter((w) => {
        if (!w.active) return false
        const fam = chainInfo(w.chainId).family
        const bal = nativeBalanceDecimal(w.nativeBalance, w.nativeDecimals)
        return isLowGas(fam, bal, w.nativeSymbol)
      }).length,
    [rows],
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Fleet</CardTitle>
          <CardDescription>
            Every registered fee wallet, with its current CAS reservation and
            gas balance. Low-gas cutoffs:{' '}
            {Object.entries(LOW_GAS_THRESHOLD)
              .filter(([s]) => s !== 'MATIC')
              .map(([sym, t], i, arr) => (
                <React.Fragment key={sym}>
                  <span className="font-mono">
                    {sym}&nbsp;&lt;&nbsp;{t}
                  </span>
                  {i < arr.length - 1 ? ' · ' : ''}
                </React.Fragment>
              ))}
            .
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {lowGasCount > 0 && (
            <Badge variant="warn">
              <Flame className="size-3" />
              {lowGasCount} low
            </Badge>
          )}
          <Button
            size="sm"
            variant={reservedOnly ? 'default' : 'outline'}
            onClick={() => setReservedOnly((v) => !v)}
          >
            <Lock className="size-3.5" />
            Reserved only
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={`size-3.5 ${q.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-[var(--fg-2)]">Loading…</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {(q.error as ApiError)?.message || 'Could not load fee wallets'}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--fg-2)]">
            {reservedOnly
              ? 'No reserved wallets right now.'
              : 'No fee wallets registered yet.'}
          </p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--fg-3)]">
                <tr>
                  <th className="px-5 py-2 text-left">Label</th>
                  <th className="px-5 py-2 text-left">Chain</th>
                  <th className="px-5 py-2 text-left">Address</th>
                  <th className="px-5 py-2 text-right">Gas</th>
                  <th className="px-5 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const chain = chainInfo(w.chainId)
                  return (
                    <tr key={w.id} className="border-t border-border">
                      <td className="px-5 py-2 font-mono text-xs">{w.label}</td>
                      <td className="px-5 py-2 text-xs text-[var(--fg-2)]">
                        {chain?.name ?? `chain ${w.chainId}`}
                      </td>
                      <td className="px-5 py-2">
                        <Addr value={w.address} />
                      </td>
                      <td className="px-5 py-2 text-right">
                        <GasCell row={w} family={chain.family} />
                      </td>
                      <td className="px-5 py-2">
                        {!w.active ? (
                          <Badge variant="warn">inactive</Badge>
                        ) : w.reservedByPayoutId ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Badge variant="warn">
                              <Lock className="size-3" /> reserved
                            </Badge>
                            <span className="font-mono text-[11px] text-[var(--fg-2)]">
                              {w.reservedByPayoutId.slice(0, 8)}…
                            </span>
                          </span>
                        ) : (
                          <Badge variant="success">available</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function GasCell({ row, family }: { row: FeeWalletRow; family: Family }) {
  if (row.nativeBalanceError === 'chain_not_wired') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-3)]"
        title="Chain not wired on gateway — enable it under Chains."
      >
        <AlertTriangle className="size-3" /> not wired
      </span>
    )
  }
  if (row.nativeBalanceError === 'rpc_error') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-warn"
        title="Gateway could not reach the RPC — will retry on next refresh."
      >
        <AlertTriangle className="size-3" /> rpc error
      </span>
    )
  }
  const bal = nativeBalanceDecimal(row.nativeBalance, row.nativeDecimals)
  if (bal == null) {
    return <span className="text-[11px] text-[var(--fg-3)]">—</span>
  }
  const low = isLowGas(family, bal, row.nativeSymbol)
  const formatted =
    bal >= 1 ? bal.toFixed(4) : bal >= 0.0001 ? bal.toFixed(6) : bal.toExponential(2)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={
          'font-mono text-xs tabular-nums ' +
          (low ? 'text-warn' : 'text-[var(--fg-1)]')
        }
      >
        {formatted}
      </span>
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-3)]">
        {row.nativeSymbol ?? ''}
      </span>
      {low && (
        <Badge variant="warn">
          <Flame className="size-3" /> low
        </Badge>
      )}
    </span>
  )
}

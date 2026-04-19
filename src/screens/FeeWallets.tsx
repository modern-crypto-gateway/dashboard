import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound, Lock, RefreshCw, Wallet } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { Family, FeeWalletResult } from '@/lib/types'
import { chainInfo } from '@/lib/chains'

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

interface FeeWalletRow {
  id: string
  chainId: number
  address: string
  label: string
  active: boolean
  reservedByPayoutId: string | null
  reservedAt: string | null
  createdAt: string
}

export function FeeWalletsPage() {
  const [chainId, setChainId] = React.useState('1')
  const [label, setLabel] = React.useState('hot-1')
  const [family, setFamily] = React.useState<Family>('evm')

  const register = useMutation({
    mutationFn: () =>
      api<{ feeWallet: FeeWalletResult }>('/api/gw/admin/fee-wallets', {
        method: 'POST',
        body: JSON.stringify({
          chainId: parseInt(chainId, 10),
          label: label.trim(),
          family,
        }),
      }),
    onSuccess: (res) => {
      toast.success(`Fee wallet registered for ${res.feeWallet.label}`, {
        description: `Fund ${res.feeWallet.address}`,
      })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not register'),
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
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <Field label="Family">
                <Select value={family} onValueChange={(v) => setFamily(v as Family)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="evm">EVM</SelectItem>
                    <SelectItem value="tron">Tron</SelectItem>
                    <SelectItem value="solana">Solana</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Chain ID">
                <Input
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </Field>
            </div>
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
                  register.isPending || !/^\d+$/.test(chainId) || label.trim() === ''
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
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5">
              <Wallet className="size-4 text-[var(--fg-2)]" />
              <span className="font-mono text-[11px] text-[var(--fg-2)]">
                {register.data.feeWallet.label} · chain{' '}
                {register.data.feeWallet.chainId}
              </span>
              <div className="flex-1" />
              <Addr value={register.data.feeWallet.address} truncated={false} />
            </div>
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
      const qs = new URLSearchParams({ limit: '200' })
      if (reservedOnly) qs.set('reserved', 'true')
      return api<{ feeWallets: FeeWalletRow[] }>(
        `/api/gw/admin/fee-wallets?${qs.toString()}`,
      )
    },
    refetchInterval: reservedOnly ? 15_000 : 60_000,
  })

  const rows = q.data?.feeWallets ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Fleet</CardTitle>
          <CardDescription>
            Every registered fee wallet, with its current CAS reservation.
            Filter by <span className="font-mono">reserved</span> to spot
            payouts stuck in <span className="font-mono">reserved</span> or{' '}
            <span className="font-mono">submitted</span> state.
          </CardDescription>
        </div>
        <div className="flex gap-2">
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

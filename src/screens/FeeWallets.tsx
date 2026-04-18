import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound, Wallet } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { Family, FeeWalletResult } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
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

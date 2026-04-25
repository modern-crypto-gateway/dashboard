import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  KeyRound,
  Loader2,
  Network,
  Pickaxe,
  RefreshCw,
  Share2,
  Snowflake,
  Sun,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { FAMILY_COLOR } from '@/lib/chains'
import { fmtNum } from '@/lib/format'
import type {
  Family,
  FeeWalletCapability,
  FeeWalletEntry,
  TronFeeWalletResources,
  TronResource,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

const FEE_WALLETS_Q = ['gw', 'fee-wallets'] as const
const TRON_RESOURCES_Q = ['gw', 'fee-wallets', 'tron', 'resources'] as const

type UsePoolArgs = { family: Family; address: string }
type ImportArgs = { family: Family; privateKey: string; address: string }

export function FeeWalletsPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: FEE_WALLETS_Q,
    queryFn: () =>
      api<{ feeWallets: FeeWalletEntry[] }>('/api/gw/admin/fee-wallets'),
    refetchInterval: 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: FEE_WALLETS_Q })

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Fee wallets
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Per-family gas providers. Registering a fee wallet on a supported
            family (Solana co-sign, Tron delegate) lets pool addresses stop
            holding native gas. EVM is not supported today.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw
            className={`size-3.5 ${q.isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {q.isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5" />
          {(q.error as ApiError)?.message ||
            'Could not load fee-wallet config. Check admin key in settings.'}
        </div>
      )}

      {q.isLoading ? (
        <FamilyCardsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(q.data?.feeWallets ?? []).map((entry) => (
            <FamilyCard key={entry.family} entry={entry} onChanged={refresh} />
          ))}
        </div>
      )}

      <TronSection
        tronEntry={q.data?.feeWallets.find((e) => e.family === 'tron') ?? null}
      />
    </div>
  )
}

/* ── per-family card ─────────────────────────────────────── */

function FamilyCard({
  entry,
  onChanged,
}: {
  entry: FeeWalletEntry
  onChanged: () => void
}) {
  const [usePoolOpen, setUsePoolOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const supported = entry.capability !== 'none'
  const configured = entry.configured

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: FAMILY_COLOR[entry.family] }}
          />
          <span className="font-semibold uppercase tracking-[0.08em] text-[13px]">
            {entry.family}
          </span>
          <CapabilityBadge capability={entry.capability} />
        </div>
        <StatusBadge supported={supported} configured={!!configured} />
      </div>

      <div className="mt-4 min-h-[56px]">
        {!supported ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-xs text-[var(--fg-2)]">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              No fee-wallet topology for this family. Gas is paid from each
              pool address's own native balance.
            </span>
          </div>
        ) : configured ? (
          <div className="space-y-2">
            <div className="eyebrow">Active fee wallet</div>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2">
              <Addr value={configured.address} />
              <Badge
                variant={configured.mode === 'imported' ? 'accent' : 'default'}
              >
                {configured.mode}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              No fee wallet registered. Pool addresses must self-fund gas until
              one is configured.
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {supported && !configured && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUsePoolOpen(true)}
            >
              <Pickaxe className="size-3.5" /> Use pool address
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-3.5" /> Import key
            </Button>
          </>
        )}
        {supported && configured && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" /> Remove
          </Button>
        )}
      </div>

      <UsePoolDialog
        open={usePoolOpen}
        onOpenChange={setUsePoolOpen}
        family={entry.family}
        onDone={onChanged}
      />
      <ImportKeyDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        family={entry.family}
        onDone={onChanged}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        family={entry.family}
        onDone={onChanged}
      />
    </Card>
  )
}

function CapabilityBadge({ capability }: { capability: FeeWalletCapability }) {
  if (capability === 'co-sign') {
    return (
      <Badge variant="accent" title="Fee wallet signs every payout as feePayer">
        co-sign
      </Badge>
    )
  }
  if (capability === 'delegate') {
    return (
      <Badge
        variant="accent"
        title="Fee wallet stakes native + delegates resources to pool addresses"
      >
        delegate
      </Badge>
    )
  }
  return (
    <Badge variant="outline" title="No fee-wallet topology supported today">
      none
    </Badge>
  )
}

function StatusBadge({
  supported,
  configured,
}: {
  supported: boolean
  configured: boolean
}) {
  if (!supported) return <Badge variant="outline">n/a</Badge>
  if (configured) {
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" /> configured
      </Badge>
    )
  }
  return (
    <Badge variant="warn">
      <AlertTriangle className="size-3" /> not set
    </Badge>
  )
}

/* ── use-pool dialog ─────────────────────────────────────── */

function UsePoolDialog({
  open,
  onOpenChange,
  family,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  family: Family
  onDone: () => void
}) {
  const [address, setAddress] = React.useState('')
  React.useEffect(() => {
    if (open) setAddress('')
  }, [open])

  const mut = useMutation({
    mutationFn: (args: UsePoolArgs) =>
      api<{ feeWallet: { family: Family; mode: 'hd-pool'; address: string } }>(
        `/api/gw/admin/fee-wallets/${args.family}/use-pool`,
        {
          method: 'POST',
          body: JSON.stringify({ address: args.address }),
        },
      ),
    onSuccess: () => {
      toast.success(`Fee wallet set for ${family}`)
      onDone()
      onOpenChange(false)
    },
    onError: (e: ApiError) => {
      if (e.code === 'POOL_ADDRESS_NOT_FOUND') {
        toast.error('Address is not in the HD pool for this family')
      } else if (e.code === 'INVALID_ADDRESS') {
        toast.error('Not a valid address for this family')
      } else {
        toast.error(e.message || 'Could not register fee wallet')
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register pool address as fee wallet</DialogTitle>
          <DialogDescription>
            Zero-new-secret setup. The address must already live in{' '}
            <span className="font-mono">address_pool</span> for{' '}
            <span className="font-mono">{family}</span>. Signing still goes
            through MASTER_SEED + the pool row's derivation index.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            mut.mutate({ family, address: address.trim() })
          }}
        >
          <Field
            label="Pool address"
            hint={
              family === 'tron'
                ? 'Base58 (starts with T…).'
                : family === 'solana'
                  ? 'Base58.'
                  : 'Hex (0x…).'
            }
          >
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono"
              required
              placeholder={
                family === 'evm'
                  ? '0x…'
                  : family === 'tron'
                    ? 'T…'
                    : 'base58…'
              }
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mut.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mut.isPending || address.trim().length < 8}
            >
              {mut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Pickaxe className="size-3.5" />
              )}
              {mut.isPending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── import-key dialog ───────────────────────────────────── */

function ImportKeyDialog({
  open,
  onOpenChange,
  family,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  family: Family
  onDone: () => void
}) {
  const [privateKey, setPrivateKey] = React.useState('')
  const [address, setAddress] = React.useState('')
  React.useEffect(() => {
    if (open) {
      setPrivateKey('')
      setAddress('')
    }
  }, [open])

  const mut = useMutation({
    mutationFn: (args: ImportArgs) =>
      api<{ feeWallet: { family: Family; mode: 'imported'; address: string } }>(
        `/api/gw/admin/fee-wallets/${args.family}/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            privateKey: args.privateKey,
            address: args.address,
          }),
        },
      ),
    onSuccess: () => {
      toast.success(`Imported fee wallet for ${family}`)
      onDone()
      onOpenChange(false)
    },
    onError: (e: ApiError) => {
      if (e.code === 'ADDRESS_KEY_MISMATCH') {
        toast.error('Address does not match private key', {
          description: e.message,
        })
      } else if (e.code === 'INVALID_PRIVATE_KEY') {
        toast.error('Private key could not be parsed for this family')
      } else if (e.code === 'INVALID_ADDRESS') {
        toast.error('Not a valid address for this family')
      } else if (e.code === 'NO_ADAPTER') {
        toast.error('Adapter not wired for this family')
      } else {
        toast.error(e.message || 'Import failed')
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import fee-wallet key</DialogTitle>
          <DialogDescription>
            Encrypted at rest via <span className="font-mono">secretsCipher</span>.
            The gateway cross-checks that the declared address derives from
            the private key — a mismatch is rejected at import time, no row
            is persisted.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            mut.mutate({
              family,
              privateKey: privateKey.trim(),
              address: address.trim(),
            })
          }}
        >
          <Field label="Private key" hint="Hex, with or without 0x prefix.">
            <PasswordField
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              className="font-mono"
              placeholder="0x…"
              autoFocus
            />
          </Field>
          <Field
            label="Address"
            hint="Canonical form for the family; must match the private key's derived address."
          >
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono"
              placeholder={
                family === 'evm'
                  ? '0x…'
                  : family === 'tron'
                    ? 'T…'
                    : 'base58…'
              }
              required
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mut.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                mut.isPending ||
                privateKey.trim().length < 16 ||
                address.trim().length < 8
              }
            >
              {mut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {mut.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── remove dialog ───────────────────────────────────────── */

function DeleteDialog({
  open,
  onOpenChange,
  family,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  family: Family
  onDone: () => void
}) {
  const mut = useMutation({
    mutationFn: () =>
      api<{ removed: boolean }>(`/api/gw/admin/fee-wallets/${family}`, {
        method: 'DELETE',
      }),
    onSuccess: (res) => {
      toast.success(
        res.removed ? `Fee wallet removed for ${family}` : 'No row to remove',
      )
      onDone()
      onOpenChange(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Remove failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove fee wallet</DialogTitle>
          <DialogDescription>
            The planner immediately falls back to self-pay / sponsor-topup on
            the next plan; in-flight payouts are unaffected.
          </DialogDescription>
        </DialogHeader>
        {family === 'tron' && (
          <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Removing does <strong>not</strong> unfreeze staked TRX or unsend
              delegations. Call undelegate + unfreeze first or funds stay locked
              on-chain.
            </span>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mut.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {mut.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Tron-specific section ───────────────────────────────── */

function TronSection({ tronEntry }: { tronEntry: FeeWalletEntry | null }) {
  const configured = !!tronEntry?.configured
  const qc = useQueryClient()
  const invalidateResources = () =>
    qc.invalidateQueries({ queryKey: TRON_RESOURCES_Q })

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: FAMILY_COLOR.tron }}
          />
          <CardTitle>Tron Stake 2.0</CardTitle>
        </div>
        <CardDescription>
          Freeze TRX on the fee wallet to generate ENERGY / BANDWIDTH, then
          delegate those resources to pool addresses so USDT payouts don't burn
          TRX for energy. Delegate first, undelegate before unfreeze — Tron
          rejects an unfreeze that would leave active delegations unfunded.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {!configured ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-xs text-[var(--fg-2)]">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Register a Tron fee wallet above to unlock staking + delegation
              operations.
            </span>
          </div>
        ) : (
          <div className="space-y-5">
            <TronResources />
            <div className="grid gap-4 md:grid-cols-2">
              <TronStakeForms onDone={invalidateResources} />
              <TronDelegationForms onDone={invalidateResources} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TronResources() {
  const q = useQuery({
    queryKey: TRON_RESOURCES_Q,
    queryFn: () =>
      api<TronFeeWalletResources>('/api/gw/admin/fee-wallets/tron/resources'),
    refetchInterval: 30_000,
  })

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }
  if (q.isError) {
    const err = q.error as ApiError
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="size-3.5" />
        {err?.code === 'NO_FEE_WALLET'
          ? 'Tron fee wallet is not registered yet.'
          : err?.code === 'NO_TRON_ADAPTER'
            ? 'Tron adapter is not wired on this deployment.'
            : err?.message || 'Could not load Tron resource budget.'}
      </div>
    )
  }

  const res = q.data!
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--fg-2)]">Fee wallet</span>
          <Addr value={res.feeWallet} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw
            className={`size-3.5 ${q.isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ResourceBar
          icon={<Zap className="size-4 text-warn" />}
          label="Energy"
          available={res.resources.energyAvailable}
          limit={res.resources.energyLimit}
        />
        <ResourceBar
          icon={<Network className="size-4 text-primary" />}
          label="Bandwidth"
          available={res.resources.bandwidthAvailable}
          limit={res.resources.bandwidthLimit}
        />
      </div>
    </div>
  )
}

function ResourceBar({
  icon,
  label,
  available,
  limit,
}: {
  icon: React.ReactNode
  label: string
  available: number
  limit: number
}) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (available / limit) * 100)) : 0
  const tone =
    pct < 15 ? 'bg-destructive' : pct < 40 ? 'bg-warn' : 'bg-success'
  return (
    <div className="rounded-md border border-border bg-[var(--bg-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className="font-mono text-xs text-[var(--fg-2)]">
          {available.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-3,var(--bg-2))] ring-1 ring-border">
        <div
          className={`h-full ${tone} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10.5px] uppercase tracking-wider text-[var(--fg-3)]">
        {pct.toFixed(0)}% available
      </div>
    </div>
  )
}

/* ── freeze / unfreeze ───────────────────────────────────── */

const SUN_PER_TRX = 1_000_000n

function trxToSun(trx: string): bigint | null {
  const s = trx.trim()
  if (!s) return null
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [intPart, fracPart = ''] = s.split('.')
  const frac = (fracPart + '000000').slice(0, 6)
  try {
    const sun = BigInt(intPart) * SUN_PER_TRX + BigInt(frac || '0')
    return sun
  } catch {
    return null
  }
}

function sunToTrxDisplay(sun: bigint): string {
  const whole = sun / SUN_PER_TRX
  const frac = sun % SUN_PER_TRX
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}.${fracStr}`
}

function TronStakeForms({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = React.useState<'freeze' | 'unfreeze'>('freeze')
  const [trxAmount, setTrxAmount] = React.useState('')
  const [resource, setResource] = React.useState<TronResource>('ENERGY')

  const sun = trxToSun(trxAmount)
  const sunValid = sun != null && sun >= SUN_PER_TRX

  type StakeResponse = {
    txHash: string
    balance: number
    resource: TronResource
  }

  const mut = useMutation({
    mutationFn: () => {
      if (sun == null) throw new ApiError('Enter a valid TRX amount', 400)
      return api<StakeResponse>(
        `/api/gw/admin/fee-wallets/tron/${mode}`,
        {
          method: 'POST',
          body: JSON.stringify({ balance: Number(sun), resource }),
        },
      )
    },
    onSuccess: (res) => {
      toast.success(
        mode === 'freeze'
          ? `Staked ${sunToTrxDisplay(BigInt(res.balance))} TRX for ${res.resource}`
          : `Unstake broadcast (14-day cooldown): ${sunToTrxDisplay(BigInt(res.balance))} TRX`,
        { description: res.txHash },
      )
      setTrxAmount('')
      onDone()
    },
    onError: (e: ApiError) => toast.error(e.message || `${mode} failed`),
  })

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {mode === 'freeze' ? (
              <Snowflake className="size-4 text-primary" />
            ) : (
              <Sun className="size-4 text-warn" />
            )}
            {mode === 'freeze' ? 'Stake TRX' : 'Unstake TRX'}
          </div>
          <div className="flex rounded-md border border-border bg-[var(--bg-2)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('freeze')}
              className={`cursor-pointer rounded px-2.5 py-1 ${mode === 'freeze' ? 'bg-card font-medium shadow-xs' : 'text-[var(--fg-2)]'}`}
            >
              Freeze
            </button>
            <button
              type="button"
              onClick={() => setMode('unfreeze')}
              className={`cursor-pointer rounded px-2.5 py-1 ${mode === 'unfreeze' ? 'bg-card font-medium shadow-xs' : 'text-[var(--fg-2)]'}`}
            >
              Unfreeze
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          {mode === 'freeze'
            ? 'Converts spendable TRX into staked TRX, generating daily resource allowance.'
            : '14-day unlock before TRX becomes withdrawable. Undelegate active loans first.'}
        </p>
      </div>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          mut.mutate()
        }}
      >
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field
            label="Amount (TRX)"
            hint={
              sun != null
                ? `${sun.toString()} sun`
                : 'Minimum 1 TRX.'
            }
          >
            <Input
              value={trxAmount}
              onChange={(e) => setTrxAmount(e.target.value)}
              inputMode="decimal"
              className="font-mono"
              placeholder="100"
            />
          </Field>
          <Field label="Resource">
            <Select
              value={resource}
              onValueChange={(v) => setResource(v as TronResource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ENERGY">ENERGY</SelectItem>
                <SelectItem value="BANDWIDTH">BANDWIDTH</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          type="submit"
          disabled={!sunValid || mut.isPending}
          className="w-full"
        >
          {mut.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : mode === 'freeze' ? (
            <Snowflake className="size-3.5" />
          ) : (
            <Sun className="size-3.5" />
          )}
          {mut.isPending
            ? 'Broadcasting…'
            : mode === 'freeze'
              ? `Stake ${fmtNum(trxAmount || '0')} TRX`
              : `Unstake ${fmtNum(trxAmount || '0')} TRX`}
        </Button>
      </form>
    </div>
  )
}

/* ── delegate / undelegate ───────────────────────────────── */

function TronDelegationForms({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = React.useState<'delegate' | 'undelegate'>('delegate')
  const [receiver, setReceiver] = React.useState('')
  const [trxAmount, setTrxAmount] = React.useState('')
  const [resource, setResource] = React.useState<TronResource>('ENERGY')
  const [lock, setLock] = React.useState(false)

  const sun = trxToSun(trxAmount)
  const sunValid = sun != null && sun >= SUN_PER_TRX
  const receiverValid = receiver.trim().length >= 8

  type DelegateResponse = {
    txHash: string
    receiver: string
    balance: number
    resource: TronResource
    lock?: boolean
    receiverIsInPool?: boolean
  }

  const mut = useMutation({
    mutationFn: () => {
      if (sun == null) throw new ApiError('Enter a valid TRX amount', 400)
      const body: Record<string, unknown> = {
        receiver: receiver.trim(),
        balance: Number(sun),
        resource,
      }
      if (mode === 'delegate') body.lock = lock
      return api<DelegateResponse>(
        `/api/gw/admin/fee-wallets/tron/${mode}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )
    },
    onSuccess: (res) => {
      if (mode === 'delegate') {
        toast.success(
          `Delegated ${sunToTrxDisplay(BigInt(res.balance))} TRX of ${res.resource}`,
          {
            description: res.receiverIsInPool
              ? 'Receiver is a pool address.'
              : 'Receiver is not in the pool.',
          },
        )
      } else {
        toast.success(
          `Undelegated ${sunToTrxDisplay(BigInt(res.balance))} TRX of ${res.resource}`,
          { description: res.txHash },
        )
      }
      setTrxAmount('')
      onDone()
    },
    onError: (e: ApiError) => toast.error(e.message || `${mode} failed`),
  })

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {mode === 'delegate' ? (
              <Share2 className="size-4 text-primary" />
            ) : (
              <Download className="size-4 text-warn" />
            )}
            {mode === 'delegate' ? 'Delegate resources' : 'Undelegate resources'}
          </div>
          <div className="flex rounded-md border border-border bg-[var(--bg-2)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('delegate')}
              className={`cursor-pointer rounded px-2.5 py-1 ${mode === 'delegate' ? 'bg-card font-medium shadow-xs' : 'text-[var(--fg-2)]'}`}
            >
              Delegate
            </button>
            <button
              type="button"
              onClick={() => setMode('undelegate')}
              className={`cursor-pointer rounded px-2.5 py-1 ${mode === 'undelegate' ? 'bg-card font-medium shadow-xs' : 'text-[var(--fg-2)]'}`}
            >
              Undelegate
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          {mode === 'delegate'
            ? "Lends staked resources so the receiver's txs consume them instead of burning TRX."
            : 'Returns delegated stake to the fee wallet. Required before unfreeze.'}
        </p>
      </div>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          mut.mutate()
        }}
      >
        <Field
          label="Receiver (base58)"
          hint={
            mode === 'delegate'
              ? 'Typically a pool address — the handler reports receiverIsInPool.'
              : 'Must match the original delegation target.'
          }
        >
          <Input
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder="T…"
            className="font-mono"
            required
          />
        </Field>
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field label="Stake amount (TRX)">
            <Input
              value={trxAmount}
              onChange={(e) => setTrxAmount(e.target.value)}
              inputMode="decimal"
              className="font-mono"
              placeholder="100"
            />
          </Field>
          <Field label="Resource">
            <Select
              value={resource}
              onValueChange={(v) => setResource(v as TronResource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ENERGY">ENERGY</SelectItem>
                <SelectItem value="BANDWIDTH">BANDWIDTH</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {mode === 'delegate' && (
          <label className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => setLock(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <div>
              <div className="font-medium text-foreground">Lock 3 days</div>
              <div className="text-[var(--fg-2)]">
                Delegation cannot be reclaimed for 3 days when locked.
              </div>
            </div>
          </label>
        )}
        <Button
          type="submit"
          disabled={!receiverValid || !sunValid || mut.isPending}
          className="w-full"
        >
          {mut.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : mode === 'delegate' ? (
            <Share2 className="size-3.5" />
          ) : (
            <Download className="size-3.5" />
          )}
          {mut.isPending
            ? 'Broadcasting…'
            : mode === 'delegate'
              ? 'Delegate'
              : 'Undelegate'}
        </Button>
      </form>
    </div>
  )
}

/* ── skeletons ───────────────────────────────────────────── */

function FamilyCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-14 w-full" />
          <Skeleton className="mt-4 h-8 w-36" />
        </Card>
      ))}
    </div>
  )
}


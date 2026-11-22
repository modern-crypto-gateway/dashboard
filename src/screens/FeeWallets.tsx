import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Download,
  Fuel,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Network,
  Pickaxe,
  RefreshCw,
  Share2,
  Snowflake,
  Sun,
  Trash2,
  Upload,
  WalletIcon,
  Zap,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  Family,
  FeeWalletCapability,
  FeeWalletEntry,
  TronFeeWalletResources,
  TronResource,
} from '@/lib/types'

import { Segmented, SegmentedBar } from '@/components/charts'
import { Addr } from '@/components/Addr'
import { ChainIcon, FamilyIcon } from '@/components/CryptoIcon'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { PasswordField } from '@/components/PasswordField'
import { Badge } from '@/components/ui/badge'
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

const FEE_WALLETS_Q = ['gw', 'fee-wallets'] as const

/** Explorer chain for a family's fee-wallet address (single-chain families only). */
const FAMILY_CHAIN: Partial<Record<Family, number>> = {
  tron: 728,
  solana: 900,
  monero: 1000,
}
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
  const entries = q.data?.feeWallets ?? []

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Fee wallets"
        description="Per-family gas providers"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <SummaryTiles entries={entries} loading={q.isLoading} />

      {q.isError && (
        <ErrorState
          title="Could not load fee wallets"
          message={
            (q.error as ApiError)?.message ||
            'Could not load fee-wallet config. Check admin key in settings.'
          }
        />
      )}

      {q.isLoading ? (
        <FamilyCardsSkeleton />
      ) : entries.length === 0 ? (
        !q.isError && (
          <EmptyState framed icon={WalletIcon} title="No families reported" />
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <FamilyCard key={entry.family} entry={entry} onChanged={refresh} />
          ))}
        </div>
      )}

      {!q.isLoading && (
        <TronSection
          tronEntry={q.data?.feeWallets.find((e) => e.family === 'tron') ?? null}
        />
      )}
    </div>
  )
}

/* ── summary ─────────────────────────────────────────────── */

function SummaryTiles({
  entries,
  loading,
}: {
  entries: FeeWalletEntry[]
  loading: boolean
}) {
  const supported = entries.filter((e) => e.capability !== 'none')
  const configured = supported.filter((e) => e.configured).length
  const missing = supported.length - configured
  const imported = entries.filter((e) => e.configured?.mode === 'imported').length
  const pool = entries.filter((e) => e.configured?.mode === 'hd-pool').length
  return (
    <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
      <StatTile
        label="Configured"
        loading={loading}
        value={
          <>
            {configured}
            <span className="text-[var(--fg-3)]">/{supported.length}</span>
          </>
        }
        footer={
          <SegmentedBar
            parts={[
              { key: 'set', name: 'Configured', value: configured, color: 'var(--st-ok-dot)' },
              { key: 'missing', name: 'Not set', value: missing, color: 'var(--st-warn-dot)' },
            ]}
          />
        }
      />
      <StatTile
        label="Not set"
        loading={loading}
        value={missing}
        badge={
          missing > 0 ? (
            <StatusPill tone="warn">Self-funded gas</StatusPill>
          ) : (
            <StatusPill tone="ok">All set</StatusPill>
          )
        }
        sub="Supported families"
      />
      <StatTile
        label="Imported keys"
        loading={loading}
        value={imported}
        sub={`${pool} from HD pool`}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  badge,
  footer,
  loading,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  badge?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--fg-2)]">{label}</span>
        {!loading && badge}
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--fg-2)]">{sub}</div>}
      {footer && !loading && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
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
    <Card className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FamilyIcon family={entry.family} size={32} />
          <div className="min-w-0">
            <div className="text-lg font-semibold uppercase tracking-[0.02em]">
              {entry.family}
            </div>
            <CapabilityBadge capability={entry.capability} />
          </div>
        </div>
        <FamilyStatus supported={supported} configured={!!configured} />
      </div>

      <div className="mt-5 flex-1">
        {!supported ? (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
            <Fuel className="size-4 shrink-0" />
            Gas paid from each pool address.
          </div>
        ) : configured ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-[var(--bg-2)] py-2 pr-2 pl-3.5">
            <Addr
              value={configured.address}
              chainId={FAMILY_CHAIN[entry.family]}
              className="flex-1"
            />
            <Badge variant="outline" title="Key source">
              {configured.mode === 'imported' ? (
                <KeyRound className="size-3" />
              ) : (
                <Pickaxe className="size-3" />
              )}
              {configured.mode}
            </Badge>
          </div>
        ) : (
          <Callout tone="warn" className="px-3.5 py-2.5 text-xs">
            No fee wallet registered. Pool addresses must self-fund gas until
            one is configured.
          </Callout>
        )}
      </div>

      {supported && (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {!configured && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUsePoolOpen(true)}
              >
                <Pickaxe className="size-4" /> Use pool address
              </Button>
              <Button size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" /> Import key
              </Button>
            </>
          )}
          {configured && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
      )}

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

const CAPABILITY_TITLE: Record<FeeWalletCapability, string> = {
  'co-sign': 'Fee wallet signs every payout as feePayer',
  delegate: 'Fee wallet stakes native + delegates resources to pool addresses',
  'top-up':
    'Fee wallet sits in the gas top-up sponsor pool — funds the source’s native top-up tx; the source still burns native for the payout',
  none: 'No fee-wallet topology supported today',
}

function CapabilityBadge({ capability }: { capability: FeeWalletCapability }) {
  return (
    <span
      title={CAPABILITY_TITLE[capability]}
      className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--fg-2)]"
    >
      <Info className="size-3.5" />
      {capability === 'none' ? 'No capability' : capability}
    </span>
  )
}

function FamilyStatus({
  supported,
  configured,
}: {
  supported: boolean
  configured: boolean
}) {
  if (!supported) return <StatusPill tone="off">n/a</StatusPill>
  if (configured) return <StatusPill tone="ok">Configured</StatusPill>
  return <StatusPill tone="warn">Not set</StatusPill>
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
  // Reset form on every closed → open transition without an effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setAddress('')
  }

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
          <DialogTitle className="flex items-center gap-2">
            <FamilyIcon family={family} size={20} />
            Register pool address as fee wallet
          </DialogTitle>
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
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Pickaxe className="size-4" />
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
  // Reset form on every closed → open transition without an effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setPrivateKey('')
      setAddress('')
    }
  }

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
          <DialogTitle className="flex items-center gap-2">
            <FamilyIcon family={family} size={20} />
            Import fee-wallet key
          </DialogTitle>
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
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
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
          <DialogTitle className="flex items-center gap-2">
            <FamilyIcon family={family} size={20} />
            Remove fee wallet
          </DialogTitle>
          <DialogDescription>
            The planner immediately falls back to self-pay / sponsor-topup on
            the next plan; in-flight payouts are unaffected.
          </DialogDescription>
        </DialogHeader>
        {family === 'tron' && (
          <Callout tone="warn">
            Removing does <strong>not</strong> unfreeze staked TRX or unsend
            delegations. Call undelegate + unfreeze first or funds stay locked
            on-chain.
          </Callout>
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
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
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
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <ChainIcon chainId={728} size={32} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Tron Stake 2.0</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-pretty text-[var(--fg-2)]">
            Freeze TRX on the fee wallet to generate ENERGY / BANDWIDTH, then
            delegate those resources to pool addresses so USDT payouts don't burn
            TRX for energy. Delegate first, undelegate before unfreeze — Tron
            rejects an unfreeze that would leave active delegations unfunded.
          </p>
        </div>
      </div>

      {!configured ? (
        <EmptyState
          framed
          compact
          icon={Snowflake}
          title="No Tron fee wallet"
          description="Register a Tron fee wallet above to unlock staking + delegation operations."
        />
      ) : (
        <div className="space-y-5">
          <TronResources />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TronStakeForms onDone={invalidateResources} />
            <TronDelegationForms onDone={invalidateResources} />
          </div>
        </div>
      )}
    </section>
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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    )
  }
  if (q.isError) {
    const err = q.error as ApiError
    return (
      <Callout tone="danger">
        {err?.code === 'NO_FEE_WALLET'
          ? 'Tron fee wallet is not registered yet.'
          : err?.code === 'NO_TRON_ADAPTER'
            ? 'Tron adapter is not wired on this deployment.'
            : err?.message || 'Could not load Tron resource budget.'}
      </Callout>
    )
  }

  const res = q.data!
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <ResourceMeter
        icon={Zap}
        label="Energy"
        available={res.resources.energyAvailable}
        limit={res.resources.energyLimit}
        feeWallet={res.feeWallet}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
      />
      <ResourceMeter
        icon={Network}
        label="Bandwidth"
        available={res.resources.bandwidthAvailable}
        limit={res.resources.bandwidthLimit}
      />
    </div>
  )
}

function ResourceMeter({
  icon: Icon,
  label,
  available,
  limit,
  feeWallet,
  onRefresh,
  refreshing,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  available: number
  limit: number
  feeWallet?: string
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (available / limit) * 100)) : 0
  const color =
    pct < 15 ? 'var(--st-bad-dot)' : pct < 40 ? 'var(--st-warn-dot)' : 'var(--st-ok-dot)'
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm text-[var(--fg-2)]">
          <Icon className="size-4" />
          {label}
        </span>
        {onRefresh ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh resources"
            title="Refresh"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
        ) : (
          <span className="h-8" />
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="figure text-xl font-semibold">{available.toLocaleString()}</span>
        <span className="figure text-sm text-[var(--fg-2)]">/ {limit.toLocaleString()}</span>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--chart-muted)]"
        role="meter"
        aria-label={`${label} available`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--fg-2)]">
        <span>
          <span className="figure text-foreground">{pct.toFixed(0)}%</span> available
        </span>
        {feeWallet && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <WalletIcon className="size-3.5 shrink-0" />
            <Addr value={feeWallet} chainId={728} />
          </span>
        )}
      </div>
    </Card>
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

/** Card shell shared by the two Tron operation forms. */
function OpCard({
  icon: Icon,
  title,
  note,
  toggle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  note: string
  toggle: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
            <Icon className="size-4" />
          </span>
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{title}</h3>
        </div>
        {toggle}
      </div>
      <p className="mt-2 text-sm text-[var(--fg-2)]">{note}</p>
      <div className="mt-5">{children}</div>
    </Card>
  )
}

function ResourceSelect({
  value,
  onChange,
}: {
  value: TronResource
  onChange: (v: TronResource) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TronResource)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ENERGY">
          <Zap className="size-4" /> ENERGY
        </SelectItem>
        <SelectItem value="BANDWIDTH">
          <Network className="size-4" /> BANDWIDTH
        </SelectItem>
      </SelectContent>
    </Select>
  )
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
    <OpCard
      icon={mode === 'freeze' ? Snowflake : Sun}
      title={mode === 'freeze' ? 'Stake TRX' : 'Unstake TRX'}
      note={
        mode === 'freeze'
          ? 'Converts spendable TRX into staked TRX, generating daily resource allowance.'
          : '14-day unlock before TRX becomes withdrawable. Undelegate active loans first.'
      }
      toggle={
        <Segmented<'freeze' | 'unfreeze'>
          ariaLabel="Stake mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'freeze', label: 'Freeze' },
            { value: 'unfreeze', label: 'Unfreeze' },
          ]}
        />
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          mut.mutate()
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
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
              className="figure"
              placeholder="100"
            />
          </Field>
          <Field label="Resource">
            <ResourceSelect value={resource} onChange={setResource} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!sunValid || mut.isPending}>
            {mut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === 'freeze' ? (
              <Snowflake className="size-4" />
            ) : (
              <Sun className="size-4" />
            )}
            {mut.isPending
              ? 'Broadcasting…'
              : mode === 'freeze'
                ? `Stake ${fmtNum(trxAmount || '0')} TRX`
                : `Unstake ${fmtNum(trxAmount || '0')} TRX`}
          </Button>
        </div>
      </form>
    </OpCard>
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
    <OpCard
      icon={mode === 'delegate' ? Share2 : Download}
      title={mode === 'delegate' ? 'Delegate resources' : 'Undelegate resources'}
      note={
        mode === 'delegate'
          ? "Lends staked resources so the receiver's txs consume them instead of burning TRX."
          : 'Returns delegated stake to the fee wallet. Required before unfreeze.'
      }
      toggle={
        <Segmented<'delegate' | 'undelegate'>
          ariaLabel="Delegation mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'delegate', label: 'Delegate' },
            { value: 'undelegate', label: 'Undelegate' },
          ]}
        />
      }
    >
      <form
        className="space-y-5"
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
          <Field label="Stake amount (TRX)">
            <Input
              value={trxAmount}
              onChange={(e) => setTrxAmount(e.target.value)}
              inputMode="decimal"
              className="figure"
              placeholder="100"
            />
          </Field>
          <Field label="Resource">
            <ResourceSelect value={resource} onChange={setResource} />
          </Field>
        </div>
        {mode === 'delegate' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => setLock(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <div>
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Lock className="size-3.5" /> Lock 3 days
              </div>
              <div className="text-xs text-[var(--fg-2)]">
                Delegation cannot be reclaimed for 3 days when locked.
              </div>
            </div>
          </label>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!receiverValid || !sunValid || mut.isPending}
          >
            {mut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === 'delegate' ? (
              <Share2 className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
            {mut.isPending
              ? 'Broadcasting…'
              : mode === 'delegate'
                ? 'Delegate'
                : 'Undelegate'}
          </Button>
        </div>
      </form>
    </OpCard>
  )
}

/* ── skeletons ───────────────────────────────────────────── */

function FamilyCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="mt-5 h-10 w-full rounded-xl" />
          <Skeleton className="mt-5 ml-auto h-8 w-36" />
        </Card>
      ))}
    </div>
  )
}

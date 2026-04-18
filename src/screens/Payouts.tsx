import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUpDown, ExternalLink, Plus, RefreshCw, Search } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { truncateAddr } from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import type { GatewayPayout, TrackedPayout } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { StatusBadge } from './Invoices'

const payoutsQueryKey = (merchantId?: string) =>
  ['payouts', 'list', merchantId ?? null] as const

export function PayoutsPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const list = useQuery({
    enabled: !!active,
    queryKey: payoutsQueryKey(active?.id),
    queryFn: () =>
      api<{ payouts: TrackedPayout[] }>(
        `/api/mg/${encodeURIComponent(active!.id)}/payouts`,
      ),
    refetchInterval: 30_000,
  })

  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const openDetail = (id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }

  if (merchants.isLoading) {
    return <div className="p-6 text-sm text-[var(--fg-2)]">Loading…</div>
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchantsCard />
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payouts</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Plan payouts and watch them land. The gateway signs + broadcasts on its
            own schedule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MerchantSwitcher />
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching || !active}
          >
            <RefreshCw className={'size-3.5' + (list.isFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
          <LookupPayoutDialog merchantId={active?.id} onOpenDetail={openDetail} />
          <CreatePayoutDialog merchantId={active?.id} onOpenDetail={openDetail} />
        </div>
      </div>

      {list.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : (list.data?.payouts.length ?? 0) === 0 ? (
        <EmptyPayoutsCard />
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <Th>Payout</Th>
                  <Th>Chain</Th>
                  <Th>Token</Th>
                  <Th>Amount (raw)</Th>
                  <Th>Destination</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data!.payouts.map((po) => (
                  <tr
                    key={po.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-2)]"
                    onClick={() => openDetail(po.id)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px]">
                          {truncateAddr(po.id, 8, 6)}
                        </span>
                        <CopyButton value={po.id} />
                      </div>
                    </Td>
                    <Td>
                      <ChainPill chainId={po.chainId} />
                    </Td>
                    <Td className="font-mono text-[12.5px]">{po.token}</Td>
                    <Td className="font-mono text-[12.5px]">{po.amountRaw}</Td>
                    <Td>
                      <Addr value={po.destinationAddress} />
                    </Td>
                    <Td>
                      <StatusBadge status={po.status} />
                    </Td>
                    <Td className="font-mono text-xs text-[var(--fg-2)]">
                      {formatRelative(po.updatedAt)}
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(po.id)
                        }}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {detailId && active && (
        <PayoutDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          merchantId={active.id}
          payoutId={detailId}
        />
      )}
    </div>
  )
}

function NoMerchantsCard() {
  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">Money</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Payouts</h1>
      </div>
      <Card className="p-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
          <ArrowUpDown className="size-5 text-[var(--fg-2)]" />
        </div>
        <div className="mt-3 text-sm text-[var(--fg-1)]">Add a merchant first.</div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          Payouts are scoped to a merchant's API key.
        </p>
      </Card>
    </div>
  )
}

function EmptyPayoutsCard() {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <ArrowUpDown className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">No payouts tracked yet.</div>
      <p className="mt-1 text-xs text-[var(--fg-2)]">
        Plan a new payout or look one up by id.
      </p>
    </Card>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="border-b border-border bg-card px-3.5 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-[var(--fg-2)]">
      {children}
    </th>
  )
}
function Td({
  children,
  className = '',
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td className={'border-b border-border px-3.5 py-2.5 align-middle ' + className}>
      {children}
    </td>
  )
}

function ChainPill({ chainId }: { chainId: number }) {
  const info = chainInfo(chainId)
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]">
      <span
        className="size-[7px] rounded-full"
        style={{ background: info.color }}
      />
      {info.name}
    </span>
  )
}

function formatRelative(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/* ── Create payout ─────────────────────────────────────── */

function CreatePayoutDialog({
  merchantId,
  onOpenDetail,
}: {
  merchantId?: string
  onOpenDetail: (id: string) => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [chainId, setChainId] = React.useState('1')
  const [token, setToken] = React.useState('USDC')
  const [amountRaw, setAmountRaw] = React.useState('')
  const [destinationAddress, setDestinationAddress] = React.useState('')

  const create = useMutation({
    mutationFn: () =>
      api<{ payout: { id: string } }>(
        `/api/mg/${encodeURIComponent(merchantId!)}/payouts`,
        {
          method: 'POST',
          body: JSON.stringify({
            chainId: parseInt(chainId, 10),
            token: token.toUpperCase(),
            amountRaw,
            destinationAddress,
          }),
        },
      ),
    onSuccess: (res) => {
      toast.success('Payout planned')
      qc.invalidateQueries({ queryKey: payoutsQueryKey(merchantId) })
      setOpen(false)
      setAmountRaw('')
      setDestinationAddress('')
      onOpenDetail(res.payout.id)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not plan payout'),
  })

  const canSubmit =
    !!merchantId &&
    /^\d+$/.test(chainId) &&
    /^[A-Z0-9]+$/.test(token) &&
    /^\d+$/.test(amountRaw) &&
    destinationAddress.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!merchantId}>
          <Plus className="size-3.5" /> Plan payout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan payout</DialogTitle>
          <DialogDescription>
            Creates the payout in <span className="font-mono">planned</span>{' '}
            state. The gateway will reserve a fee wallet, sign, and broadcast on
            its next scheduler tick.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chain ID">
              <Input
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
            <Field label="Token">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase())}
                className="font-mono"
              />
            </Field>
          </div>
          <Field label="Amount (raw integer, smallest units)">
            <Input
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="1000000"
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
          <Field label="Destination address">
            <Input
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder="0x…"
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? 'Planning…' : 'Plan payout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Lookup payout ─────────────────────────────────────── */

function LookupPayoutDialog({
  merchantId,
  onOpenDetail,
}: {
  merchantId?: string
  onOpenDetail: (id: string) => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState('')

  const track = useMutation({
    mutationFn: () =>
      api<{ payout: { id: string } }>(
        `/api/mg/${encodeURIComponent(merchantId!)}/payouts/track`,
        { method: 'POST', body: JSON.stringify({ id }) },
      ),
    onSuccess: (res) => {
      toast.success('Payout tracked')
      qc.invalidateQueries({ queryKey: payoutsQueryKey(merchantId) })
      setOpen(false)
      setId('')
      onOpenDetail(res.payout.id)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not look up'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!merchantId}>
          <Search className="size-3.5" /> Look up
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Look up a payout</DialogTitle>
          <DialogDescription>
            Fetch a payout by id and track it locally.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            track.mutate()
          }}
        >
          <Field label="Payout id">
            <Input
              autoFocus
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="uuid"
              className="font-mono"
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={track.isPending || !id.trim()}>
              {track.isPending ? 'Looking up…' : 'Track payout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Detail ────────────────────────────────────────────── */

function PayoutDetailDialog({
  open,
  onOpenChange,
  merchantId,
  payoutId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  merchantId: string
  payoutId: string
}) {
  const detail = useQuery({
    enabled: open,
    queryKey: ['payout', merchantId, payoutId] as const,
    queryFn: () =>
      api<{ payout: GatewayPayout }>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts/${encodeURIComponent(payoutId)}`,
      ),
    refetchInterval: open ? 10_000 : false,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payout detail</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{payoutId}</span>
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <div className="py-8 text-center text-sm text-[var(--fg-2)]">Loading…</div>
        ) : !detail.data ? (
          <div className="py-8 text-center text-sm text-destructive">
            {detail.error instanceof Error ? detail.error.message : 'Not found'}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="Status">
                <StatusBadge status={detail.data.payout.status} />
              </FieldRow>
              <FieldRow label="Chain">
                <ChainPill chainId={detail.data.payout.chainId} />
              </FieldRow>
              <FieldRow label="Token">
                <span className="font-mono">{detail.data.payout.token}</span>
              </FieldRow>
              <FieldRow label="Amount (raw)">
                <span className="font-mono">{detail.data.payout.amountRaw}</span>
              </FieldRow>
              <FieldRow label="Destination">
                <Addr value={detail.data.payout.destinationAddress} truncated={false} />
              </FieldRow>
              <FieldRow label="Source">
                {detail.data.payout.sourceAddress ? (
                  <Addr value={detail.data.payout.sourceAddress} />
                ) : (
                  <span className="text-[var(--fg-2)]">—</span>
                )}
              </FieldRow>
              <FieldRow label="Tx hash">
                {detail.data.payout.txHash ? (
                  <Addr value={detail.data.payout.txHash} />
                ) : (
                  <span className="text-[var(--fg-2)]">pending</span>
                )}
              </FieldRow>
              <FieldRow label="Fee estimate (native)">
                <span className="font-mono">
                  {detail.data.payout.feeEstimateNative ?? '—'}
                </span>
              </FieldRow>
              <FieldRow label="Created">
                <span className="font-mono text-xs">
                  {new Date(detail.data.payout.createdAt).toISOString().slice(0, 19)}Z
                </span>
              </FieldRow>
              <FieldRow label="Confirmed">
                <span className="font-mono text-xs">
                  {detail.data.payout.confirmedAt
                    ? new Date(detail.data.payout.confirmedAt)
                        .toISOString()
                        .slice(0, 19) + 'Z'
                    : '—'}
                </span>
              </FieldRow>
            </div>
            {detail.data.payout.lastError && (
              <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-destructive">
                <div className="font-semibold">last error</div>
                <div className="font-mono">{detail.data.payout.lastError}</div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

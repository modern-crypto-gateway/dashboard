import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, RefreshCw, FileText, ExternalLink, X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtUsd, fmtNum, truncateAddr } from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import type {
  Family,
  InvoiceDetails,
  TrackedInvoice,
} from '@/lib/types'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const invoicesQueryKey = (merchantId?: string) =>
  ['invoices', 'list', merchantId ?? null] as const

export function InvoicesPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()

  const list = useQuery({
    enabled: !!active,
    queryKey: invoicesQueryKey(active?.id),
    queryFn: () =>
      api<{ invoices: TrackedInvoice[] }>(
        `/api/mg/${encodeURIComponent(active!.id)}/invoices`,
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Create, look up, and force-expire invoices for the selected merchant.
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
          <LookupInvoiceDialog merchantId={active?.id} onOpenDetail={openDetail} />
          <CreateInvoiceDialog merchantId={active?.id} onOpenDetail={openDetail} />
        </div>
      </div>

      {list.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : (list.data?.invoices.length ?? 0) === 0 ? (
        <EmptyInvoicesCard />
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Chain</Th>
                  <Th>Token</Th>
                  <Th>Amount</Th>
                  <Th>External</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data!.invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-2)]"
                    onClick={() => openDetail(inv.id)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px]">
                          {truncateAddr(inv.id, 8, 6)}
                        </span>
                        <CopyButton value={inv.id} />
                      </div>
                    </Td>
                    <Td>
                      <ChainPill chainId={inv.chainId} />
                    </Td>
                    <Td className="font-mono text-[12.5px]">{inv.token}</Td>
                    <Td className="font-mono text-[12.5px]">{inv.amountSpec}</Td>
                    <Td className="font-mono text-[12.5px] text-[var(--fg-2)]">
                      {inv.externalId ?? '—'}
                    </Td>
                    <Td>
                      <StatusBadge status={inv.status} />
                    </Td>
                    <Td className="font-mono text-xs text-[var(--fg-2)]">
                      {formatRelative(inv.updatedAt)}
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(inv.id)
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
        <InvoiceDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          merchantId={active.id}
          invoiceId={detailId}
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
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Invoices</h1>
      </div>
      <Card className="p-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
          <FileText className="size-5 text-[var(--fg-2)]" />
        </div>
        <div className="mt-3 text-sm text-[var(--fg-1)]">
          Add a merchant first.
        </div>
        <p className="mt-1 text-xs text-[var(--fg-2)]">
          Invoices are issued against a merchant's API key — head to Merchants to create or import one.
        </p>
      </Card>
    </div>
  )
}

function EmptyInvoicesCard() {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <FileText className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">
        No invoices tracked yet.
      </div>
      <p className="mt-1 text-xs text-[var(--fg-2)]">
        Create a new one or look one up by id.
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

export function StatusBadge({ status }: { status: string }) {
  const variant = (() => {
    switch (status) {
      case 'confirmed':
        return 'success' as const
      case 'overpaid':
        return 'accent' as const
      case 'detected':
      case 'partial':
        return 'warn' as const
      case 'expired':
      case 'canceled':
      case 'failed':
      case 'reverted':
        return 'danger' as const
      default:
        return 'default' as const
    }
  })()
  return <Badge variant={variant}>{status}</Badge>
}

function formatRelative(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/* ── Create Invoice ──────────────────────────────────────── */

type PricingMode = 'usd' | 'raw' | 'fiat'

interface CreateInvoiceProps {
  merchantId?: string
  onOpenDetail: (id: string) => void
}

function CreateInvoiceDialog({ merchantId, onOpenDetail }: CreateInvoiceProps) {
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<PricingMode>('usd')
  const [chainId, setChainId] = React.useState('1')
  const [token, setToken] = React.useState('USDC')
  const [amountUsd, setAmountUsd] = React.useState('10.00')
  const [amountRaw, setAmountRaw] = React.useState('')
  const [fiatAmount, setFiatAmount] = React.useState('')
  const [fiatCurrency, setFiatCurrency] = React.useState('USD')
  const [externalId, setExternalId] = React.useState('')
  const [metadataJson, setMetadataJson] = React.useState('')
  const [expiresInMinutes, setExpiresInMinutes] = React.useState('30')
  const [acceptedFamilies, setAcceptedFamilies] = React.useState<Family[]>([
    'evm',
  ])

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        chainId: parseInt(chainId, 10),
        token: token.toUpperCase(),
        expiresInMinutes: parseInt(expiresInMinutes, 10),
      }
      if (externalId) body.externalId = externalId
      if (metadataJson.trim()) {
        try {
          body.metadata = JSON.parse(metadataJson)
        } catch {
          throw new Error('metadata must be valid JSON')
        }
      }
      if (mode === 'usd') {
        body.amountUsd = amountUsd
        if (acceptedFamilies.length > 0) body.acceptedFamilies = acceptedFamilies
      } else if (mode === 'raw') {
        body.amountRaw = amountRaw
      } else {
        body.fiatAmount = fiatAmount
        body.fiatCurrency = fiatCurrency
      }
      return api<{ invoice: { id: string } }>(
        `/api/mg/${encodeURIComponent(merchantId!)}/invoices`,
        { method: 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: (res) => {
      toast.success('Invoice created')
      qc.invalidateQueries({ queryKey: invoicesQueryKey(merchantId) })
      setOpen(false)
      onOpenDetail(res.invoice.id)
    },
    onError: (e: ApiError | Error) =>
      toast.error(e.message || 'Could not create invoice'),
  })

  const canSubmit =
    !!merchantId &&
    (mode === 'usd'
      ? /^\d+(\.\d{1,8})?$/.test(amountUsd)
      : mode === 'raw'
        ? /^\d+$/.test(amountRaw)
        : /^\d+(\.\d+)?$/.test(fiatAmount) &&
          /^[A-Z]{3}$/.test(fiatCurrency)) &&
    /^\d+$/.test(chainId) &&
    /^[A-Z0-9]+$/.test(token)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!merchantId}>
          <Plus className="size-3.5" /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>
            Posts to the gateway with the selected merchant's API key. Pick
            exactly one pricing mode.
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

          <Field label="Pricing mode">
            <Select value={mode} onValueChange={(v) => setMode(v as PricingMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usd">USD-pegged (amountUsd)</SelectItem>
                <SelectItem value="raw">Raw token (amountRaw)</SelectItem>
                <SelectItem value="fiat">Fiat-quoted (fiatAmount + fiatCurrency)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {mode === 'usd' && (
            <>
              <Field label="Amount (USD)">
                <Input
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  placeholder="10.00"
                  inputMode="decimal"
                  className="font-mono"
                />
              </Field>
              <Field
                label="Accepted families"
                hint="Each accepted family gets one allocated receive address."
              >
                <div className="flex gap-2">
                  {(['evm', 'tron', 'solana'] as const).map((f) => {
                    const active = acceptedFamilies.includes(f)
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          setAcceptedFamilies((cur) =>
                            active
                              ? cur.filter((x) => x !== f)
                              : [...cur, f],
                          )
                        }
                        className={
                          'rounded-md border px-2.5 py-1 text-xs font-medium uppercase tracking-wider transition-colors cursor-pointer ' +
                          (active
                            ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary'
                            : 'border-border text-[var(--fg-2)] hover:bg-[var(--bg-hover)]')
                        }
                      >
                        {f}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </>
          )}

          {mode === 'raw' && (
            <Field label="Amount (raw integer, smallest units)">
              <Input
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="1000000"
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
          )}

          {mode === 'fiat' && (
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Field label="Fiat amount">
                <Input
                  value={fiatAmount}
                  onChange={(e) => setFiatAmount(e.target.value)}
                  placeholder="19.99"
                  className="font-mono"
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={fiatCurrency}
                  onChange={(e) => setFiatCurrency(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  maxLength={3}
                  className="font-mono"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="External ID (optional)"
              hint="Stripe-style idempotency key."
            >
              <Input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="cart-123"
                className="font-mono"
              />
            </Field>
            <Field label="Expires in (minutes)">
              <Input
                value={expiresInMinutes}
                onChange={(e) => setExpiresInMinutes(e.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Metadata (JSON, optional)"
            hint='{"orderId": "…"}'
          >
            <Textarea
              value={metadataJson}
              onChange={(e) => setMetadataJson(e.target.value)}
              placeholder='{"orderId":"42"}'
              rows={3}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Lookup by id ────────────────────────────────────────── */

function LookupInvoiceDialog({
  merchantId,
  onOpenDetail,
}: {
  merchantId?: string
  onOpenDetail: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState('')
  const qc = useQueryClient()

  const track = useMutation({
    mutationFn: () =>
      api<{ invoice: { id: string } }>(
        `/api/mg/${encodeURIComponent(merchantId!)}/invoices/track`,
        { method: 'POST', body: JSON.stringify({ id }) },
      ),
    onSuccess: (res) => {
      toast.success('Invoice tracked')
      qc.invalidateQueries({ queryKey: invoicesQueryKey(merchantId) })
      setOpen(false)
      setId('')
      onOpenDetail(res.invoice.id)
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
          <DialogTitle>Look up an invoice</DialogTitle>
          <DialogDescription>
            Fetch an invoice by its id and track it locally.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            track.mutate()
          }}
        >
          <Field label="Invoice id">
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
              {track.isPending ? 'Looking up…' : 'Track invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Detail dialog ───────────────────────────────────────── */

function InvoiceDetailDialog({
  open,
  onOpenChange,
  merchantId,
  invoiceId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  merchantId: string
  invoiceId: string
}) {
  const qc = useQueryClient()
  const detail = useQuery({
    enabled: open,
    queryKey: ['invoice', merchantId, invoiceId] as const,
    queryFn: () =>
      api<InvoiceDetails>(
        `/api/mg/${encodeURIComponent(merchantId)}/invoices/${encodeURIComponent(invoiceId)}`,
      ),
    refetchInterval: open ? 10_000 : false,
  })

  const expire = useMutation({
    mutationFn: () =>
      api(
        `/api/mg/${encodeURIComponent(merchantId)}/invoices/${encodeURIComponent(invoiceId)}/expire`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Invoice force-expired')
      qc.invalidateQueries({ queryKey: ['invoice', merchantId, invoiceId] })
      qc.invalidateQueries({ queryKey: invoicesQueryKey(merchantId) })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not expire'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Invoice detail</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{invoiceId}</span>
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
                <StatusBadge status={detail.data.invoice.status} />
              </FieldRow>
              <FieldRow label="Chain">
                <ChainPill chainId={detail.data.invoice.chainId} />
              </FieldRow>
              <FieldRow label="Token">
                <span className="font-mono">{detail.data.invoice.token}</span>
              </FieldRow>
              <FieldRow label="External ID">
                <span className="font-mono">
                  {detail.data.invoice.externalId ?? '—'}
                </span>
              </FieldRow>
              <FieldRow label="Required">
                <span className="font-mono">
                  {detail.data.invoice.amountUsd
                    ? fmtUsd(detail.data.invoice.amountUsd)
                    : detail.data.invoice.requiredAmountRaw}
                </span>
              </FieldRow>
              <FieldRow label="Received">
                <span className="font-mono">
                  {detail.data.invoice.paidUsd
                    ? fmtUsd(detail.data.invoice.paidUsd)
                    : detail.data.invoice.receivedAmountRaw}
                </span>
              </FieldRow>
              <FieldRow label="Created">
                <span className="font-mono text-xs">
                  {new Date(detail.data.invoice.createdAt).toISOString().slice(0, 19)}Z
                </span>
              </FieldRow>
              <FieldRow label="Expires">
                <span className="font-mono text-xs">
                  {new Date(detail.data.invoice.expiresAt).toISOString().slice(0, 19)}Z
                </span>
              </FieldRow>
            </div>

            {detail.data.invoice.receiveAddresses?.length ? (
              <div className="space-y-2">
                <div className="eyebrow">Receive addresses</div>
                {detail.data.invoice.receiveAddresses.map((r) => (
                  <div
                    key={r.family}
                    className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2"
                  >
                    <span className="rounded bg-card px-1.5 py-0.5 text-[11px] font-mono">
                      {r.family}
                    </span>
                    <Addr value={r.address} truncated={false} />
                  </div>
                ))}
              </div>
            ) : (
              <FieldRow label="Receive address">
                <Addr value={detail.data.invoice.receiveAddress} truncated={false} />
              </FieldRow>
            )}

            {detail.data.amounts.requiredUsd != null && (
              <div className="rounded-[var(--radius-md)] border border-border p-3">
                <div className="eyebrow mb-2">USD axis</div>
                <div className="grid grid-cols-2 gap-y-1.5 font-mono text-sm sm:grid-cols-4">
                  <AmountCell label="required" value={detail.data.amounts.requiredUsd} />
                  <AmountCell label="confirmed" value={detail.data.amounts.confirmedUsd} />
                  <AmountCell label="confirming" value={detail.data.amounts.confirmingUsd} />
                  <AmountCell label="remaining" value={detail.data.amounts.remainingUsd} />
                </div>
              </div>
            )}

            {detail.data.transactions.length > 0 && (
              <div className="space-y-2">
                <div className="eyebrow">Transactions</div>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <Th>Tx</Th>
                        <Th>Status</Th>
                        <Th>Token</Th>
                        <Th>Amount</Th>
                        <Th>Conf</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.transactions.map((t) => (
                        <tr key={t.id}>
                          <Td>
                            <Addr value={t.txHash} />
                          </Td>
                          <Td>
                            <StatusBadge status={t.status} />
                          </Td>
                          <Td className="font-mono text-[12.5px]">{t.token}</Td>
                          <Td className="font-mono text-[12.5px]">
                            {fmtNum(t.amount)}
                          </Td>
                          <Td className="font-mono text-[12.5px]">
                            {t.confirmations}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter>
              {['expired', 'canceled', 'confirmed', 'overpaid'].includes(
                detail.data.invoice.status,
              ) ? null : (
                <Button
                  variant="destructive"
                  onClick={() => expire.mutate()}
                  disabled={expire.isPending}
                >
                  <X className="size-3.5" />{' '}
                  {expire.isPending ? 'Expiring…' : 'Force expire'}
                </Button>
              )}
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

function AmountCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--fg-2)]">{label}</span>
      <span>{value != null ? fmtUsd(value) : '—'}</span>
    </div>
  )
}

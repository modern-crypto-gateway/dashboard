import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, RefreshCw, Target, X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { fmtUsd, truncateAddr } from '@/lib/format'
import type { OrphanTransaction } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function OrphansPage() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['orphans'] as const,
    queryFn: () =>
      api<{ orphans: OrphanTransaction[] }>(
        '/api/gw/admin/orphan-transactions?limit=100',
      ),
    refetchInterval: 60_000,
  })

  const [target, setTarget] = React.useState<OrphanTransaction | null>(null)
  const [mode, setMode] = React.useState<'attribute' | 'dismiss' | null>(null)
  const open = !!target && !!mode
  const close = () => {
    setTarget(null)
    setMode(null)
    qc.invalidateQueries({ queryKey: ['orphans'] })
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Orphan transactions
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            On-chain transfers the gateway couldn't attribute at ingest — usually
            payments on an address whose invoice has already closed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => list.refetch()}
          disabled={list.isFetching}
        >
          <RefreshCw className={'size-3.5' + (list.isFetching ? ' animate-spin' : '')} />
          Refresh
        </Button>
      </div>

      {list.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : list.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {list.error instanceof Error ? list.error.message : 'Error'}
        </Card>
      ) : (list.data?.orphans.length ?? 0) === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
            <AlertTriangle className="size-5 text-[var(--fg-2)]" />
          </div>
          <div className="mt-3 text-sm text-[var(--fg-1)]">No open orphans.</div>
          <p className="mt-1 text-xs text-[var(--fg-2)]">
            Every on-chain transfer is attributed or dismissed.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <Th>Tx</Th>
                  <Th>Chain</Th>
                  <Th>Token</Th>
                  <Th>From → To</Th>
                  <Th>Amount</Th>
                  <Th>USD</Th>
                  <Th>Conf</Th>
                  <Th>Detected</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data!.orphans.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-[var(--bg-2)]">
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px]">
                          {truncateAddr(o.txHash, 8, 6)}
                        </span>
                        <CopyButton value={o.txHash} />
                      </div>
                    </Td>
                    <Td>
                      <ChainPill chainId={o.chainId} />
                    </Td>
                    <Td className="font-mono text-[12.5px]">{o.token}</Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-[12.5px]">
                        <Addr value={o.fromAddress} />
                        <span className="text-[var(--fg-3)]">↓</span>
                        <Addr value={o.toAddress} />
                      </div>
                    </Td>
                    <Td className="font-mono text-[12.5px]">{o.amountRaw}</Td>
                    <Td className="font-mono text-[12.5px]">
                      {o.amountUsd ? fmtUsd(o.amountUsd) : '—'}
                    </Td>
                    <Td className="font-mono text-[12.5px]">{o.confirmations}</Td>
                    <Td className="font-mono text-xs text-[var(--fg-2)]">
                      {formatAgo(o.detectedAt)}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setTarget(o)
                            setMode('attribute')
                          }}
                        >
                          <Target className="size-3.5" /> Attribute
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setTarget(o)
                            setMode('dismiss')
                          }}
                        >
                          <X className="size-3.5" /> Dismiss
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {target && mode === 'attribute' && (
        <AttributeDialog open={open} onOpenChange={close} orphan={target} />
      )}
      {target && mode === 'dismiss' && (
        <DismissDialog open={open} onOpenChange={close} orphan={target} />
      )}
    </div>
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

function formatAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function AttributeDialog({
  open,
  onOpenChange,
  orphan,
}: {
  open: boolean
  onOpenChange: () => void
  orphan: OrphanTransaction
}) {
  const [invoiceId, setInvoiceId] = React.useState('')
  const attr = useMutation({
    mutationFn: () =>
      api<{ attribution: Record<string, unknown> }>(
        `/api/gw/admin/orphan-transactions/${encodeURIComponent(orphan.id)}/attribute`,
        {
          method: 'POST',
          body: JSON.stringify({ invoiceId }),
        },
      ),
    onSuccess: () => {
      toast.success('Orphan attributed')
      onOpenChange()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not attribute'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attribute orphan to invoice</DialogTitle>
          <DialogDescription>
            Re-points the tx's <span className="font-mono">invoice_id</span> and
            reconciles the target invoice. Terminal invoices may flip to
            <span className="font-mono"> confirmed</span> or
            <span className="font-mono"> overpaid</span> if the payment covers it.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-secondary p-3 text-xs font-mono">
          {truncateAddr(orphan.txHash, 10, 8)} · {orphan.token}{' '}
          {orphan.amountRaw}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            attr.mutate()
          }}
        >
          <Field label="Invoice id">
            <Input
              autoFocus
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              placeholder="uuid"
              className="font-mono"
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button type="submit" disabled={attr.isPending || !invoiceId.trim()}>
              {attr.isPending ? 'Attributing…' : 'Attribute'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DismissDialog({
  open,
  onOpenChange,
  orphan,
}: {
  open: boolean
  onOpenChange: () => void
  orphan: OrphanTransaction
}) {
  const [reason, setReason] = React.useState('')
  const dismiss = useMutation({
    mutationFn: () =>
      api(
        `/api/gw/admin/orphan-transactions/${encodeURIComponent(orphan.id)}/dismiss`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => {
      toast.success('Orphan dismissed')
      onOpenChange()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not dismiss'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss orphan</DialogTitle>
          <DialogDescription>
            The tx stays in the audit log but drops off the open-orphans queue.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-secondary p-3 text-xs font-mono">
          {truncateAddr(orphan.txHash, 10, 8)} · {orphan.token}{' '}
          {orphan.amountRaw}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            dismiss.mutate()
          }}
        >
          <Field
            label="Reason"
            hint="1–512 characters. Shown in audit history."
          >
            <Textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="dust · test tx · merchant asked us to ignore"
              maxLength={512}
              rows={3}
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={dismiss.isPending || reason.trim().length === 0}
            >
              {dismiss.isPending ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

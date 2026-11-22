import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, RefreshCw, Target, X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { fmtUsd, truncateAddr, useNow } from '@/lib/format'
import type { OrphanTransaction } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States'
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
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

export function OrphansPage() {
  const qc = useQueryClient()
  const now = useNow()
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
    <div className="fade-in space-y-5">
      <PageHeader
        eyebrow="Payments"
        title="Orphan transactions"
        description="On-chain transfers the gateway couldn't attribute at ingest — usually payments on an address whose invoice has already closed."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={'size-3.5' + (list.isFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
        }
      />

      {list.isLoading ? (
        <ListSkeleton rows={5} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load orphan transactions"
          message={list.error instanceof Error ? list.error.message : 'Error'}
        />
      ) : (list.data?.orphans.length ?? 0) === 0 ? (
        <EmptyState
          framed
          icon={AlertTriangle}
          title="No open orphans"
          description="Every on-chain transfer is attributed or dismissed."
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[1000px]">
              <THead>
                <tr>
                  <Th>Tx</Th>
                  <Th>Chain</Th>
                  <Th>Token</Th>
                  <Th>From → To</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">USD</Th>
                  <Th align="right">Conf</Th>
                  <Th>Detected</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {list.data!.orphans.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">
                          {truncateAddr(o.txHash, 8, 6)}
                        </span>
                        <CopyButton value={o.txHash} />
                      </div>
                    </Td>
                    <Td>
                      <ChainPill chainId={o.chainId} />
                    </Td>
                    <Td className="font-mono text-xs">{o.token}</Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <Addr value={o.fromAddress} />
                        <span className="text-[var(--fg-3)]">↓</span>
                        <Addr value={o.toAddress} />
                      </div>
                    </Td>
                    <Td align="right" className="text-xs">{o.amountRaw}</Td>
                    <Td align="right" className="text-xs">
                      {o.amountUsd ? fmtUsd(o.amountUsd) : '—'}
                    </Td>
                    <Td align="right" className="text-xs">{o.confirmations}</Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--fg-2)]">
                      {formatAgo(o.detectedAt, now)}
                    </Td>
                    <Td align="right" className="font-sans">
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
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
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

function formatAgo(iso: string, nowMs: number): string {
  const diff = Math.floor((nowMs - new Date(iso).getTime()) / 1000)
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
        <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5 font-mono text-xs break-all tabular-nums">
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
        <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2.5 font-mono text-xs break-all tabular-nums">
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
              placeholder="dust · test tx · store asked us to ignore"
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

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  Webhook,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { truncateAddr } from '@/lib/format'
import type { WebhookDelivery } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
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
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'delivered' | 'dead'

export function WebhooksPage() {
  const [status, setStatus] = React.useState<Status>('dead')
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['webhook-deliveries', status] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        `/api/gw/admin/webhook-deliveries?status=${status}&limit=100`,
      ),
    refetchInterval: 60_000,
  })

  const [detail, setDetail] = React.useState<WebhookDelivery | null>(null)

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Webhook deliveries
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Operator view of the outbox. Replay dead rows after the merchant has
            fixed the underlying cause.
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

      <StatusTabs
        value={status}
        onChange={setStatus}
        counts={{
          pending: list.data?.deliveries.filter((d) => d.status === 'pending').length,
          delivered: list.data?.deliveries.filter((d) => d.status === 'delivered').length,
          dead: list.data?.deliveries.filter((d) => d.status === 'dead').length,
        }}
      />

      {list.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : list.isError ? (
        <Card className="p-10 text-center text-sm text-destructive">
          {list.error instanceof Error
            ? list.error.message
            : 'Could not load deliveries'}
        </Card>
      ) : (list.data?.deliveries.length ?? 0) === 0 ? (
        <EmptyCard status={status} />
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <Th>Delivery</Th>
                  <Th>Event</Th>
                  <Th>Merchant</Th>
                  <Th>Attempts</Th>
                  <Th>Last code</Th>
                  <Th>Next / delivered</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data!.deliveries.map((d) => (
                  <tr
                    key={d.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-2)]"
                    onClick={() => setDetail(d)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px]">
                          {truncateAddr(d.id, 8, 6)}
                        </span>
                        <CopyButton value={d.id} />
                      </div>
                    </Td>
                    <Td className="font-mono text-[12.5px]">{d.eventType}</Td>
                    <Td>
                      <Addr value={d.merchantId} />
                    </Td>
                    <Td className="font-mono text-[12.5px]">{d.attempts}</Td>
                    <Td className="font-mono text-[12.5px]">
                      {d.lastStatusCode ?? '—'}
                    </Td>
                    <Td className="font-mono text-xs text-[var(--fg-2)]">
                      {formatAt(d)}
                    </Td>
                    <Td className="text-right">
                      {d.status === 'dead' && <ReplayButton id={d.id} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <DeliveryDetailDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        delivery={detail}
        onReplayed={() =>
          qc.invalidateQueries({ queryKey: ['webhook-deliveries', status] })
        }
      />
    </div>
  )
}

function StatusTabs({
  value,
  onChange,
  counts,
}: {
  value: Status
  onChange: (s: Status) => void
  counts: Record<Status, number | undefined>
}) {
  const items: Array<{ key: Status; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'dead', label: 'Dead', Icon: AlertTriangle },
    { key: 'pending', label: 'Pending', Icon: Clock },
    { key: 'delivered', label: 'Delivered', Icon: CheckCircle2 },
  ]
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {items.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
            value === key
              ? 'bg-secondary text-foreground shadow-xs'
              : 'text-[var(--fg-2)] hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
          {label}
          {counts[key] != null && (
            <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
              {counts[key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function EmptyCard({ status }: { status: Status }) {
  const copy: Record<Status, string> = {
    dead: 'No permanently failed deliveries. 🎉',
    pending: 'No deliveries queued for retry.',
    delivered: 'No delivered rows in the recent window.',
  }
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <Webhook className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--fg-1)]">{copy[status]}</div>
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

function formatAt(d: WebhookDelivery): string {
  if (d.status === 'delivered' && d.deliveredAt) {
    return new Date(d.deliveredAt).toISOString().slice(11, 19) + 'Z'
  }
  if (d.status === 'pending' && d.nextAttemptAt) {
    const delta = d.nextAttemptAt - Date.now()
    if (delta < 0) return 'due now'
    if (delta < 60_000) return `in ${Math.ceil(delta / 1000)}s`
    if (delta < 3_600_000) return `in ${Math.ceil(delta / 60_000)}m`
    return `in ${Math.ceil(delta / 3_600_000)}h`
  }
  return new Date(d.updatedAt).toISOString().slice(11, 19) + 'Z'
}

function ReplayButton({ id }: { id: string }) {
  const qc = useQueryClient()
  const replay = useMutation({
    mutationFn: () =>
      api(`/api/gw/admin/webhook-deliveries/${encodeURIComponent(id)}/replay`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast.success('Queued for retry')
      qc.invalidateQueries({ queryKey: ['webhook-deliveries'] })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not replay'),
  })
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        replay.mutate()
      }}
      disabled={replay.isPending}
    >
      <RotateCcw className={'size-3.5' + (replay.isPending ? ' animate-spin' : '')} />
      Replay
    </Button>
  )
}

function DeliveryDetailDialog({
  open,
  onOpenChange,
  delivery,
  onReplayed,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  delivery: WebhookDelivery | null
  onReplayed: () => void
}) {
  const replay = useMutation({
    mutationFn: () =>
      api(
        `/api/gw/admin/webhook-deliveries/${encodeURIComponent(delivery!.id)}/replay`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Queued for retry')
      onReplayed()
      onOpenChange(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not replay'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delivery detail</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{delivery?.id}</span>
          </DialogDescription>
        </DialogHeader>
        {delivery && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="Event">
                <span className="font-mono text-[12.5px]">{delivery.eventType}</span>
              </FieldRow>
              <FieldRow label="Status">
                <Badge
                  variant={
                    delivery.status === 'delivered'
                      ? 'success'
                      : delivery.status === 'dead'
                        ? 'danger'
                        : 'warn'
                  }
                >
                  {delivery.status}
                </Badge>
              </FieldRow>
              <FieldRow label="Attempts">
                <span className="font-mono">{delivery.attempts}</span>
              </FieldRow>
              <FieldRow label="Last status">
                <span className="font-mono">
                  {delivery.lastStatusCode ?? '—'}
                </span>
              </FieldRow>
              <FieldRow label="Created">
                <span className="font-mono text-xs">
                  {new Date(delivery.createdAt).toISOString()}
                </span>
              </FieldRow>
              <FieldRow label="Updated">
                <span className="font-mono text-xs">
                  {new Date(delivery.updatedAt).toISOString()}
                </span>
              </FieldRow>
            </div>
            {delivery.lastError && (
              <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-destructive">
                <div className="mb-1 font-semibold">last error</div>
                <div className="font-mono whitespace-pre-wrap break-all">
                  {delivery.lastError}
                </div>
              </div>
            )}
            <DialogFooter>
              {delivery.status === 'dead' && (
                <Button
                  variant="outline"
                  onClick={() => replay.mutate()}
                  disabled={replay.isPending}
                >
                  <RotateCcw className="size-3.5" />{' '}
                  {replay.isPending ? 'Replaying…' : 'Replay'}
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

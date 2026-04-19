import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Search,
  Webhook,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { fmtLocal, fmtLocalTime, truncateAddr } from '@/lib/format'
import type { WebhookDelivery } from '@/lib/types'

import { CopyButton } from '@/components/CopyButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'delivered' | 'dead'

export function WebhooksPage() {
  const [status, setStatus] = React.useState<Status>('dead')
  const [query, setQuery] = React.useState('')
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['webhook-deliveries', status] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        `/api/gw/admin/webhook-deliveries?status=${status}&limit=100`,
      ),
    refetchInterval: 60_000,
  })

  const all = list.data?.deliveries ?? []
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (d) =>
        d.id.toLowerCase().includes(q) ||
        d.merchantId.toLowerCase().includes(q) ||
        d.eventType.toLowerCase().includes(q),
    )
  }, [all, query])

  const detail = all.find((d) => d.id === detailId) ?? null

  const counts = React.useMemo(
    () => ({
      pending: status === 'pending' ? all.length : undefined,
      delivered: status === 'delivered' ? all.length : undefined,
      dead: status === 'dead' ? all.length : undefined,
    }),
    [all, status],
  )

  return (
    <div className="fade-in space-y-5">
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
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <StatusTabs value={status} onChange={setStatus} counts={counts} />
        <div className="relative sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--fg-3)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by id, merchant, event…"
            className="pl-8"
          />
        </div>
      </div>

      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-destructive">
          {list.error instanceof Error
            ? list.error.message
            : 'Could not load deliveries'}
        </div>
      ) : all.length === 0 ? (
        <EmptyState status={status} />
      ) : filtered.length === 0 ? (
        <NoMatch />
      ) : (
        <DeliveryList rows={filtered} onOpen={setDetailId} />
      )}

      <DeliveryDetailSheet
        delivery={detail}
        onOpenChange={(v) => !v && setDetailId(null)}
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
            'inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
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

function DeliveryList({
  rows,
  onOpen,
}: {
  rows: WebhookDelivery[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[1fr_180px_140px_80px_100px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)] sm:grid">
        <div>Delivery</div>
        <div>Event</div>
        <div>Merchant</div>
        <div>Attempts</div>
        <div>Timing</div>
      </div>
      <ul>
        {rows.map((d) => (
          <DeliveryRow key={d.id} d={d} onOpen={() => onOpen(d.id)} />
        ))}
      </ul>
    </div>
  )
}

function DeliveryRow({
  d,
  onOpen,
}: {
  d: WebhookDelivery
  onOpen: () => void
}) {
  return (
    <li className="border-b border-border last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="grid w-full cursor-pointer grid-cols-1 items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[1fr_180px_140px_80px_100px] sm:gap-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12.5px]">
              {truncateAddr(d.id, 8, 6)}
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              <CopyButton value={d.id} />
            </span>
          </div>
          {d.lastStatusCode != null && (
            <div className="mt-0.5 font-mono text-[11px] text-[var(--fg-3)]">
              last · {d.lastStatusCode}
            </div>
          )}
        </div>

        <div className="truncate font-mono text-[12.5px] text-[var(--fg-2)]">
          {d.eventType}
        </div>

        <div className="truncate font-mono text-[12.5px] text-[var(--fg-2)]">
          {truncateAddr(d.merchantId, 6, 4)}
        </div>

        <div className="font-mono text-[12.5px]">{d.attempts}</div>

        <div className="text-xs text-[var(--fg-3)]">{formatAt(d)}</div>
      </div>
    </li>
  )
}

function formatAt(d: WebhookDelivery): string {
  if (d.status === 'delivered' && d.deliveredAt) {
    return fmtLocalTime(d.deliveredAt)
  }
  if (d.status === 'pending' && d.nextAttemptAt) {
    const delta = d.nextAttemptAt - Date.now()
    if (delta < 0) return 'due now'
    if (delta < 60_000) return `in ${Math.ceil(delta / 1000)}s`
    if (delta < 3_600_000) return `in ${Math.ceil(delta / 60_000)}m`
    return `in ${Math.ceil(delta / 3_600_000)}h`
  }
  return fmtLocalTime(d.updatedAt)
}

/* ── detail sheet ──────────────────────────────────────── */

function DeliveryDetailSheet({
  delivery,
  onOpenChange,
  onReplayed,
}: {
  delivery: WebhookDelivery | null
  onOpenChange: (o: boolean) => void
  onReplayed: () => void
}) {
  const open = delivery !== null
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="space-y-2">
          {delivery && (
            <div className="flex items-center gap-2">
              <SheetTitle className="truncate font-mono text-base">
                {truncateAddr(delivery.id, 10, 8)}
              </SheetTitle>
              <CopyButton value={delivery.id} />
              <StatusBadge status={delivery.status} />
            </div>
          )}
        </SheetHeader>

        <SheetBody>
          {delivery && (
            <div className="space-y-5">
              <KV>
                <KVItem label="Event">
                  <span className="font-mono text-[12.5px]">
                    {delivery.eventType}
                  </span>
                </KVItem>
                <KVItem label="Last status">
                  <span className="font-mono">
                    {delivery.lastStatusCode ?? '—'}
                  </span>
                </KVItem>
                <KVItem label="Attempts">
                  <span className="font-mono">{delivery.attempts}</span>
                </KVItem>
                <KVItem label="Timing">
                  <span className="font-mono text-xs">{formatAt(delivery)}</span>
                </KVItem>
                <KVItem label="Merchant" wide>
                  <span className="font-mono text-[12.5px]">
                    {delivery.merchantId}
                  </span>
                </KVItem>
                <KVItem label="Created">
                  <span className="font-mono text-xs">
                    {fmtLocal(delivery.createdAt)}
                  </span>
                </KVItem>
                <KVItem label="Updated">
                  <span className="font-mono text-xs">
                    {fmtLocal(delivery.updatedAt)}
                  </span>
                </KVItem>
              </KV>

              {delivery.lastError && (
                <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5">
                  <div className="eyebrow mb-1 text-destructive">last error</div>
                  <div className="whitespace-pre-wrap break-all font-mono text-xs text-destructive">
                    {delivery.lastError}
                  </div>
                </div>
              )}

              {delivery.status === 'dead' && (
                <div className="border-t border-border pt-5">
                  <div className="eyebrow mb-3">Action</div>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary px-3 py-2.5">
                    <div>
                      <div className="text-sm font-medium">Replay delivery</div>
                      <div className="text-xs text-[var(--fg-2)]">
                        Resets attempts and re-queues this delivery.
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => replay.mutate()}
                      disabled={replay.isPending}
                    >
                      <RotateCcw
                        className={'size-3.5' + (replay.isPending ? ' animate-spin' : '')}
                      />
                      {replay.isPending ? 'Replaying…' : 'Replay'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant={
        status === 'delivered'
          ? 'success'
          : status === 'dead'
            ? 'danger'
            : 'warn'
      }
    >
      {status}
    </Badge>
  )
}

function KV({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
      {children}
    </dl>
  )
}

function KVItem({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/* ── skeletons / empty ─────────────────────────────────── */

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_180px_140px_80px_100px] items-center gap-4 border-b border-border px-5 py-3 last:border-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-16" />
          </div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ status }: { status: Status }) {
  const copy: Record<Status, string> = {
    dead: 'No permanently failed deliveries.',
    pending: 'No deliveries queued for retry.',
    delivered: 'No delivered rows in the recent window.',
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <Webhook className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="text-sm font-medium">{copy[status]}</div>
    </div>
  )
}

function NoMatch() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-[var(--fg-2)]">
      No deliveries match your search.
    </div>
  )
}

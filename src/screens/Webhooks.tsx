import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  Link2,
  RotateCcw,
  Search,
  Send,
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

function safeHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function statusCodeTone(code: number | null | undefined) {
  if (code == null) return 'text-[var(--fg-3)]'
  if (code >= 200 && code < 300) return 'text-success'
  if (code >= 300 && code < 400) return 'text-warn'
  if (code >= 400) return 'text-destructive'
  return 'text-[var(--fg-3)]'
}

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
        d.eventType.toLowerCase().includes(q) ||
        (d.resourceId?.toLowerCase().includes(q) ?? false) ||
        (d.targetUrl?.toLowerCase().includes(q) ?? false),
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
            placeholder="Search by id, merchant, event, resource, target…"
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
      <div className="hidden grid-cols-[1.7fr_1.3fr_1.3fr_70px_110px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)] sm:grid">
        <div>Event &amp; resource</div>
        <div>Target</div>
        <div>Last response</div>
        <div>Tries</div>
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
  const targetHost = safeHost(d.targetUrl)
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
        className="grid w-full cursor-pointer grid-cols-1 items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[1.7fr_1.3fr_1.3fr_70px_110px] sm:gap-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12.5px]">
              {d.eventType}
            </span>
            {d.resourceType && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {d.resourceType}
              </Badge>
            )}
          </div>
          {d.resourceId && (
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-[var(--fg-3)]">
              <Hash className="size-3" />
              <span className="truncate">{truncateAddr(d.resourceId, 6, 4)}</span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {targetHost ? (
            <span className="truncate font-mono text-[12.5px] text-[var(--fg-2)]">
              {targetHost}
            </span>
          ) : (
            <span className="text-xs text-[var(--fg-3)]">—</span>
          )}
        </div>

        <div className="min-w-0">
          {d.lastStatusCode != null ? (
            <span
              className={cn(
                'font-mono text-[12.5px] font-semibold',
                statusCodeTone(d.lastStatusCode),
              )}
            >
              HTTP {d.lastStatusCode}
            </span>
          ) : d.lastError ? (
            <span className="truncate text-xs text-destructive">
              {d.lastError}
            </span>
          ) : (
            <span className="text-xs text-[var(--fg-3)]">—</span>
          )}
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
                <KVItem label="Last response">
                  <span
                    className={cn(
                      'font-mono text-sm font-semibold',
                      statusCodeTone(delivery.lastStatusCode),
                    )}
                  >
                    {delivery.lastStatusCode != null
                      ? `HTTP ${delivery.lastStatusCode}`
                      : '—'}
                  </span>
                </KVItem>
                <KVItem label="Attempts">
                  <span className="font-mono">{delivery.attempts}</span>
                </KVItem>
                <KVItem label="Timing">
                  <span className="font-mono text-xs">
                    {formatAt(delivery)}
                  </span>
                </KVItem>
              </KV>

              {(delivery.targetUrl ||
                delivery.resourceId ||
                delivery.idempotencyKey) && (
                <div className="space-y-3 rounded-md border border-border bg-[var(--bg-2)] p-3">
                  {delivery.targetUrl && (
                    <DetailLine label="Target" icon={<Link2 className="size-3.5" />}>
                      <a
                        href={delivery.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[12.5px] text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">{delivery.targetUrl}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                      <CopyButton value={delivery.targetUrl} />
                    </DetailLine>
                  )}
                  {delivery.resourceId && (
                    <DetailLine
                      label={
                        delivery.resourceType
                          ? `${delivery.resourceType[0].toUpperCase()}${delivery.resourceType.slice(1)}`
                          : 'Resource'
                      }
                      icon={
                        delivery.resourceType === 'payout' ? (
                          <Send className="size-3.5" />
                        ) : (
                          <FileText className="size-3.5" />
                        )
                      }
                    >
                      <span className="truncate font-mono text-[12.5px]">
                        {delivery.resourceId}
                      </span>
                      <CopyButton value={delivery.resourceId} />
                    </DetailLine>
                  )}
                  {delivery.idempotencyKey && (
                    <DetailLine label="Idempotency" icon={<Hash className="size-3.5" />}>
                      <span className="truncate font-mono text-[12.5px]">
                        {delivery.idempotencyKey}
                      </span>
                      <CopyButton value={delivery.idempotencyKey} />
                    </DetailLine>
                  )}
                </div>
              )}

              <KV>
                <KVItem label="Delivery id" wide>
                  <span className="break-all font-mono text-[12.5px]">
                    {delivery.id}
                  </span>
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

              {delivery.payload && <PayloadBlock payload={delivery.payload} />}

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

function DetailLine({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
        {icon}
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
    </div>
  )
}

function PayloadBlock({
  payload,
}: {
  payload: NonNullable<WebhookDelivery['payload']>
}) {
  const json = React.useMemo(() => JSON.stringify(payload, null, 2), [payload])
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="eyebrow">Payload</span>
          <span className="font-mono text-[11px] text-[var(--fg-2)]">
            {payload.event}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <CopyButton value={json} label="Copy JSON" />
        </div>
      </div>
      {!collapsed && (
        <pre className="max-h-[420px] overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--fg-1)]">
          {json}
        </pre>
      )}
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
          className="grid grid-cols-[1.7fr_1.3fr_1.3fr_70px_110px] items-center gap-4 border-b border-border px-5 py-3 last:border-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
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

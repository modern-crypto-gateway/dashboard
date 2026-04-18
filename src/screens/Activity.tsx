import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, RefreshCw } from 'lucide-react'

import { api } from '@/lib/api'
import type { WebhookDelivery } from '@/lib/types'
import { truncateAddr } from '@/lib/format'

import { Addr } from '@/components/Addr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'

type Feed = Array<WebhookDelivery & { _source: 'pending' | 'delivered' | 'dead' }>

export function ActivityPage() {
  const pending = useQuery({
    queryKey: ['activity', 'pending'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=pending&limit=50',
      ),
    refetchInterval: 15_000,
  })
  const delivered = useQuery({
    queryKey: ['activity', 'delivered'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=delivered&limit=50',
      ),
    refetchInterval: 30_000,
  })
  const dead = useQuery({
    queryKey: ['activity', 'dead'] as const,
    queryFn: () =>
      api<{ deliveries: WebhookDelivery[] }>(
        '/api/gw/admin/webhook-deliveries?status=dead&limit=50',
      ),
    refetchInterval: 30_000,
  })

  const feed: Feed = React.useMemo(() => {
    const rows: Feed = []
    for (const d of pending.data?.deliveries ?? []) rows.push({ ...d, _source: 'pending' })
    for (const d of delivered.data?.deliveries ?? [])
      rows.push({ ...d, _source: 'delivered' })
    for (const d of dead.data?.deliveries ?? []) rows.push({ ...d, _source: 'dead' })
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return rows.slice(0, 150)
  }, [pending.data, delivered.data, dead.data])

  const refresh = () => {
    pending.refetch()
    delivered.refetch()
    dead.refetch()
  }

  const anyLoading =
    pending.isLoading || delivered.isLoading || dead.isLoading
  const anyFetching =
    pending.isFetching || delivered.isFetching || dead.isFetching

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Overview</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Live merge of pending, delivered, and dead webhook deliveries — your
            best proxy for what the gateway is doing right now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-[11.5px] text-success">
            <StatusDot tone="success" pulse /> live
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={anyFetching}
          >
            <RefreshCw className={'size-3.5' + (anyFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
        </div>
      </div>

      {anyLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : feed.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
            <ActivityIcon className="size-5 text-[var(--fg-2)]" />
          </div>
          <div className="mt-3 text-sm text-[var(--fg-1)]">No recent activity.</div>
          <p className="mt-1 text-xs text-[var(--fg-2)]">
            Activity appears as the gateway dispatches webhooks.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {feed.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3',
                    'transition-colors hover:bg-[var(--bg-2)]',
                  )}
                >
                  <StatusDot
                    tone={
                      e._source === 'delivered'
                        ? 'success'
                        : e._source === 'dead'
                          ? 'danger'
                          : 'warn'
                    }
                    className="mt-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11.5px] text-[var(--fg-2)]">
                        {e.eventType}
                      </span>
                      <Badge
                        variant={
                          e._source === 'delivered'
                            ? 'success'
                            : e._source === 'dead'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {e._source}
                      </Badge>
                      {e.attempts > 1 && (
                        <Badge variant="outline">attempt {e.attempts}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-1)]">
                      <span>delivery</span>
                      <span className="font-mono">
                        {truncateAddr(e.id, 8, 6)}
                      </span>
                      <span className="text-[var(--fg-2)]">·</span>
                      <span>merchant</span>
                      <Addr value={e.merchantId} />
                    </div>
                    {e.lastError && (
                      <div className="mt-1 font-mono text-[11.5px] text-destructive">
                        {e.lastError.slice(0, 120)}
                        {e.lastError.length > 120 && '…'}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--fg-3)]">
                    {new Date(e.updatedAt).toISOString().slice(11, 19)}Z
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

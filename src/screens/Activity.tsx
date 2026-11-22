import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, RefreshCw } from '@/components/icons'

import { api } from '@/lib/api'
import type { WebhookDelivery } from '@/lib/types'
import { fmtLocalTime, truncateAddr } from '@/lib/format'

import { Addr } from '@/components/Addr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ListSkeleton } from '@/components/States'
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
      <PageHeader
        eyebrow="Overview"
        title="Activity"
        description="Live merge of pending, delivered, and dead webhook deliveries — your best proxy for what the gateway is doing right now."
        actions={
          <>
            <Badge variant="success" className="gap-1.5">
              <StatusDot tone="success" pulse /> live
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={anyFetching}
            >
              <RefreshCw className={'size-3.5' + (anyFetching ? ' animate-spin' : '')} />
              Refresh
            </Button>
          </>
        }
      />

      {anyLoading ? (
        <ListSkeleton rows={8} />
      ) : feed.length === 0 ? (
        <EmptyState
          framed
          icon={ActivityIcon}
          title="No recent activity"
          description="Activity appears as the gateway dispatches webhooks."
        />
      ) : (
        <Card className="overflow-hidden">
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
                      <span className="font-mono text-xs text-foreground">
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
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--fg-2)]">
                      <span>delivery</span>
                      <span className="font-mono text-[var(--fg-1)]">
                        {truncateAddr(e.id, 8, 6)}
                      </span>
                      <span className="text-[var(--fg-3)]">·</span>
                      <span>store</span>
                      <Addr value={e.merchantId} />
                    </div>
                    {e.lastError && (
                      <div className="mt-1 font-mono text-2xs break-words text-destructive">
                        {e.lastError.slice(0, 120)}
                        {e.lastError.length > 120 && '…'}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-2xs text-[var(--fg-3)]">
                    {fmtLocalTime(e.updatedAt)}
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

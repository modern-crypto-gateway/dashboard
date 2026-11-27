import * as React from 'react'

import type { AssistantConversation, AssistantUiItem } from '@/lib/assistant'
import { CHECKIN_AUTO_GRACE_MS, CheckinContext } from '@/lib/assistantUi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Alarm, Check, Loader2, X } from '@/components/icons'

type WakeupItem = Extract<AssistantUiItem, { kind: 'wakeup' }>
type CheckinItem = Extract<AssistantUiItem, { kind: 'checkin' }>

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** A check-in the assistant scheduled, inside its response. */
export function WakeupCard({
  item,
  conversationId,
  live,
  busy,
}: {
  item: WakeupItem
  conversationId: string | null
  /** The chat's current check-in (only that one can still run). */
  live: AssistantConversation['wakeup']
  busy: boolean
}) {
  const api = React.useContext(CheckinContext)
  const active = item.status === 'scheduled' && live?.id === item.id && !!conversationId
  const [now, setNow] = React.useState(() => Date.now())
  const [acting, setActing] = React.useState<'run' | 'cancel' | null>(null)
  React.useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])

  if (!active) {
    const text =
      item.status === 'done'
        ? `Checked back at ${clock(item.firedAt ?? item.dueAt)}`
        : item.status === 'cancelled'
          ? 'Check-in cancelled'
          : item.status === 'replaced'
            ? 'Check-in rescheduled'
            : 'Check-in'
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--fg-2)]">
        {item.status === 'done' ? <Check className="size-3.5 shrink-0 text-success" /> : <Alarm className="size-3.5 shrink-0" />}
        <span className="shrink-0">{text}</span>
        <span className={cn('truncate text-[var(--fg-3)]', item.status === 'cancelled' && 'line-through')}>· {item.reason}</span>
      </div>
    )
  }

  const left = item.dueAt - now
  const missed = left < -CHECKIN_AUTO_GRACE_MS
  const due = left <= 0
  const act = async (what: 'run' | 'cancel') => {
    if (!conversationId) return
    setActing(what)
    try {
      await (what === 'run' ? api.run(conversationId, item.id) : api.cancel(conversationId, item.id))
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="animate-in rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3 duration-300 fade-in-0 slide-in-from-bottom-1">
      <div className="flex items-start gap-2.5">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-card text-[var(--accent-ink)] ring-1 ring-[var(--accent-border)]">
          <Alarm className={cn('size-4', !due && !missed && 'ai-ring')} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold">
            {missed ? 'Check-in missed' : due ? 'Checking back now…' : 'Checking back'}
            {!due && (
              <span className="figure text-[12px] font-medium text-[var(--accent-ink)] tabular-nums">
                in {countdown(left)}
              </span>
            )}
            <span className="text-[11px] font-normal text-[var(--fg-2)]">at {clock(item.dueAt)}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--fg-2)]">{item.reason}</p>
          {missed && (
            <p className="mt-0.5 text-[11.5px] text-[var(--fg-3)]">The dashboard was closed when it was due.</p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex gap-2 pl-[42px]">
        <Button size="sm" variant="outline" disabled={busy || acting !== null} onClick={() => void act('run')}>
          {acting === 'run' ? <Loader2 className="size-3.5 animate-spin" /> : <Alarm className="size-3.5" />}
          Check now
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || acting !== null} onClick={() => void act('cancel')}>
          {acting === 'cancel' ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Where a scheduled check-in started a new response. */
export function CheckinDivider({ item }: { item: CheckinItem }) {
  return (
    <div className="flex animate-in items-center gap-3 duration-300 fade-in-0" title={item.reason}>
      <div className="h-px flex-1 bg-border" />
      <span className="flex max-w-[80%] items-center gap-1.5 rounded-full border border-border bg-[var(--bg-0)] px-2.5 py-1 text-[11.5px] text-[var(--fg-2)]">
        <Alarm className="size-3.5 shrink-0 text-[var(--accent-ink)]" />
        <span className="shrink-0 font-medium text-foreground">Scheduled check-in</span>
        <span className="shrink-0">· {clock(item.at)}</span>
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

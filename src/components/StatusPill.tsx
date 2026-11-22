/* eslint-disable react-refresh/only-export-components -- tone helpers live with the pill */
import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  AlertTriangle,
  XCircle,
  Ban,
} from './icons'

export type StatusTone = 'ok' | 'run' | 'wait' | 'warn' | 'bad' | 'info' | 'off'

const TONE: Record<StatusTone, { text: string; bg: string; icon: React.ComponentType<{ className?: string; weight?: 'fill' | 'bold' | 'regular' }> }> = {
  ok: { text: 'text-[var(--st-ok)]', bg: 'bg-[var(--st-ok-bg)]', icon: CheckCircle2 },
  run: { text: 'text-[var(--st-run)]', bg: 'bg-[var(--st-run-bg)]', icon: Loader2 },
  wait: { text: 'text-[var(--st-wait)]', bg: 'bg-[var(--st-wait-bg)]', icon: Clock },
  warn: { text: 'text-[var(--st-warn)]', bg: 'bg-[var(--st-warn-bg)]', icon: AlertTriangle },
  bad: { text: 'text-[var(--st-bad)]', bg: 'bg-[var(--st-bad-bg)]', icon: XCircle },
  info: { text: 'text-[var(--st-info)]', bg: 'bg-[var(--st-info-bg)]', icon: Info },
  off: { text: 'text-[var(--st-wait)]', bg: 'bg-[var(--st-wait-bg)]', icon: Ban },
}

/**
 * Status pill: tinted capsule with an icon and a short label.
 * `run` spins its icon so in-flight states read as live.
 */
export function StatusPill({
  tone,
  children,
  icon,
  className,
  size = 'md',
}: {
  tone: StatusTone
  children: React.ReactNode
  icon?: React.ComponentType<{ className?: string; weight?: 'fill' | 'bold' | 'regular' }> | null
  className?: string
  size?: 'sm' | 'md'
}) {
  const t = TONE[tone]
  const Icon = icon === undefined ? t.icon : icon
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'md' ? 'h-6 pr-2.5 pl-1.5 text-xs' : 'h-5 pr-2 pl-1 text-2xs',
        t.text,
        t.bg,
        className,
      )}
    >
      {Icon && (
        <Icon
          weight="fill"
          className={cn(
            size === 'md' ? 'size-4' : 'size-3.5',
            tone === 'run' && 'animate-spin [animation-duration:1.6s]',
          )}
        />
      )}
      <span className="first-letter:uppercase">{children}</span>
    </span>
  )
}

/** Small coloured dot, for dense rows. */
export function StatusDotTone({ tone, className }: { tone: StatusTone; className?: string }) {
  const map: Record<StatusTone, string> = {
    ok: 'bg-[var(--st-ok-dot)]',
    run: 'bg-[var(--st-run-dot)]',
    wait: 'bg-[var(--st-wait-dot)]',
    warn: 'bg-[var(--st-warn-dot)]',
    bad: 'bg-[var(--st-bad-dot)]',
    info: 'bg-[var(--st-info-dot)]',
    off: 'bg-[var(--st-wait-dot)]',
  }
  return <span className={cn('inline-block size-2 rounded-full', map[tone], className)} />
}

/** Maps the gateway's status words onto tones. Unknown words read as neutral. */
export function toneFor(status: string | null | undefined): StatusTone {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'confirmed':
    case 'delivered':
    case 'paid':
    case 'filled':
    case 'active':
    case 'ready':
    case 'verified':
    case 'healthy':
    case 'ok':
    case 'enabled':
    case 'succeeded':
    case 'success':
      return 'ok'
    case 'processing':
    case 'submitted':
    case 'reserved':
    case 'topping-up':
    case 'broadcast':
    case 'confirming':
    case 'running':
    case 'in-progress':
    case 'detected':
      return 'run'
    case 'pending':
    case 'planned':
    case 'queued':
    case 'scheduled':
    case 'waiting':
    case 'open':
      return 'wait'
    case 'partial':
    case 'underpaid':
    case 'overpaid':
    case 'held':
    case 'expired':
    case 'stalled':
    case 'degraded':
    case 'unverified':
    case 'awaiting verification':
      return 'warn'
    case 'failed':
    case 'dead':
    case 'error':
    case 'canceled':
    case 'cancelled':
    case 'revoked':
    case 'rejected':
    case 'mismatches-detected':
      return 'bad'
    case 'disabled':
    case 'inactive':
    case 'paused':
    case 'dismissed':
      return 'off'
    default:
      return 'wait'
  }
}

/** Convenience: pill straight from a status word. */
export function Status({ value, className, size }: { value: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <StatusPill tone={toneFor(value)} className={className} size={size}>
      {value.replace(/[-_]/g, ' ')}
    </StatusPill>
  )
}


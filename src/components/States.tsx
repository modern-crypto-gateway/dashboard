import * as React from 'react'
import { AlertTriangle, Info, OctagonAlert, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './ui/skeleton'

/** Empty list / nothing-here-yet. Says what this is and offers one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
  framed,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
  /** Standalone (not inside a card): draw a dashed frame. */
  framed?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-6 py-8' : 'gap-3 px-6 py-14',
        framed && 'rounded-lg border border-dashed border-[var(--border-strong)] bg-card',
        className,
      )}
    >
      {Icon && (
        <div className="grid size-10 place-items-center rounded-lg border border-border bg-[var(--bg-2)] text-[var(--fg-2)]">
          <Icon className="size-[18px]" />
        </div>
      )}
      <div className="space-y-1">
        <div className="text-base font-medium">{title}</div>
        {description && (
          <div className="mx-auto max-w-sm text-sm text-pretty text-[var(--fg-2)]">
            {description}
          </div>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

type CalloutTone = 'info' | 'warn' | 'danger' | 'success'

const calloutTone: Record<CalloutTone, { box: string; icon: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: {
    box: 'border-[var(--accent-border)] bg-[var(--accent-bg)]',
    icon: 'text-primary',
    Icon: Info,
  },
  warn: {
    box: 'border-[var(--warn-border)] bg-[var(--warn-bg)]',
    icon: 'text-warn',
    Icon: AlertTriangle,
  },
  danger: {
    box: 'border-[var(--danger-border)] bg-[var(--danger-bg)]',
    icon: 'text-destructive',
    Icon: OctagonAlert,
  },
  success: {
    box: 'border-[var(--success-border)] bg-[var(--success-bg)]',
    icon: 'text-success',
    Icon: CheckCircle2,
  },
}

/** Inline notice: warnings, errors, guidance. */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: CalloutTone
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }> | null
  className?: string
}) {
  const t = calloutTone[tone]
  const Icon = icon === undefined ? t.Icon : icon
  return (
    <div
      role={tone === 'danger' || tone === 'warn' ? 'alert' : undefined}
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        t.box,
        className,
      )}
    >
      {Icon && <Icon className={cn('mt-0.5 size-4 shrink-0', t.icon)} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <div className="font-medium text-foreground">{title}</div>}
        {children && <div className="text-pretty text-[var(--fg-1)]">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

/** Failed request. Keeps the server's message visible for the operator. */
export function ErrorState({
  title = 'Could not load',
  message,
  action,
  className,
}: {
  title?: React.ReactNode
  message?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Callout tone="danger" title={title} action={action} className={className}>
      {message && <span className="font-mono text-xs break-words">{message}</span>}
    </Callout>
  )
}

/** Generic list skeleton: N rows of shimmering bars inside a card. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div className="h-9 border-b border-border bg-[var(--bg-2)]" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0"
        >
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-24" />
          <div className="flex-1" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}

/** Label/value pair for detail views. */
export function KeyValue({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-[var(--fg-2)]">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  )
}

/** A headline number with label and optional sub-line. */
export function Stat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'success' | 'warn' | 'danger'
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-xs text-[var(--fg-2)]">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-xl font-semibold tracking-[-0.02em] tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--fg-2)]">{sub}</div>}
    </div>
  )
}

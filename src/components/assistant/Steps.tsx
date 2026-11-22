import * as React from 'react'

import type { AssistantStep } from '@/lib/assistant'
import { resourceKey, type ResourceKey } from '@/lib/assistantUi'
import { cn } from '@/lib/utils'
import {
  ArrowsLeftRight,
  Ban,
  Brain,
  ChartBar,
  Check,
  ChevronDown,
  Coins,
  GasPump,
  HourglassSimple,
  Landmark,
  Layers,
  Loader2,
  Network,
  Receipt,
  Search,
  Send,
  ShieldAlert,
  Stop,
  Storefront,
  Wallet,
  WebhooksLogo,
  X,
  type IconType,
} from '@/components/icons'

const RESOURCE_ICONS: Record<ResourceKey, IconType> = {
  thinking: Brain,
  invoice: Receipt,
  held: HourglassSimple,
  payout: Send,
  store: Storefront,
  balance: Wallet,
  treasury: Landmark,
  exchange: ArrowsLeftRight,
  webhook: WebhooksLogo,
  search: Search,
  fee: GasPump,
  pool: Layers,
  chain: Network,
  health: ChartBar,
  other: Coins,
}

/** Icon for what a call touches (see resourceKey). */
export function ResourceIcon({ k, className }: { k: ResourceKey; className?: string }) {
  const Icon = RESOURCE_ICONS[k]
  return <Icon className={className} />
}

function duration(step: AssistantStep, now: number): string {
  const ms = (step.endedAt ?? now) - step.startedAt
  if (ms < 1000) return `${Math.max(ms, 0)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function StatusMark({ step }: { step: AssistantStep }) {
  const base = 'absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full ring-2 ring-card'
  switch (step.status) {
    case 'running':
      return (
        <span className={cn(base, 'bg-card')}>
          <Loader2 className="size-3 animate-spin text-[var(--accent-ink)]" weight="bold" />
        </span>
      )
    case 'ok':
      return (
        <span className={cn(base, 'bg-[var(--success-bg)] text-success')}>
          <Check className="size-2.5" weight="bold" />
        </span>
      )
    case 'error':
      return (
        <span className={cn(base, 'bg-[var(--danger-bg)] text-destructive')}>
          <X className="size-2.5" weight="bold" />
        </span>
      )
    case 'stopped':
      return (
        <span className={cn(base, 'bg-[var(--muted-bg)] text-[var(--fg-2)]')}>
          <Stop className="size-2" weight="fill" />
        </span>
      )
    default:
      return (
        <span className={cn(base, 'bg-[var(--muted-bg)] text-[var(--fg-2)]')}>
          <Ban className="size-2.5" weight="bold" />
        </span>
      )
  }
}

const STATUS_WORD: Record<AssistantStep['status'], string> = {
  running: 'Running',
  ok: 'Done',
  error: 'Failed',
  declined: 'Declined',
  expired: 'Expired',
  stopped: 'Stopped',
}

/** One row of the activity timeline; click to see the request and result. */
function StepRow({ step, now, last }: { step: AssistantStep; now: number; last: boolean }) {
  const [open, setOpen] = React.useState(false)
  const running = step.status === 'running'
  const thinking = step.kind === 'thinking'
  const hasDetail = thinking ? !!step.summary : !!(step.path || step.preview || step.reason)
  const isChange = step.risk === 'write' || step.risk === 'money'

  return (
    <li className="relative animate-in pl-9 duration-300 fade-in-0 slide-in-from-left-1">
      {/* timeline rail */}
      {!last && <span aria-hidden className="absolute top-7 bottom-[-6px] left-[13px] w-px bg-border" />}
      <span
        className={cn(
          'absolute top-0.5 left-0 grid size-[27px] place-items-center rounded-lg ring-1 ring-border',
          isChange ? 'bg-[var(--warn-bg)] text-warn' : 'bg-[var(--bg-0)] text-[var(--fg-1)]',
          running && 'ring-[var(--accent-border)]',
        )}
      >
        <ResourceIcon k={resourceKey(step.path, step.kind)} className="size-3.5" />
        <StatusMark step={step} />
      </span>

      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 py-1 text-left disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('truncate text-[13px] font-medium', running && 'ai-shimmer')}>{step.label}</span>
            {step.risk === 'money' && (
              <span className="shrink-0 rounded px-1 text-[10px] font-semibold tracking-wide text-warn uppercase ring-1 ring-[var(--warn-border)]">
                money
              </span>
            )}
          </span>
          {(step.summary || running) && !thinking && (
            <span
              className={cn(
                'block truncate text-[11.5px]',
                step.status === 'error' ? 'text-destructive' : 'text-[var(--fg-2)]',
              )}
            >
              {running ? 'Working…' : step.summary}
            </span>
          )}
          {thinking && running && step.summary && (
            <span className="line-clamp-2 block text-[11.5px] text-[var(--fg-2)] italic">
              {step.summary.slice(-220)}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--fg-3)] tabular-nums">
          {running ? duration(step, now) : `${STATUS_WORD[step.status]} · ${duration(step, now)}`}
        </span>
        {hasDetail && (
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-[var(--fg-3)] transition-transform duration-200 group-hover:text-foreground',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-1 mb-2 animate-in space-y-2 rounded-lg border border-border bg-[var(--bg-0)] p-2.5 text-[12px] duration-200 fade-in-0">
          {thinking ? (
            <p className="leading-relaxed whitespace-pre-wrap text-[var(--fg-2)] italic">{step.summary}</p>
          ) : (
            <>
              {step.reason && (
                <p className="text-[var(--fg-2)]">
                  <span className="font-medium text-[var(--fg-1)]">Why: </span>
                  {step.reason}
                </p>
              )}
              {step.path && (
                <code className="block rounded-md bg-[var(--muted-bg)] px-2 py-1 font-mono text-[11px] break-all">
                  <span className="font-semibold">{step.method}</span> {step.path}
                  {step.query && Object.keys(step.query).length > 0
                    ? `?${new URLSearchParams(step.query).toString()}`
                    : ''}
                </code>
              )}
              {step.preview && (
                <pre className="max-h-56 overflow-auto rounded-md bg-[var(--muted-bg)] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {step.preview}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * A run of consecutive steps. Open while the assistant is working on it,
 * folded into a one-line summary afterwards (click to unfold).
 */
export function ActivityBlock({ steps, live }: { steps: AssistantStep[]; live: boolean }) {
  const running = steps.some((s) => s.status === 'running')
  const [open, setOpen] = React.useState<boolean | null>(null)
  const expanded = open ?? (live || running)
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [running])

  const calls = steps.filter((s) => s.kind === 'call')
  const failed = steps.filter((s) => s.status === 'error').length
  const changes = calls.filter((s) => s.risk === 'write' || s.risk === 'money').length
  const first = steps[0]?.startedAt ?? now
  const lastEnd = Math.max(...steps.map((s) => s.endedAt ?? (s.status === 'running' ? now : s.startedAt)))
  const total = Math.max(0, lastEnd - first)
  const current = steps.find((s) => s.status === 'running')
  const icons = Array.from(new Set(calls.map((s) => resourceKey(s.path)))).slice(0, 4)

  const title = current
    ? current.kind === 'thinking'
      ? 'Thinking'
      : current.label
    : calls.length === 0
      ? 'Thought it through'
      : `${calls.length} ${calls.length === 1 ? 'step' : 'steps'}${changes ? ` · ${changes} ${changes === 1 ? 'change' : 'changes'}` : ''}${failed ? ` · ${failed} failed` : ''}`

  return (
    <div className="animate-in duration-300 fade-in-0">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="group flex items-center gap-2 rounded-lg py-1 pr-2 text-left text-[12.5px] text-[var(--fg-2)] transition-colors hover:text-foreground"
      >
        {current ? (
          <Loader2 className="size-3.5 animate-spin text-[var(--accent-ink)]" weight="bold" />
        ) : failed ? (
          <ShieldAlert className="size-3.5 text-destructive" />
        ) : (
          <Check className="size-3.5 text-success" weight="bold" />
        )}
        <span className={cn('font-medium', current && 'ai-shimmer')}>{title}</span>
        {!current && icons.length > 0 && (
          <span className="flex items-center gap-0.5 text-[var(--fg-3)]">
            {icons.map((k) => (
              <ResourceIcon key={k} k={k} className="size-3" />
            ))}
          </span>
        )}
        <span className="text-[11px] text-[var(--fg-3)] tabular-nums">
          {total >= 1000 ? `${(total / 1000).toFixed(total < 10_000 ? 1 : 0)}s` : ''}
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <ol className="mt-1.5 animate-in space-y-1.5 duration-200 fade-in-0">
          {steps.map((s, i) => (
            <StepRow key={s.id} step={s} now={now} last={i === steps.length - 1} />
          ))}
        </ol>
      )}
    </div>
  )
}

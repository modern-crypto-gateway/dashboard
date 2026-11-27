import * as React from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import type { AssistantConversation, AssistantPendingAction } from '@/lib/assistant'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { OtpInput } from '@/components/OtpInput'
import { ChevronDown, Clock, Loader2, ShieldCheck } from '@/components/icons'
import { ChainIcon, TokenIcon } from '@/components/CryptoIcon'
import { chainInfo } from '@/lib/chains'
import { useMerchants } from '@/lib/merchants'
import { resourceKey } from '@/lib/assistantUi'
import { ResourceIcon } from './Steps'

type Pending = NonNullable<AssistantConversation['pending']>

/**
 * Changes the assistant asked for. Everything shown here comes from the
 * server's copy of the request (facts and exact request); only "reason" is the
 * assistant's own words, and it is labelled as such.
 */
export function ApprovalCard({
  pending,
  busy,
  onDecide,
}: {
  pending: Pending
  busy: boolean
  onDecide: (decisions: Record<string, 'approve' | 'decline'>, totp?: string) => Promise<void>
}) {
  const [selected, setSelected] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(pending.actions.map((a) => [a.id, true])),
  )
  const [code, setCode] = React.useState('')
  const [sending, setSending] = React.useState<'approve' | 'decline' | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const approvedCount = pending.actions.filter((a) => selected[a.id]).length
  const moneySelected = pending.actions.some((a) => a.risk === 'money' && selected[a.id])
  const anyMoney = pending.actions.some((a) => a.risk === 'money')
  const left = Math.max(0, Math.floor((pending.expiresAt - now) / 1000))
  const expired = left === 0
  const disabled = busy || sending !== null

  const decide = async (mode: 'approve' | 'decline') => {
    setSending(mode)
    try {
      const decisions = Object.fromEntries(
        pending.actions.map((a) => [a.id, mode === 'approve' && selected[a.id] ? 'approve' : 'decline'] as const),
      )
      await onDecide(decisions, mode === 'approve' && moneySelected ? code : undefined)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not apply the decision')
      setCode('')
    } finally {
      setSending(null)
    }
  }

  return (
    <div
      className={cn(
        'animate-in space-y-3 rounded-2xl border p-3.5 shadow-[var(--shadow-sm)] duration-300 fade-in-0 slide-in-from-bottom-2',
        anyMoney ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg ring-1',
            anyMoney ? 'bg-card text-warn ring-[var(--warn-border)]' : 'bg-[var(--bg-0)] text-[var(--fg-1)] ring-border',
          )}
        >
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">
            {pending.actions.length === 1
              ? 'Approve this change?'
              : `Approve ${pending.actions.length} changes?`}
          </div>
          <div className="text-[12px] text-[var(--fg-2)]">
            {anyMoney ? 'Includes a money move: your authenticator code is needed.' : 'Nothing runs until you approve.'}
          </div>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums ring-1',
            expired
              ? 'text-destructive ring-[var(--danger-border)]'
              : left < 60
                ? 'text-warn ring-[var(--warn-border)]'
                : 'text-[var(--fg-2)] ring-border',
          )}
        >
          <Clock className="size-3" />
          {expired ? 'Expired' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
        </span>
      </div>

      <ul className="space-y-2">
        {pending.actions.map((a) => (
          <ActionRow
            key={a.id}
            action={a}
            checked={!!selected[a.id]}
            onChange={(v) => setSelected((s) => ({ ...s, [a.id]: v }))}
            disabled={disabled || expired}
          />
        ))}
      </ul>

      {moneySelected && !expired && (
        <div className="animate-in space-y-1.5 duration-200 fade-in-0">
          <div className="text-[12px] font-medium">Authenticator code</div>
          <OtpInput value={code} onChange={setCode} autoFocus={false} />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={anyMoney ? 'signal' : 'default'}
          disabled={disabled || expired || approvedCount === 0 || (moneySelected && code.length !== 6)}
          onClick={() => void decide('approve')}
        >
          {sending === 'approve' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : approvedCount === pending.actions.length ? (
            pending.actions.length === 1 ? 'Approve' : `Approve all ${approvedCount}`
          ) : (
            `Approve ${approvedCount} of ${pending.actions.length}`
          )}
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => void decide('decline')}>
          {sending === 'decline' ? <Loader2 className="size-4 animate-spin" /> : expired ? 'Dismiss' : 'Decline'}
        </Button>
      </div>
    </div>
  )
}

function ActionRow({
  action,
  checked,
  onChange,
  disabled,
}: {
  action: AssistantPendingAction
  checked: boolean
  onChange: (v: boolean) => void
  disabled: boolean
}) {
  // Money moves open with the exact request visible.
  const [showRaw, setShowRaw] = React.useState(action.risk === 'money')
  return (
    <li className={cn('rounded-xl border bg-card p-2.5 transition-opacity', checked ? 'border-border' : 'border-dashed border-border opacity-60')}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1 size-4 rounded border-border accent-[var(--accent)]"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--bg-0)] text-[var(--fg-1)] ring-1 ring-border">
          <ResourceIcon k={resourceKey(action.path)} className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium">{action.label}</span>
            <Badge variant={action.risk === 'money' ? 'warn' : 'default'}>
              {action.risk === 'money' ? 'Money move' : 'Change'}
            </Badge>
          </div>
          {action.facts.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-[12px]">
              {action.facts.map(([k, v], i) => (
                <React.Fragment key={`${k}-${i}`}>
                  <dt className="text-[var(--fg-2)]">{FACT_LABEL[k] ?? k}</dt>
                  <dd className="min-w-0 text-[11.5px] break-all">
                    <FactValue k={k} v={v} />
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          {action.reason && (
            <p className="mt-1.5 text-[12px] text-[var(--fg-2)]">
              <span className="font-medium">Assistant’s reason:</span> {action.reason}
            </p>
          )}
        </div>
      </label>
      <button
        type="button"
        onClick={() => setShowRaw((s) => !s)}
        className="mt-1.5 ml-[60px] flex items-center gap-1 text-[11.5px] text-[var(--fg-2)] hover:text-foreground"
      >
        <ChevronDown className={cn('size-3 transition-transform', showRaw && 'rotate-180')} /> Exact request
      </button>
      {showRaw && (
        <pre className="mt-1.5 ml-[60px] max-h-48 animate-in overflow-auto rounded-lg bg-[var(--muted-bg)] p-2 font-mono text-[11px] break-all whitespace-pre-wrap duration-200 fade-in-0">
          {`${action.method} ${action.path}${action.query ? '?' + new URLSearchParams(action.query).toString() : ''}`}
          {action.body != null ? `\n\n${JSON.stringify(action.body, null, 2)}` : ''}
        </pre>
      )}
    </li>
  )
}

const FACT_LABEL: Record<string, string> = {
  storeId: 'Store',
  chainId: 'Chain',
  token: 'Token',
  amount: 'Amount',
  amountRaw: 'Amount (base units)',
  amountUSD: 'Amount (USD)',
  amountUsd: 'Amount (USD)',
  destinationAddress: 'To',
  address: 'Address',
  feeTier: 'Fee tier',
  rows: 'Rows',
}

/** A fact, readable: chains and tokens with their logos, stores by name. */
function FactValue({ k, v }: { k: string; v: string }) {
  const merchants = useMerchants()
  if (k === 'chainId' && /^\d+$/.test(v)) {
    const id = Number(v)
    return (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <ChainIcon chainId={id} size={15} />
        {chainInfo(id).name}
        <span className="font-mono text-[10.5px] text-[var(--fg-3)]">{v}</span>
      </span>
    )
  }
  if (k === 'token') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <TokenIcon symbol={v} size={15} />
        {v}
      </span>
    )
  }
  if (k === 'storeId') {
    const name = merchants.data?.merchants.find((m) => m.id === v)?.name
    return name ? (
      <span className="font-medium">
        {name} <span className="font-mono text-[10.5px] text-[var(--fg-3)]">{v.slice(0, 8)}…</span>
      </span>
    ) : (
      <span className="font-mono">{v}</span>
    )
  }
  if (k === 'amount' || k === 'amountUSD' || k === 'amountUsd') {
    return <span className="figure text-[12.5px] font-semibold">{k === 'amount' ? v : `$${v}`}</span>
  }
  return <span className="font-mono">{v}</span>
}

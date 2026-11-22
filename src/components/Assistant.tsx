import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import {
  assistantStateQuery,
  postAssistant,
  type AssistantConversation,
  type AssistantPendingAction,
  type AssistantState,
  type AssistantUiItem,
} from '@/lib/assistant'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { OtpInput } from '@/components/OtpInput'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  SendRight,
  Sparkle,
  X,
  XCircle,
} from '@/components/icons'

/**
 * Floating AI assistant (bottom right). Renders only inside the signed-in
 * app shell; the server refuses every /api/assistant call without a session
 * anyway. Nothing here holds the Anthropic key: the browser only sends chat
 * text and approval decisions, and gets back display items.
 */
export function Assistant() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
      <button
        type="button"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'fixed right-4 bottom-4 z-50 flex size-12 items-center justify-center rounded-full shadow-[var(--shadow-md)] transition-transform duration-150 hover:scale-105 active:scale-95 md:right-6 md:bottom-6',
          'bg-primary text-primary-foreground',
          open && 'max-md:hidden',
        )}
      >
        {open ? <X className="size-5" /> : <Sparkle className="size-5" weight="fill" />}
      </button>
    </>
  )
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const state = useQuery(assistantStateQuery)
  const { pathname } = useLocation()
  const [draft, setDraft] = React.useState('')
  const listRef = React.useRef<HTMLDivElement>(null)

  const setConversation = (conversation: AssistantConversation) =>
    qc.setQueryData<AssistantState>(assistantStateQuery.queryKey, (old) =>
      old ? { ...old, conversation } : old,
    )

  const onFail = (e: ApiError) => {
    toast.error(e.message || 'The assistant could not answer')
    qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
  }

  const send = useMutation({
    mutationFn: (message: string) =>
      postAssistant<{ conversation: AssistantConversation }>('chat', { message, page: pathname }),
    onSuccess: (r) => setConversation(r.conversation),
    onError: onFail,
  })

  const reset = useMutation({
    mutationFn: () => postAssistant('reset'),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey }),
    onError: onFail,
  })

  const conv = state.data?.conversation
  const configured = state.data?.config.configured ?? false
  const modelLabel = state.data?.models.find((m) => m.id === state.data?.config.model)?.label
  const working = send.isPending || !!conv?.busy
  const blocked = !configured || working || !!conv?.pending

  // Keep the newest item in view.
  React.useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conv?.ui.length, conv?.pending?.id, send.isPending])

  const submit = () => {
    const text = draft.trim()
    if (!text || blocked) return
    setDraft('')
    // Show the message immediately; the server's copy replaces it.
    qc.setQueryData<AssistantState>(assistantStateQuery.queryKey, (old) =>
      old
        ? {
            ...old,
            conversation: {
              ...old.conversation,
              ui: [...old.conversation.ui, { kind: 'user', text, at: Date.now() }],
            },
          }
        : old,
    )
    send.mutate(text)
  }

  return (
    <div
      role="dialog"
      aria-label="AI assistant"
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden border border-border bg-card shadow-[var(--shadow-md)]',
        'inset-0 md:inset-auto md:right-6 md:bottom-22 md:h-[min(680px,calc(100dvh-8rem))] md:w-[420px] md:rounded-[20px]',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkle className="size-4 text-[var(--accent-ink)]" weight="fill" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Assistant</div>
          {modelLabel && <div className="truncate text-xs text-[var(--fg-2)]">{modelLabel}</div>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reset.mutate()}
          disabled={reset.isPending || working || !conv || conv.ui.length === 0}
          title="Start a new chat"
        >
          <Plus className="size-3.5" /> New chat
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
          <X className="size-4" />
        </Button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {state.isLoading && <div className="text-sm text-[var(--fg-2)]">Loading…</div>}
        {state.data && !configured && (
          <div className="rounded-xl border border-border bg-[var(--bg-0)] p-4 text-sm">
            <p className="font-medium">Connect Claude to start</p>
            <p className="mt-1 text-[var(--fg-2)]">
              Add your Anthropic API key in{' '}
              <Link to="/settings" className="text-primary underline underline-offset-4" onClick={onClose}>
                Settings → AI assistant
              </Link>
              .
            </p>
          </div>
        )}
        {configured && conv && conv.ui.length === 0 && <EmptyHints onPick={setDraft} />}
        {conv?.ui.map((item, i) => <UiRow key={`${item.at}-${i}`} item={item} />)}
        {working && (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
            <Loader2 className="size-4 animate-spin" /> Working…
          </div>
        )}
        {conv?.pending && <ApprovalCard key={conv.pending.id} pending={conv.pending} onDone={setConversation} />}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={2}
            placeholder={
              conv?.pending ? 'Approve or decline the changes above first' : 'Ask about stores, invoices, payouts…'
            }
            disabled={blocked}
            aria-label="Message"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-input bg-[var(--bg-0)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--fg-3)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-50"
          />
          <Button type="submit" size="icon" disabled={blocked || !draft.trim()} aria-label="Send">
            <SendRight className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--fg-3)]">
          Changes wait for your approval. Money moves also need your authenticator code.
        </p>
      </form>
    </div>
  )
}

function EmptyHints({ onPick }: { onPick: (s: string) => void }) {
  const hints = [
    'Summarize today: new invoices, payments, payouts',
    'Which payouts failed this week and why?',
    'Show balances by chain and token',
    'Any orphan transactions I should look at?',
  ]
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--fg-2)]">Ask anything about your gateway. Try:</p>
      {hints.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onPick(h)}
          className="block w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)]"
        >
          {h}
        </button>
      ))}
    </div>
  )
}

/* ── transcript rows ──────────────────────────────────────── */

function UiRow({ item }: { item: AssistantUiItem }) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {item.text}
        </div>
      </div>
    )
  }
  if (item.kind === 'assistant') {
    return (
      <div className="max-w-[95%] text-sm leading-relaxed">
        <RichText text={item.text} />
      </div>
    )
  }
  if (item.kind === 'notice') {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-warn">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {item.text}
      </div>
    )
  }
  const icon =
    item.status === 'ok' ? (
      <Check className="size-3.5 text-success" />
    ) : item.status === 'error' ? (
      <XCircle className="size-3.5 text-destructive" />
    ) : (
      <X className="size-3.5 text-[var(--fg-3)]" />
    )
  const verb =
    item.risk === 'read'
      ? 'Looked up'
      : item.status === 'ok'
        ? 'Done'
        : item.status === 'error'
          ? 'Failed'
          : item.status === 'declined'
            ? 'Declined'
            : 'Expired'
  return (
    <div className="text-xs text-[var(--fg-2)]">
      <div className="flex items-center gap-1.5">
        {icon}
        <span>
          {verb}: <span className="text-foreground">{item.label}</span>
        </span>
      </div>
      {item.detail && <div className="mt-1 ml-5 font-mono break-all text-[var(--fg-3)]">{item.detail}</div>}
    </div>
  )
}

/**
 * Minimal, safe formatting for the model's text: paragraphs, "- " bullets,
 * **bold** and `code`. Built from React nodes only (no HTML injection).
 */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b)}
          </p>
        )
      })}
    </div>
  )
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const rx = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = rx.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    out.push(
      t.startsWith('**') ? (
        <strong key={m.index}>{t.slice(2, -2)}</strong>
      ) : (
        <code key={m.index} className="rounded bg-[var(--muted-bg)] px-1 font-mono text-[0.85em] break-all">
          {t.slice(1, -1)}
        </code>
      ),
    )
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/* ── approval card ────────────────────────────────────────── */

function ApprovalCard({
  pending,
  onDone,
}: {
  pending: NonNullable<AssistantConversation['pending']>
  onDone: (c: AssistantConversation) => void
}) {
  const qc = useQueryClient()
  const [selected, setSelected] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(pending.actions.map((a) => [a.id, true])),
  )
  const [code, setCode] = React.useState('')
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

  const decide = useMutation({
    mutationFn: (mode: 'selected' | 'none') => {
      const decisions = Object.fromEntries(
        pending.actions.map((a) => [a.id, mode === 'selected' && selected[a.id] ? 'approve' : 'decline']),
      )
      return postAssistant<{ conversation: AssistantConversation }>('approve', {
        batchId: pending.id,
        decisions,
        ...(mode === 'selected' && moneySelected ? { totp: code } : {}),
      })
    },
    onSuccess: (r) => onDone(r.conversation),
    onError: (e: ApiError) => {
      toast.error(e.message || 'Could not apply the decision')
      setCode('')
      if (e.code === 'AI_NO_PENDING') qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
    },
  })

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border p-3',
        anyMoney ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]/40' : 'border-border bg-[var(--bg-0)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {pending.actions.length === 1 ? '1 change needs your approval' : `${pending.actions.length} changes need your approval`}
        </div>
        <div className={cn('text-xs tabular-nums', left < 60 ? 'text-warn' : 'text-[var(--fg-2)]')}>
          {expired ? 'expired' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
        </div>
      </div>

      <ul className="space-y-2">
        {pending.actions.map((a) => (
          <ActionRow
            key={a.id}
            action={a}
            checked={!!selected[a.id]}
            onChange={(v) => setSelected((s) => ({ ...s, [a.id]: v }))}
            disabled={decide.isPending || expired}
          />
        ))}
      </ul>

      {moneySelected && !expired && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Authenticator code to approve money moves</div>
          <OtpInput value={code} onChange={setCode} />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={anyMoney ? 'signal' : 'default'}
          disabled={decide.isPending || expired || approvedCount === 0 || (moneySelected && code.length !== 6)}
          onClick={() => decide.mutate('selected')}
        >
          {decide.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : approvedCount === pending.actions.length ? (
            pending.actions.length === 1 ? 'Approve' : `Approve all ${approvedCount}`
          ) : (
            `Approve ${approvedCount} of ${pending.actions.length}`
          )}
        </Button>
        <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate('none')}>
          {expired ? 'Dismiss' : 'Decline all'}
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
    <li className="rounded-xl border border-border bg-card p-2.5">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-border"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{action.label}</span>
            <Badge variant={action.risk === 'money' ? 'warn' : 'default'}>
              {action.risk === 'money' ? 'Money move' : 'Change'}
            </Badge>
          </div>
          {action.facts.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {action.facts.map(([k, v], i) => (
                <React.Fragment key={`${k}-${i}`}>
                  <dt className="text-[var(--fg-2)]">{k}</dt>
                  <dd className="min-w-0 font-mono break-all">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          {action.reason && (
            <p className="mt-1.5 text-xs text-[var(--fg-2)]">
              <span className="font-medium">Assistant’s reason:</span> {action.reason}
            </p>
          )}
        </div>
      </label>
      <button
        type="button"
        onClick={() => setShowRaw((s) => !s)}
        className="mt-1.5 ml-6.5 flex items-center gap-1 text-xs text-[var(--fg-2)] hover:text-foreground"
      >
        {showRaw ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Exact request
      </button>
      {showRaw && (
        <pre className="mt-1.5 ml-6.5 max-h-48 overflow-auto rounded-lg bg-[var(--muted-bg)] p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
          {`${action.method} ${action.path}${action.query ? '?' + new URLSearchParams(action.query).toString() : ''}`}
          {action.body != null ? `\n\n${JSON.stringify(action.body, null, 2)}` : ''}
        </pre>
      )}
    </li>
  )
}

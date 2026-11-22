import * as React from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import type { AssistantAnswer, AssistantQuestion } from '@/lib/assistant'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Check, Loader2, Pencil, Sparkle } from '@/components/icons'

/**
 * The assistant's questions, shown as a small form docked above the message
 * box: one question at a time, options as buttons (number keys pick them),
 * an optional "Other" answer, and Skip. A single single-choice question is
 * answered with one click.
 */
export function QuestionCard({
  questions,
  disabled,
  onAnswer,
  onSkip,
}: {
  questions: AssistantQuestion[]
  disabled: boolean
  onAnswer: (answers: AssistantAnswer[]) => Promise<void>
  onSkip: () => Promise<void>
}) {
  const [page, setPage] = React.useState(0)
  const [answers, setAnswers] = React.useState<AssistantAnswer[]>(() => questions.map(() => ({ selected: [] })))
  const [otherOpen, setOtherOpen] = React.useState<boolean[]>(() => questions.map(() => false))
  const [sending, setSending] = React.useState<'answer' | 'skip' | null>(null)
  const otherRef = React.useRef<HTMLInputElement>(null)

  const q = questions[page]
  const a = answers[page]
  const last = page === questions.length - 1
  const oneClick = questions.length === 1 && !q.multiSelect
  const showSend = !oneClick || otherOpen[page]
  const busy = disabled || sending !== null
  const complete = (x: AssistantAnswer) => x.selected.length > 0 || !!x.other?.trim()

  const submit = async (final: AssistantAnswer[]) => {
    setSending('answer')
    try {
      await onAnswer(final.map((x) => ({ selected: x.selected, ...(x.other?.trim() ? { other: x.other.trim() } : {}) })))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send the answer')
      setSending(null)
    }
  }

  const choose = (label: string) => {
    if (busy) return
    const next = answers.map((x, i) => {
      if (i !== page) return x
      if (q.multiSelect) {
        const has = x.selected.includes(label)
        return { ...x, selected: has ? x.selected.filter((l) => l !== label) : [...x.selected, label] }
      }
      return { selected: [label] }
    })
    setAnswers(next)
    if (!q.multiSelect) {
      setOtherOpen((o) => o.map((v, i) => (i === page ? false : v)))
      if (oneClick) void submit(next)
      else if (!last) window.setTimeout(() => setPage((p) => p + 1), 160)
    }
  }

  const openOther = () => {
    setOtherOpen((o) => o.map((v, i) => (i === page ? true : v)))
    if (!q.multiSelect) setAnswers((xs) => xs.map((x, i) => (i === page ? { selected: [], other: x.other } : x)))
    window.setTimeout(() => otherRef.current?.focus(), 0)
  }

  // Number keys pick an option (when the focus isn't in a text field).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
        e.preventDefault()
        choose(q.options[n - 1].label)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="shrink-0 animate-in border-t border-border bg-card px-3 pt-3 duration-300 fade-in-0 slide-in-from-bottom-3">
      <div className="mx-auto max-w-[720px] rounded-2xl border border-[var(--accent-border)] bg-[var(--bg-0)] p-3 shadow-[var(--shadow-sm)]">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-fg)]">
            <Sparkle className="size-3" weight="fill" />
          </span>
          {q.header && (
            <span className="rounded-md bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-[var(--accent-ink)] uppercase">
              {q.header}
            </span>
          )}
          {questions.length > 1 && (
            <span className="text-[11px] text-[var(--fg-3)] tabular-nums">
              {page + 1} of {questions.length}
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSending('skip')
              void onSkip().catch((e) => {
                toast.error(e instanceof ApiError ? e.message : 'Could not skip')
                setSending(null)
              })
            }}
            className="ml-auto rounded-md px-2 py-0.5 text-[11.5px] text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-50"
          >
            {sending === 'skip' ? 'Skipping…' : 'Skip'}
          </button>
        </div>

        <p key={page} className="mb-2.5 animate-in text-[13.5px] leading-snug font-medium duration-200 fade-in-0">
          {q.question}
        </p>

        <div role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question} className="grid gap-1.5">
          {q.options.map((o, i) => {
            const on = a.selected.includes(o.label)
            return (
              <button
                key={o.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={on}
                disabled={busy}
                onClick={() => choose(o.label)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={cn(
                  'group flex animate-in items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors duration-200 fill-mode-both fade-in-0 slide-in-from-bottom-1 disabled:opacity-60',
                  on
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                    : 'border-border bg-card hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors',
                    q.multiSelect ? 'rounded' : 'rounded-full',
                    on ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]' : 'border-[var(--border-strong)]',
                  )}
                >
                  {on && <Check className="size-3" weight="bold" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{o.label}</span>
                  {o.description && (
                    <span className="block text-[11.5px] leading-snug text-[var(--fg-2)]">{o.description}</span>
                  )}
                </span>
                {sending === 'answer' && on && oneClick ? (
                  <Loader2 className="mt-0.5 size-3.5 animate-spin text-[var(--accent-ink)]" />
                ) : (
                  <kbd className="mt-0.5 hidden rounded border border-border px-1 text-[10px] text-[var(--fg-3)] sm:inline">
                    {i + 1}
                  </kbd>
                )}
              </button>
            )
          })}

          {q.allowOther &&
            (otherOpen[page] ? (
              <input
                ref={otherRef}
                value={a.other ?? ''}
                maxLength={500}
                disabled={busy}
                placeholder="Type your answer…"
                onChange={(e) =>
                  setAnswers((xs) => xs.map((x, i) => (i === page ? { ...x, other: e.target.value } : x)))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && complete(a)) {
                    e.preventDefault()
                    if (last) void submit(answers)
                    else setPage((p) => p + 1)
                  }
                }}
                className="rounded-xl border border-[var(--accent-border)] bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
              />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={openOther}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-left text-[12.5px] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <Pencil className="size-3.5" /> Something else…
              </button>
            ))}
        </div>

        {showSend && (
          <div className="mt-2.5 flex items-center gap-2">
            {page > 0 && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPage((p) => p - 1)}>
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={busy || !complete(a)}
              onClick={() => (last ? void submit(answers) : setPage((p) => p + 1))}
            >
              {sending === 'answer' ? <Loader2 className="size-3.5 animate-spin" /> : last ? 'Send answer' : 'Next'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** A question in the transcript once it has been answered (or skipped). */
export function AnsweredQuestion({
  questions,
  answers,
  status,
}: {
  questions: AssistantQuestion[]
  answers: AssistantAnswer[] | null
  status: 'waiting' | 'answered' | 'skipped' | 'replied'
}) {
  return (
    <div className="animate-in rounded-xl border border-border bg-[var(--bg-0)] px-3 py-2 text-[12.5px] duration-200 fade-in-0">
      {questions.map((q, i) => (
        <div key={i} className={cn(i > 0 && 'mt-1.5 border-t border-border pt-1.5')}>
          <div className="text-[var(--fg-2)]">{q.question}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {status === 'answered' && answers?.[i] ? (
              <>
                {answers[i].selected.map((l) => (
                  <span
                    key={l}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-bg)] px-1.5 py-0.5 font-medium text-[var(--accent-ink)]"
                  >
                    <Check className="size-3" weight="bold" /> {l}
                  </span>
                ))}
                {answers[i].other && <span className="font-medium">“{answers[i].other}”</span>}
              </>
            ) : status === 'waiting' ? (
              <span className="ai-shimmer font-medium">Waiting for your answer…</span>
            ) : (
              <span className="text-[var(--fg-3)] italic">{status === 'skipped' ? 'Skipped' : 'Answered in chat'}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

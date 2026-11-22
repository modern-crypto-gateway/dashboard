import * as React from 'react'

import type { ConversationMeta } from '@/lib/assistant'
import { cn } from '@/lib/utils'
import { Chats, Check, Pencil, Plus, Trash2, X } from '@/components/icons'

function groupOf(ts: number, now: Date): string {
  const d = new Date(ts)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= start) return 'Today'
  if (ts >= start - 86_400_000) return 'Yesterday'
  if (ts >= start - 6 * 86_400_000) return 'Previous 7 days'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

/** Past chats, newest first, grouped by day. */
export function History({
  conversations,
  activeId,
  onOpen,
  onNew,
  onRename,
  onDelete,
  loading,
}: {
  conversations: ConversationMeta[]
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  loading?: boolean
}) {
  const now = new Date()
  const groups: Array<[string, ConversationMeta[]]> = []
  for (const c of conversations) {
    const g = groupOf(c.updatedAt, now)
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(c)
    else groups.push([g, [c]])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <Plus className="size-4" /> New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <div className="px-2 py-3 text-[12.5px] text-[var(--fg-3)]">Loading…</div>}
        {!loading && conversations.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-[12.5px] text-[var(--fg-3)]">
            <Chats className="size-6" />
            Your chats will appear here. They are kept for 30 days.
          </div>
        )}
        {groups.map(([label, items]) => (
          <div key={label} className="mt-2">
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-[var(--fg-3)] uppercase">{label}</div>
            <ul className="space-y-0.5">
              {items.map((c) => (
                <HistoryRow
                  key={c.id}
                  conv={c}
                  active={c.id === activeId}
                  now={now.getTime()}
                  onOpen={() => onOpen(c.id)}
                  onRename={(t) => onRename(c.id, t)}
                  onDelete={() => onDelete(c.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryRow({
  conv,
  active,
  now,
  onOpen,
  onRename,
  onDelete,
}: {
  conv: ConversationMeta
  active: boolean
  now: number
  onOpen: () => void
  onRename: (title: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [mode, setMode] = React.useState<'view' | 'rename' | 'confirm'>('view')
  const [title, setTitle] = React.useState(conv.title)

  if (mode === 'rename') {
    return (
      <li>
        <form
          className="flex items-center gap-1 rounded-lg bg-[var(--bg-hover)] px-1.5 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            if (!t) return
            void onRename(t).then(() => setMode('view'))
          }}
        >
          <input
            autoFocus
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setMode('view')}
            className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 text-[12.5px] outline-none focus-visible:border-ring"
          />
          <button type="submit" aria-label="Save title" className="rounded p-1 text-success hover:bg-card">
            <Check className="size-3.5" />
          </button>
          <button type="button" aria-label="Cancel" onClick={() => setMode('view')} className="rounded p-1 hover:bg-card">
            <X className="size-3.5" />
          </button>
        </form>
      </li>
    )
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
          active ? 'bg-[var(--bg-active)] text-foreground' : 'text-[var(--fg-1)] hover:bg-[var(--bg-hover)]',
        )}
      >
        {conv.pending && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Waiting for your approval" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{conv.title}</span>
        <span className="shrink-0 text-[11px] text-[var(--fg-3)] tabular-nums group-hover:opacity-0">
          {ago(conv.updatedAt, now)}
        </span>
      </button>
      {mode === 'confirm' ? (
        <div className="absolute inset-y-0 right-1 flex items-center gap-1 rounded-md bg-[var(--bg-active)] pl-2 text-[11.5px]">
          Delete?
          <button
            type="button"
            className="rounded px-1.5 py-0.5 font-medium text-destructive hover:bg-card"
            onClick={() => void onDelete().finally(() => setMode('view'))}
          >
            Yes
          </button>
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-card" onClick={() => setMode('view')}>
            No
          </button>
        </div>
      ) : (
        <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            aria-label="Rename chat"
            onClick={() => {
              setTitle(conv.title)
              setMode('rename')
            }}
            className="rounded p-1 text-[var(--fg-2)] hover:bg-card hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete chat"
            onClick={() => setMode('confirm')}
            className="rounded p-1 text-[var(--fg-2)] hover:bg-card hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  )
}

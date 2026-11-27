import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import {
  applyEvent,
  assistantStateQuery,
  conversationKey,
  conversationQuery,
  emptyConversation,
  LOCAL_USER_ID,
  postAssistant,
  streamAssistant,
  type AssistantAnswer,
  type AssistantConversation,
  type AssistantStep,
  type AssistantUiItem,
  type EntityRef,
  type StreamEvent,
} from '@/lib/assistant'
import { useActiveMerchant } from '@/lib/merchants'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Collapse,
  Copy,
  Expand,
  History as HistoryIcon,
  ImageSquare,
  Paperclip,
  Plus,
  Receipt,
  Search,
  Send,
  SendRight,
  Sparkle,
  Stop,
  Wallet,
  X,
} from '@/components/icons'
import { ActivityBlock } from './assistant/Steps'
import { ApprovalCard } from './assistant/ApprovalCard'
import { AnsweredQuestion, QuestionCard } from './assistant/QuestionCard'
import { History } from './assistant/History'
import { CheckinContext, EntityContext } from '@/lib/assistantUi'
import { Markdown } from './assistant/Markdown'
import { CheckinDivider, WakeupCard } from './assistant/Checkin'
import { useCheckins } from './assistant/useCheckins'
import { AttachmentTray, UserImages } from './assistant/Images'
import { imageFiles, MAX_ATTACHMENTS, prepareImage, type Attachment } from '@/lib/imageAttach'

const InvoiceSheet = React.lazy(() =>
  import('@/screens/Invoices').then((m) => ({ default: m.InvoiceDetailSheet })),
)
const PayoutSheet = React.lazy(() => import('@/screens/Payouts').then((m) => ({ default: m.PayoutDetailSheet })))

type Mode = 'compact' | 'expanded'

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = window.localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

/**
 * Floating AI assistant (bottom right). Renders only inside the signed-in
 * app shell; the server refuses every /api/assistant call without a session
 * anyway. Nothing here holds the Anthropic key: the browser sends chat text
 * and approval decisions, and receives display items and progress events.
 */
export function Assistant() {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<Mode>(() => readPref('gw:assistant:mode', 'compact', ['compact', 'expanded']))
  const desktop = useMediaQuery('(min-width: 768px)')
  const [chatId, setChatIdState] = React.useState<string | null>(() => {
    try {
      return window.localStorage.getItem('gw:assistant:chat')
    } catch {
      return null
    }
  })
  const setChatId = React.useCallback((id: string | null) => {
    setChatIdState(id)
    writePref('gw:assistant:chat', id)
  }, [])

  const openChat = React.useCallback(
    (id: string) => {
      setChatId(id)
      setOpen(true)
    },
    [setChatId],
  )
  const checkins = useCheckins({ visibleChat: open ? chatId : null, panelOpen: open, onOpenChat: openChat })

  const setModePersist = (m: Mode) => {
    setMode(m)
    writePref('gw:assistant:mode', m)
  }

  return (
    <CheckinContext.Provider value={checkins.api}>
      {open && (
        <AssistantPanel
          mode={desktop ? mode : 'expanded'}
          desktop={desktop}
          chatId={chatId}
          onChat={setChatId}
          checkinRunning={checkins.running}
          onMode={setModePersist}
          onClose={() => setOpen(false)}
        />
      )}
      {!(open && (mode === 'expanded' || !desktop)) && (
        <button
          type="button"
          aria-label={open ? 'Close assistant' : 'Open assistant'}
          aria-expanded={open}
          onClick={() => {
            checkins.clearUnseen()
            setOpen((o) => !o)
          }}
          className={cn(
            'fixed right-4 bottom-4 z-50 flex size-12 items-center justify-center rounded-full shadow-[var(--shadow-md)] transition-all duration-200 hover:scale-105 active:scale-95 md:right-6 md:bottom-6',
            'bg-primary text-primary-foreground',
          )}
        >
          <span className={cn('transition-transform duration-200', open && 'rotate-90')}>
            {open ? <X className="size-5" /> : <Sparkle className="size-5" weight="fill" />}
          </span>
          {!open && (checkins.unseen || checkins.running.length > 0) && (
            <span
              aria-hidden
              className={cn(
                'absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background',
                checkins.running.length > 0 ? 'ai-pulse bg-[var(--accent)]' : 'bg-success',
              )}
            />
          )}
        </button>
      )}
    </CheckinContext.Provider>
  )
}

/* ── panel ────────────────────────────────────────────────── */

function AssistantPanel({
  mode,
  desktop,
  chatId: storedId,
  onChat: setActiveId,
  checkinRunning,
  onMode,
  onClose,
}: {
  mode: Mode
  desktop: boolean
  /** The chat to show (remembered across visits). */
  chatId: string | null
  onChat: (id: string | null) => void
  /** Chats whose scheduled check-in is running now. */
  checkinRunning: string[]
  onMode: (m: Mode) => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { active, setActiveId: setActiveStore } = useActiveMerchant()
  const state = useQuery(assistantStateQuery)

  const [showHistory, setShowHistory] = React.useState(false)
  const [streaming, setStreaming] = React.useState(false)
  // First message of a chat being created, shown until the server answers.
  const [draftNew, setDraftNew] = React.useState<{ text: string; at: number; images: Attachment[] } | null>(null)
  const composerRef = React.useRef<ComposerHandle>(null)
  const [dragging, setDragging] = React.useState(false)
  const [entity, setEntity] = React.useState<EntityRef | null>(null)

  // While this tab streams a turn for the chat, the stream is the live copy:
  // a refetch (mount, focus, busy polling) would return the server's last
  // save and wipe what is streaming in. The stream ends with the saved chat.
  const streamingHere = streaming || (!!storedId && checkinRunning.includes(storedId))
  const convQ = useQuery({
    ...conversationQuery(storedId ?? 'none'),
    enabled: !!storedId && !streamingHere,
    retry: false,
  })
  // A remembered chat that no longer exists (deleted, expired) starts fresh.
  const gone = !!storedId && convQ.error instanceof ApiError && convQ.error.status === 404
  const activeId = gone ? null : storedId

  const conv = activeId ? (convQ.data ?? null) : null
  const configured = state.data?.config.configured ?? false
  const modelLabel = state.data?.models.find((m) => m.id === state.data?.config.model)?.label
  const working = streaming || !!conv?.busy || (!!activeId && checkinRunning.includes(activeId))
  const expanded = mode === 'expanded'

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || entity) return
      // Escape closes the topmost thing only: leave it to an open sheet,
      // dialog or menu (Radix marks them data-state="open").
      if (document.querySelector('[data-state="open"]:is([role="dialog"],[role="menu"],[role="listbox"])')) return
      onClose()
    }
    // Capture phase on window runs before Radix's own Escape handling, so an
    // open sheet is still in the DOM when this checks for it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, entity])

  /* streaming turn (chat or approve) */
  const runTurn = async (
    action: 'chat' | 'approve' | 'answer',
    body: Record<string, unknown>,
    knownId: string | null,
  ): Promise<void> => {
    setStreaming(true)
    let cid = knownId
    const onEvent = (ev: StreamEvent) => {
      if (ev.t === 'start') {
        cid = ev.conversation.id
        if (!knownId) {
          qc.setQueryData<AssistantConversation>(conversationKey(cid), emptyConversation(ev.conversation))
          setActiveId(cid)
          setDraftNew(null)
        }
        void qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
        return
      }
      if (ev.t === 'error') {
        toast.error(ev.message)
        return
      }
      if (cid) {
        qc.setQueryData<AssistantConversation>(conversationKey(cid), (old) => (old ? applyEvent(old, ev) : old))
      }
    }
    try {
      await streamAssistant(action, body, onEvent)
    } finally {
      setStreaming(false)
      void qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
      if (cid) void qc.invalidateQueries({ queryKey: conversationKey(cid) })
    }
  }

  const send = async (text: string, images: Attachment[] = []) => {
    const page = pathname
    const storeId = active?.id
    const local = images.map((a) => ({ id: a.id, mediaType: a.mediaType, width: a.width, height: a.height, src: a.dataUrl }))
    if (activeId && conv) {
      // Show the message at once; the server's copy replaces it.
      qc.setQueryData<AssistantConversation>(conversationKey(activeId), (old) =>
        old
          ? {
              ...old,
              ui: [...old.ui, { kind: 'user', id: LOCAL_USER_ID, text, at: Date.now(), ...(local.length ? { images: local } : {}) }],
            }
          : old,
      )
    } else {
      setDraftNew({ text, at: Date.now(), images })
    }
    try {
      await runTurn(
        'chat',
        {
          conversationId: activeId,
          message: text,
          page,
          storeId,
          ...(images.length ? { images: images.map((a) => ({ data: a.data, width: a.width, height: a.height })) } : {}),
        },
        activeId,
      )
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'The assistant could not answer')
      setDraftNew(null)
      if (activeId) {
        qc.setQueryData<AssistantConversation>(conversationKey(activeId), (old) =>
          old ? { ...old, ui: old.ui.filter((x) => x.id !== LOCAL_USER_ID) } : old,
        )
      }
      throw e
    }
  }

  const decide = async (decisions: Record<string, 'approve' | 'decline'>, totp?: string) => {
    if (!conv?.pending) return
    await runTurn(
      'approve',
      { conversationId: conv.id, batchId: conv.pending.id, decisions, ...(totp ? { totp } : {}) },
      conv.id,
    )
  }

  const answer = async (answers: AssistantAnswer[] | null) => {
    if (!conv?.question) return
    await runTurn(
      'answer',
      { conversationId: conv.id, questionId: conv.question.id, ...(answers ? { answers } : { skip: true }) },
      conv.id,
    )
  }

  const stop = async () => {
    if (!activeId) return
    try {
      await postAssistant('stop', { conversationId: activeId })
      toast('Stopping after the current step…')
    } catch {
      /* the turn may have just finished */
    }
  }

  const newChat = () => {
    setActiveId(null)
    setDraftNew(null)
    setShowHistory(false)
  }

  const openEntity = React.useCallback(
    (ref: EntityRef) => {
      if (ref.type === 'invoice' || ref.type === 'payout') {
        setEntity(ref)
        return
      }
      if (ref.type === 'store') {
        setActiveStore(ref.storeId)
        navigate('/stores')
      } else {
        navigate(ref.path)
      }
      if (!desktop) onClose()
    },
    [desktop, navigate, onClose, setActiveStore],
  )

  const history = (
    <History
      conversations={state.data?.conversations ?? []}
      loading={state.isLoading}
      activeId={activeId}
      onOpen={(id) => {
        setActiveId(id)
        setShowHistory(false)
      }}
      onNew={newChat}
      onRename={async (id, title) => {
        await postAssistant('rename', { conversationId: id, title })
        await qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
        await qc.invalidateQueries({ queryKey: conversationKey(id) })
      }}
      onDelete={async (id) => {
        try {
          await postAssistant('delete', { conversationId: id })
          if (id === activeId) newChat()
          qc.removeQueries({ queryKey: conversationKey(id) })
          await qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : 'Could not delete the chat')
        }
      }}
    />
  )

  return (
    <EntityContext.Provider value={openEntity}>
      <div
        role="dialog"
        aria-label="AI assistant"
        className={cn(
          'fixed z-50 flex animate-in overflow-hidden border border-border bg-card shadow-[var(--shadow-md)] duration-200 fade-in-0',
          !desktop && 'inset-0',
          desktop &&
            !expanded &&
            'right-6 bottom-[5.5rem] h-[min(720px,calc(100dvh-7.5rem))] w-[440px] origin-bottom-right zoom-in-95 slide-in-from-bottom-3 rounded-[20px]',
          desktop && expanded && 'inset-y-2 right-2 w-[min(1040px,calc(100vw-1rem))] slide-in-from-right-4 rounded-[20px]',
        )}
      >
        {expanded && desktop && (
          <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-[var(--bg-0)]">
            <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-border px-4">
              <HistoryIcon className="size-4 text-[var(--fg-2)]" />
              <span className="text-[13px] font-semibold">Chats</span>
            </div>
            {history}
          </aside>
        )}

        <section
          className="relative flex min-w-0 flex-1 flex-col"
          onDragEnter={(e) => {
            if (configured && e.dataTransfer.types.includes('Files')) setDragging(true)
          }}
          onDragOver={(e) => {
            if (configured && e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragging(false)
            composerRef.current?.addFiles(imageFiles(e.dataTransfer.files))
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-20 grid animate-in place-items-center rounded-2xl border-2 border-dashed border-[var(--accent-border)] bg-[var(--accent-bg)]/90 duration-150 fade-in-0">
              <div className="flex flex-col items-center gap-2 text-[13px] font-medium text-[var(--accent-ink)]">
                <ImageSquare className="size-7" />
                Drop images to attach
              </div>
            </div>
          )}
          {/* header */}
          <header className="flex h-[57px] shrink-0 items-center gap-2.5 border-b border-border px-3.5">
            <Avatar working={working} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{conv?.title ?? (draftNew ? 'New chat' : 'Assistant')}</div>
              <div className="flex items-center gap-1.5 truncate text-[11.5px] text-[var(--fg-2)]">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    !configured ? 'bg-[var(--fg-3)]' : working ? 'bg-[var(--accent)] animate-pulse' : 'bg-success',
                  )}
                />
                {!configured ? 'Not connected' : working ? 'Working…' : (modelLabel ?? 'Ready')}
              </div>
            </div>
            {(!expanded || !desktop) && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Chat history"
                aria-pressed={showHistory}
                onClick={() => setShowHistory((s) => !s)}
                className={cn(showHistory && 'bg-[var(--bg-active)]')}
              >
                <HistoryIcon className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="New chat" onClick={newChat} disabled={!activeId && !draftNew}>
              <Plus className="size-4" />
            </Button>
            {desktop && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? 'Make smaller' : 'Expand'}
                onClick={() => onMode(expanded ? 'compact' : 'expanded')}
              >
                {expanded ? <Collapse className="size-4" /> : <Expand className="size-4" />}
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Close assistant" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </header>

          {showHistory && (!expanded || !desktop) ? (
            <div className="min-h-0 flex-1 animate-in duration-200 fade-in-0">{history}</div>
          ) : (
            <>
              <Thread
                conv={conv}
                draftNew={draftNew}
                configured={configured}
                stateLoading={state.isLoading || (!!activeId && convQ.isLoading)}
                live={working}
                wide={expanded && desktop}
                onPick={(t) => void send(t).catch(() => {})}
                onDecide={decide}
                onClose={onClose}
              />
              {conv?.question && !working && (
                <QuestionCard
                  key={conv.question.id}
                  questions={conv.question.questions}
                  disabled={working}
                  onAnswer={(a) => answer(a)}
                  onSkip={() => answer(null)}
                />
              )}
              <Composer
                handleRef={composerRef}
                disabled={!configured || !!conv?.pending}
                working={working}
                pending={!!conv?.pending}
                question={!!conv?.question}
                wide={expanded && desktop}
                onSend={send}
                onStop={stop}
              />
            </>
          )}
        </section>
      </div>

      <React.Suspense fallback={null}>
        {entity?.type === 'invoice' && (
          <InvoiceSheet merchantId={entity.storeId} invoiceId={entity.id} onOpenChange={(o) => !o && setEntity(null)} />
        )}
        {entity?.type === 'payout' && (
          <PayoutSheet
            merchantId={entity.storeId}
            payoutId={entity.id}
            onOpenChange={(o) => !o && setEntity(null)}
            onOpenBatch={() => {
              setEntity(null)
              navigate('/payouts')
            }}
          />
        )}
      </React.Suspense>
    </EntityContext.Provider>
  )
}

/* ── avatar ───────────────────────────────────────────────── */

function Avatar({ working, size = 'md' }: { working?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'size-12 rounded-2xl' : size === 'sm' ? 'size-6 rounded-lg' : 'size-8 rounded-xl'
  const icon = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-sm)]',
        dim,
        working && 'ai-pulse',
      )}
    >
      <Sparkle className={icon} weight="fill" />
    </span>
  )
}

/* ── thread ───────────────────────────────────────────────── */

type Block =
  | { kind: 'user'; item: Extract<AssistantUiItem, { kind: 'user' }> }
  | { kind: 'checkin'; item: Extract<AssistantUiItem, { kind: 'checkin' }> }
  | { kind: 'response'; id: string; parts: Part[] }

type Part =
  | { kind: 'text'; item: Extract<AssistantUiItem, { kind: 'assistant' }> }
  | { kind: 'steps'; id: string; steps: AssistantStep[] }
  | { kind: 'notice'; item: Extract<AssistantUiItem, { kind: 'notice' }> }
  | { kind: 'question'; item: Extract<AssistantUiItem, { kind: 'question' }> }
  | { kind: 'wakeup'; item: Extract<AssistantUiItem, { kind: 'wakeup' }> }

/** Group the flat transcript into user messages and assistant responses. */
function toBlocks(ui: AssistantUiItem[]): Block[] {
  const blocks: Block[] = []
  let resp: Extract<Block, { kind: 'response' }> | null = null
  for (const item of ui) {
    if (item.kind === 'user') {
      resp = null
      blocks.push({ kind: 'user', item })
      continue
    }
    if (item.kind === 'checkin') {
      resp = null
      blocks.push({ kind: 'checkin', item })
      continue
    }
    if (!resp) {
      resp = { kind: 'response', id: item.id, parts: [] }
      blocks.push(resp)
    }
    const last = resp.parts[resp.parts.length - 1]
    if (item.kind === 'step') {
      if (last?.kind === 'steps') last.steps.push(item.step)
      else resp.parts.push({ kind: 'steps', id: item.id, steps: [item.step] })
    } else if (item.kind === 'assistant') {
      resp.parts.push({ kind: 'text', item })
    } else if (item.kind === 'question') {
      resp.parts.push({ kind: 'question', item })
    } else if (item.kind === 'wakeup') {
      resp.parts.push({ kind: 'wakeup', item })
    } else {
      resp.parts.push({ kind: 'notice', item })
    }
  }
  return blocks
}

function Thread({
  conv,
  draftNew,
  configured,
  stateLoading,
  live,
  wide,
  onPick,
  onDecide,
  onClose,
}: {
  conv: AssistantConversation | null
  draftNew: { text: string; at: number; images: Attachment[] } | null
  configured: boolean
  stateLoading: boolean
  live: boolean
  wide: boolean
  onPick: (text: string) => void
  onDecide: (d: Record<string, 'approve' | 'decline'>, totp?: string) => Promise<void>
  onClose: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = React.useState(true)
  const atBottomRef = React.useRef(true)
  // Only the reader's own scrolling (wheel, touch, keys, scrollbar drag) can
  // stop the auto-follow; scrolls caused by content changing size cannot.
  const userScrollAt = React.useRef(0)
  const markUser = () => {
    userScrollAt.current = Date.now()
  }
  const ui = React.useMemo<AssistantUiItem[]>(() => {
    if (conv) return conv.ui
    return draftNew
      ? [
          {
            kind: 'user',
            id: LOCAL_USER_ID,
            text: draftNew.text,
            at: draftNew.at,
            images: draftNew.images.map((a) => ({ id: a.id, mediaType: a.mediaType, width: a.width, height: a.height, src: a.dataUrl })),
          },
        ]
      : []
  }, [conv, draftNew])
  const blocks = React.useMemo(() => toBlocks(ui), [ui])
  const lastBlock = blocks[blocks.length - 1]
  const awaitingFirst = live && (!lastBlock || lastBlock.kind === 'user' || lastBlock.kind === 'checkin')

  // Follow new content (new items, streaming text, steps that grow) while
  // the reader is at the bottom; leave them alone once they scroll up.
  React.useEffect(() => {
    const el = ref.current
    const body = inner.current
    if (!el || !body) return
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(body)
    return () => ro.disconnect()
  }, [])
  // …and right after every content change commits (ResizeObserver only fires
  // on rendering frames, which a background tab skips).
  const last = ui[ui.length - 1]
  const signature = [
    ui.length,
    last?.id,
    last?.kind === 'assistant' ? last.text.length : last?.kind === 'step' ? `${last.step.status}${last.step.summary?.length ?? 0}` : '',
    conv?.pending?.id ?? '',
    live,
  ].join('|')
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [signature])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (!bottom && atBottomRef.current && Date.now() - userScrollAt.current > 800) {
      // Not the reader: keep following.
      el.scrollTop = el.scrollHeight
      return
    }
    atBottomRef.current = bottom
    setAtBottom(bottom)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        onWheel={markUser}
        onTouchMove={markUser}
        onPointerDown={markUser}
        onKeyDown={markUser}
        className="h-full overflow-y-auto"
      >
        <div ref={inner} className={cn('mx-auto space-y-5 px-4 py-5', wide && 'max-w-[720px] px-6')}>
          {stateLoading && ui.length === 0 && <ThreadSkeleton />}

          {!stateLoading && !configured && (
            <div className="rounded-2xl border border-border bg-[var(--bg-0)] p-4 text-[13px]">
              <p className="font-medium">Connect Claude to start</p>
              <p className="mt-1 text-[var(--fg-2)]">
                Add your Anthropic API key in{' '}
                <Link to="/settings" className="text-[var(--accent-ink)] underline underline-offset-4" onClick={onClose}>
                  Settings → AI assistant
                </Link>
                .
              </p>
            </div>
          )}

          {!stateLoading && configured && ui.length === 0 && <EmptyState onPick={onPick} />}

          {blocks.map((b, i) =>
            b.kind === 'user' ? (
              <UserMessage key={b.item.id} item={b.item} conversationId={conv?.id ?? null} />
            ) : b.kind === 'checkin' ? (
              <CheckinDivider key={b.item.id} item={b.item} />
            ) : (
              <Response
                key={b.id}
                parts={b.parts}
                live={live && i === blocks.length - 1}
                conversationId={conv?.id ?? null}
                wakeup={conv?.wakeup ?? null}
                busy={live}
              />
            ),
          )}

          {awaitingFirst && (
            <div className="flex animate-in items-center gap-3 duration-300 fade-in-0">
              <Avatar working size="sm" />
              <span className="ai-shimmer text-[13px] font-medium">Thinking…</span>
            </div>
          )}

          {conv?.pending && <ApprovalCard key={conv.pending.id} pending={conv.pending} busy={live} onDecide={onDecide} />}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            atBottomRef.current = true
            setAtBottom(true)
            ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-in items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[12px] shadow-[var(--shadow-md)] duration-200 fade-in-0 slide-in-from-bottom-2 hover:bg-[var(--bg-hover)]"
        >
          <ArrowDown className="size-3.5" /> Latest
        </button>
      )}
    </div>
  )
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function UserMessage({
  item,
  conversationId,
}: {
  item: Extract<AssistantUiItem, { kind: 'user' }>
  conversationId: string | null
}) {
  return (
    <div className="group flex animate-in flex-col items-end gap-1.5 duration-300 fade-in-0 slide-in-from-bottom-1">
      {item.images && item.images.length > 0 && <UserImages images={item.images} conversationId={conversationId} />}
      {item.text && (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-primary-foreground shadow-[var(--shadow-sm)]">
          {item.text}
        </div>
      )}
      <span className="mt-1 text-[10.5px] text-[var(--fg-3)] opacity-0 transition-opacity group-hover:opacity-100">
        {time(item.at)}
      </span>
    </div>
  )
}

function Response({
  parts,
  live,
  conversationId,
  wakeup,
  busy,
}: {
  parts: Part[]
  live: boolean
  conversationId: string | null
  wakeup: AssistantConversation['wakeup']
  busy: boolean
}) {
  const lastText = [...parts].reverse().find((p) => p.kind === 'text') as Extract<Part, { kind: 'text' }> | undefined
  const allText = parts
    .filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.item.text)
    .join('\n\n')
  const lastPart = parts[parts.length - 1]
  const streamingId = live && lastPart?.kind === 'text' ? lastPart.item.id : null
  const waiting = live && lastPart && lastPart.kind !== 'text' && !(lastPart.kind === 'steps' && lastPart.steps.some((s) => s.status === 'running'))

  return (
    <div className="group flex animate-in gap-3 duration-300 fade-in-0 slide-in-from-bottom-1">
      <Avatar working={live} size="sm" />
      <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
        {parts.map((p) =>
          p.kind === 'text' ? (
            <Markdown key={p.item.id} text={p.item.text} streaming={p.item.id === streamingId} />
          ) : p.kind === 'steps' ? (
            <ActivityBlock key={p.id} steps={p.steps} live={live} />
          ) : p.kind === 'question' ? (
            <AnsweredQuestion key={p.item.id} questions={p.item.questions} answers={p.item.answers} status={p.item.status} />
          ) : p.kind === 'wakeup' ? (
            <WakeupCard key={p.item.id} item={p.item} conversationId={conversationId} live={wakeup} busy={busy} />
          ) : (
            <div
              key={p.item.id}
              className="flex animate-in items-start gap-2 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-[12.5px] text-warn duration-200 fade-in-0"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p.item.text}
            </div>
          ),
        )}
        {waiting && <span className="ai-shimmer block text-[12.5px] font-medium">Working…</span>}
        {!live && lastText && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={allText} />
            <span className="text-[10.5px] text-[var(--fg-3)]">{time(lastText.item.at)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <button
      type="button"
      aria-label="Copy answer"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setDone(true)
        window.setTimeout(() => setDone(false), 1200)
      }}
      className="rounded-md p-1 text-[var(--fg-3)] hover:bg-[var(--bg-hover)] hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4">
      {[70, 45, 85].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="size-6 animate-pulse rounded-lg bg-[var(--muted-bg)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 animate-pulse rounded bg-[var(--muted-bg)]" style={{ width: `${w}%` }} />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--muted-bg)]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── empty state ──────────────────────────────────────────── */

const SUGGESTIONS: Record<string, Array<{ icon: typeof Receipt; text: string }>> = {
  '/invoices': [
    { icon: Receipt, text: 'Which invoices were paid in the last 24 hours?' },
    { icon: Search, text: 'Show expired invoices that received a partial payment' },
  ],
  '/payouts': [
    { icon: Send, text: 'Which payouts failed this week, and why?' },
    { icon: Search, text: 'List payouts still pending for more than an hour' },
  ],
}
const DEFAULT_SUGGESTIONS = [
  { icon: Sparkle, text: 'Summarize today: new invoices, payments and payouts' },
  { icon: Wallet, text: 'Show balances by chain and token' },
  { icon: Send, text: 'Which payouts failed this week, and why?' },
  { icon: Search, text: 'Any orphan transactions I should look at?' },
]

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { pathname } = useLocation()
  const extra = SUGGESTIONS[pathname] ?? []
  const list = [...extra, ...DEFAULT_SUGGESTIONS.filter((d) => !extra.some((e) => e.text === d.text))].slice(0, 4)
  return (
    <div className="flex animate-in flex-col items-center pt-6 pb-2 text-center duration-500 fade-in-0 slide-in-from-bottom-2">
      <Avatar size="lg" />
      <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">How can I help?</h2>
      <p className="mt-1 max-w-[320px] text-[12.5px] text-pretty text-[var(--fg-2)]">
        I can look things up across your stores, invoices and payouts, and prepare changes for your approval.
      </p>
      <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
        {list.map(({ icon: Icon, text }, i) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            style={{ animationDelay: `${i * 60}ms` }}
            className="flex animate-in items-start gap-2.5 rounded-xl border border-border bg-card p-3 text-left text-[12.5px] leading-snug shadow-[var(--shadow-sm)] transition-colors duration-300 fill-mode-both fade-in-0 slide-in-from-bottom-1 hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)]"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── composer ─────────────────────────────────────────────── */

interface ComposerHandle {
  addFiles: (files: File[]) => void
}

function Composer({
  handleRef,
  disabled,
  working,
  pending,
  question,
  wide,
  onSend,
  onStop,
}: {
  handleRef: React.Ref<ComposerHandle>
  disabled: boolean
  working: boolean
  pending: boolean
  question: boolean
  wide: boolean
  onSend: (text: string, images: Attachment[]) => Promise<void>
  onStop: () => Promise<void>
}) {
  const [draft, setDraft] = React.useState('')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [preparing, setPreparing] = React.useState(0)
  const ta = React.useRef<HTMLTextAreaElement>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)

  // Count includes images still being prepared, so a burst of pastes can't
  // go over the limit.
  const slots = React.useRef(0)
  React.useEffect(() => {
    slots.current = attachments.length + preparing
  }, [attachments.length, preparing])

  const addFiles = React.useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return
      const room = Math.max(0, MAX_ATTACHMENTS - slots.current)
      if (files.length > room) toast(`Up to ${MAX_ATTACHMENTS} images per message.`)
      const take = files.slice(0, room)
      slots.current += take.length
      for (const file of take) {
        setPreparing((n) => n + 1)
        prepareImage(file)
          .then((a) => setAttachments((list) => [...list, a]))
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'That image could not be attached.'))
          .finally(() => setPreparing((n) => n - 1))
      }
      ta.current?.focus()
    },
    [disabled],
  )
  React.useImperativeHandle(handleRef, () => ({ addFiles }), [addFiles])

  // Back to the message box when a turn finishes, so the next question can
  // be typed straight away.
  const wasWorking = React.useRef(working)
  React.useEffect(() => {
    if (wasWorking.current && !working && !disabled) ta.current?.focus()
    wasWorking.current = working
  }, [working, disabled])

  // Grow with the text, up to about eight lines.
  React.useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const submit = () => {
    const text = draft.trim()
    if ((!text && attachments.length === 0) || disabled || working || preparing > 0) return
    const images = attachments
    setDraft('')
    setAttachments([])
    void onSend(text, images).catch(() => {
      setDraft(text)
      setAttachments(images)
    })
  }

  return (
    <form
      className={cn('shrink-0 border-t border-border bg-card px-3 pt-3 pb-2.5', wide && 'px-6')}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className={cn('mx-auto', wide && 'max-w-[720px]')}>
        <AttachmentTray
          attachments={attachments}
          preparing={preparing}
          onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
        />
        <div className="flex items-end gap-1.5 rounded-2xl border border-input bg-[var(--bg-0)] p-1.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              addFiles(imageFiles(e.target.files))
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Attach images"
            title="Attach images (or paste / drop them)"
            disabled={disabled || attachments.length + preparing >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
            className="shrink-0 rounded-xl text-[var(--fg-2)] hover:text-foreground"
          >
            <Paperclip className="size-4" />
          </Button>
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData.files)
              if (files.length) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={
              pending
                ? 'Approve or decline the changes above first'
                : question
                  ? 'Or type a different answer…'
                  : working
                  ? 'Working on it…'
                  : 'Ask about stores, invoices, payouts…'
            }
            disabled={disabled}
            aria-label="Message"
            className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-[var(--fg-3)] disabled:opacity-50"
          />
          {working ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Stop"
              onClick={() => void onStop()}
              className="shrink-0 rounded-xl"
            >
              <Stop className="size-3.5" weight="fill" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={disabled || preparing > 0 || (!draft.trim() && attachments.length === 0)}
              aria-label="Send"
              className="shrink-0 rounded-xl"
            >
              <SendRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[10.5px] text-[var(--fg-3)]">
          <span>Changes wait for your approval · money moves need your 2FA code</span>
          <span className="hidden shrink-0 sm:inline">
            {draft.length > 3500 ? `${draft.length}/4000` : 'Enter to send · Shift+Enter new line'}
          </span>
        </div>
      </div>
    </form>
  )
}

import { queryOptions } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'

/* ── types (mirror worker/assistant/types.ts) ─────────────── */

export type AssistantRisk = 'read' | 'write' | 'money'
export type StepStatus = 'running' | 'ok' | 'error' | 'declined' | 'expired' | 'stopped'

export interface AssistantStep {
  id: string
  kind: 'thinking' | 'call'
  status: StepStatus
  label: string
  method?: string
  path?: string
  query?: Record<string, string> | null
  risk?: AssistantRisk
  reason?: string
  summary?: string
  preview?: string
  startedAt: number
  endedAt?: number
}

export interface AssistantQuestion {
  question: string
  header?: string
  options: Array<{ label: string; description?: string }>
  multiSelect: boolean
  allowOther: boolean
}

export interface AssistantAnswer {
  selected: string[]
  other?: string
}

export type AssistantUiItem =
  | { kind: 'user'; id: string; text: string; at: number }
  | { kind: 'assistant'; id: string; text: string; at: number }
  | { kind: 'step'; id: string; step: AssistantStep; at: number }
  | { kind: 'notice'; id: string; text: string; at: number }
  | {
      kind: 'question'
      id: string
      questions: AssistantQuestion[]
      answers: AssistantAnswer[] | null
      status: 'waiting' | 'answered' | 'skipped' | 'replied'
      at: number
    }

export interface AssistantPendingAction {
  id: string
  method: string
  path: string
  query: Record<string, string> | null
  body: unknown
  risk: 'write' | 'money'
  label: string
  facts: Array<[string, string]>
  reason: string
}

export interface ConversationMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pending: boolean
}

export interface AssistantConversation extends Omit<ConversationMeta, 'pending'> {
  rev: number
  busy: boolean
  ui: AssistantUiItem[]
  pending: { id: string; expiresAt: number; actions: AssistantPendingAction[] } | null
  question: { id: string; questions: AssistantQuestion[] } | null
}

export interface AssistantConfig {
  configured: boolean
  keyHint: string | null
  model: string
}

export interface AssistantState {
  config: AssistantConfig
  models: Array<{ id: string; label: string }>
  conversations: ConversationMeta[]
}

export type StreamEvent =
  | { t: 'start'; conversation: ConversationMeta }
  | { t: 'ui'; item: AssistantUiItem }
  | { t: 'delta'; id: string; delta: string }
  | { t: 'remove'; id: string }
  | { t: 'done'; conversation: AssistantConversation }
  | { t: 'error'; message: string }

/* ── queries ──────────────────────────────────────────────── */

export const assistantStateQuery = queryOptions({
  queryKey: ['assistant', 'state'],
  queryFn: () => api<AssistantState>('/api/assistant/state'),
  staleTime: 5_000,
})

export const conversationKey = (id: string) => ['assistant', 'conversation', id] as const

export const conversationQuery = (id: string) =>
  queryOptions({
    queryKey: conversationKey(id),
    queryFn: () =>
      api<{ conversation: AssistantConversation }>(`/api/assistant/conversations/${encodeURIComponent(id)}`).then(
        (r) => r.conversation,
      ),
    // A chat reopened while a turn still runs on the server catches up.
    refetchInterval: (q) => (q.state.data?.busy ? 2_000 : false),
  })

export function postAssistant<T>(action: string, body: unknown = {}): Promise<T> {
  return api<T>(`/api/assistant/${action}`, { method: 'POST', body: JSON.stringify(body) })
}

/* ── streaming ────────────────────────────────────────────── */

function csrfToken(): string | null {
  const v = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('__Host-gw_csrf='))
  return v ? decodeURIComponent(v.slice('__Host-gw_csrf='.length)) : null
}

/**
 * POST to a streaming assistant endpoint and call `onEvent` for every line
 * the Worker sends. Refusals (busy, 2FA, …) come back as normal JSON errors
 * and throw ApiError before any event.
 */
export async function streamAssistant(
  action: 'chat' | 'approve' | 'answer',
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' })
  const csrf = csrfToken()
  if (csrf) headers.set('X-CSRF-Token', csrf)
  const res = await fetch(`/api/assistant/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  const ct = res.headers.get('content-type') || ''
  if (!res.ok || !ct.includes('ndjson') || !res.body) {
    const payload = ct.includes('application/json') ? await res.json().catch(() => null) : null
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(err?.message || res.statusText || 'Request failed', res.status, err?.code, err?.details)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as StreamEvent)
      } catch {
        /* ignore a malformed line */
      }
    }
  }
}

/** Apply one live event to a conversation (pure). */
export function applyEvent(conv: AssistantConversation, ev: StreamEvent): AssistantConversation {
  switch (ev.t) {
    case 'ui': {
      // The server's copy of the operator's message replaces the optimistic one.
      const ui = ev.item.kind === 'user' ? conv.ui.filter((x) => x.id !== LOCAL_USER_ID) : conv.ui
      const i = ui.findIndex((x) => x.id === ev.item.id)
      const next = i >= 0 ? ui.map((x, j) => (j === i ? ev.item : x)) : [...ui, ev.item]
      return { ...conv, ui: next }
    }
    case 'delta':
      return {
        ...conv,
        ui: conv.ui.map((x) => {
          if (x.id !== ev.id) return x
          if (x.kind === 'assistant') return { ...x, text: x.text + ev.delta }
          if (x.kind === 'step') return { ...x, step: { ...x.step, summary: (x.step.summary ?? '') + ev.delta } }
          return x
        }),
      }
    case 'remove':
      return { ...conv, ui: conv.ui.filter((x) => x.id !== ev.id) }
    case 'done':
      return ev.conversation
    default:
      return conv
  }
}

export const LOCAL_USER_ID = 'local-user'

export function emptyConversation(meta: ConversationMeta): AssistantConversation {
  return { ...meta, rev: 0, busy: true, ui: [], pending: null, question: null }
}

/* ── record links (gw:…) ──────────────────────────────────── */

export type EntityRef =
  | { type: 'invoice'; storeId: string; id: string }
  | { type: 'payout'; storeId: string; id: string }
  | { type: 'store'; storeId: string }
  | { type: 'page'; path: string }

const SEG = /^[A-Za-z0-9_.:-]{1,128}$/

/** App pages the assistant may link to. */
export const LINKABLE_PAGES = new Set([
  '/', '/activity', '/balances', '/pool', '/pool/addresses', '/consolidation-schedules', '/treasury',
  '/exchange', '/invoices', '/payouts', '/payouts/batch', '/orphans', '/held-payouts', '/webhooks',
  '/stores', '/audit-address', '/chains', '/fee-wallets', '/settings',
])

/** Parse a `gw:` link from the model. Anything unexpected is not a link. */
export function parseEntityHref(href: string): EntityRef | null {
  if (!href.startsWith('gw:')) return null
  const rest = href.slice(3)
  const [type, ...parts] = rest.split('/')
  if ((type === 'invoice' || type === 'payout') && parts.length === 2 && parts.every((p) => SEG.test(p))) {
    return { type, storeId: parts[0], id: parts[1] }
  }
  if (type === 'store' && parts.length === 1 && SEG.test(parts[0])) return { type, storeId: parts[0] }
  if (type === 'page') {
    const path = '/' + parts.join('/')
    const clean = path === '//' ? '/' : path.replace(/\/$/, '') || '/'
    return LINKABLE_PAGES.has(clean) ? { type, path: clean } : null
  }
  return null
}

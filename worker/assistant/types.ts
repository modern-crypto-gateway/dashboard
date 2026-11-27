import type Anthropic from '@anthropic-ai/sdk'
import type { Method, Risk } from './catalog'

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam

/** A change the model asked for, waiting for the operator's decision. */
export interface PendingAction {
  toolUseId: string
  method: Method
  path: string
  query?: Record<string, string>
  body?: unknown
  risk: Exclude<Risk, 'read'>
  label: string
  /** Key facts pulled from the request by the server (not written by the model). */
  facts: Array<[string, string]>
  /** The model's one-line reason. Shown as the assistant's words, never trusted. */
  reason: string
}

export interface ReadyResult {
  toolUseId: string
  content: string
  isError: boolean
}

/** All tool calls from one model turn: reads already done, changes waiting. */
export interface PendingBatch {
  id: string
  createdAt: number
  expiresAt: number
  /** Every tool_use id of the turn, in order (results must answer all of them). */
  order: string[]
  ready: ReadyResult[]
  actions: PendingAction[]
}

/** One question the assistant asks with ask_operator. */
export interface Question {
  question: string
  /** Very short tag shown above the question ("Store", "Chain"). */
  header?: string
  options: Array<{ label: string; description?: string }>
  multiSelect: boolean
  /** Offer a free-text "Other" answer. */
  allowOther: boolean
}

export interface QuestionAnswer {
  selected: string[]
  other?: string
}

/** Questions waiting for the operator; the model's turn is paused on them. */
export interface PendingQuestion {
  id: string
  toolUseId: string
  createdAt: number
  questions: Question[]
  /** Every tool_use id of the turn, in order, and results already known. */
  order: string[]
  ready: ReadyResult[]
}

/**
 * A check-in the assistant scheduled (schedule_check). The browser runs it
 * through /api/assistant/wake when it is due, as the signed-in operator.
 */
export interface Wakeup {
  /** Also the id of its transcript item. */
  id: string
  createdAt: number
  dueAt: number
  /** What the assistant will check (its words). */
  reason: string
}

export type StepStatus = 'running' | 'ok' | 'error' | 'declined' | 'expired' | 'stopped'

/** One visible unit of work: a thinking pass or one dashboard call. */
export interface Step {
  id: string
  kind: 'thinking' | 'call'
  status: StepStatus
  label: string
  method?: string
  path?: string
  query?: Record<string, string> | null
  risk?: Risk
  /** The model's reason for a call (its words, shown as such). */
  reason?: string
  /** Thinking summary, or a one-line result ("25 items", an error message). */
  summary?: string
  /** Redacted, truncated response preview (pretty JSON). */
  preview?: string
  startedAt: number
  endedAt?: number
}

/** An image the operator attached (bytes live in the store, see store.ts). */
export interface ImageRef {
  id: string
  mediaType: ImageMediaType
  width?: number
  height?: number
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** A stored image as the model gets it. */
export interface StoredImage {
  mediaType: ImageMediaType
  /** Base64. */
  data: string
}

export type UiItem =
  | { kind: 'user'; id: string; text: string; at: number; images?: ImageRef[] }
  | { kind: 'assistant'; id: string; text: string; at: number }
  | { kind: 'step'; id: string; step: Step; at: number }
  | { kind: 'notice'; id: string; text: string; at: number }
  | {
      kind: 'question'
      id: string
      questions: Question[]
      answers: QuestionAnswer[] | null
      status: 'waiting' | 'answered' | 'skipped' | 'replied'
      at: number
    }
  | {
      kind: 'wakeup'
      id: string
      dueAt: number
      reason: string
      status: 'scheduled' | 'done' | 'cancelled' | 'replaced'
      firedAt?: number
      at: number
    }
  /** Marks where a scheduled check-in started a new response. */
  | { kind: 'checkin'; id: string; reason: string; at: number }

/** Progress events streamed to the browser during a turn (NDJSON). */
export type StreamEvent =
  | { t: 'start'; conversation: ConversationMeta }
  | { t: 'ui'; item: UiItem }
  | { t: 'delta'; id: string; delta: string }
  | { t: 'remove'; id: string }
  | { t: 'done'; conversation: unknown }
  | { t: 'error'; message: string }

export interface ConversationMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pending: boolean
  /** When the scheduled check-in is due, if any. */
  wakeAt: number | null
  wakeId: string | null
}

export interface Conversation {
  id: string
  title: string
  rev: number
  username: string
  createdAt: number
  updatedAt: number
  messages: MessageParam[]
  pending: PendingBatch | null
  /** Questions the assistant asked and is waiting on. */
  question: PendingQuestion | null
  ui: UiItem[]
  /** Epoch ms until which a turn is running (a crash frees it after this). */
  busyUntil: number
  /** Set by the Stop button; the loop checks it between steps. */
  stop: boolean
  /** The scheduled check-in (absent on chats saved before check-ins existed). */
  wakeup?: Wakeup | null
  /** Check-ins run in a row since the operator last wrote. */
  wakeChain?: number
}

export function newConversation(username: string, id: string, title: string): Conversation {
  const now = Date.now()
  return {
    id,
    title,
    rev: 0,
    username,
    createdAt: now,
    updatedAt: now,
    messages: [],
    pending: null,
    question: null,
    ui: [],
    busyUntil: 0,
    stop: false,
    wakeup: null,
    wakeChain: 0,
  }
}

export function metaOf(c: Conversation): ConversationMeta {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    pending: !!c.pending || !!c.question,
    wakeAt: c.wakeup?.dueAt ?? null,
    wakeId: c.wakeup?.id ?? null,
  }
}

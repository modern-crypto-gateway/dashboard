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

export type UiItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | {
      kind: 'action'
      label: string
      method: string
      path: string
      risk: Risk
      status: 'ok' | 'error' | 'declined' | 'expired'
      detail?: string
      at: number
    }
  | { kind: 'notice'; text: string; at: number }

export interface Conversation {
  rev: number
  username: string
  messages: MessageParam[]
  pending: PendingBatch | null
  ui: UiItem[]
  updatedAt: number
  /** Epoch ms until which a turn is running (a crash frees it after this). */
  busyUntil: number
}

export function emptyConversation(username: string): Conversation {
  return { rev: 0, username, messages: [], pending: null, ui: [], updatedAt: Date.now(), busyUntil: 0 }
}

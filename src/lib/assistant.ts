import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type AssistantRisk = 'read' | 'write' | 'money'

export type AssistantUiItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | {
      kind: 'action'
      label: string
      method: string
      path: string
      risk: AssistantRisk
      status: 'ok' | 'error' | 'declined' | 'expired'
      detail?: string
      at: number
    }
  | { kind: 'notice'; text: string; at: number }

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

export interface AssistantConversation {
  rev: number
  busy: boolean
  ui: AssistantUiItem[]
  pending: { id: string; expiresAt: number; actions: AssistantPendingAction[] } | null
}

export interface AssistantConfig {
  configured: boolean
  keyHint: string | null
  model: string
}

export interface AssistantState {
  config: AssistantConfig
  models: Array<{ id: string; label: string }>
  conversation: AssistantConversation
}

export const assistantStateQuery = queryOptions({
  queryKey: ['assistant', 'state'],
  queryFn: () => api<AssistantState>('/api/assistant/state'),
  staleTime: 5_000,
})

export function postAssistant<T>(action: string, body: unknown = {}): Promise<T> {
  return api<T>(`/api/assistant/${action}`, { method: 'POST', body: JSON.stringify(body) })
}

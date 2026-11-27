import * as React from 'react'
import type { EntityRef } from '@/lib/assistant'

/** Opens a record the assistant linked to (provided by the assistant panel). */
export const EntityContext = React.createContext<(ref: EntityRef) => void>(() => {})

/** Scheduled check-ins: run one now, or cancel it (provided by <Assistant>). */
export interface CheckinApi {
  run: (conversationId: string, wakeupId: string) => Promise<void>
  cancel: (conversationId: string, wakeupId: string) => Promise<void>
}
export const CheckinContext = React.createContext<CheckinApi>({
  run: async () => {},
  cancel: async () => {},
})

/** A due check-in older than this is not run on its own; the chat offers "Check now". */
export const CHECKIN_AUTO_GRACE_MS = 30 * 60 * 1000

export type ResourceKey =
  | 'thinking'
  | 'invoice'
  | 'held'
  | 'payout'
  | 'store'
  | 'balance'
  | 'treasury'
  | 'exchange'
  | 'webhook'
  | 'search'
  | 'fee'
  | 'pool'
  | 'chain'
  | 'health'
  | 'other'

/** What a call touches, from its path (drives its icon). */
export function resourceKey(path?: string, kind?: 'thinking' | 'call'): ResourceKey {
  if (kind === 'thinking') return 'thinking'
  const p = path ?? ''
  if (/\/invoices/.test(p)) return 'invoice'
  if (/\/payouts\/held/.test(p)) return 'held'
  if (/\/payouts/.test(p)) return 'payout'
  if (/\/api\/merchants|\/admin\/merchants/.test(p)) return 'store'
  if (/\/balances/.test(p)) return 'balance'
  if (/\/treasury/.test(p)) return 'treasury'
  if (/\/exchange/.test(p)) return 'exchange'
  if (/\/webhook/.test(p)) return 'webhook'
  if (/\/orphan|audit-address/.test(p)) return 'search'
  if (/\/fee-wallets/.test(p)) return 'fee'
  if (/\/pool|consolidat/.test(p)) return 'pool'
  if (/\/chains/.test(p)) return 'chain'
  if (/\/health/.test(p)) return 'health'
  return 'other'
}

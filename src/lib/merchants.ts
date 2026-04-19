import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Merchant } from './types'

const STORAGE_KEY = 'gw:active-merchant'

export const merchantsQuery = {
  queryKey: ['merchants'] as const,
  queryFn: () =>
    api<{ merchants: Merchant[]; gatewayReachable?: boolean }>('/api/merchants'),
  staleTime: 10_000,
}

export function useMerchants() {
  return useQuery(merchantsQuery)
}

interface DashboardConfig {
  baseUrl: string
  hasAdminKey: boolean
  adminKeyHint?: string
  defaultMerchantId: string | null
}

export const configQuery = {
  queryKey: ['settings', 'config'] as const,
  queryFn: () => api<DashboardConfig>('/api/settings/config'),
  staleTime: 10_000,
}

function getStoredMerchantId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function setStoredMerchantId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Active merchant selection priority:
 *   1. user override in this session (localStorage)
 *   2. operator-wide default merchant from Settings (KV)
 *   3. first usable merchant (source !== 'gateway-only')
 *   4. first merchant in the list
 *
 * "Usable" = we hold a sealed API key locally; invoices/payouts work.
 * Gateway-only entries are listable but can't be transacted against until
 * the operator does a rotate-key (which re-lands a plaintext we can seal).
 */
export function useActiveMerchant() {
  const { data } = useMerchants()
  const cfg = useQuery(configQuery)
  const merchants = data?.merchants ?? []
  const defaultId = cfg.data?.defaultMerchantId ?? null

  const [override, setOverrideState] = React.useState<string | null>(
    getStoredMerchantId,
  )

  const preferred = React.useMemo(() => {
    const has = (id: string | null) =>
      !!id && merchants.some((m) => m.id === id)
    if (has(override)) return override!
    if (has(defaultId)) return defaultId!
    const usable = merchants.find((m) => m.source !== 'gateway-only')
    if (usable) return usable.id
    return merchants[0]?.id ?? null
  }, [merchants, override, defaultId])

  const setActiveId = React.useCallback((id: string | null) => {
    setOverrideState(id)
    setStoredMerchantId(id)
  }, [])

  const active = merchants.find((m) => m.id === preferred) ?? null
  return { merchants, active, setActiveId, defaultId }
}

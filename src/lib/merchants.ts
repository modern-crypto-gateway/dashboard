import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Merchant } from './types'

const STORAGE_KEY = 'gw:active-merchant'

export const merchantsQuery = {
  queryKey: ['merchants'] as const,
  queryFn: () => api<{ merchants: Merchant[] }>('/api/merchants'),
  staleTime: 10_000,
}

export function useMerchants() {
  return useQuery(merchantsQuery)
}

export function getStoredMerchantId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setStoredMerchantId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function useActiveMerchant() {
  const { data } = useMerchants()
  const merchants = data?.merchants ?? []
  const [activeId, setActiveIdState] = React.useState<string | null>(
    getStoredMerchantId,
  )

  // Keep the active id valid when the list changes.
  React.useEffect(() => {
    if (merchants.length === 0) return
    if (!activeId || !merchants.some((m) => m.id === activeId)) {
      const next = merchants[0].id
      setActiveIdState(next)
      setStoredMerchantId(next)
    }
  }, [merchants, activeId])

  const setActiveId = React.useCallback((id: string | null) => {
    setActiveIdState(id)
    setStoredMerchantId(id)
  }, [])

  const active = merchants.find((m) => m.id === activeId) ?? null

  return { merchants, active, setActiveId }
}

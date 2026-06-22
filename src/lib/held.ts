import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { ListHeldResponse } from '@/lib/types'

/**
 * Upper bound on rows pulled for the recovery queue. The gateway caps `limit`
 * at 500; an ops queue rarely holds more than a handful, so 200 is generous
 * while keeping the sidebar count cheap. The page and the sidebar share this
 * so an unfiltered view dedupes to a single request via React Query.
 */
export const HELD_LIMIT = 200

type UseHeldOpts = {
  chainId?: number | null
  token?: string | null
  enabled?: boolean
  /** Default 20s. Pass `false` to disable polling. */
  refetchInterval?: number | false
}

/**
 * The held-payout recovery queue (`GET /admin/payouts/held`). Used by the
 * Held payouts page (with filters) and, unfiltered, by the sidebar badge and
 * the Address-pool banner — kept in a lib module (not the lazy screen) so
 * those always-mounted callers don't drag in the page bundle.
 */
export function useHeldQueue(opts: UseHeldOpts = {}) {
  const {
    chainId = null,
    token = null,
    enabled = true,
    refetchInterval = 20_000,
  } = opts
  return useQuery({
    enabled,
    queryKey: ['gw', 'payouts', 'held', { chainId, token }] as const,
    queryFn: () => {
      const qs = new URLSearchParams()
      if (chainId != null) qs.set('chainId', String(chainId))
      if (token) qs.set('token', token)
      qs.set('limit', String(HELD_LIMIT))
      return api<ListHeldResponse>(`/api/gw/admin/payouts/held?${qs}`)
    },
    refetchInterval,
    // NOT_CONFIGURED (no ADMIN_KEY) → 404; don't hammer it on every page.
    retry: false,
  })
}

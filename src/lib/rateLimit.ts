import * as React from 'react'

/**
 * Tracks the gateway's merchant-scoped rate-limit headers seen on every
 * `/api/mg/:merchantId/...` response. Feeds a pre-flight "batch size exceeds
 * remaining quota" warning on the batch payout page without needing each
 * component to remember headers itself.
 *
 * Headers we consume: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
 * `X-RateLimit-Reset`. Reset is parsed tolerantly — unix-ms / unix-seconds /
 * seconds-until-reset are all handled.
 */

export type MerchantRateLimit = {
  limit: number | null
  remaining: number | null
  resetAtMs: number | null
  /** When the headers were observed, in epoch ms. Lets UIs judge staleness. */
  observedAtMs: number
}

const MERCHANT_PATH_RE = /^\/api\/mg\/([^/]+)\//

let byMerchant: Record<string, MerchantRateLimit> = {}
const subs = new Set<() => void>()

function notify() {
  subs.forEach((cb) => cb())
}

function parseIntHeader(v: string | null): number | null {
  if (v === null) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function parseResetMs(v: string | null): number | null {
  if (v === null) return null
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return null
  const now = Date.now()
  // Heuristic: distinguish unix-ms vs unix-seconds vs seconds-from-now.
  if (n >= 1e12) return n // unix ms
  if (n >= 1e9) return n * 1000 // unix seconds
  return now + n * 1000 // seconds-from-now
}

/** Call this with every response from the gateway. No-op for non-merchant paths. */
export function recordRateLimit(path: string, headers: Headers): void {
  const m = MERCHANT_PATH_RE.exec(path)
  if (!m) return
  const merchantId = decodeURIComponent(m[1])

  const limit = parseIntHeader(headers.get('X-RateLimit-Limit'))
  const remaining = parseIntHeader(headers.get('X-RateLimit-Remaining'))
  const resetAtMs = parseResetMs(headers.get('X-RateLimit-Reset'))

  // If none of the headers are present, don't wipe existing state.
  if (limit === null && remaining === null && resetAtMs === null) return

  const prev = byMerchant[merchantId]
  const next: MerchantRateLimit = {
    limit: limit ?? prev?.limit ?? null,
    remaining: remaining ?? prev?.remaining ?? null,
    resetAtMs: resetAtMs ?? prev?.resetAtMs ?? null,
    observedAtMs: Date.now(),
  }

  if (
    prev &&
    prev.limit === next.limit &&
    prev.remaining === next.remaining &&
    prev.resetAtMs === next.resetAtMs
  ) {
    // Only the observedAtMs would change — skip a pointless re-render.
    return
  }

  byMerchant = { ...byMerchant, [merchantId]: next }
  notify()
}

function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

/** Live snapshot of the given merchant's rate-limit state, or null if none observed yet. */
export function useMerchantRateLimit(
  merchantId: string | null | undefined,
): MerchantRateLimit | null {
  const getSnapshot = React.useCallback(
    () => (merchantId ? (byMerchant[merchantId] ?? null) : null),
    [merchantId],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null)
}

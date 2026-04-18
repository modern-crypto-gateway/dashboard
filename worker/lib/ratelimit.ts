/**
 * Two layers of rate limiting:
 *
 * 1. **Cloudflare native `ratelimits` bindings** — declared in wrangler.jsonc.
 *    Period is constrained to 10 or 60 seconds by the platform. Good for the
 *    hot path (blanket API cap, gateway proxy, setup, session revoke).
 *
 * 2. **KV sliding-window fallback** — used for windows longer than 60s that
 *    CF's native binding cannot express (login brute-force, password change
 *    cooldown, recovery-code regeneration).
 *
 * Both return a structured 429 via `HttpError` so the worker's `toResponse`
 * converts to the normal error shape.
 */

import { kvGet, kvPut, K } from './kv'
import { HttpError } from './http'
import type { Bindings } from './env'

/* ── Layer 1: Cloudflare Rate Limiting binding ──────────────── */

export async function cfLimit(
  binding: RateLimit,
  key: string,
  bucketName: string,
): Promise<void> {
  const { success } = await binding.limit({ key })
  if (!success) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests', {
      bucket: bucketName,
    })
  }
}

/* ── Layer 2: KV sliding-window limiter ─────────────────────── */

export interface RateLimitConfig {
  /** requests per window */
  limit: number
  /** window size in seconds */
  windowSeconds: number
}

export async function rateLimit(
  env: Bindings,
  bucket: string,
  id: string,
  cfg: RateLimitConfig,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - (now % cfg.windowSeconds)
  const key = K.ratelimit(bucket, `${id}:${windowStart}`)
  const v = await kvGet(env, key, 'text')
  const current = v ? parseInt(v, 10) : 0
  if (current >= cfg.limit) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests', {
      retryAfter: windowStart + cfg.windowSeconds - now,
    })
  }
  await kvPut(env, key, String(current + 1), {
    expirationTtl: cfg.windowSeconds + 5,
  })
}

export function clientId(req: Request): string {
  return req.headers.get('cf-connecting-ip') || 'anon'
}

/* ── Window presets for the KV limiter ─────────────────────
 * Only used where the CF native binding's 10s / 60s periods are too short.
 * The 60s-window buckets (general API, gw proxy, setup, session-revoke) live
 * in wrangler.jsonc as `ratelimits` bindings. */
export const RL_LOGIN = { limit: 10, windowSeconds: 300 } // 10/5min per IP
export const RL_TOTP = { limit: 20, windowSeconds: 300 } // 20/5min per IP
export const RL_SEC_PASSWORD = { limit: 5, windowSeconds: 600 } // 5/10min
export const RL_SEC_TOTP_ROTATE = { limit: 5, windowSeconds: 600 } // 5/10min
export const RL_SEC_RECOVERY_REGEN = { limit: 3, windowSeconds: 3600 } // 3/hr

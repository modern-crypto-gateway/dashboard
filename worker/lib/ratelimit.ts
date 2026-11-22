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

/**
 * Rate-limit identity for the caller. IPv4 addresses are used as-is. IPv6
 * addresses are cut to their /64 prefix: one subscriber usually holds a whole
 * /64, so keying on the full address would hand an attacker billions of
 * separate buckets.
 */
export function clientId(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip') || 'anon'
  return ip.includes(':') ? ipv6Prefix64(ip) : ip
}

export function ipv6Prefix64(ip: string): string {
  const addr = ip.split('%')[0].toLowerCase()
  // IPv4-mapped (::ffff:1.2.3.4): the IPv4 part is the identity.
  const v4 = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) return v4[1]
  const [head, tail] = addr.includes('::') ? addr.split('::', 2) : [addr, null]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = tail === null ? 0 : Math.max(0, 8 - h.length - t.length)
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t]
  const prefix = groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, '') || '0')
    .join(':')
  return `${prefix}::/64`
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

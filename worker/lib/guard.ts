/**
 * Exact counters for login brute-force protection.
 *
 * The KV limiter in ratelimit.ts is a read-then-write on an eventually
 * consistent store: parallel bursts, or requests landing in different
 * Cloudflare locations, under-count. Login and 2FA guessing must be counted
 * exactly, so they go through this Durable Object instead. Each instance
 * (one per IP prefix, one per username, ...) handles one call at a time and
 * its SQL calls are synchronous, so check-and-increment is atomic.
 *
 * Operations:
 *   hit(key, limit, window)  count one event in a fixed window; ok=false once
 *                            the count is above `limit`
 *   peek(key)                current count + seconds until the window ends
 *   claim(key, ttl)          true only the first time `key` is claimed while
 *                            the claim lives (single-use codes, TOTP replay)
 *   clear(key)               drop a counter (e.g. after a successful login)
 */

import { DurableObject } from 'cloudflare:workers'
import { HttpError } from './http'
import type { Bindings } from './env'

interface Row {
  n: number
  exp: number
}

export interface HitResult {
  ok: boolean
  count: number
  retryAfter: number
}

export class AuthGuard extends DurableObject {
  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    this.sql = ctx.storage.sql
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS c (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)',
    )
  }

  private now(): number {
    return Math.floor(Date.now() / 1000)
  }

  private live(key: string, now: number): Row | null {
    this.sql.exec('DELETE FROM c WHERE exp <= ?', now)
    const rows = this.sql.exec<{ n: number; exp: number }>('SELECT n, exp FROM c WHERE k = ?', key).toArray()
    return rows.length ? { n: Number(rows[0].n), exp: Number(rows[0].exp) } : null
  }

  hit(key: string, limit: number, windowSeconds: number): HitResult {
    const now = this.now()
    const row = this.live(key, now)
    if (!row) {
      this.sql.exec('INSERT INTO c (k, n, exp) VALUES (?, 1, ?)', key, now + windowSeconds)
      return { ok: 1 <= limit, count: 1, retryAfter: windowSeconds }
    }
    const n = row.n + 1
    this.sql.exec('UPDATE c SET n = ? WHERE k = ?', n, key)
    return { ok: n <= limit, count: n, retryAfter: row.exp - now }
  }

  peek(key: string): { count: number; retryAfter: number } {
    const now = this.now()
    const row = this.live(key, now)
    return row ? { count: row.n, retryAfter: row.exp - now } : { count: 0, retryAfter: 0 }
  }

  claim(key: string, ttlSeconds: number): boolean {
    const now = this.now()
    if (this.live(key, now)) return false
    this.sql.exec('INSERT INTO c (k, n, exp) VALUES (?, 1, ?)', key, now + ttlSeconds)
    return true
  }

  clear(key: string): void {
    this.sql.exec('DELETE FROM c WHERE k = ?', key)
  }
}

/* ── helpers ──────────────────────────────────────────────────
 * `scope` picks the Durable Object instance (e.g. `user:alice`, `ip:1.2.3.4`);
 * `key` is the counter inside it. */

function stub(env: Bindings, scope: string) {
  const ns = env.AUTH_GUARD
  if (!ns) throw new Error('AUTH_GUARD Durable Object binding is missing (see wrangler.jsonc.example).')
  return ns.get(ns.idFromName(scope))
}

/** Count one attempt; throws 429 once over the limit. */
export async function guardHit(
  env: Bindings,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<HitResult> {
  const r = await stub(env, scope).hit(key, limit, windowSeconds)
  if (!r.ok) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', {
      retryAfter: r.retryAfter,
    })
  }
  return r
}

/** Count one failure without throwing; returns the new count. */
export async function guardCount(
  env: Bindings,
  scope: string,
  key: string,
  windowSeconds: number,
): Promise<HitResult> {
  return stub(env, scope).hit(key, Number.MAX_SAFE_INTEGER, windowSeconds)
}

/** Throws 429 if the counter already reached `limit` (a lockout check). */
export async function guardAssertBelow(
  env: Bindings,
  scope: string,
  key: string,
  limit: number,
): Promise<void> {
  const r = await stub(env, scope).peek(key)
  if (r.count >= limit) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', {
      retryAfter: r.retryAfter,
    })
  }
}

export async function guardClaim(
  env: Bindings,
  scope: string,
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  return stub(env, scope).claim(key, ttlSeconds)
}

export async function guardClear(env: Bindings, scope: string, key: string): Promise<void> {
  await stub(env, scope).clear(key)
}

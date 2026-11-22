/**
 * Session management.
 *
 * A session token is 32 random URL-safe bytes. The session is keyed in KV by
 * `sha256(token)` so that reading KV doesn't hand out cookies.
 *
 * Cookies (the __Host- prefix makes the browser refuse any version of the
 * cookie that is not Secure, host-only and Path=/, so a sibling subdomain
 * can't plant or overwrite them):
 *   __Host-gw_sess — HttpOnly, Secure, SameSite=Strict; carries the raw token.
 *   __Host-gw_csrf — NOT HttpOnly (readable by SPA), SameSite=Strict; double-submit
 *             token compared against a per-session value in KV on every
 *             non-GET request.
 *
 * A secondary per-user index (`user-sess:<username>`) stores session hashes
 * so we can enumerate a user's active sessions without scanning KV.
 */

import { randomToken, sha256Hex, timingSafeEqualStr } from './crypto'
import { kvDelete, kvGet, kvPut, K, type SessionRecord } from './kv'
import type { Bindings } from './env'

export const COOKIE_SESS = '__Host-gw_sess'
export const COOKIE_CSRF = '__Host-gw_csrf'
export const COOKIE_CHAL = '__Host-gw_chal'

const SESSION_IDLE_SECONDS = 30 * 60 // 30 min idle timeout
const SESSION_DEFAULT_TTL_SECONDS = 8 * 60 * 60 // 8h absolute
const SESSION_REMEMBER_TTL_SECONDS = 7 * 24 * 60 * 60 // 7d with remember-me

interface UserSessionIndex {
  hashes: string[]
}

export function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.get('Cookie') || ''
  const out: Record<string, string> = {}
  raw.split(/;\s*/).forEach((s) => {
    if (!s) return
    const eq = s.indexOf('=')
    if (eq < 0) return
    // A malformed cookie (e.g. planted from a sibling subdomain) must not
    // break every request: keep the raw value instead of throwing.
    const rawValue = s.slice(eq + 1)
    let v = rawValue
    try {
      v = decodeURIComponent(rawValue)
    } catch {
      /* keep raw */
    }
    out[s.slice(0, eq)] = v
  })
  return out
}

function buildSetCookie(
  name: string,
  value: string,
  opts: {
    maxAge?: number
    httpOnly?: boolean
    path?: string
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
  },
): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${opts.path ?? '/'}`)
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  if (opts.secure !== false) parts.push('Secure')
  parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`)
  return parts.join('; ')
}

async function addToUserIndex(env: Bindings, username: string, hash: string) {
  const idx = (await kvGet<UserSessionIndex>(env, K.userSessions(username), 'json')) ?? {
    hashes: [],
  }
  if (!idx.hashes.includes(hash)) {
    idx.hashes.unshift(hash)
    // Cap at 50 to keep list calls cheap. Old entries naturally expire out.
    idx.hashes = idx.hashes.slice(0, 50)
    await kvPut(env, K.userSessions(username), idx)
  }
}

async function removeFromUserIndex(
  env: Bindings,
  username: string,
  hash: string,
) {
  const idx = await kvGet<UserSessionIndex>(env, K.userSessions(username), 'json')
  if (!idx) return
  const next = idx.hashes.filter((h) => h !== hash)
  if (next.length === idx.hashes.length) return
  if (next.length === 0) {
    await kvDelete(env, K.userSessions(username))
  } else {
    await kvPut(env, K.userSessions(username), { hashes: next })
  }
}

export async function createSession(
  env: Bindings,
  req: Request,
  username: string,
  remember = false,
): Promise<{ token: string; csrf: string; ttlSeconds: number; setCookies: string[] }> {
  const token = randomToken(32)
  const csrf = randomToken(24)
  const now = Math.floor(Date.now() / 1000)
  const ttl = remember ? SESSION_REMEMBER_TTL_SECONDS : SESSION_DEFAULT_TTL_SECONDS
  // The raw token is never stored: KV holds only its hash (the key), so a
  // KV dump or a leaked API token doesn't hand out live session cookies.
  const record: SessionRecord = {
    username,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttl,
    ip: req.headers.get('cf-connecting-ip') || '',
    userAgent: (req.headers.get('user-agent') || '').slice(0, 512),
  }
  const hash = await sha256Hex(token)
  await kvPut(env, K.session(hash), record, { expirationTtl: ttl })
  await kvPut(env, K.csrf(hash), csrf, { expirationTtl: ttl })
  await addToUserIndex(env, username, hash)

  const setCookies = [
    buildSetCookie(COOKIE_SESS, token, {
      maxAge: ttl,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    }),
    buildSetCookie(COOKIE_CSRF, csrf, {
      maxAge: ttl,
      httpOnly: false,
      secure: true,
      sameSite: 'Strict',
    }),
  ]
  return { token, csrf, ttlSeconds: ttl, setCookies }
}

export async function destroySession(
  env: Bindings,
  token: string,
): Promise<string[]> {
  const hash = await sha256Hex(token)
  const record = await kvGet<SessionRecord>(env, K.session(hash), 'json')
  await kvDelete(env, K.session(hash))
  await kvDelete(env, K.csrf(hash))
  if (record) await removeFromUserIndex(env, record.username, hash)
  return [
    buildSetCookie(COOKIE_SESS, '', { maxAge: 0 }),
    buildSetCookie(COOKIE_CSRF, '', { maxAge: 0, httpOnly: false }),
  ]
}

export async function destroySessionByHash(
  env: Bindings,
  hash: string,
): Promise<void> {
  const record = await kvGet<SessionRecord>(env, K.session(hash), 'json')
  await kvDelete(env, K.session(hash))
  await kvDelete(env, K.csrf(hash))
  if (record) await removeFromUserIndex(env, record.username, hash)
}

export async function listUserSessions(
  env: Bindings,
  username: string,
): Promise<Array<{ hash: string; record: SessionRecord }>> {
  const idx = await kvGet<UserSessionIndex>(env, K.userSessions(username), 'json')
  if (!idx) return []
  const loaded = await Promise.all(
    idx.hashes.map(async (h) => {
      const r = await kvGet<SessionRecord>(env, K.session(h), 'json')
      return r ? { hash: h, record: r } : null
    }),
  )
  const alive = loaded.filter((x): x is { hash: string; record: SessionRecord } => !!x)
  // Clean up stale index entries silently.
  if (alive.length !== idx.hashes.length) {
    if (alive.length === 0) await kvDelete(env, K.userSessions(username))
    else await kvPut(env, K.userSessions(username), { hashes: alive.map((a) => a.hash) })
  }
  return alive
}

export async function destroyAllSessionsFor(
  env: Bindings,
  username: string,
  exceptHash?: string,
): Promise<number> {
  const alive = await listUserSessions(env, username)
  let killed = 0
  for (const { hash } of alive) {
    if (exceptHash && hash === exceptHash) continue
    await destroySessionByHash(env, hash)
    killed++
  }
  return killed
}

export async function loadSession(
  env: Bindings,
  req: Request,
): Promise<{ record: SessionRecord; hash: string } | null> {
  const token = parseCookies(req)[COOKIE_SESS]
  if (!token) return null
  const hash = await sha256Hex(token)
  const record = await kvGet<SessionRecord>(env, K.session(hash), 'json')
  if (!record) return null

  // Sessions created before the raw token stopped being stored are retired:
  // their token sat in KV in the clear.
  if (record.token !== undefined) {
    await destroySessionByHash(env, hash)
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (now >= record.expiresAt) {
    await destroySessionByHash(env, hash)
    return null
  }
  if (now - record.lastSeenAt > SESSION_IDLE_SECONDS) {
    await destroySessionByHash(env, hash)
    return null
  }

  if (now - record.lastSeenAt > 60) {
    const ttl = record.expiresAt - now
    await kvPut(
      env,
      K.session(hash),
      { ...record, lastSeenAt: now },
      { expirationTtl: Math.max(60, ttl) },
    )
  }

  return { record, hash }
}

export async function verifyCsrf(
  env: Bindings,
  req: Request,
  hash: string,
): Promise<boolean> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true
  const header = req.headers.get('X-CSRF-Token') || ''
  const cookies = parseCookies(req)
  const cookie = cookies[COOKIE_CSRF] || ''
  if (!header || !cookie || header !== cookie) return false
  const stored = await kvGet(env, K.csrf(hash), 'text')
  if (!stored) return false
  return timingSafeEqualStr(stored, header)
}

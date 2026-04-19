/**
 * Typed KV accessors + the canonical key layout.
 *
 * Key layout:
 *   cfg:setup_complete            "1" once onboarding is done
 *   cfg:base_url                  plaintext URL string
 *   cfg:admin_key                 sealed(ADMIN_KEY) — gateway ADMIN_KEY (AES-GCM via DASHBOARD_KEK)
 *   cfg:admin_key_hint            last-4 chars of admin key (for UI display)
 *
 *   user:{username}               JSON { passwordHash, totpSecretSealed?, recoveryHashes[], createdAt, updatedAt }
 *   user:index                    JSON { current: string }   (the single super-admin username)
 *
 *   setup:pending_user            JSON { username, passwordHash } during 2FA-bind step
 *   setup:pending_totp            sealed(secretB32)
 *
 *   sess:{token}                  JSON session record, written with `expirationTtl`
 *   csrf:{sessionToken}           CSRF token (32 random bytes b64url), TTL matches session
 *
 *   rl:{bucket}:{id}              rate-limit counter (numeric string)
 *
 *   merchant:{id}                 sealed(apiKey) JSON (P2)
 */

import { kv, type Bindings } from './env'

export async function kvGet<T = unknown>(
  env: Bindings,
  key: string,
  type: 'json',
): Promise<T | null>
export async function kvGet(
  env: Bindings,
  key: string,
  type?: 'text',
): Promise<string | null>
export async function kvGet(
  env: Bindings,
  key: string,
  type: 'json' | 'text' = 'text',
): Promise<unknown> {
  if (type === 'json') return kv(env).get(key, 'json')
  return kv(env).get(key, 'text')
}

export async function kvPut(
  env: Bindings,
  key: string,
  value: string | object,
  opts: { expirationTtl?: number } = {},
): Promise<void> {
  const body = typeof value === 'string' ? value : JSON.stringify(value)
  await kv(env).put(key, body, opts)
}

export async function kvDelete(env: Bindings, key: string): Promise<void> {
  await kv(env).delete(key)
}

export interface UserRecord {
  username: string
  passwordHash: string
  totpSecretSealed?: string
  recoveryHashes: string[] // SHA-256 hex digests of single-use codes
  createdAt: number
  updatedAt: number
}

export interface SessionRecord {
  token: string
  username: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  ip: string
  userAgent: string
}

export interface MerchantRecord {
  id: string
  name: string
  /** "dashboard" = created via /admin/merchants here; "imported" = manually added */
  source: 'dashboard' | 'imported'
  apiKeySealed: string
  webhookUrl?: string
  apiKeyFingerprint: string // last 4 chars, for UI display
  createdAt: number
  updatedAt: number
}

export const K = {
  setupComplete: 'cfg:setup_complete',
  baseUrl: 'cfg:base_url',
  adminKey: 'cfg:admin_key',
  adminKeyHint: 'cfg:admin_key_hint',
  defaultMerchant: 'cfg:default_merchant_id',
  userIndex: 'user:index',
  user: (u: string) => `user:${u}` as const,
  pendingUser: 'setup:pending_user',
  pendingTotp: 'setup:pending_totp',
  session: (hash: string) => `sess:${hash}` as const,
  csrf: (hash: string) => `csrf:${hash}` as const,
  userSessions: (u: string) => `user-sess:${u}` as const,
  ratelimit: (bucket: string, id: string) => `rl:${bucket}:${id}` as const,

  merchantIndex: 'merchant:index',
  merchant: (id: string) => `merchant:${id}` as const,
}

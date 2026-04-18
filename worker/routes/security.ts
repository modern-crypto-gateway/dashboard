/**
 * Authenticated security endpoints for the logged-in super-admin:
 *
 *   GET  /api/security/sessions                 → list active sessions
 *   POST /api/security/sessions/revoke          → revoke a specific session hash
 *   POST /api/security/sessions/revoke-all      → revoke every session except the current one
 *   POST /api/security/password                 → change password (requires old pw + TOTP)
 *   POST /api/security/totp/begin               → mint a new TOTP secret (pending, not committed)
 *   POST /api/security/totp/commit              → commit a pending TOTP secret (requires code + current TOTP)
 *   POST /api/security/recovery/regenerate      → mint fresh recovery codes (requires pw + TOTP)
 */

import {
  hashPassword,
  mintRecoveryCode,
  seal,
  sha256Hex,
  unseal,
  verifyPassword,
} from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K, type UserRecord } from '../lib/kv'
import {
  destroyAllSessionsFor,
  destroySessionByHash,
  listUserSessions,
} from '../lib/session'
import { generateTotpSecretB32, otpauthUrl, verifyTotp } from '../lib/totp'

async function loadUser(env: Bindings, username: string): Promise<UserRecord> {
  const u = await kvGet<UserRecord>(env, K.user(username), 'json')
  if (!u) throw new HttpError(404, 'NO_USER', 'User not found')
  return u
}

async function verifyCurrentTotp(
  env: Bindings,
  user: UserRecord,
  code: string,
): Promise<boolean> {
  if (!user.totpSecretSealed) return false
  const secret = await unseal(user.totpSecretSealed, kek(env))
  return verifyTotp(code, secret)
}

/* ── sessions ─────────────────────────────────────────────── */

export async function getSessions(
  _req: Request,
  env: Bindings,
  currentHash: string,
  username: string,
): Promise<Response> {
  const rows = await listUserSessions(env, username)
  const now = Math.floor(Date.now() / 1000)
  return json({
    sessions: rows.map(({ hash, record }) => ({
      hash,
      current: hash === currentHash,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt,
      idleSeconds: now - record.lastSeenAt,
      ip: record.ip || null,
      userAgent: record.userAgent || null,
    })),
  })
}

export async function postRevokeSession(
  req: Request,
  env: Bindings,
  currentHash: string,
): Promise<Response> {
  const body = await readJson<{ hash?: string }>(req)
  const target = (body.hash ?? '').trim()
  if (!target) return error('BAD_HASH', 'hash required', 400)
  if (target === currentHash) {
    return error('SELF_REVOKE', 'Use logout to end your own session', 400)
  }
  await destroySessionByHash(env, target)
  return json({ ok: true })
}

export async function postRevokeAllSessions(
  _req: Request,
  env: Bindings,
  currentHash: string,
  username: string,
): Promise<Response> {
  const killed = await destroyAllSessionsFor(env, username, currentHash)
  return json({ ok: true, revoked: killed })
}

/* ── change password ───────────────────────────────────────── */

export async function postChangePassword(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{
    oldPassword?: string
    newPassword?: string
    totp?: string
  }>(req)
  const oldPassword = body.oldPassword ?? ''
  const newPassword = body.newPassword ?? ''
  const code = (body.totp ?? '').trim()

  if (newPassword.length < 12) {
    return error('BAD_PASSWORD', 'New password must be at least 12 characters', 400)
  }

  const user = await loadUser(env, username)
  const okPw = await verifyPassword(oldPassword, user.passwordHash)
  const okTotp = await verifyCurrentTotp(env, user, code)
  if (!okPw || !okTotp) {
    return error('BAD_CREDS', 'Current password or TOTP is invalid', 401)
  }

  const nextHash = await hashPassword(newPassword)
  const updated: UserRecord = {
    ...user,
    passwordHash: nextHash,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  await kvPut(env, K.user(username), updated)
  return json({ ok: true })
}

/* ── rotate TOTP ──────────────────────────────────────────── */

// Stash a pending TOTP secret per-user during rotation, keyed so we don't
// collide with the first-run binding flow.
const pendingRotateKey = (u: string) => `setup:pending_totp_rotate:${u}`

export async function postTotpBegin(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{ password?: string }>(req)
  const user = await loadUser(env, username)
  const okPw = await verifyPassword(body.password ?? '', user.passwordHash)
  if (!okPw) return error('BAD_CREDS', 'Password is invalid', 401)

  const secret = generateTotpSecretB32(20)
  const sealed = await seal(secret, kek(env))
  await kvPut(env, pendingRotateKey(username), sealed, { expirationTtl: 15 * 60 })

  const url = otpauthUrl({
    secretB32: secret,
    label: `Gateway Dashboard:${username}`,
    issuer: 'Gateway Dashboard',
  })
  return json({ secret, otpauthUrl: url })
}

export async function postTotpCommit(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{ code?: string; currentTotp?: string }>(req)
  const code = (body.code ?? '').trim()
  const currentCode = (body.currentTotp ?? '').trim()

  const user = await loadUser(env, username)
  // Require a valid current-TOTP so stealing the dashboard session alone isn't
  // enough to replace the authenticator.
  if (!(await verifyCurrentTotp(env, user, currentCode))) {
    return error('BAD_CURRENT_TOTP', 'Current TOTP is invalid', 401)
  }

  const sealed = await kvGet(env, pendingRotateKey(username), 'text')
  if (!sealed) return error('NO_PENDING', 'Rotation expired — restart', 409)

  const newSecretB32 = await unseal(sealed, kek(env))
  if (!(await verifyTotp(code, newSecretB32))) {
    return error('BAD_CODE', 'New authenticator code is invalid', 401)
  }

  const updated: UserRecord = {
    ...user,
    totpSecretSealed: sealed,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  await kvPut(env, K.user(username), updated)
  await kvDelete(env, pendingRotateKey(username))
  return json({ ok: true })
}

/* ── regenerate recovery codes ────────────────────────────── */

export async function postRegenerateRecovery(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{ password?: string; totp?: string }>(req)
  const user = await loadUser(env, username)
  const okPw = await verifyPassword(body.password ?? '', user.passwordHash)
  const okTotp = await verifyCurrentTotp(env, user, (body.totp ?? '').trim())
  if (!okPw || !okTotp) {
    return error('BAD_CREDS', 'Password or TOTP is invalid', 401)
  }

  const plainCodes = Array.from({ length: 10 }, () => mintRecoveryCode())
  const recoveryHashes = await Promise.all(plainCodes.map((c) => sha256Hex(c)))

  const updated: UserRecord = {
    ...user,
    recoveryHashes,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  await kvPut(env, K.user(username), updated)
  return json({ recoveryCodes: plainCodes })
}

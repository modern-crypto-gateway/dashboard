import {
  hashPassword,
  mintRecoveryCode,
  seal,
  sha256Hex,
  unseal,
} from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K, type UserRecord } from '../lib/kv'
import { createSession } from '../lib/session'
import { cfLimit, clientId } from '../lib/ratelimit'
import { generateTotpSecretB32, otpauthUrl, verifyTotp } from '../lib/totp'

const USERNAME_RX = /^[\w-]{3,32}$/
const BASE_URL_RX = /^https?:\/\/[^\s]{3,256}$/i

interface PendingUser {
  username: string
  passwordHash: string
}

async function assertNotSetup(env: Bindings) {
  const done = await kvGet(env, K.setupComplete, 'text')
  if (done === '1') {
    throw new HttpError(409, 'SETUP_DONE', 'Setup already completed')
  }
}

export async function getSetupStatus(_req: Request, env: Bindings): Promise<Response> {
  const [baseUrl, adminKey, username, done] = await Promise.all([
    kvGet(env, K.baseUrl, 'text'),
    kvGet(env, K.adminKey, 'text'),
    kvGet<{ current: string }>(env, K.userIndex, 'json'),
    kvGet(env, K.setupComplete, 'text'),
  ])
  return json({
    setupComplete: done === '1',
    hasBaseUrl: !!baseUrl,
    hasAdminKey: !!adminKey,
    hasUser: !!username?.current,
    hasTotp: false, // only known after the user record is finalized at completion
  })
}

export async function postBaseUrl(req: Request, env: Bindings): Promise<Response> {
  await assertNotSetup(env)
  await cfLimit(env.SETUP_RL, clientId(req), 'setup')
  const body = await readJson<{ baseUrl?: string }>(req)
  const url = (body.baseUrl ?? '').trim()
  if (!BASE_URL_RX.test(url)) {
    return error('BAD_URL', 'Base URL must be a valid http(s) URL', 400)
  }
  await kvPut(env, K.baseUrl, url)
  return json({ ok: true })
}

export async function postAdminKey(req: Request, env: Bindings): Promise<Response> {
  await assertNotSetup(env)
  await cfLimit(env.SETUP_RL, clientId(req), 'setup')
  const body = await readJson<{ adminKey?: string }>(req)
  const key = (body.adminKey ?? '').trim()
  if (key.length < 32 || key.length > 256 || /\s/.test(key)) {
    return error(
      'BAD_KEY',
      'Admin key must be 32–256 chars with no whitespace',
      400,
    )
  }
  const sealed = await seal(key, kek(env))
  await kvPut(env, K.adminKey, sealed)
  await kvPut(env, K.adminKeyHint, key.slice(-4))
  return json({ ok: true })
}

export async function postUser(req: Request, env: Bindings): Promise<Response> {
  await assertNotSetup(env)
  await cfLimit(env.SETUP_RL, clientId(req), 'setup')
  const body = await readJson<{ username?: string; password?: string }>(req)
  const username = (body.username ?? '').trim()
  const password = body.password ?? ''
  if (!USERNAME_RX.test(username)) {
    return error(
      'BAD_USERNAME',
      'Username must be 3–32 chars of letters, numbers, dash, underscore',
      400,
    )
  }
  if (password.length < 12) {
    return error('BAD_PASSWORD', 'Password must be at least 12 characters', 400)
  }
  // Require admin key + base URL first — prevents accidental 3rd-step-first calls.
  const [hasKey, hasUrl] = await Promise.all([
    kvGet(env, K.adminKey, 'text'),
    kvGet(env, K.baseUrl, 'text'),
  ])
  if (!hasUrl || !hasKey) {
    return error('BAD_ORDER', 'Base URL and admin key must be set first', 409)
  }

  const passwordHash = await hashPassword(password)
  const pending: PendingUser = { username, passwordHash }
  await kvPut(env, K.pendingUser, pending, { expirationTtl: 15 * 60 })
  return json({ ok: true })
}

export async function postTotpBegin(req: Request, env: Bindings): Promise<Response> {
  await assertNotSetup(env)
  await cfLimit(env.SETUP_RL, clientId(req), 'setup')
  const pending = await kvGet<PendingUser>(env, K.pendingUser, 'json')
  if (!pending) {
    return error('NO_PENDING', 'Create the user account first', 409)
  }
  const secret = generateTotpSecretB32(20)
  const sealed = await seal(secret, kek(env))
  await kvPut(env, K.pendingTotp, sealed, { expirationTtl: 15 * 60 })

  const url = otpauthUrl({
    secretB32: secret,
    label: `Gateway Dashboard:${pending.username}`,
    issuer: 'Gateway Dashboard',
  })
  return json({ secret, otpauthUrl: url })
}

export async function postComplete(req: Request, env: Bindings): Promise<Response> {
  await assertNotSetup(env)
  await cfLimit(env.SETUP_RL, clientId(req), 'setup')
  const body = await readJson<{ code?: string }>(req)
  const code = (body.code ?? '').trim()

  const [pending, sealed] = await Promise.all([
    kvGet<PendingUser>(env, K.pendingUser, 'json'),
    kvGet(env, K.pendingTotp, 'text'),
  ])
  if (!pending || !sealed) {
    return error('NO_PENDING', 'Restart setup — binding state expired', 409)
  }

  const secretB32 = await unseal(sealed, kek(env))
  const ok = await verifyTotp(code, secretB32)
  if (!ok) {
    return error('BAD_CODE', 'Invalid or expired code', 401)
  }

  // Mint 10 single-use recovery codes — 80-bit entropy each. Show plaintext
  // once, store SHA-256 hashes (pre-image resistance suffices at this
  // entropy; password hashing is overkill for codes this long).
  const plainCodes = Array.from({ length: 10 }, () => mintRecoveryCode())
  const recoveryHashes = await Promise.all(plainCodes.map((c) => sha256Hex(c)))

  const now = Math.floor(Date.now() / 1000)
  const user: UserRecord = {
    username: pending.username,
    passwordHash: pending.passwordHash,
    totpSecretSealed: sealed,
    recoveryHashes,
    createdAt: now,
    updatedAt: now,
  }
  await kvPut(env, K.user(pending.username), user)
  await kvPut(env, K.userIndex, { current: pending.username })
  await kvDelete(env, K.pendingUser)
  await kvDelete(env, K.pendingTotp)
  await kvPut(env, K.setupComplete, '1')

  // Auto-login after successful setup.
  const { setCookies } = await createSession(env, req, pending.username, false)
  const headers = new Headers()
  for (const c of setCookies) headers.append('Set-Cookie', c)
  return json({ recoveryCodes: plainCodes, authenticated: true }, { headers })
}

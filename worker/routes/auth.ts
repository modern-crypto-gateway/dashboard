import { randomToken, sha256Hex, unseal, verifyPassword } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K, type UserRecord } from '../lib/kv'
import {
  createSession,
  destroySession,
  loadSession,
  parseCookies,
} from '../lib/session'
import { clientId, rateLimit, RL_LOGIN, RL_TOTP } from '../lib/ratelimit'
import { verifyTotp } from '../lib/totp'

interface Challenge {
  username: string
  remember: boolean
  createdAt: number
}

const CHALLENGE_TTL = 5 * 60 // 5 minutes

/* ── /api/auth/session ──────────────────────────────────────── */

export async function getSession(req: Request, env: Bindings): Promise<Response> {
  const sess = await loadSession(env, req)
  if (!sess) return json({ authenticated: false })
  const baseUrl = (await kvGet(env, K.baseUrl, 'text')) ?? undefined
  return json({
    authenticated: true,
    user: { username: sess.record.username },
    baseUrl,
  })
}

/* ── /api/auth/logout ───────────────────────────────────────── */

export async function postLogout(req: Request, env: Bindings): Promise<Response> {
  const { gw_sess } = parseCookies(req)
  const headers = new Headers()
  if (gw_sess) {
    const setCookies = await destroySession(env, gw_sess)
    for (const c of setCookies) headers.append('Set-Cookie', c)
  }
  return json({ ok: true }, { headers })
}

/* ── /api/auth/login/password ───────────────────────────────── */

export async function postLoginPassword(
  req: Request,
  env: Bindings,
): Promise<Response> {
  await rateLimit(env, 'login', clientId(req), RL_LOGIN)
  const body = await readJson<{
    username?: string
    password?: string
    remember?: boolean
  }>(req)
  const username = (body.username ?? '').trim()
  const password = body.password ?? ''
  if (!username || !password) {
    return error('BAD_INPUT', 'Username and password required', 400)
  }

  const user = await kvGet<UserRecord>(env, K.user(username), 'json')
  // Dummy verify to equalize timing on non-existent users.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(
        password,
        // constant dummy hash — iterations match real hashes so timing is stable.
        'pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      )
  if (!user || !ok) {
    return error('BAD_CREDS', 'Invalid username or password', 401)
  }

  const challengeToken = randomToken(32)
  const chKey = `challenge:${await sha256Hex(challengeToken)}`
  const challenge: Challenge = {
    username,
    remember: !!body.remember,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await kvPut(env, chKey, challenge, { expirationTtl: CHALLENGE_TTL })

  // Stash the challenge token in an HttpOnly short-lived cookie so the
  // SPA's second request doesn't have to shuttle it through JS.
  const headers = new Headers()
  headers.append(
    'Set-Cookie',
    `gw_chal=${encodeURIComponent(challengeToken)}; Path=/; Max-Age=${CHALLENGE_TTL}; HttpOnly; Secure; SameSite=Strict`,
  )

  return json({ challengeToken }, { headers })
}

/* ── /api/auth/login/totp ───────────────────────────────────── */

export async function postLoginTotp(
  req: Request,
  env: Bindings,
): Promise<Response> {
  await rateLimit(env, 'totp', clientId(req), RL_TOTP)
  const body = await readJson<{ code?: string; recovery?: string }>(req)

  const { gw_chal } = parseCookies(req)
  if (!gw_chal) {
    return error('NO_CHALLENGE', 'No login challenge — re-enter your password', 401)
  }
  const chKey = `challenge:${await sha256Hex(gw_chal)}`
  const challenge = await kvGet<Challenge>(env, chKey, 'json')
  if (!challenge) {
    return error('NO_CHALLENGE', 'Login challenge expired — re-enter your password', 401)
  }

  const user = await kvGet<UserRecord>(env, K.user(challenge.username), 'json')
  if (!user || !user.totpSecretSealed) {
    await kvDelete(env, chKey)
    return error('NO_USER', 'Account missing or unbound', 401)
  }

  const code = (body.code ?? '').trim()
  const recovery = (body.recovery ?? '').trim()

  let passed = false
  if (code) {
    const secret = await unseal(user.totpSecretSealed, kek(env))
    passed = await verifyTotp(code, secret)
  } else if (recovery) {
    const h = await sha256Hex(recovery)
    const idx = user.recoveryHashes.indexOf(h)
    if (idx >= 0) {
      passed = true
      // Consume the code.
      const updated: UserRecord = {
        ...user,
        recoveryHashes: user.recoveryHashes.filter((_, i) => i !== idx),
        updatedAt: Math.floor(Date.now() / 1000),
      }
      await kvPut(env, K.user(user.username), updated)
    }
  } else {
    return error('BAD_INPUT', 'Provide an authenticator code or recovery code', 400)
  }

  if (!passed) {
    return error('BAD_CODE', 'Invalid code', 401)
  }

  // Consume challenge, mint session.
  await kvDelete(env, chKey)
  const { setCookies } = await createSession(
    env,
    req,
    user.username,
    challenge.remember,
  )
  const headers = new Headers()
  // Clear the challenge cookie.
  headers.append(
    'Set-Cookie',
    `gw_chal=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  )
  for (const c of setCookies) headers.append('Set-Cookie', c)
  return json({ authenticated: true }, { headers })
}

/* ── middleware: require auth + CSRF for mutating routes ───── */

export async function requireAuth(req: Request, env: Bindings) {
  const sess = await loadSession(env, req)
  if (!sess) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required')
  }
  return sess
}

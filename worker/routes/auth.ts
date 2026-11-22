import { randomToken, sha256Hex, verifyPassword } from '../lib/crypto'
import { type Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K, type UserRecord } from '../lib/kv'
import {
  COOKIE_CHAL,
  COOKIE_SESS,
  createSession,
  destroySession,
  loadSession,
  parseCookies,
} from '../lib/session'
import { clientId } from '../lib/ratelimit'
import { guardClear, guardCount, guardHit } from '../lib/guard'
import {
  claimRecoveryCode,
  clearTotpFailures,
  takeTotpAttempt,
  userScope,
  verifyUserTotpOnce,
} from '../lib/stepup'
import { turnstileEnabled, verifyTurnstile } from '../lib/turnstile'

interface Challenge {
  username: string
  remember: boolean
  createdAt: number
}

const CHALLENGE_TTL = 5 * 60 // 5 minutes

/* Brute-force limits. All counted exactly in the AuthGuard Durable Object.
 *   - per IP (IPv6: per /64): password 10 / 5 min, 2FA 20 / 5 min
 *   - per username from one IP / 64: 20 password attempts / hour
 *   - per username from anywhere: 300 password attempts / hour. High on
 *     purpose: a low global cap would let anyone lock the operator out by
 *     spraying wrong passwords; this one only stops large distributed
 *     guessing, and with Turnstile on each attempt costs a solved challenge.
 *   - per login challenge: 5 wrong 2FA codes, then the challenge is burned and
 *     the password has to be entered again
 *   - per user: 10 2FA / recovery attempts per hour without a success locks
 *     every 2FA check (see stepup.ts). Reaching it needs the password.
 * Attempts are counted before they are checked (atomic), so a burst of
 * parallel requests can't get past a limit. */
const IP_PASSWORD = { limit: 10, window: 5 * 60 }
const IP_TOTP = { limit: 20, window: 5 * 60 }
const USER_IP_PASSWORD = { limit: 20, window: 60 * 60 }
const USER_PASSWORD = { limit: 300, window: 60 * 60 }
const CHALLENGE_ATTEMPTS = 5

const USERNAME_MAX = 64

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

/* ── /api/auth/login-config (public) ─────────────────────────── */

/** What the login screen needs before sign-in: the public Turnstile site key. */
export function getLoginConfig(_req: Request, env: Bindings): Response {
  return json({
    turnstileSiteKey: turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null,
  })
}

/* ── /api/auth/logout ───────────────────────────────────────── */

export async function postLogout(req: Request, env: Bindings): Promise<Response> {
  const token = parseCookies(req)[COOKIE_SESS]
  const headers = new Headers()
  if (token) {
    const setCookies = await destroySession(env, token)
    for (const c of setCookies) headers.append('Set-Cookie', c)
  }
  return json({ ok: true }, { headers })
}

/* ── /api/auth/login/password ───────────────────────────────── */

export async function postLoginPassword(
  req: Request,
  env: Bindings,
): Promise<Response> {
  await guardHit(env, `ip:${clientId(req)}`, 'login-pw', IP_PASSWORD.limit, IP_PASSWORD.window)
  const body = await readJson<{
    username?: string
    password?: string
    remember?: boolean
    turnstileToken?: string
  }>(req)
  // Turnstile first: a bot without a fresh token never reaches the password
  // check or the per-username counter.
  await verifyTurnstile(env, req, body.turnstileToken)

  const username = (typeof body.username === 'string' ? body.username : '').trim()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password || username.length > USERNAME_MAX || password.length > 1024) {
    return error('BAD_INPUT', 'Username and password required', 400)
  }

  const pwKey = `pw:${clientId(req)}`
  await guardHit(env, userScope(username), pwKey, USER_IP_PASSWORD.limit, USER_IP_PASSWORD.window)
  const all = await guardHit(env, userScope(username), 'pw', USER_PASSWORD.limit, USER_PASSWORD.window)
  if (all.count === USER_PASSWORD.limit) {
    console.warn('security: password attempt limit reached', { username })
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
  await guardClear(env, userScope(username), pwKey)

  const challengeToken = randomToken(32)
  const chKey = `challenge:${await sha256Hex(challengeToken)}`
  const challenge: Challenge = {
    username,
    remember: !!body.remember,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await kvPut(env, chKey, challenge, { expirationTtl: CHALLENGE_TTL })

  // The challenge token lives only in an HttpOnly cookie; it is not returned
  // in the body, so page scripts never see it.
  const headers = new Headers()
  headers.append(
    'Set-Cookie',
    `${COOKIE_CHAL}=${encodeURIComponent(challengeToken)}; Path=/; Max-Age=${CHALLENGE_TTL}; HttpOnly; Secure; SameSite=Strict`,
  )

  return json({ ok: true }, { headers })
}

/* ── /api/auth/login/totp ───────────────────────────────────── */

export async function postLoginTotp(
  req: Request,
  env: Bindings,
): Promise<Response> {
  await guardHit(env, `ip:${clientId(req)}`, 'login-totp', IP_TOTP.limit, IP_TOTP.window)
  const body = await readJson<{ code?: string; recovery?: string }>(req)

  const chalToken = parseCookies(req)[COOKIE_CHAL]
  if (!chalToken) {
    return error('NO_CHALLENGE', 'No login challenge — re-enter your password', 401)
  }
  const chHash = await sha256Hex(chalToken)
  const chKey = `challenge:${chHash}`
  const challenge = await kvGet<Challenge>(env, chKey, 'json')
  if (!challenge) {
    return error('NO_CHALLENGE', 'Login challenge expired — re-enter your password', 401)
  }

  const user = await kvGet<UserRecord>(env, K.user(challenge.username), 'json')
  if (!user || !user.totpSecretSealed) {
    await kvDelete(env, chKey)
    return error('NO_USER', 'Account missing or unbound', 401)
  }

  // Each challenge gets a few tries, counted exactly; then it is burned.
  const tries = await guardCount(env, userScope(user.username), `chal:${chHash}`, CHALLENGE_TTL)
  if (tries.count > CHALLENGE_ATTEMPTS) {
    await kvDelete(env, chKey)
    return error('NO_CHALLENGE', 'Too many wrong codes — re-enter your password', 401)
  }

  const code = (typeof body.code === 'string' ? body.code : '').trim()
  const recovery = (typeof body.recovery === 'string' ? body.recovery : '').trim()

  let passed = false
  if (code) {
    passed = await verifyUserTotpOnce(env, user, code)
  } else if (recovery) {
    await takeTotpAttempt(env, user.username)
    const h = await sha256Hex(recovery)
    const idx = user.recoveryHashes.indexOf(h)
    // Claim the code atomically before honouring it, so two parallel requests
    // can't both spend it.
    if (idx >= 0 && (await claimRecoveryCode(env, user.username, h))) {
      passed = true
      const fresh = await kvGet<UserRecord>(env, K.user(user.username), 'json')
      const updated: UserRecord = {
        ...(fresh ?? user),
        recoveryHashes: (fresh ?? user).recoveryHashes.filter((x) => x !== h),
        updatedAt: Math.floor(Date.now() / 1000),
      }
      await kvPut(env, K.user(user.username), updated)
      console.warn('security: recovery code used', { username: user.username })
    }
  } else {
    return error('BAD_INPUT', 'Provide an authenticator code or recovery code', 400)
  }

  if (!passed) {
    if (tries.count >= CHALLENGE_ATTEMPTS) await kvDelete(env, chKey)
    return error('BAD_CODE', 'Invalid code', 401)
  }

  // Consume challenge, mint session.
  await kvDelete(env, chKey)
  await clearTotpFailures(env, user.username)
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
    `${COOKIE_CHAL}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
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

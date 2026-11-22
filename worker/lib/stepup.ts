/**
 * "Prove it's still you" checks with the operator's authenticator.
 *
 * A TOTP code stays valid for about 90 seconds (±1 step). Anyone who sees a
 * code (shoulder-surfing, a logged request, a phishing page relaying it) could
 * reuse it in that window, so every accepted code's time step is claimed once
 * per user in the AuthGuard Durable Object and a second use is refused.
 *
 * Every attempt is counted (atomically, before the code is checked, so a
 * burst of parallel guesses can't slip past) toward a per-user limit: 10
 * attempts in an hour without a success blocks every TOTP check for that user
 * (login included) until the hour ends. A correct code clears the count.
 * Reaching that point needs the password or a live session already, so the
 * lockout is a stop for an attacker who has one of those, not a way for an
 * outsider to lock the operator out.
 */

import { unseal } from './crypto'
import { kek, type Bindings } from './env'
import { guardClaim, guardClear, guardHit } from './guard'
import { HttpError } from './http'
import type { UserRecord } from './kv'
import { matchTotpStep } from './totp'

export const TOTP_FAIL_LIMIT = 10
export const TOTP_FAIL_WINDOW = 60 * 60
const STEP_CLAIM_TTL = 3 * 60

export const userScope = (username: string) => `user:${username}`

/**
 * Count one TOTP / recovery-code attempt before it is checked. Throws 429 once
 * the user is over the limit. Atomic, so parallel requests can't all pass.
 */
export async function takeTotpAttempt(env: Bindings, username: string): Promise<void> {
  const r = await guardHit(env, userScope(username), 'totp-fail', TOTP_FAIL_LIMIT, TOTP_FAIL_WINDOW)
  if (r.count === TOTP_FAIL_LIMIT) {
    console.warn('security: TOTP attempt limit reached', { username, retryAfter: r.retryAfter })
  }
}

export async function clearTotpFailures(env: Bindings, username: string): Promise<void> {
  await guardClear(env, userScope(username), 'totp-fail')
}

/**
 * Check `code` against the user's current authenticator, accepting each code
 * once. Counts the attempt toward the limit first. Returns true on success.
 */
export async function verifyUserTotpOnce(
  env: Bindings,
  user: UserRecord,
  code: string,
): Promise<boolean> {
  await takeTotpAttempt(env, user.username)
  if (!user.totpSecretSealed || !code) return false
  const secret = await unseal(user.totpSecretSealed, kek(env))
  const step = await matchTotpStep(code, secret)
  if (step === null) return false
  if (!(await guardClaim(env, userScope(user.username), `totp-step:${step}`, STEP_CLAIM_TTL))) {
    throw new HttpError(
      401,
      'TOTP_REUSED',
      'That code was already used. Wait for the next code in your authenticator.',
    )
  }
  await clearTotpFailures(env, user.username)
  return true
}

/** Claim a recovery code hash once (two parallel requests can't both use it). */
export async function claimRecoveryCode(
  env: Bindings,
  username: string,
  hash: string,
): Promise<boolean> {
  return guardClaim(env, userScope(username), `recovery:${hash}`, 365 * 24 * 60 * 60)
}

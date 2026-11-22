/**
 * "Prove it's still you" checks with the operator's authenticator.
 *
 * A TOTP code stays valid for about 90 seconds (±1 step). Anyone who sees a
 * code (shoulder-surfing, a logged request, a phishing page relaying it) could
 * reuse it in that window, so every accepted code's time step is claimed once
 * per user in the AuthGuard Durable Object and a second use is refused.
 *
 * Failed codes count toward a per-user lockout: 10 wrong codes in an hour
 * blocks every TOTP check for that user (login included) until the hour ends.
 * Reaching that point needs the password or a live session already, so the
 * lockout is a stop for an attacker who has one of those, not a way for an
 * outsider to lock the operator out.
 */

import { unseal } from './crypto'
import { kek, type Bindings } from './env'
import { guardAssertBelow, guardClaim, guardClear, guardCount } from './guard'
import { HttpError } from './http'
import type { UserRecord } from './kv'
import { matchTotpStep } from './totp'

export const TOTP_FAIL_LIMIT = 10
export const TOTP_FAIL_WINDOW = 60 * 60
const STEP_CLAIM_TTL = 3 * 60

export const userScope = (username: string) => `user:${username}`

/** Throws 429 while the user's TOTP lockout is active. */
export async function assertTotpNotLocked(env: Bindings, username: string): Promise<void> {
  await guardAssertBelow(env, userScope(username), 'totp-fail', TOTP_FAIL_LIMIT)
}

/** Record one failed TOTP / recovery attempt for the user. */
export async function recordTotpFailure(env: Bindings, username: string): Promise<void> {
  const r = await guardCount(env, userScope(username), 'totp-fail', TOTP_FAIL_WINDOW)
  if (r.count === TOTP_FAIL_LIMIT) {
    console.warn('security: TOTP lockout engaged', { username, retryAfter: r.retryAfter })
  }
}

export async function clearTotpFailures(env: Bindings, username: string): Promise<void> {
  await guardClear(env, userScope(username), 'totp-fail')
}

/**
 * Check `code` against the user's current authenticator, accepting each code
 * once. Counts failures toward the lockout. Returns true on success.
 */
export async function verifyUserTotpOnce(
  env: Bindings,
  user: UserRecord,
  code: string,
): Promise<boolean> {
  await assertTotpNotLocked(env, user.username)
  if (!user.totpSecretSealed || !code) {
    await recordTotpFailure(env, user.username)
    return false
  }
  const secret = await unseal(user.totpSecretSealed, kek(env))
  const step = await matchTotpStep(code, secret)
  if (step === null) {
    await recordTotpFailure(env, user.username)
    return false
  }
  if (!(await guardClaim(env, userScope(user.username), `totp-step:${step}`, STEP_CLAIM_TTL))) {
    throw new HttpError(
      401,
      'TOTP_REUSED',
      'That code was already used. Wait for the next code in your authenticator.',
    )
  }
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

/**
 * Cloudflare Turnstile check for the password step of login.
 *
 * Off until TURNSTILE_SECRET_KEY is set (`wrangler secret put
 * TURNSTILE_SECRET_KEY`) so a deploy never locks the operator out before the
 * widget exists. Once the secret is set it fails closed: a missing, invalid,
 * reused or wrong-site token, or siteverify being unreachable, all refuse login.
 */

import type { Bindings } from './env'
import { HttpError } from './http'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_ACTION = 'login'

interface SiteverifyResult {
  success?: boolean
  action?: string
  hostname?: string
  'error-codes'?: string[]
  metadata?: { result_with_testing_key?: boolean }
}

export function turnstileEnabled(env: Bindings): boolean {
  return !!env.TURNSTILE_SECRET_KEY && !!env.TURNSTILE_SITE_KEY
}

export async function verifyTurnstile(
  env: Bindings,
  req: Request,
  token: unknown,
): Promise<void> {
  if (!turnstileEnabled(env)) return
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new HttpError(400, 'TURNSTILE_REQUIRED', 'Complete the human check and try again.')
  }

  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET_KEY as string)
  form.append('response', token)
  const ip = req.headers.get('cf-connecting-ip')
  if (ip) form.append('remoteip', ip)

  let data: SiteverifyResult
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form })
    data = (await res.json()) as SiteverifyResult
  } catch {
    throw new HttpError(503, 'TURNSTILE_UNAVAILABLE', 'Human check is unavailable. Try again shortly.')
  }

  if (!data.success) {
    console.warn('turnstile rejected', { codes: data['error-codes'] ?? [] })
    throw new HttpError(403, 'TURNSTILE_FAILED', 'Human check failed. Try again.')
  }
  // Cloudflare's published test keys (local dev) answer without action or our
  // hostname. Only those answers carry this flag; real keys never do.
  if (data.metadata?.result_with_testing_key === true) return
  if (data.action !== TURNSTILE_ACTION) {
    throw new HttpError(403, 'TURNSTILE_FAILED', 'Human check failed. Try again.')
  }
  // The token must have been issued on this site, not lifted from another
  // page that uses the same site key. Local dev serves on localhost.
  const host = new URL(req.url).hostname
  if (host !== 'localhost' && host !== '127.0.0.1' && data.hostname !== host) {
    throw new HttpError(403, 'TURNSTILE_FAILED', 'Human check failed. Try again.')
  }
}

import { recordRateLimit } from '@/lib/rateLimit'
import { requestStepUpCode, STEPUP_RETRY_CODES } from '@/lib/stepup'
import { isDryRunBody, moneyActionFor, STEPUP_HEADER } from '../../shared/moneyRoutes'

export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(msg: string, status: number, code?: string, details?: unknown) {
    super(msg)
    this.status = status
    this.code = code
    this.details = details
  }
}

function getCookie(name: string): string | null {
  const v = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='))
  return v ? decodeURIComponent(v.slice(name.length + 1)) : null
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const csrf = getCookie('__Host-gw_csrf')
  if (csrf && init.method && init.method !== 'GET') {
    headers.set('X-CSRF-Token', csrf)
  }

  // Money moves need a fresh authenticator code (shared/moneyRoutes.ts). Ask
  // before sending; if the Worker still refuses (wrong / already-used code,
  // or a route this copy of the list doesn't know), ask again and resend.
  // A refused request did nothing on the server, so resending is safe.
  const match = moneyActionFor(init.method ?? 'GET', path)
  let action =
    match && !(match.dryRunOk && typeof init.body === 'string' && isDryRunBody(init.body))
      ? match.label
      : null
  let stepUpError: string | undefined
  let res: Response
  for (;;) {
    if (action) {
      const code = await requestStepUpCode(action, stepUpError)
      if (code === null) {
        throw new ApiError('Cancelled — no authenticator code entered', 0, 'STEPUP_CANCELLED')
      }
      headers.set(STEPUP_HEADER, code)
    }
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
    if (res.status !== 401) break
    const peek = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: string; message?: string; details?: { action?: string } } } | null
    const code = peek?.error?.code
    if (!code || !STEPUP_RETRY_CODES.has(code)) break
    // Only the money-route gate's refusals (they name the action). Routes
    // that take the code in their body (settings, assistant approve) show
    // their own error instead of this prompt.
    const gateAction = peek?.error?.details?.action
    if (!action && !gateAction) break
    action = action ?? gateAction ?? 'This action'
    stepUpError = code === 'TOTP_REQUIRED' ? undefined : peek?.error?.message
  }
  // Record merchant-scoped rate-limit headers on success AND failure — the
  // batch page uses these for a pre-submit quota warning and a 429 response
  // is exactly when the numbers are most useful.
  recordRateLimit(path, res.headers)

  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : null

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error
    // A non-OK response without the `{ error }` envelope (e.g. the exchange
    // run route answers 409 with a plain result object) keeps its body in
    // `details` so the caller can still read it.
    throw new ApiError(
      err?.message || res.statusText || 'Request failed',
      res.status,
      err?.code,
      err ? err.details : (body ?? undefined),
    )
  }
  return body as T
}

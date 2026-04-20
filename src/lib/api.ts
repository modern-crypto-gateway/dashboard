import { recordRateLimit } from '@/lib/rateLimit'

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
  const csrf = getCookie('gw_csrf')
  if (csrf && init.method && init.method !== 'GET') {
    headers.set('X-CSRF-Token', csrf)
  }

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  // Record merchant-scoped rate-limit headers on success AND failure — the
  // batch page uses these for a pre-submit quota warning and a 429 response
  // is exactly when the numbers are most useful.
  recordRateLimit(path, res.headers)

  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : null

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error
    throw new ApiError(
      err?.message || res.statusText || 'Request failed',
      res.status,
      err?.code,
      err?.details,
    )
  }
  return body as T
}

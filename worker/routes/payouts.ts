/**
 * Payout routes — merchant-scoped, proxied through the merchant's API key.
 *
 *   GET  /api/mg/:merchantId/payouts                → list via gateway /api/v1/payouts
 *   POST /api/mg/:merchantId/payouts                → plan a payout via gateway
 *   GET  /api/mg/:merchantId/payouts/:id            → fetch detail via gateway
 *   POST /api/mg/:merchantId/payouts/estimate       → tier-fee quote
 *   POST /api/mg/:merchantId/payouts/batch          → mass-create up to 100 rows
 *   POST /api/mg/:merchantId/payouts/:id/cancel     → cancel a reserved payout (v2.2)
 *
 * Rate-limit headers from the gateway are forwarded through so the browser's
 * rate-limit store can show a pre-flight quota warning on the batch page.
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { HttpError, json, readJson } from '../lib/http'
import { kvGet, K } from '../lib/kv'

const LIST_PASSTHROUGH = [
  'status',
  'kind',
  'chainId',
  'token',
  'destinationAddress',
  'sourceAddress',
  'batchId',
  'createdFrom',
  'createdTo',
  'limit',
  'offset',
] as const

// Headers we forward from the upstream gateway response to the browser. The
// browser's rate-limit store keys on these to gate batch submit before 429.
const FORWARD_UPSTREAM_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
]

function rateLimitHeaders(upstream: Response): Headers {
  const h = new Headers()
  for (const name of FORWARD_UPSTREAM_HEADERS) {
    const v = upstream.headers.get(name)
    if (v !== null) h.set(name, v)
  }
  return h
}

async function gwFetch(
  env: Bindings,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const baseUrl = (await kvGet(env, K.baseUrl, 'text')) ?? ''
  if (!baseUrl) throw new HttpError(400, 'NO_BASE_URL', 'Gateway base URL is not configured')
  const target = new URL(
    path.replace(/\/+/g, '/'),
    baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
  )
  return fetch(target.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

/** Forwarded upstream error shape re-built on the dashboard side so browsers see a consistent envelope. */
function errorWithHeaders(
  upstream: Response,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body = { error: { code, message, details } }
  return json(body, {
    status: upstream.status || 502,
    headers: rateLimitHeaders(upstream),
  })
}

export async function listPayouts(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const incoming = new URL(req.url).searchParams
  const qs = new URLSearchParams()
  for (const key of LIST_PASSTHROUGH) {
    const v = incoming.get(key)
    if (v) qs.set(key, v)
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const upstream = await gwFetch(env, apiKey, 'GET', `/api/v1/payouts${suffix}`)
  const payload = (await upstream.json().catch(() => ({}))) as {
    payouts?: unknown[]
    limit?: number
    offset?: number
    hasMore?: boolean
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected list',
      payload.error?.details,
    )
  }
  return json(payload, {
    status: upstream.status,
    headers: rateLimitHeaders(upstream),
  })
}

export async function createPayout(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req)
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(env, apiKey, 'POST', '/api/v1/payouts', body)
  const payload = (await upstream.json().catch(() => ({}))) as {
    payout?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.payout) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected create',
      payload.error?.details,
    )
  }
  return json(
    { payout: payload.payout },
    { status: upstream.status, headers: rateLimitHeaders(upstream) },
  )
}

export async function getPayout(
  _req: Request,
  env: Bindings,
  merchantId: string,
  id: string,
): Promise<Response> {
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(
    env,
    apiKey,
    'GET',
    `/api/v1/payouts/${encodeURIComponent(id)}`,
  )
  const payload = (await upstream.json().catch(() => ({}))) as {
    payout?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.payout) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Payout not found',
    )
  }
  return json(payload, {
    status: upstream.status,
    headers: rateLimitHeaders(upstream),
  })
}

export async function estimatePayout(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req)
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(
    env,
    apiKey,
    'POST',
    '/api/v1/payouts/estimate',
    body,
  )
  const payload = (await upstream.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; details?: unknown }
    [k: string]: unknown
  }
  if (!upstream.ok) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected estimate',
      payload.error?.details,
    )
  }
  return json(payload, {
    status: upstream.status,
    headers: rateLimitHeaders(upstream),
  })
}

export async function cancelPayout(
  _req: Request,
  env: Bindings,
  merchantId: string,
  id: string,
): Promise<Response> {
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(
    env,
    apiKey,
    'POST',
    `/api/v1/payouts/${encodeURIComponent(id)}/cancel`,
  )
  const payload = (await upstream.json().catch(() => ({}))) as {
    payout?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.payout) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected cancel',
      payload.error?.details,
    )
  }
  return json(
    { payout: payload.payout },
    { status: upstream.status, headers: rateLimitHeaders(upstream) },
  )
}

export async function batchPayouts(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req)
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(
    env,
    apiKey,
    'POST',
    '/api/v1/payouts/batch',
    body,
  )
  const payload = (await upstream.json().catch(() => ({}))) as {
    batchId?: string
    results?: unknown[]
    summary?: { planned: number; failed: number }
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.batchId) {
    return errorWithHeaders(
      upstream,
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected batch',
      payload.error?.details,
    )
  }
  return json(payload, {
    status: upstream.status,
    headers: rateLimitHeaders(upstream),
  })
}

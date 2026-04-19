/**
 * Payout routes — merchant-scoped, proxied through the merchant's API key.
 *
 *   GET  /api/mg/:merchantId/payouts           → list via gateway /api/v1/payouts
 *   POST /api/mg/:merchantId/payouts           → plan a payout via gateway
 *   GET  /api/mg/:merchantId/payouts/:id       → fetch detail via gateway
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvGet, K } from '../lib/kv'

const LIST_PASSTHROUGH = [
  'status',
  'chainId',
  'token',
  'destinationAddress',
  'sourceAddress',
  'createdFrom',
  'createdTo',
  'limit',
  'offset',
] as const

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
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected list',
      upstream.status || 502,
      payload.error?.details,
    )
  }
  return json(payload, { status: upstream.status })
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
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected create',
      upstream.status || 502,
      payload.error?.details,
    )
  }
  return json({ payout: payload.payout }, { status: upstream.status })
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
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Payout not found',
      upstream.status || 502,
    )
  }
  return json(payload, { status: upstream.status })
}

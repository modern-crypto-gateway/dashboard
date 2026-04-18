/**
 * Payout routes — merchant-scoped, KV-tracked index per merchant.
 *
 *   GET  /api/mg/:merchantId/payouts            → list tracked payouts (from KV)
 *   POST /api/mg/:merchantId/payouts            → plan a payout, track result
 *   GET  /api/mg/:merchantId/payouts/:id        → fetch detail, update track
 *   POST /api/mg/:merchantId/payouts/:id/track  → import a payout id created outside
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvGet, kvPut, K, type TrackedPayout } from '../lib/kv'

interface IndexShape {
  ids: string[]
}

async function upsertTracked(
  env: Bindings,
  merchantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gw: Record<string, any>,
): Promise<TrackedPayout> {
  const id = gw.id as string
  const now = Math.floor(Date.now() / 1000)
  const existing = await kvGet<TrackedPayout>(env, K.payout(merchantId, id), 'json')
  const record: TrackedPayout = {
    id,
    merchantId,
    chainId: gw.chainId ?? existing?.chainId ?? 0,
    token: gw.token ?? existing?.token ?? '',
    status: gw.status ?? existing?.status ?? 'planned',
    amountRaw: gw.amountRaw ?? existing?.amountRaw ?? '',
    destinationAddress: gw.destinationAddress ?? existing?.destinationAddress ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await kvPut(env, K.payout(merchantId, id), record)

  const idx = (await kvGet<IndexShape>(env, K.payoutIndex(merchantId), 'json')) ?? { ids: [] }
  if (!idx.ids.includes(id)) {
    idx.ids.unshift(id)
    if (idx.ids.length > 500) idx.ids = idx.ids.slice(0, 500)
    await kvPut(env, K.payoutIndex(merchantId), idx)
  }
  return record
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

export async function listPayouts(
  _req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const idx = await kvGet<IndexShape>(env, K.payoutIndex(merchantId), 'json')
  const ids = idx?.ids ?? []
  const loaded = await Promise.all(
    ids.map((id) => kvGet<TrackedPayout>(env, K.payout(merchantId, id), 'json')),
  )
  return json({
    payouts: loaded.filter((x): x is TrackedPayout => !!x),
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
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected create',
      upstream.status || 502,
      payload.error?.details,
    )
  }
  const tracked = await upsertTracked(env, merchantId, payload.payout)
  return json({ payout: payload.payout, tracked }, { status: upstream.status })
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
  await upsertTracked(env, merchantId, payload.payout)
  return json(payload, { status: upstream.status })
}

export async function trackPayout(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<{ id?: string }>(req)
  const id = (body.id ?? '').trim()
  if (!id) return error('BAD_ID', 'Payout id required', 400)
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
      payload.error?.message ?? 'Payout not found or not owned by this merchant',
      upstream.status || 502,
    )
  }
  const tracked = await upsertTracked(env, merchantId, payload.payout)
  return json({ payout: payload.payout, tracked })
}

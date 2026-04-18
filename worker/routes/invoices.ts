/**
 * Invoice routes — merchant-scoped, with a KV-tracked index per merchant.
 *
 *   GET  /api/mg/:merchantId/invoices                → list tracked invoices (from KV index)
 *   POST /api/mg/:merchantId/invoices                → create via gateway, track result
 *   GET  /api/mg/:merchantId/invoices/:id            → fetch detail via gateway, update track
 *   POST /api/mg/:merchantId/invoices/:id/expire     → force-expire via gateway, update track
 *   POST /api/mg/:merchantId/invoices/:id/track      → import an invoice id we didn't create here
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { error, json, readJson, HttpError } from '../lib/http'
import { kvGet, kvPut, K, type TrackedInvoice } from '../lib/kv'

interface IndexShape {
  ids: string[]
}

async function upsertTracked(
  env: Bindings,
  merchantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gw: Record<string, any>,
): Promise<TrackedInvoice> {
  const id = gw.id as string
  const now = Math.floor(Date.now() / 1000)

  const amountSpec = gw.amountUsd
    ? `$${gw.amountUsd}`
    : gw.fiatAmount && gw.fiatCurrency
      ? `${gw.fiatAmount} ${gw.fiatCurrency}`
      : gw.requiredAmountRaw
        ? `${gw.requiredAmountRaw} ${gw.token}`
        : `${gw.token}`

  const existing = await kvGet<TrackedInvoice>(env, K.invoice(merchantId, id), 'json')
  const record: TrackedInvoice = {
    id,
    merchantId,
    chainId: gw.chainId ?? existing?.chainId ?? 0,
    token: gw.token ?? existing?.token ?? '',
    status: gw.status ?? existing?.status ?? 'created',
    amountSpec,
    externalId: gw.externalId ?? existing?.externalId ?? undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await kvPut(env, K.invoice(merchantId, id), record)

  const idx = (await kvGet<IndexShape>(env, K.invoiceIndex(merchantId), 'json')) ?? { ids: [] }
  if (!idx.ids.includes(id)) {
    idx.ids.unshift(id) // newest-first
    // cap to a reasonable retention — oldest drop off as operators create more.
    if (idx.ids.length > 500) idx.ids = idx.ids.slice(0, 500)
    await kvPut(env, K.invoiceIndex(merchantId), idx)
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

export async function listInvoices(
  _req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const idx = await kvGet<IndexShape>(env, K.invoiceIndex(merchantId), 'json')
  const ids = idx?.ids ?? []
  const loaded = await Promise.all(
    ids.map((id) => kvGet<TrackedInvoice>(env, K.invoice(merchantId, id), 'json')),
  )
  return json({
    invoices: loaded.filter((x): x is TrackedInvoice => !!x),
  })
}

export async function createInvoice(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req)
  const { apiKey } = await merchantKeyPlain(env, merchantId)

  const upstream = await gwFetch(env, apiKey, 'POST', '/api/v1/invoices', body)
  const payload = (await upstream.json().catch(() => ({}))) as {
    invoice?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.invoice) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected create',
      upstream.status || 502,
      payload.error?.details,
    )
  }

  const tracked = await upsertTracked(env, merchantId, payload.invoice)
  return json(
    { invoice: payload.invoice, tracked },
    { status: upstream.status },
  )
}

export async function getInvoice(
  _req: Request,
  env: Bindings,
  merchantId: string,
  id: string,
): Promise<Response> {
  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(env, apiKey, 'GET', `/api/v1/invoices/${encodeURIComponent(id)}`)
  const payload = (await upstream.json().catch(() => ({}))) as {
    invoice?: Record<string, unknown>
    amounts?: unknown
    transactions?: unknown
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.invoice) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Invoice not found',
      upstream.status || 502,
    )
  }
  await upsertTracked(env, merchantId, payload.invoice)
  return json(payload, { status: upstream.status })
}

export async function expireInvoice(
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
    `/api/v1/invoices/${encodeURIComponent(id)}/expire`,
  )
  const payload = (await upstream.json().catch(() => ({}))) as {
    invoice?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.invoice) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Could not expire',
      upstream.status || 502,
      payload.error?.details,
    )
  }
  await upsertTracked(env, merchantId, payload.invoice)
  return json({ invoice: payload.invoice })
}

export async function trackInvoice(
  req: Request,
  env: Bindings,
  merchantId: string,
): Promise<Response> {
  const body = await readJson<{ id?: string }>(req)
  const id = (body.id ?? '').trim()
  if (!id) return error('BAD_ID', 'Invoice id required', 400)

  const { apiKey } = await merchantKeyPlain(env, merchantId)
  const upstream = await gwFetch(env, apiKey, 'GET', `/api/v1/invoices/${encodeURIComponent(id)}`)
  const payload = (await upstream.json().catch(() => ({}))) as {
    invoice?: Record<string, unknown>
    error?: { code?: string; message?: string; details?: unknown }
  }
  if (!upstream.ok || !payload.invoice) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Invoice not found or not owned by this merchant',
      upstream.status || 502,
    )
  }
  const tracked = await upsertTracked(env, merchantId, payload.invoice)
  return json({ invoice: payload.invoice, tracked })
}

/**
 * Invoice routes — merchant-scoped, proxied through the merchant's API key.
 *
 *   GET  /api/mg/:merchantId/invoices               → list via gateway /api/v1/invoices
 *   POST /api/mg/:merchantId/invoices               → create via gateway
 *   GET  /api/mg/:merchantId/invoices/:id           → fetch detail via gateway
 *   POST /api/mg/:merchantId/invoices/:id/expire    → force-expire via gateway
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvGet, K } from '../lib/kv'

const LIST_PASSTHROUGH = [
  'status',
  'chainId',
  'token',
  'externalId',
  'toAddress',
  'fromAddress',
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

export async function listInvoices(
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
  const upstream = await gwFetch(env, apiKey, 'GET', `/api/v1/invoices${suffix}`)
  const payload = (await upstream.json().catch(() => ({}))) as {
    invoices?: unknown[]
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
  return json({ invoice: payload.invoice }, { status: upstream.status })
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
  return json({ invoice: payload.invoice })
}

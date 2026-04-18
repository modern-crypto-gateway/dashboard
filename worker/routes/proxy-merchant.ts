/**
 * Merchant-scoped proxy.
 *
 *   /api/mg/:merchantId/*   →   <baseUrl>/*   (forwarded with merchant's API key)
 *
 * Same safety constraints as the admin proxy: whitelisted request headers,
 * origin-pinned target, stripped hop-by-hop response headers.
 */

import { merchantKeyPlain } from './merchants'
import type { Bindings } from '../lib/env'
import { error, HttpError } from '../lib/http'
import { kvGet, K } from '../lib/kv'

const ALLOWED_UPSTREAM_REQ_HEADERS = new Set([
  'content-type',
  'accept',
  'idempotency-key',
])

const STRIP_UPSTREAM_RES_HEADERS = new Set([
  'set-cookie',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-encoding',
  'content-length',
])

export async function proxyAsMerchant(
  req: Request,
  env: Bindings,
  merchantId: string,
  tail: string,
): Promise<Response> {
  const baseUrl = await kvGet(env, K.baseUrl, 'text')
  if (!baseUrl) return error('NO_BASE_URL', 'Gateway base URL is not configured', 400)

  const { apiKey } = await merchantKeyPlain(env, merchantId)

  const src = new URL(req.url)
  const target = new URL(
    ('/' + tail).replace(/\/+/g, '/') + src.search,
    baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
  )
  if (
    target.origin !== new URL(baseUrl).origin ||
    target.pathname.includes('..')
  ) {
    throw new HttpError(400, 'BAD_TARGET', 'Invalid proxy target')
  }

  const headers = new Headers()
  req.headers.forEach((v, k) => {
    const key = k.toLowerCase()
    if (ALLOWED_UPSTREAM_REQ_HEADERS.has(key)) headers.set(key, v)
  })
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('X-API-Key', apiKey)

  const init: RequestInit = {
    method: req.method,
    headers,
    body:
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await req.clone().arrayBuffer(),
    redirect: 'manual',
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch (e) {
    return error(
      'UPSTREAM_UNREACHABLE',
      `Could not reach gateway: ${e instanceof Error ? e.message : String(e)}`,
      502,
    )
  }

  const outHeaders = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!STRIP_UPSTREAM_RES_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v)
  })
  outHeaders.set('Cache-Control', 'no-store')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}

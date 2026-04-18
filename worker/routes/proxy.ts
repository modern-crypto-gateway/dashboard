/**
 * Gateway proxy.
 *
 *   /api/gw/*   → <baseUrl>/*   (admin-key authenticated)
 *
 * Admin endpoints get the dashboard's stored admin key injected as
 * `Authorization: Bearer …`. Non-admin GETs (e.g. /health) still pass
 * through without the admin key — the gateway treats /health as public.
 *
 * The dashboard *never* passes through arbitrary upstream headers; we
 * whitelist what we forward and strip hop-by-hop headers on both legs.
 */

import { unseal } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { HttpError, error } from '../lib/http'
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
  'content-encoding', // avoid double-decode when re-serving
  'content-length',
])

export async function proxyGateway(
  req: Request,
  env: Bindings,
  tail: string,
): Promise<Response> {
  const [baseUrl, sealedKey] = await Promise.all([
    kvGet(env, K.baseUrl, 'text'),
    kvGet(env, K.adminKey, 'text'),
  ])
  if (!baseUrl) {
    return error('NO_BASE_URL', 'Gateway base URL is not configured', 400)
  }

  // Resolve target URL by safely joining base + tail, preserving query.
  const src = new URL(req.url)
  const target = new URL(
    ('/' + tail).replace(/\/+/g, '/') + src.search,
    baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
  )

  // Only allow navigation within the configured origin.
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
  if (sealedKey) {
    const adminKey = await unseal(sealedKey, kek(env))
    headers.set('Authorization', `Bearer ${adminKey}`)
    headers.set('X-Admin-Key', adminKey)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    body:
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await req.clone().arrayBuffer(),
    // The CF fetch runtime supplies a sensible default redirect policy.
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

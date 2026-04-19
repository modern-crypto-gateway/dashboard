import { seal, unseal, randomHex } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import {
  kvDelete,
  kvGet,
  kvPut,
  K,
  type MerchantRecord,
} from '../lib/kv'

const MERCHANT_NAME_RX = /^.{1,128}$/

/* ── helpers ─────────────────────────────────────────────── */

interface Index {
  ids: string[]
}

async function readIndex(env: Bindings): Promise<Index> {
  return (await kvGet<Index>(env, K.merchantIndex, 'json')) ?? { ids: [] }
}

async function writeIndex(env: Bindings, idx: Index): Promise<void> {
  await kvPut(env, K.merchantIndex, idx)
}

interface GatewayMerchant {
  id: string
  name: string
  webhookUrl: string | null
  active: boolean
  paymentToleranceUnderBps: number
  paymentToleranceOverBps: number
  addressCooldownSeconds: number
  createdAt: string
  updatedAt: string
}

function publicShape(
  m: MerchantRecord,
  gw?: GatewayMerchant | null,
) {
  return {
    id: m.id,
    name: gw?.name ?? m.name,
    source: m.source,
    webhookUrl: gw?.webhookUrl ?? m.webhookUrl ?? null,
    apiKeyFingerprint: m.apiKeyFingerprint,
    active: gw?.active ?? null,
    paymentToleranceUnderBps: gw?.paymentToleranceUnderBps ?? null,
    paymentToleranceOverBps: gw?.paymentToleranceOverBps ?? null,
    addressCooldownSeconds: gw?.addressCooldownSeconds ?? null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}

function gatewayOnlyShape(gw: GatewayMerchant) {
  return {
    id: gw.id,
    name: gw.name,
    source: 'gateway-only' as const,
    webhookUrl: gw.webhookUrl,
    apiKeyFingerprint: null,
    active: gw.active,
    paymentToleranceUnderBps: gw.paymentToleranceUnderBps,
    paymentToleranceOverBps: gw.paymentToleranceOverBps,
    addressCooldownSeconds: gw.addressCooldownSeconds,
    createdAt: Math.floor(new Date(gw.createdAt).getTime() / 1000),
    updatedAt: Math.floor(new Date(gw.updatedAt).getTime() / 1000),
  }
}

async function loadBaseUrl(env: Bindings): Promise<string> {
  const v = await kvGet(env, K.baseUrl, 'text')
  if (!v) throw new HttpError(400, 'NO_BASE_URL', 'Gateway base URL is not configured')
  return v
}

async function adminKeyPlain(env: Bindings): Promise<string> {
  const sealed = await kvGet(env, K.adminKey, 'text')
  if (!sealed) throw new HttpError(400, 'NO_ADMIN_KEY', 'Admin key is not configured')
  return unseal(sealed, kek(env))
}

export async function merchantKeyPlain(
  env: Bindings,
  merchantId: string,
): Promise<{ merchant: MerchantRecord; apiKey: string }> {
  const m = await kvGet<MerchantRecord>(env, K.merchant(merchantId), 'json')
  if (!m) throw new HttpError(404, 'NO_MERCHANT', 'Merchant not found')
  const apiKey = await unseal(m.apiKeySealed, kek(env))
  return { merchant: m, apiKey }
}

/** Call a gateway admin endpoint with the sealed admin key injected. */
async function callGateway(
  env: Bindings,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: any }> {
  const baseUrl = await loadBaseUrl(env)
  const adminKey = await adminKeyPlain(env)
  const target = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminKey}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (e) {
    throw new HttpError(
      502,
      'UPSTREAM_UNREACHABLE',
      `Gateway unreachable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const payload = await upstream.json().catch(() => ({}))
  return { status: upstream.status, payload }
}

/* ── routes ──────────────────────────────────────────────── */

/**
 * Merge the gateway's merchant list (source of truth for name, active,
 * tolerances) with our KV-held sealed API keys (source of truth for
 * "usable from this dashboard"). Gateway merchants we don't hold a key
 * for are still surfaced with `source: 'gateway-only'` so operators can
 * see them and can `rotate-key` to bring them in-dashboard.
 */
export async function listMerchants(
  _req: Request,
  env: Bindings,
): Promise<Response> {
  const idx = await readIndex(env)
  const localLoaded = await Promise.all(
    idx.ids.map((id) => kvGet<MerchantRecord>(env, K.merchant(id), 'json')),
  )
  const locals = localLoaded.filter((m): m is MerchantRecord => !!m)
  const localById = new Map(locals.map((m) => [m.id, m]))

  // Clean up stale local index entries silently.
  const aliveIds = localLoaded
    .map((m, i) => (m ? idx.ids[i] : null))
    .filter((x): x is string => !!x)
  if (aliveIds.length !== idx.ids.length) {
    await writeIndex(env, { ids: aliveIds })
  }

  // Best-effort gateway list — if it fails we fall back to local-only.
  let gwList: GatewayMerchant[] = []
  let gwReachable = true
  try {
    const { status, payload } = await callGateway(
      env,
      'GET',
      '/admin/merchants?limit=500&offset=0',
    )
    if (status === 200 && Array.isArray(payload.merchants)) {
      gwList = payload.merchants as GatewayMerchant[]
    } else if (status === 404) {
      // Admin surface not enabled — treat as reachable-but-empty.
      gwList = []
    } else {
      gwReachable = false
    }
  } catch {
    gwReachable = false
  }
  const gwById = new Map(gwList.map((g) => [g.id, g]))

  const merged = [
    ...locals.map((m) => publicShape(m, gwById.get(m.id))),
    ...gwList.filter((g) => !localById.has(g.id)).map(gatewayOnlyShape),
  ]
  return json({ merchants: merged, gatewayReachable: gwReachable })
}

/** Create a merchant via the gateway's admin endpoint, store its plaintext key. */
export async function createMerchantViaGateway(
  req: Request,
  env: Bindings,
): Promise<Response> {
  const body = await readJson<{
    name?: string
    webhookUrl?: string
    paymentToleranceUnderBps?: number
    paymentToleranceOverBps?: number
    addressCooldownSeconds?: number
  }>(req)
  const name = (body.name ?? '').trim()
  if (!MERCHANT_NAME_RX.test(name)) {
    return error('BAD_NAME', 'Name must be 1–128 characters', 400)
  }

  const baseUrl = await loadBaseUrl(env)
  const adminKey = await adminKeyPlain(env)

  const target = new URL('/admin/merchants', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        name,
        ...(body.webhookUrl ? { webhookUrl: body.webhookUrl } : {}),
        ...(body.paymentToleranceUnderBps != null
          ? { paymentToleranceUnderBps: body.paymentToleranceUnderBps }
          : {}),
        ...(body.paymentToleranceOverBps != null
          ? { paymentToleranceOverBps: body.paymentToleranceOverBps }
          : {}),
        ...(body.addressCooldownSeconds != null
          ? { addressCooldownSeconds: body.addressCooldownSeconds }
          : {}),
      }),
    })
  } catch (e) {
    return error(
      'UPSTREAM_UNREACHABLE',
      `Gateway unreachable: ${e instanceof Error ? e.message : String(e)}`,
      502,
    )
  }

  const payload = (await upstream.json().catch(() => ({}))) as {
    merchant?: {
      id: string
      name: string
      webhookUrl?: string | null
    }
    apiKey?: string
    error?: { code?: string; message?: string; details?: unknown }
  }

  if (!upstream.ok || !payload.merchant || !payload.apiKey) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected the create call',
      upstream.status || 502,
      payload.error?.details,
    )
  }

  const sealedKey = await seal(payload.apiKey, kek(env))
  const now = Math.floor(Date.now() / 1000)
  const record: MerchantRecord = {
    id: payload.merchant.id,
    name: payload.merchant.name,
    source: 'dashboard',
    webhookUrl: payload.merchant.webhookUrl ?? undefined,
    apiKeySealed: sealedKey,
    apiKeyFingerprint: payload.apiKey.slice(-4),
    createdAt: now,
    updatedAt: now,
  }
  await kvPut(env, K.merchant(record.id), record)
  const idx = await readIndex(env)
  if (!idx.ids.includes(record.id)) {
    idx.ids.push(record.id)
    await writeIndex(env, idx)
  }

  return json({ merchant: publicShape(record) }, { status: 201 })
}

/** Import an existing merchant (id + plaintext API key) created outside the dashboard. */
export async function importMerchant(
  req: Request,
  env: Bindings,
): Promise<Response> {
  const body = await readJson<{
    id?: string
    name?: string
    apiKey?: string
    webhookUrl?: string
  }>(req)
  const id = (body.id ?? '').trim() || 'mrc_' + randomHex(8)
  const name = (body.name ?? '').trim()
  const apiKey = (body.apiKey ?? '').trim()

  if (!MERCHANT_NAME_RX.test(name)) {
    return error('BAD_NAME', 'Name must be 1–128 characters', 400)
  }
  if (apiKey.length < 8 || apiKey.length > 256) {
    return error('BAD_API_KEY', 'API key must be 8–256 characters', 400)
  }

  const sealedKey = await seal(apiKey, kek(env))
  const now = Math.floor(Date.now() / 1000)
  const record: MerchantRecord = {
    id,
    name,
    source: 'imported',
    webhookUrl: body.webhookUrl ?? undefined,
    apiKeySealed: sealedKey,
    apiKeyFingerprint: apiKey.slice(-4),
    createdAt: now,
    updatedAt: now,
  }
  await kvPut(env, K.merchant(id), record)
  const idx = await readIndex(env)
  if (!idx.ids.includes(id)) {
    idx.ids.push(id)
    await writeIndex(env, idx)
  }
  return json({ merchant: publicShape(record) }, { status: 201 })
}

/**
 * PATCH every field that the gateway owns (name, webhookUrl, tolerances,
 * cooldown). If the merchant had no webhook URL before and we're setting one,
 * the gateway mints a fresh HMAC secret and returns it exactly once — we
 * bubble that plaintext up to the caller so it can be shown one-shot.
 */
export async function patchMerchant(
  req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const m = await kvGet<MerchantRecord>(env, K.merchant(id), 'json')
  if (!m) return error('NO_MERCHANT', 'Merchant not found', 404)

  const body = await readJson<{
    name?: string
    webhookUrl?: string | null
    paymentToleranceUnderBps?: number
    paymentToleranceOverBps?: number
    addressCooldownSeconds?: number
  }>(req)

  const gwPatch: Record<string, unknown> = {}
  if (body.name?.trim()) gwPatch.name = body.name.trim().slice(0, 128)
  if (body.webhookUrl !== undefined) gwPatch.webhookUrl = body.webhookUrl
  if (body.paymentToleranceUnderBps != null)
    gwPatch.paymentToleranceUnderBps = body.paymentToleranceUnderBps
  if (body.paymentToleranceOverBps != null)
    gwPatch.paymentToleranceOverBps = body.paymentToleranceOverBps
  if (body.addressCooldownSeconds != null)
    gwPatch.addressCooldownSeconds = body.addressCooldownSeconds

  if (Object.keys(gwPatch).length === 0) {
    return json({ merchant: publicShape(m) })
  }

  const { status, payload } = await callGateway(
    env,
    'PATCH',
    `/admin/merchants/${encodeURIComponent(id)}`,
    gwPatch,
  )
  if (status !== 200) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected PATCH',
      status || 502,
      payload.error?.details,
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const next: MerchantRecord = {
    ...m,
    name: payload.merchant?.name ?? m.name,
    webhookUrl: payload.merchant?.webhookUrl ?? undefined,
    updatedAt: now,
  }
  await kvPut(env, K.merchant(id), next)
  return json({
    merchant: publicShape(next, payload.merchant),
    ...(payload.webhookSecret ? { webhookSecret: payload.webhookSecret } : {}),
  })
}

export async function deleteMerchant(
  _req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const m = await kvGet<MerchantRecord>(env, K.merchant(id), 'json')
  if (!m) return error('NO_MERCHANT', 'Merchant not found', 404)
  await kvDelete(env, K.merchant(id))
  const idx = await readIndex(env)
  idx.ids = idx.ids.filter((x) => x !== id)
  await writeIndex(env, idx)
  return json({ ok: true })
}

/**
 * Rotate a merchant's API key via the gateway. The gateway returns the
 * new plaintext key exactly once — we re-seal it in KV, update the
 * fingerprint, and also bubble the plaintext up so the operator can
 * copy it (one-time view). If the merchant is not in our KV yet,
 * we create a local record on the fly (source: 'dashboard').
 */
export async function rotateMerchantKey(
  _req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const { status, payload } = await callGateway(
    env,
    'POST',
    `/admin/merchants/${encodeURIComponent(id)}/rotate-key`,
  )
  if (status !== 200 || !payload.apiKey || !payload.merchant) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected rotate-key',
      status || 502,
      payload.error?.details,
    )
  }

  const apiKey = payload.apiKey as string
  const gwMerchant = payload.merchant as { id: string; name: string }
  const sealedKey = await seal(apiKey, kek(env))
  const now = Math.floor(Date.now() / 1000)
  const existing = await kvGet<MerchantRecord>(env, K.merchant(id), 'json')
  const record: MerchantRecord = existing
    ? { ...existing, apiKeySealed: sealedKey, apiKeyFingerprint: apiKey.slice(-4), updatedAt: now }
    : {
        id: gwMerchant.id,
        name: gwMerchant.name,
        source: 'dashboard',
        apiKeySealed: sealedKey,
        apiKeyFingerprint: apiKey.slice(-4),
        createdAt: now,
        updatedAt: now,
      }
  await kvPut(env, K.merchant(id), record)
  if (!existing) {
    const idx = await readIndex(env)
    if (!idx.ids.includes(id)) {
      idx.ids.push(id)
      await writeIndex(env, idx)
    }
  }

  return json({ merchant: publicShape(record), apiKey })
}

export async function activateMerchant(
  _req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const { status, payload } = await callGateway(
    env,
    'POST',
    `/admin/merchants/${encodeURIComponent(id)}/activate`,
  )
  if (status !== 200) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected activate',
      status || 502,
      payload.error?.details,
    )
  }
  return json({ merchant: payload.merchant ?? null })
}

export async function deactivateMerchant(
  _req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const { status, payload } = await callGateway(
    env,
    'POST',
    `/admin/merchants/${encodeURIComponent(id)}/deactivate`,
  )
  if (status !== 200) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected deactivate',
      status || 502,
      payload.error?.details,
    )
  }
  return json({ merchant: payload.merchant ?? null })
}

/** Rotate the HMAC signing secret for this merchant's webhooks. Plaintext
 * is shown once, never persisted here — the merchant stores it on their
 * side to verify signatures. */
export async function rotateWebhookSecret(
  _req: Request,
  env: Bindings,
  id: string,
): Promise<Response> {
  const { status, payload } = await callGateway(
    env,
    'POST',
    `/admin/merchants/${encodeURIComponent(id)}/rotate-webhook-secret`,
  )
  if (status !== 200 || !payload.webhookSecret) {
    return error(
      payload.error?.code ?? 'UPSTREAM_ERROR',
      payload.error?.message ?? 'Gateway rejected webhook-secret rotate',
      status || 502,
      payload.error?.details,
    )
  }
  return json({ webhookSecret: payload.webhookSecret })
}

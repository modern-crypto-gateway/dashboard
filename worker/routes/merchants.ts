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

function publicShape(m: MerchantRecord) {
  return {
    id: m.id,
    name: m.name,
    source: m.source,
    webhookUrl: m.webhookUrl ?? null,
    apiKeyFingerprint: m.apiKeyFingerprint,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
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

/* ── routes ──────────────────────────────────────────────── */

export async function listMerchants(
  _req: Request,
  env: Bindings,
): Promise<Response> {
  const idx = await readIndex(env)
  if (idx.ids.length === 0) return json({ merchants: [] })

  const loaded = await Promise.all(
    idx.ids.map((id) => kvGet<MerchantRecord>(env, K.merchant(id), 'json')),
  )
  const merchants = loaded
    .filter((m): m is MerchantRecord => !!m)
    .map(publicShape)
  // Clean up stale index entries silently.
  const aliveIds = loaded
    .map((m, i) => (m ? idx.ids[i] : null))
    .filter((x): x is string => !!x)
  if (aliveIds.length !== idx.ids.length) {
    await writeIndex(env, { ids: aliveIds })
  }
  return json({ merchants })
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

  // Gateway-side patches only apply to merchants that live on the gateway
  // (i.e. we know the id is the gateway's id, not a dashboard-only alias).
  const gwPatch: Record<string, unknown> = {}
  if (body.paymentToleranceUnderBps != null)
    gwPatch.paymentToleranceUnderBps = body.paymentToleranceUnderBps
  if (body.paymentToleranceOverBps != null)
    gwPatch.paymentToleranceOverBps = body.paymentToleranceOverBps
  if (body.addressCooldownSeconds != null)
    gwPatch.addressCooldownSeconds = body.addressCooldownSeconds

  if (Object.keys(gwPatch).length > 0) {
    const baseUrl = await loadBaseUrl(env)
    const adminKey = await adminKeyPlain(env)
    const target = new URL(
      `/admin/merchants/${encodeURIComponent(id)}`,
      baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
    )
    let upstream: Response
    try {
      upstream = await fetch(target.toString(), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify(gwPatch),
      })
    } catch (e) {
      return error(
        'UPSTREAM_UNREACHABLE',
        `Gateway unreachable: ${e instanceof Error ? e.message : String(e)}`,
        502,
      )
    }
    const gwBody = (await upstream.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; details?: unknown }
    }
    if (!upstream.ok) {
      return error(
        gwBody.error?.code ?? 'UPSTREAM_ERROR',
        gwBody.error?.message ?? 'Gateway rejected PATCH',
        upstream.status || 502,
        gwBody.error?.details,
      )
    }
  }

  // Local-only fields (name, webhookUrl) still live in KV on the dashboard.
  const now = Math.floor(Date.now() / 1000)
  const next: MerchantRecord = {
    ...m,
    name: body.name?.trim() ? body.name.trim().slice(0, 128) : m.name,
    webhookUrl:
      body.webhookUrl === null
        ? undefined
        : body.webhookUrl !== undefined
          ? body.webhookUrl
          : m.webhookUrl,
    updatedAt: now,
  }
  await kvPut(env, K.merchant(id), next)
  return json({ merchant: publicShape(next) })
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

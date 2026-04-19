import { seal } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K } from '../lib/kv'

const BASE_URL_RX = /^https?:\/\/[^\s]{3,256}$/i

export async function getConfig(_req: Request, env: Bindings): Promise<Response> {
  const [baseUrl, adminKey, hint, defaultMerchantId] = await Promise.all([
    kvGet(env, K.baseUrl, 'text'),
    kvGet(env, K.adminKey, 'text'),
    kvGet(env, K.adminKeyHint, 'text'),
    kvGet(env, K.defaultMerchant, 'text'),
  ])
  return json({
    baseUrl: baseUrl ?? '',
    hasAdminKey: !!adminKey,
    adminKeyHint: hint ?? undefined,
    defaultMerchantId: defaultMerchantId ?? null,
  })
}

export async function postDefaultMerchant(
  req: Request,
  env: Bindings,
): Promise<Response> {
  const body = await readJson<{ id?: string | null }>(req)
  const id = (body.id ?? '').toString().trim()
  if (!id) {
    await kvDelete(env, K.defaultMerchant)
    return json({ ok: true, defaultMerchantId: null })
  }
  if (id.length > 128 || /\s/.test(id)) {
    return error('BAD_ID', 'Merchant id is invalid', 400)
  }
  await kvPut(env, K.defaultMerchant, id)
  return json({ ok: true, defaultMerchantId: id })
}

export async function postBaseUrl(req: Request, env: Bindings): Promise<Response> {
  const body = await readJson<{ baseUrl?: string }>(req)
  const url = (body.baseUrl ?? '').trim()
  if (!BASE_URL_RX.test(url)) {
    return error('BAD_URL', 'Base URL must be a valid http(s) URL', 400)
  }
  await kvPut(env, K.baseUrl, url)
  return json({ ok: true })
}

export async function postAdminKey(req: Request, env: Bindings): Promise<Response> {
  const body = await readJson<{ adminKey?: string }>(req)
  const key = (body.adminKey ?? '').trim()
  if (key.length < 32 || key.length > 256 || /\s/.test(key)) {
    return error(
      'BAD_KEY',
      'Admin key must be 32–256 chars with no whitespace',
      400,
    )
  }
  const sealed = await seal(key, kek(env))
  await kvPut(env, K.adminKey, sealed)
  await kvPut(env, K.adminKeyHint, key.slice(-4))
  return json({ ok: true })
}

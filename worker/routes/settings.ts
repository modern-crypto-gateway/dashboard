import { seal } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { error, json, readJson } from '../lib/http'
import { kvDelete, kvGet, kvPut, K, type UserRecord } from '../lib/kv'
import { verifyUserTotpOnce } from '../lib/stepup'

/** Fresh-authenticator-code check for settings that control where the admin key goes. */
async function requireStepUp(env: Bindings, username: string, code: unknown): Promise<Response | null> {
  const user = await kvGet<UserRecord>(env, K.user(username), 'json')
  const c = typeof code === 'string' ? code.trim() : ''
  if (!user || !c) {
    return error('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator', 401)
  }
  if (!(await verifyUserTotpOnce(env, user, c))) {
    return error('BAD_TOTP', 'Authenticator code is invalid', 401)
  }
  return null
}

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

export async function postBaseUrl(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{ baseUrl?: string; totp?: string }>(req)
  const url = (body.baseUrl ?? '').trim()
  if (!BASE_URL_RX.test(url)) {
    return error('BAD_URL', 'Base URL must be a valid http(s) URL', 400)
  }
  const denied = await requireStepUp(env, username, body.totp)
  if (denied) return denied
  await kvPut(env, K.baseUrl, url)
  return json({ ok: true })
}

export async function postAdminKey(
  req: Request,
  env: Bindings,
  username: string,
): Promise<Response> {
  const body = await readJson<{ adminKey?: string; totp?: string }>(req)
  const key = (body.adminKey ?? '').trim()
  if (key.length < 32 || key.length > 256 || /\s/.test(key)) {
    return error(
      'BAD_KEY',
      'Admin key must be 32–256 chars with no whitespace',
      400,
    )
  }
  const denied = await requireStepUp(env, username, body.totp)
  if (denied) return denied
  const sealed = await seal(key, kek(env))
  await kvPut(env, K.adminKey, sealed)
  await kvPut(env, K.adminKeyHint, key.slice(-4))
  return json({ ok: true })
}

import { error, json, toResponse, HttpError } from './lib/http'
import { Router } from './lib/router'
import { kvGet, K } from './lib/kv'
import { verifyCsrf } from './lib/session'
import {
  cfLimit,
  clientId,
  rateLimit,
  RL_SEC_PASSWORD,
  RL_SEC_RECOVERY_REGEN,
  RL_SEC_TOTP_ROTATE,
} from './lib/ratelimit'
import { applySecurityHeaders } from './lib/securityHeaders'
import type { Bindings } from './lib/env'

import {
  getSetupStatus,
  postAdminKey as setupAdminKey,
  postBaseUrl as setupBaseUrl,
  postComplete,
  postTotpBegin,
  postUser,
} from './routes/setup'
import {
  getSession,
  postLoginPassword,
  postLoginTotp,
  postLogout,
  requireAuth,
} from './routes/auth'
import {
  getConfig,
  postAdminKey as settingsAdminKey,
  postBaseUrl as settingsBaseUrl,
  postDefaultMerchant,
} from './routes/settings'
import { proxyGateway } from './routes/proxy'
import {
  getSessions,
  postChangePassword,
  postRegenerateRecovery,
  postRevokeAllSessions,
  postRevokeSession,
  postTotpBegin as securityTotpBegin,
  postTotpCommit as securityTotpCommit,
} from './routes/security'
import {
  activateMerchant,
  createMerchantViaGateway,
  deactivateMerchant,
  deleteMerchant,
  importMerchant,
  listMerchants,
  patchMerchant,
  rotateMerchantKey,
  rotateWebhookSecret,
} from './routes/merchants'
import { proxyAsMerchant } from './routes/proxy-merchant'
import {
  createInvoice,
  expireInvoice,
  getInvoice,
  listInvoices,
} from './routes/invoices'
import {
  batchPayouts,
  cancelPayout,
  createPayout,
  estimatePayout,
  getPayout,
  listPayouts,
} from './routes/payouts'
import { getAvatar } from './routes/avatar'

const router = new Router()

/* ── guard helpers ────────────────────────────────────────── */

async function guardAuthAndCsrf(req: Request, env: Bindings) {
  const sess = await requireAuth(req, env)
  if (!(await verifyCsrf(env, req, sess.hash))) {
    throw new HttpError(403, 'BAD_CSRF', 'CSRF token mismatch')
  }
  return sess
}

/* ── public / unauthenticated ─────────────────────────────── */
router.get('/api/auth/setup-status', getSetupStatus)
router.get('/api/auth/session', getSession)
router.get('/api/avatar', getAvatar)
router.get('/api/health', async (_req, env) => {
  const done = await kvGet(env, K.setupComplete, 'text')
  return json({ ok: true, setup: done === '1' })
})

/* ── setup (callable only until setup is complete) ──────── */
router.post('/api/setup/base-url', setupBaseUrl)
router.post('/api/setup/admin-key', setupAdminKey)
router.post('/api/setup/user', postUser)
router.post('/api/setup/totp/begin', postTotpBegin)
router.post('/api/setup/complete', postComplete)

/* ── login ────────────────────────────────────────────────── */
router.post('/api/auth/login/password', postLoginPassword)
router.post('/api/auth/login/totp', postLoginTotp)
router.post('/api/auth/logout', postLogout)

/* ── settings ────────────────────────────────────────────── */
router.get('/api/settings/config', async (req, env) => {
  await requireAuth(req, env)
  return getConfig(req, env)
})
router.post('/api/settings/base-url', async (req, env) => {
  await guardAuthAndCsrf(req, env)
  return settingsBaseUrl(req, env)
})
router.post('/api/settings/admin-key', async (req, env) => {
  await guardAuthAndCsrf(req, env)
  return settingsAdminKey(req, env)
})
router.post('/api/settings/default-merchant', async (req, env) => {
  await guardAuthAndCsrf(req, env)
  return postDefaultMerchant(req, env)
})

/* ── security (authenticated, CSRF + tight rate limits) ──── */
router.get('/api/security/sessions', async (req, env) => {
  const sess = await requireAuth(req, env)
  return getSessions(req, env, sess.hash, sess.record.username)
})
router.post('/api/security/sessions/revoke', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  await cfLimit(env.SESS_RL, sess.record.username, 'sec-revoke')
  return postRevokeSession(req, env, sess.hash)
})
router.post('/api/security/sessions/revoke-all', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  await cfLimit(env.SESS_RL, sess.record.username, 'sec-revoke')
  return postRevokeAllSessions(req, env, sess.hash, sess.record.username)
})
router.post('/api/security/password', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  // Key on username + IP so neither a stolen session nor a legit user's retries
  // alone can burn the quota.
  await rateLimit(
    env,
    'sec-password',
    `${sess.record.username}:${clientId(req)}`,
    RL_SEC_PASSWORD,
  )
  return postChangePassword(req, env, sess.record.username)
})
router.post('/api/security/totp/begin', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  await rateLimit(
    env,
    'sec-totp',
    `${sess.record.username}:${clientId(req)}`,
    RL_SEC_TOTP_ROTATE,
  )
  return securityTotpBegin(req, env, sess.record.username)
})
router.post('/api/security/totp/commit', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  await rateLimit(
    env,
    'sec-totp',
    `${sess.record.username}:${clientId(req)}`,
    RL_SEC_TOTP_ROTATE,
  )
  return securityTotpCommit(req, env, sess.record.username)
})
router.post('/api/security/recovery/regenerate', async (req, env) => {
  const sess = await guardAuthAndCsrf(req, env)
  await rateLimit(
    env,
    'sec-recovery',
    `${sess.record.username}:${clientId(req)}`,
    RL_SEC_RECOVERY_REGEN,
  )
  return postRegenerateRecovery(req, env, sess.record.username)
})

/* ── merchants ───────────────────────────────────────────── */
router.get('/api/merchants', async (req, env) => {
  await requireAuth(req, env)
  return listMerchants(req, env)
})
router.post('/api/merchants', async (req, env) => {
  await guardAuthAndCsrf(req, env)
  return createMerchantViaGateway(req, env)
})
router.post('/api/merchants/import', async (req, env) => {
  await guardAuthAndCsrf(req, env)
  return importMerchant(req, env)
})
router.delete('/api/merchants/*', async (req, env, _ctx, params) => {
  await guardAuthAndCsrf(req, env)
  const id = (params.tail ?? '').split('/').filter(Boolean)[0]
  if (!id) return error('BAD_ID', 'Merchant id required', 400)
  return deleteMerchant(req, env, id)
})
router.patch('/api/merchants/*', async (req, env, _ctx, params) => {
  await guardAuthAndCsrf(req, env)
  const id = (params.tail ?? '').split('/').filter(Boolean)[0]
  if (!id) return error('BAD_ID', 'Merchant id required', 400)
  return patchMerchant(req, env, id)
})
// POST sub-actions: rotate-key, activate, deactivate. Must come AFTER the
// exact `/api/merchants` + `/api/merchants/import` POSTs above.
router.post('/api/merchants/*', async (req, env, _ctx, params) => {
  await guardAuthAndCsrf(req, env)
  const parts = (params.tail ?? '').split('/').filter(Boolean)
  const [id, action] = parts
  if (!id || !action) return error('BAD_ID', 'Merchant id + action required', 400)
  if (action === 'rotate-key') {
    await cfLimit(env.GW_RL, clientId(req), 'gw')
    return rotateMerchantKey(req, env, id)
  }
  if (action === 'rotate-webhook-secret') {
    await cfLimit(env.GW_RL, clientId(req), 'gw')
    return rotateWebhookSecret(req, env, id)
  }
  if (action === 'activate') return activateMerchant(req, env, id)
  if (action === 'deactivate') return deactivateMerchant(req, env, id)
  return error('BAD_ACTION', 'Unknown merchant action', 404)
})

/* ── gateway proxy (admin-scoped) ────────────────────────── */
router.any('/api/gw/*', async (req, env, _ctx, params) => {
  await guardAuthAndCsrf(req, env)
  await cfLimit(env.GW_RL, clientId(req), 'gw')
  return proxyGateway(req, env, params.tail ?? '')
})

/* ── merchant-scoped surface (demuxed from a single catch-all) ── */
router.any('/api/mg/*', async (req, env, _ctx, params) => {
  await guardAuthAndCsrf(req, env)
  return dispatchMerchant(req, env, params.tail ?? '')
})

async function dispatchMerchant(
  req: Request,
  env: Bindings,
  tail: string,
): Promise<Response> {
  const parts = tail.split('/').filter(Boolean)
  if (parts.length < 2) return error('BAD_PATH', 'Invalid merchant path', 404)
  const [merchantId, resource, ...rest] = parts
  const method = req.method

  if (resource === 'invoices') {
    if (rest.length === 0) {
      if (method === 'GET') return listInvoices(req, env, merchantId)
      if (method === 'POST') {
        await cfLimit(env.GW_RL, clientId(req), 'gw')
        return createInvoice(req, env, merchantId)
      }
    } else if (rest.length === 1 && method === 'GET') {
      return getInvoice(req, env, merchantId, rest[0])
    } else if (rest.length === 2 && rest[1] === 'expire' && method === 'POST') {
      await cfLimit(env.GW_RL, clientId(req), 'gw')
      return expireInvoice(req, env, merchantId, rest[0])
    }
  } else if (resource === 'payouts') {
    if (rest.length === 0) {
      if (method === 'GET') return listPayouts(req, env, merchantId)
      if (method === 'POST') {
        await cfLimit(env.GW_RL, clientId(req), 'gw')
        return createPayout(req, env, merchantId)
      }
    } else if (rest.length === 1) {
      if (method === 'GET') return getPayout(req, env, merchantId, rest[0])
      // Sub-actions that sit at /payouts/<action> rather than /payouts/<id>.
      if (method === 'POST' && rest[0] === 'estimate') {
        await cfLimit(env.GW_RL, clientId(req), 'gw')
        return estimatePayout(req, env, merchantId)
      }
      if (method === 'POST' && rest[0] === 'batch') {
        await cfLimit(env.GW_RL, clientId(req), 'gw')
        return batchPayouts(req, env, merchantId)
      }
    } else if (rest.length === 2 && method === 'POST' && rest[1] === 'cancel') {
      await cfLimit(env.GW_RL, clientId(req), 'gw')
      return cancelPayout(req, env, merchantId, rest[0])
    }
  } else if (resource === 'raw' && rest.length > 0) {
    await cfLimit(env.GW_RL, clientId(req), 'gw')
    return proxyAsMerchant(req, env, merchantId, rest.join('/'))
  }

  return error('NOT_FOUND', 'Merchant route not found', 404)
}

async function handle(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)

  if (!url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 404 })
  }

  try {
    const lightPath =
      url.pathname === '/api/auth/session' ||
      url.pathname === '/api/auth/setup-status' ||
      url.pathname === '/api/health'
    if (!lightPath) {
      await cfLimit(env.API_RL, clientId(request), 'api')
    }

    const isSetup = url.pathname.startsWith('/api/setup/')
    if (!isSetup && !lightPath && request.method !== 'GET') {
      const done = await kvGet(env, K.setupComplete, 'text')
      if (done !== '1') {
        return error(
          'SETUP_REQUIRED',
          'First-time setup has not been completed yet',
          409,
        )
      }
    }

    return await router.handle(request, env, ctx)
  } catch (e) {
    return toResponse(e)
  }
}

export default {
  async fetch(request, env, ctx) {
    const res = await handle(request, env, ctx)
    return applySecurityHeaders(res)
  },
} satisfies ExportedHandler<Env>

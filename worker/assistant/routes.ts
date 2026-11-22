/**
 * /api/assistant/* — every route requires a signed-in session; every POST
 * also requires the CSRF token (both enforced in worker/index.ts before these
 * handlers run). Nothing here is reachable without logging in.
 *
 *   GET  /api/assistant/state      settings summary + this session's conversation
 *   POST /api/assistant/config     set the Anthropic key (needs 2FA code) and/or model
 *   POST /api/assistant/key/delete remove the Anthropic key
 *   POST /api/assistant/test       check the key works
 *   POST /api/assistant/chat       send a message
 *   POST /api/assistant/approve    approve / decline the pending batch
 *   POST /api/assistant/reset      start a new chat
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Bindings } from '../lib/env'
import { error, HttpError, json, readJson } from '../lib/http'
import { kvGet, K, type SessionRecord, type UserRecord } from '../lib/kv'
import { clientId } from '../lib/ratelimit'
import { verifyUserTotpOnce } from '../lib/stepup'
import { moneyActionFor } from '../../shared/moneyRoutes'
import {
  appendUserText,
  executeBatch,
  notice,
  repairDangling,
  runModel,
  type Decisions,
  type TurnCtx,
} from './agent'
import {
  deleteApiKey,
  isModelId,
  MODELS,
  readApiKey,
  readConfig,
  validApiKey,
  writeApiKey,
  writeModel,
} from './config'
import type { AssistantStoreApi } from './store'
import type { Conversation } from './types'

export interface Sess {
  hash: string
  record: SessionRecord
}

type Dispatch = (req: Request) => Promise<Response>

const MESSAGE_MAX = 4000
const PAGE_RX = /^\/[A-Za-z0-9/_-]{0,120}$/

function store(env: Bindings, sess: Sess): AssistantStoreApi {
  const ns = env.ASSISTANT_STORE
  if (!ns) throw new Error('ASSISTANT_STORE Durable Object binding is missing (see wrangler.jsonc.example).')
  return ns.get(ns.idFromName(`sess:${sess.hash}`)) as unknown as AssistantStoreApi
}

/** What the browser may see: no raw messages, no thinking, no tool results. */
function publicView(conv: Conversation) {
  return {
    rev: conv.rev,
    busy: conv.busyUntil > Date.now(),
    ui: conv.ui,
    pending: conv.pending && {
      id: conv.pending.id,
      expiresAt: conv.pending.expiresAt,
      actions: conv.pending.actions.map((a) => ({
        id: a.toolUseId,
        method: a.method,
        path: a.path,
        query: a.query ?? null,
        body: a.body ?? null,
        risk: a.risk,
        label: a.label,
        facts: a.facts,
        reason: a.reason,
      })),
    },
  }
}

/**
 * Anthropic client pinned to the real API. The SDK would otherwise honour an
 * ANTHROPIC_BASE_URL environment variable; pinning it means no configuration
 * can quietly send the key elsewhere. Local development may point at a stub,
 * but only for requests to localhost.
 */
function anthropicClient(env: Bindings, req: Request, apiKey: string, opts: { maxRetries: number; timeout: number }) {
  const host = new URL(req.url).hostname
  const dev = env.ASSISTANT_DEV_ANTHROPIC_URL
  const baseURL = dev && (host === 'localhost' || host === '127.0.0.1') ? dev : 'https://api.anthropic.com'
  return new Anthropic({ apiKey, baseURL, ...opts })
}

async function makeCtx(req: Request, env: Bindings, sess: Sess, dispatch: Dispatch): Promise<TurnCtx> {
  const [apiKey, cfg] = await Promise.all([readApiKey(env), readConfig(env)])
  if (!apiKey) throw new HttpError(409, 'AI_NOT_CONFIGURED', 'Add an Anthropic API key in Settings first.')
  return {
    env,
    origin: new URL(req.url).origin,
    cookie: req.headers.get('Cookie') ?? '',
    csrf: req.headers.get('X-CSRF-Token') ?? '',
    ip: req.headers.get('cf-connecting-ip') ?? '',
    username: sess.record.username,
    dispatch,
    // One model call is capped near 3 minutes (90 s x 2 tries), under the
    // 5-minute turn lock that every step renews.
    client: anthropicClient(env, req, apiKey, { maxRetries: 1, timeout: 90_000 }),
    model: cfg.model,
    checkpoint: (conv) => store(env, sess).checkpoint(conv),
  }
}

/** Turn an Anthropic API failure into a chat notice (never echoing the key). */
function describeFailure(e: unknown): string {
  if (e instanceof HttpError) return e.message
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return 'Anthropic rejected the API key. Update it in Settings.'
  }
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached. Try again in a minute.'
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. Try again.'
  if (e instanceof Anthropic.APIError) return `Claude request failed (HTTP ${e.status ?? '?'}). Try again.`
  console.error('assistant turn failed', e)
  return 'Something went wrong. Try again.'
}

/* ── state ────────────────────────────────────────────────── */

export async function getAssistantState(_req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const [cfg, conv] = await Promise.all([readConfig(env), store(env, sess).read(sess.record.username)])
  return json({
    config: cfg,
    models: MODELS.map((m) => ({ id: m.id, label: m.label })),
    conversation: publicView(conv),
  })
}

/* ── POST dispatcher ──────────────────────────────────────── */

export async function assistantPost(
  action: string,
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
): Promise<Response> {
  switch (action) {
    case 'config':
      return postConfig(req, env, sess)
    case 'key/delete':
      await deleteApiKey(env)
      return json({ config: await readConfig(env) })
    case 'test':
      return postTest(req, env)
    case 'chat':
      return postChat(req, env, sess, dispatch)
    case 'approve':
      return postApprove(req, env, sess, dispatch)
    case 'reset': {
      const ok = await store(env, sess).reset(sess.record.username)
      if (!ok) return error('AI_BUSY', 'Wait for the current step to finish.', 409)
      return json({ ok: true })
    }
    default:
      return error('NOT_FOUND', 'Not found', 404)
  }
}

/* ── settings ─────────────────────────────────────────────── */

async function postConfig(req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const body = await readJson<{ apiKey?: unknown; model?: unknown; totp?: unknown }>(req)
  if (body.model !== undefined) {
    if (!isModelId(body.model)) return error('BAD_MODEL', 'Unknown model', 400)
  }
  if (body.apiKey !== undefined) {
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!validApiKey(key)) {
      return error('BAD_KEY', 'That does not look like an Anthropic API key (sk-ant-…).', 400)
    }
    // Replacing the key decides where every future conversation (and the
    // gateway data it reads) is sent, so a stolen session alone must not be
    // able to swap in someone else's key.
    const user = await kvGet<UserRecord>(env, K.user(sess.record.username), 'json')
    const code = typeof body.totp === 'string' ? body.totp.trim() : ''
    if (!user || !code) return error('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator', 401)
    if (!(await verifyUserTotpOnce(env, user, code))) {
      return error('BAD_TOTP', 'Authenticator code is invalid', 401)
    }
    await writeApiKey(env, key)
  }
  if (body.model !== undefined && isModelId(body.model)) await writeModel(env, body.model)
  return json({ config: await readConfig(env) })
}

async function postTest(req: Request, env: Bindings): Promise<Response> {
  const [apiKey, cfg] = await Promise.all([readApiKey(env), readConfig(env)])
  if (!apiKey) return error('AI_NOT_CONFIGURED', 'No Anthropic API key set.', 409)
  try {
    const client = anthropicClient(env, req, apiKey, { maxRetries: 1, timeout: 20_000 })
    const m = await client.models.retrieve(cfg.model)
    return json({ ok: true, model: m.id })
  } catch (e) {
    return error('AI_TEST_FAILED', describeFailure(e), 502)
  }
}

/* ── chat ─────────────────────────────────────────────────── */

async function postChat(req: Request, env: Bindings, sess: Sess, dispatch: Dispatch): Promise<Response> {
  const body = await readJson<{ message?: unknown; page?: unknown }>(req)
  const text = typeof body.message === 'string' ? body.message.trim() : ''
  if (!text || text.length > MESSAGE_MAX) {
    return error('BAD_MESSAGE', `Message must be 1–${MESSAGE_MAX} characters.`, 400)
  }
  const page = typeof body.page === 'string' && PAGE_RX.test(body.page) ? body.page : undefined
  const ctx = await makeCtx(req, env, sess, dispatch)

  const s = store(env, sess)
  const begun = await s.begin(sess.record.username)
  if (!begun.ok) return error('AI_BUSY', 'The assistant is still working on the last message.', 409)
  const conv = begun.conv
  if (conv.pending) {
    await s.release(sess.record.username)
    return error('AI_PENDING', 'Approve or decline the pending changes first.', 409)
  }

  repairDangling(conv)
  appendUserText(conv, text, page)
  try {
    await runModel(ctx, conv)
  } catch (e) {
    repairDangling(conv)
    notice(conv, describeFailure(e))
  }
  const saved = await s.commit(conv)
  return json({ conversation: publicView(saved) })
}

/* ── approvals ────────────────────────────────────────────── */

async function postApprove(req: Request, env: Bindings, sess: Sess, dispatch: Dispatch): Promise<Response> {
  const body = await readJson<{ batchId?: unknown; decisions?: unknown; totp?: unknown }>(req)
  const batchId = typeof body.batchId === 'string' ? body.batchId : ''
  if (!batchId || !body.decisions || typeof body.decisions !== 'object' || Array.isArray(body.decisions)) {
    return error('BAD_INPUT', 'batchId and decisions are required', 400)
  }
  const decisions: Decisions = {}
  for (const [k, v] of Object.entries(body.decisions as Record<string, unknown>)) {
    if (v === 'approve' || v === 'decline') decisions[k] = v
  }

  const s = store(env, sess)
  const current = await s.read(sess.record.username)
  const batch = current.pending
  if (!batch || batch.id !== batchId) {
    return error('AI_NO_PENDING', 'These changes are no longer waiting for approval.', 409)
  }

  // Money moves need a fresh authenticator code, checked before the batch is
  // claimed so a wrong code leaves it waiting. Required whatever the expiry:
  // expiry is decided again inside the store, and two clocks must never be
  // the only thing between a money move and its 2FA check.
  // A money action is one the catalog marks as such or one the dashboard's
  // own money-route gate would ask a code for (shared/moneyRoutes.ts), so the
  // two lists can't drift into a batch that skips the code.
  const approvedMoney = batch.actions.some(
    (a) =>
      decisions[a.toolUseId] === 'approve' &&
      (a.risk === 'money' || moneyActionFor(a.method, a.path) !== null),
  )
  if (approvedMoney) {
    const user = await kvGet<UserRecord>(env, K.user(sess.record.username), 'json')
    const code = typeof body.totp === 'string' ? body.totp.trim() : ''
    if (!user || !code) return error('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator', 401)
    if (!(await verifyUserTotpOnce(env, user, code))) {
      return error('BAD_TOTP', 'Authenticator code is invalid', 401)
    }
  }

  const ctx = await makeCtx(req, env, sess, dispatch)
  // Atomic: only one request can take the batch, so it runs at most once.
  const claimed = await s.claim(sess.record.username, batchId)
  if (!claimed.ok) {
    return error(
      claimed.reason === 'busy' ? 'AI_BUSY' : 'AI_NO_PENDING',
      claimed.reason === 'busy'
        ? 'The assistant is busy. Try again in a moment.'
        : 'These changes are no longer waiting for approval.',
      409,
    )
  }
  const conv = claimed.conv
  ctx.batchId = batchId
  console.log(
    JSON.stringify({
      event: 'assistant_batch',
      user: sess.record.username,
      ip: clientId(req),
      batch: batchId,
      approved: Object.values(decisions).filter((d) => d === 'approve').length,
      total: claimed.batch.actions.length,
      expired: claimed.expired,
    }),
  )
  try {
    // approvedMoney implies the code was verified above (else we returned 401).
    await executeBatch(ctx, conv, claimed.batch, decisions, claimed.expired, approvedMoney)
    await runModel(ctx, conv)
  } catch (e) {
    repairDangling(conv)
    notice(conv, describeFailure(e))
  }
  const saved = await s.commit(conv)
  return json({ conversation: publicView(saved) })
}

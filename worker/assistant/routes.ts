/**
 * /api/assistant/* — every route requires a signed-in session; every POST
 * also requires the CSRF token (both enforced in worker/index.ts before these
 * handlers run). Nothing here is reachable without logging in.
 *
 *   GET  /api/assistant/state              settings summary + chat list
 *   GET  /api/assistant/conversations/:id  one chat
 *   GET  /api/assistant/conversations/:id/images/:imageId  an image the operator attached
 *   POST /api/assistant/config             set the Anthropic key (needs 2FA code) and/or model
 *   POST /api/assistant/key/delete         remove the Anthropic key
 *   POST /api/assistant/test               check the key works
 *   POST /api/assistant/chat               send a message (streams progress)
 *   POST /api/assistant/approve            approve / decline the pending batch (streams progress)
 *   POST /api/assistant/answer             answer / skip the assistant's question (streams progress)
 *   POST /api/assistant/wake               run the chat's scheduled check-in (streams progress)
 *   POST /api/assistant/wake/cancel        cancel the scheduled check-in
 *   POST /api/assistant/stop               stop the running turn after the current step
 *   POST /api/assistant/rename             rename a chat
 *   POST /api/assistant/delete             delete a chat
 *
 * chat / approve answer with `application/x-ndjson`: one JSON event per line
 * (see StreamEvent in types.ts), ending with `done` and the saved chat. Every
 * check that can refuse the request (input, lock, 2FA, claim) runs before the
 * stream starts, so refusals are ordinary JSON errors.
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
  beginCheckin,
  executeBatch,
  notice,
  repairDangling,
  resolveQuestion,
  runModel,
  validateAnswers,
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
import { MAX_IMAGES_PER_CHAT, type AssistantStoreApi } from './store'
import { metaOf, type Conversation, type ImageMediaType, type ImageRef, type StreamEvent } from './types'

export interface Sess {
  hash: string
  record: SessionRecord
}

type Dispatch = (req: Request) => Promise<Response>

const MESSAGE_MAX = 4000
const TITLE_MAX = 80
const PAGE_RX = /^\/[A-Za-z0-9/_-]{0,120}$/
const STORE_ID_RX = /^[A-Za-z0-9_-]{1,128}$/
const CONV_ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const IMAGES_PER_MESSAGE = 4
/** Per image, after the browser has scaled it down (Claude reads up to ~1568 px). */
const IMAGE_BYTES_MAX = 1_500_000
const B64_RX = /^[A-Za-z0-9+/]+={0,2}$/

/** The type an image really is, from its first bytes (never the declared type). */
function sniffImage(b: Uint8Array): ImageMediaType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif'
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

type ParsedImage = { ref: ImageRef; bytes: Uint8Array }

/** Validate the images of a chat message: count, size, real type. */
function parseImages(raw: unknown): { ok: true; images: ParsedImage[] } | { ok: false; message: string } {
  if (raw == null) return { ok: true, images: [] }
  if (!Array.isArray(raw)) return { ok: false, message: 'images must be a list' }
  if (raw.length > IMAGES_PER_MESSAGE) return { ok: false, message: `At most ${IMAGES_PER_MESSAGE} images per message.` }
  const images: ParsedImage[] = []
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const data = typeof o.data === 'string' ? o.data : ''
    if (!data || !B64_RX.test(data) || data.length > Math.ceil((IMAGE_BYTES_MAX * 4) / 3) + 4) {
      return { ok: false, message: 'Each image must be a PNG, JPEG, WebP or GIF of at most 1.5 MB.' }
    }
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    } catch {
      return { ok: false, message: 'An image could not be read.' }
    }
    const mediaType = sniffImage(bytes)
    if (!mediaType || bytes.length > IMAGE_BYTES_MAX) {
      return { ok: false, message: 'Each image must be a PNG, JPEG, WebP or GIF of at most 1.5 MB.' }
    }
    const dim = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : undefined)
    const width = dim(o.width)
    const height = dim(o.height)
    images.push({
      ref: { id: crypto.randomUUID(), mediaType, ...(width ? { width } : {}), ...(height ? { height } : {}) },
      bytes,
    })
  }
  return { ok: true, images }
}

function store(env: Bindings, username: string): AssistantStoreApi {
  const ns = env.ASSISTANT_STORE
  if (!ns) throw new Error('ASSISTANT_STORE Durable Object binding is missing (see wrangler.jsonc.example).')
  return ns.get(ns.idFromName(`user:${username}`)) as unknown as AssistantStoreApi
}

function convId(v: unknown): string | null {
  return typeof v === 'string' && CONV_ID_RX.test(v) ? v : null
}

/** What the browser may see: no raw messages, no tool results, no secrets. */
function publicView(conv: Conversation) {
  return {
    ...metaOf(conv),
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
    question: conv.question && { id: conv.question.id, questions: conv.question.questions },
    wakeup: conv.wakeup ? { id: conv.wakeup.id, dueAt: conv.wakeup.dueAt, reason: conv.wakeup.reason } : null,
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

async function makeCtx(
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  s: AssistantStoreApi,
): Promise<TurnCtx> {
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
    checkpoint: (conv) => s.checkpoint(conv),
    loadImages: (cid, ids) => s.getImages(cid, ids),
    shouldStop: async () => false,
    emit: () => {},
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

/**
 * Run `work` while streaming its events to the browser as NDJSON. The work
 * keeps going (waitUntil) if the browser goes away; it always ends by saving
 * the chat, so reopening it shows the outcome.
 */
function streamTurn(ectx: ExecutionContext, work: (emit: (ev: StreamEvent) => void) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  let open = true
  const emit = (ev: StreamEvent) => {
    if (!open) return
    writer.write(enc.encode(JSON.stringify(ev) + '\n')).catch(() => {
      open = false
    })
  }
  const run = (async () => {
    try {
      await work(emit)
    } catch (e) {
      console.error('assistant stream failed', e)
      emit({ t: 'error', message: 'Something went wrong. Reopen the chat to see where it stopped.' })
    } finally {
      try {
        await writer.close()
      } catch {
        /* browser already gone */
      }
    }
  })()
  ectx.waitUntil(run)
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/* ── GETs ─────────────────────────────────────────────────── */

export async function getAssistantState(_req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const [cfg, conversations] = await Promise.all([readConfig(env), store(env, sess.record.username).list()])
  return json({
    config: cfg,
    models: MODELS.map((m) => ({ id: m.id, label: m.label })),
    conversations,
  })
}

export async function getConversation(_req: Request, env: Bindings, sess: Sess, id: string): Promise<Response> {
  const img = /^([^/]+)\/images\/([^/]+)$/.exec(id)
  if (img) return getImage(env, sess, img[1], img[2])
  const cid = convId(id)
  if (!cid) return error('BAD_ID', 'Unknown conversation', 404)
  const conv = await store(env, sess.record.username).read(cid)
  if (!conv) return error('NOT_FOUND', 'Unknown conversation', 404)
  return json({ conversation: publicView(conv) })
}

/**
 * An attached image, for the chat transcript. Only types sniffed on upload
 * are ever stored, and the response can't be run as a page if opened directly.
 */
async function getImage(env: Bindings, sess: Sess, conv: string, image: string): Promise<Response> {
  const cid = convId(conv)
  const iid = convId(image)
  if (!cid || !iid) return error('NOT_FOUND', 'Unknown image', 404)
  const found = await store(env, sess.record.username).getImage(cid, iid)
  if (!found) return error('NOT_FOUND', 'Unknown image', 404)
  return new Response(found.bytes, {
    headers: {
      'Content-Type': found.mediaType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

/* ── POST dispatcher ──────────────────────────────────────── */

export async function assistantPost(
  action: string,
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  ectx: ExecutionContext,
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
      return postChat(req, env, sess, dispatch, ectx)
    case 'approve':
      return postApprove(req, env, sess, dispatch, ectx)
    case 'answer':
      return postAnswer(req, env, sess, dispatch, ectx)
    case 'wake':
      return postWake(req, env, sess, dispatch, ectx)
    case 'wake/cancel':
      return postWakeCancel(req, env, sess)
    case 'stop':
      return postStop(req, env, sess)
    case 'rename':
      return postRename(req, env, sess)
    case 'delete':
      return postDelete(req, env, sess)
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

function titleFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? 'New chat'
  const t = line.trim().replace(/\s+/g, ' ')
  return t.length > 60 ? `${t.slice(0, 57)}…` : t
}

async function postChat(
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  ectx: ExecutionContext,
): Promise<Response> {
  const body = await readJson<{
    conversationId?: unknown
    message?: unknown
    page?: unknown
    storeId?: unknown
    images?: unknown
  }>(req)
  const text = typeof body.message === 'string' ? body.message.trim() : ''
  const parsedImages = parseImages(body.images)
  if (!parsedImages.ok) return error('BAD_IMAGE', parsedImages.message, 400)
  const images = parsedImages.images
  if ((!text && images.length === 0) || text.length > MESSAGE_MAX) {
    return error('BAD_MESSAGE', `Message must be 1–${MESSAGE_MAX} characters.`, 400)
  }
  const requested = body.conversationId == null ? null : convId(body.conversationId)
  if (body.conversationId != null && !requested) return error('BAD_ID', 'Unknown conversation', 404)
  const page = typeof body.page === 'string' && PAGE_RX.test(body.page) ? body.page : undefined
  const storeId = typeof body.storeId === 'string' && STORE_ID_RX.test(body.storeId) ? body.storeId : undefined
  const context = [
    page ? `The operator is on the dashboard page ${page}` : '',
    storeId ? `the selected store is ${storeId}` : '',
  ]
    .filter(Boolean)
    .join('; ')

  const s = store(env, sess.record.username)
  const ctx = await makeCtx(req, env, sess, dispatch, s)
  const begun = await s.begin(requested, sess.record.username, titleFrom(text || 'Image'))
  if (!begun.ok) {
    return begun.reason === 'busy'
      ? error('AI_BUSY', 'The assistant is still working on the last message.', 409)
      : error('NOT_FOUND', 'Unknown conversation', 404)
  }
  const conv = begun.conv
  if (conv.pending) {
    await s.release(conv.id)
    return error('AI_PENDING', 'Approve or decline the pending changes first.', 409)
  }
  if (images.length) {
    const stored = await s.putImages(
      conv.id,
      images.map((i) => ({ id: i.ref.id, mediaType: i.ref.mediaType, bytes: i.bytes })),
    )
    if (!stored) {
      await s.release(conv.id)
      return error('AI_TOO_MANY_IMAGES', `A chat can hold ${MAX_IMAGES_PER_CHAT} images. Start a new chat to send more.`, 409)
    }
  }

  return streamTurn(ectx, async (emit) => {
    ctx.emit = emit
    ctx.shouldStop = () => s.shouldStop(conv.id)
    emit({ t: 'start', conversation: metaOf(conv) })
    // Typing instead of picking an option answers the waiting question.
    if (conv.question) resolveQuestion(ctx, conv, { replied: true })
    repairDangling(ctx, conv)
    appendUserText(
      ctx,
      conv,
      text,
      context || undefined,
      images.map((i) => i.ref),
    )
    try {
      await runModel(ctx, conv)
    } catch (e) {
      repairDangling(ctx, conv)
      notice(ctx, conv, describeFailure(e))
    }
    if (await ctx.shouldStop()) repairDangling(ctx, conv, 'stopped')
    const saved = await s.commit(conv)
    emit({ t: 'done', conversation: publicView(saved) })
  })
}

/* ── approvals ────────────────────────────────────────────── */

async function postApprove(
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  ectx: ExecutionContext,
): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown; batchId?: unknown; decisions?: unknown; totp?: unknown }>(req)
  const cid = convId(body.conversationId)
  const batchId = typeof body.batchId === 'string' ? body.batchId : ''
  if (!cid || !batchId || !body.decisions || typeof body.decisions !== 'object' || Array.isArray(body.decisions)) {
    return error('BAD_INPUT', 'conversationId, batchId and decisions are required', 400)
  }
  const decisions: Decisions = {}
  for (const [k, v] of Object.entries(body.decisions as Record<string, unknown>)) {
    if (v === 'approve' || v === 'decline') decisions[k] = v
  }

  const s = store(env, sess.record.username)
  const current = await s.read(cid)
  const batch = current?.pending
  if (!batch || batch.id !== batchId) {
    return error('AI_NO_PENDING', 'These changes are no longer waiting for approval.', 409)
  }

  // Money moves need a fresh authenticator code, checked before the batch is
  // claimed so a wrong code leaves it waiting. Required whatever the expiry:
  // expiry is decided again inside the store, and two clocks must never be
  // the only thing between a money move and its 2FA check. A money action is
  // one the catalog marks as such or one the dashboard's own money-route gate
  // would ask a code for (shared/moneyRoutes.ts), so the lists can't drift.
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

  const ctx = await makeCtx(req, env, sess, dispatch, s)
  // Atomic: only one request can take the batch, so it runs at most once.
  const claimed = await s.claim(cid, batchId)
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

  return streamTurn(ectx, async (emit) => {
    ctx.emit = emit
    ctx.shouldStop = () => s.shouldStop(conv.id)
    emit({ t: 'start', conversation: metaOf(conv) })
    try {
      // approvedMoney implies the code was verified above (else we returned 401).
      await executeBatch(ctx, conv, claimed.batch, decisions, claimed.expired, approvedMoney)
      await runModel(ctx, conv)
    } catch (e) {
      repairDangling(ctx, conv)
      notice(ctx, conv, describeFailure(e))
    }
    if (await ctx.shouldStop()) repairDangling(ctx, conv, 'stopped')
    const saved = await s.commit(conv)
    emit({ t: 'done', conversation: publicView(saved) })
  })
}

/* ── answers to the assistant's questions ─────────────────── */

async function postAnswer(
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  ectx: ExecutionContext,
): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown; questionId?: unknown; answers?: unknown; skip?: unknown }>(req)
  const cid = convId(body.conversationId)
  const qid = typeof body.questionId === 'string' ? body.questionId : ''
  if (!cid || !qid) return error('BAD_INPUT', 'conversationId and questionId are required', 400)

  const s = store(env, sess.record.username)
  const current = await s.read(cid)
  const q = current?.question
  if (!q || q.id !== qid) return error('AI_NO_QUESTION', 'That question is no longer waiting for an answer.', 409)
  const skip = body.skip === true
  const answers = skip ? null : validateAnswers(q.questions, body.answers)
  if (!skip && !answers) return error('BAD_ANSWER', 'Pick one of the offered options for each question.', 400)

  const ctx = await makeCtx(req, env, sess, dispatch, s)
  const claimed = await s.claimQuestion(cid, qid)
  if (!claimed.ok) {
    return error(
      claimed.reason === 'busy' ? 'AI_BUSY' : 'AI_NO_QUESTION',
      claimed.reason === 'busy' ? 'The assistant is busy. Try again in a moment.' : 'That question is no longer waiting for an answer.',
      409,
    )
  }
  const conv = claimed.conv

  return streamTurn(ectx, async (emit) => {
    ctx.emit = emit
    ctx.shouldStop = () => s.shouldStop(conv.id)
    emit({ t: 'start', conversation: metaOf(conv) })
    resolveQuestion(ctx, conv, answers ? { answers } : { skipped: true })
    try {
      await runModel(ctx, conv)
    } catch (e) {
      repairDangling(ctx, conv)
      notice(ctx, conv, describeFailure(e))
    }
    if (await ctx.shouldStop()) repairDangling(ctx, conv, 'stopped')
    const saved = await s.commit(conv)
    emit({ t: 'done', conversation: publicView(saved) })
  })
}

/* ── scheduled check-ins ──────────────────────────────────── */

/**
 * Run a check-in the assistant scheduled. The operator's own browser calls
 * this when it is due (or when they press "Check now"), so it runs with their
 * session, CSRF token and limits like any message; nothing runs server-side
 * on its own. Two tabs firing together run it once (claimWakeup is atomic).
 */
async function postWake(
  req: Request,
  env: Bindings,
  sess: Sess,
  dispatch: Dispatch,
  ectx: ExecutionContext,
): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown; wakeupId?: unknown }>(req)
  const cid = convId(body.conversationId)
  const wid = typeof body.wakeupId === 'string' ? body.wakeupId : ''
  if (!cid || !wid) return error('BAD_INPUT', 'conversationId and wakeupId are required', 400)

  const s = store(env, sess.record.username)
  const ctx = await makeCtx(req, env, sess, dispatch, s)
  const claimed = await s.claimWakeup(cid, wid)
  if (!claimed.ok) {
    switch (claimed.reason) {
      case 'busy':
        return error('AI_BUSY', 'The assistant is busy. The check-in will run after the current step.', 409)
      case 'pending':
        return error('AI_PENDING', 'Approve, decline or answer what is waiting first.', 409)
      case 'not_found':
        return error('NOT_FOUND', 'Unknown conversation', 404)
      default:
        return error('AI_NO_WAKEUP', 'That check-in already ran or was cancelled.', 409)
    }
  }
  const conv = claimed.conv

  return streamTurn(ectx, async (emit) => {
    ctx.emit = emit
    ctx.shouldStop = () => s.shouldStop(conv.id)
    emit({ t: 'start', conversation: metaOf(conv) })
    repairDangling(ctx, conv)
    beginCheckin(ctx, conv, claimed.wakeup)
    try {
      await runModel(ctx, conv)
    } catch (e) {
      repairDangling(ctx, conv)
      notice(ctx, conv, describeFailure(e))
    }
    if (await ctx.shouldStop()) repairDangling(ctx, conv, 'stopped')
    const saved = await s.commit(conv)
    emit({ t: 'done', conversation: publicView(saved) })
  })
}

async function postWakeCancel(req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown; wakeupId?: unknown }>(req)
  const cid = convId(body.conversationId)
  const wid = typeof body.wakeupId === 'string' ? body.wakeupId : ''
  if (!cid || !wid) return error('BAD_INPUT', 'conversationId and wakeupId are required', 400)
  const r = await store(env, sess.record.username).cancelWakeup(cid, wid)
  if (!r.ok) {
    if (r.reason === 'busy') return error('AI_BUSY', 'Wait for the current step to finish.', 409)
    if (r.reason === 'not_found') return error('NOT_FOUND', 'Unknown conversation', 404)
    return error('AI_NO_WAKEUP', 'That check-in already ran or was cancelled.', 409)
  }
  return json({ conversation: publicView(r.conv) })
}

/* ── chat housekeeping ────────────────────────────────────── */

async function postStop(req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown }>(req)
  const cid = convId(body.conversationId)
  if (!cid) return error('BAD_ID', 'Unknown conversation', 404)
  const stopped = await store(env, sess.record.username).requestStop(cid)
  return json({ ok: true, stopping: stopped })
}

async function postRename(req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown; title?: unknown }>(req)
  const cid = convId(body.conversationId)
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : ''
  if (!cid) return error('BAD_ID', 'Unknown conversation', 404)
  if (!title || title.length > TITLE_MAX) return error('BAD_TITLE', `Title must be 1–${TITLE_MAX} characters.`, 400)
  const ok = await store(env, sess.record.username).rename(cid, title)
  return ok ? json({ ok: true }) : error('NOT_FOUND', 'Unknown conversation', 404)
}

async function postDelete(req: Request, env: Bindings, sess: Sess): Promise<Response> {
  const body = await readJson<{ conversationId?: unknown }>(req)
  const cid = convId(body.conversationId)
  if (!cid) return error('BAD_ID', 'Unknown conversation', 404)
  const r = await store(env, sess.record.username).remove(cid)
  if (r === 'busy') return error('AI_BUSY', 'Wait for the current step to finish.', 409)
  if (r === 'not_found') return error('NOT_FOUND', 'Unknown conversation', 404)
  return json({ ok: true })
}

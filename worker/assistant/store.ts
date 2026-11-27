/**
 * The operator's assistant conversations: one Durable Object per dashboard
 * user (`user:<username>`), holding a list of chats.
 *
 * Why a Durable Object and not KV: approving a batch must run it exactly
 * once. The gateway has no idempotency on payouts, so two approval requests
 * racing (double click, retry, two tabs) must not both execute. Each method
 * here runs its storage read-check-write without yielding to another request
 * (Durable Object input gates), so `claim` and `begin` are atomic.
 *
 * Storage keys: `index` (list of ConversationMeta, newest first),
 * `c:<id>` (messages, pending batch, lock) and `u:<id>` (what the chat shows).
 * Chats untouched for 30 days are deleted by a daily alarm, and at most 200
 * are kept, so gateway data the assistant read does not pile up forever.
 * Images the operator attached live under `img:<chatId>:<imageId>` and go
 * with their chat.
 */

import { DurableObject } from 'cloudflare:workers'
import {
  metaOf,
  newConversation,
  type Conversation,
  type ConversationMeta,
  type PendingBatch,
  type PendingQuestion,
  type ImageMediaType,
  type StoredImage,
  type UiItem,
  type Wakeup,
} from './types'

const TURN_LOCK_MS = 5 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000
const MAX_CONVERSATIONS = 200
/** Images one chat may hold (each is resent to Claude on every turn). */
export const MAX_IMAGES_PER_CHAT = 20

interface ImageRecord {
  mediaType: ImageMediaType
  bytes: Uint8Array
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export type BeginResult =
  | { ok: true; conv: Conversation }
  | { ok: false; reason: 'busy' | 'not_found' }

export type ClaimQuestionResult =
  | { ok: true; conv: Conversation; question: PendingQuestion }
  | { ok: false; reason: 'busy' | 'no_question' | 'not_found' }

export type ClaimWakeupResult =
  | { ok: true; conv: Conversation; wakeup: Wakeup }
  | { ok: false; reason: 'busy' | 'no_wakeup' | 'not_found' | 'pending' }

export type ClaimResult =
  | { ok: true; conv: Conversation; batch: PendingBatch; expired: boolean }
  | { ok: false; reason: 'busy' | 'no_pending' | 'not_found' }

/**
 * The methods as callers see them. Conversations are plain JSON, but the
 * generated RPC types can't prove that for the SDK's message types, so callers
 * use this interface (see routes.ts `store()`).
 */
export interface AssistantStoreApi {
  list(): Promise<ConversationMeta[]>
  read(id: string): Promise<Conversation | null>
  begin(id: string | null, username: string, title: string): Promise<BeginResult>
  claim(id: string, batchId: string): Promise<ClaimResult>
  claimQuestion(id: string, questionId: string): Promise<ClaimQuestionResult>
  claimWakeup(id: string, wakeupId: string): Promise<ClaimWakeupResult>
  cancelWakeup(id: string, wakeupId: string): Promise<{ ok: true; conv: Conversation } | { ok: false; reason: 'busy' | 'no_wakeup' | 'not_found' }>
  checkpoint(conv: Conversation): Promise<void>
  commit(conv: Conversation): Promise<Conversation>
  release(id: string): Promise<void>
  requestStop(id: string): Promise<boolean>
  shouldStop(id: string): Promise<boolean>
  rename(id: string, title: string): Promise<boolean>
  remove(id: string): Promise<'ok' | 'busy' | 'not_found'>
  putImages(id: string, images: Array<{ id: string; mediaType: ImageMediaType; bytes: Uint8Array }>): Promise<boolean>
  getImages(id: string, imageIds: string[]): Promise<Record<string, StoredImage>>
  getImage(id: string, imageId: string): Promise<{ mediaType: ImageMediaType; bytes: Uint8Array } | null>
}

type Core = Omit<Conversation, 'ui'>

export class AssistantStore extends DurableObject implements AssistantStoreApi {
  private async index(): Promise<ConversationMeta[]> {
    return (await this.ctx.storage.get<ConversationMeta[]>('index')) ?? []
  }

  private async core(id: string): Promise<Core | undefined> {
    return this.ctx.storage.get<Core>(`c:${id}`)
  }

  private async load(id: string): Promise<Conversation | null> {
    const core = await this.core(id)
    if (!core) return null
    const ui = (await this.ctx.storage.get<UiItem[]>(`u:${id}`)) ?? []
    return { ...core, ui }
  }

  private async save(conv: Conversation): Promise<void> {
    const { ui, ...core } = conv
    const idx = (await this.index()).filter((m) => m.id !== conv.id)
    idx.push(metaOf(conv))
    idx.sort((a, b) => b.updatedAt - a.updatedAt)
    const dropped = idx.splice(MAX_CONVERSATIONS)
    await this.ctx.storage.put<unknown>({ [`c:${conv.id}`]: core, [`u:${conv.id}`]: ui, index: idx })
    if (dropped.length) {
      await this.ctx.storage.delete(dropped.flatMap((m) => [`c:${m.id}`, `u:${m.id}`]))
      await this.dropImages(dropped.map((m) => m.id))
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
    }
  }

  private async imageKeys(id: string): Promise<string[]> {
    return [...(await this.ctx.storage.list({ prefix: `img:${id}:` })).keys()]
  }

  private async dropImages(ids: string[]): Promise<void> {
    for (const id of ids) {
      const keys = await this.imageKeys(id)
      for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128))
    }
  }

  /** Store a message's images. Refused once the chat holds too many. */
  async putImages(
    id: string,
    images: Array<{ id: string; mediaType: ImageMediaType; bytes: Uint8Array }>,
  ): Promise<boolean> {
    if (!(await this.core(id))) return false
    if ((await this.imageKeys(id)).length + images.length > MAX_IMAGES_PER_CHAT) return false
    for (const img of images) {
      await this.ctx.storage.put<ImageRecord>(`img:${id}:${img.id}`, { mediaType: img.mediaType, bytes: img.bytes })
    }
    return true
  }

  /** Images for a model call, base64-encoded; missing ones are left out. */
  async getImages(id: string, imageIds: string[]): Promise<Record<string, StoredImage>> {
    const got = await this.ctx.storage.get<ImageRecord>(imageIds.map((i) => `img:${id}:${i}`))
    const out: Record<string, StoredImage> = {}
    for (const [key, rec] of got) out[key.slice(`img:${id}:`.length)] = { mediaType: rec.mediaType, data: toBase64(rec.bytes) }
    return out
  }

  async getImage(id: string, imageId: string): Promise<{ mediaType: ImageMediaType; bytes: Uint8Array } | null> {
    const rec = await this.ctx.storage.get<ImageRecord>(`img:${id}:${imageId}`)
    return rec ? { mediaType: rec.mediaType, bytes: rec.bytes } : null
  }

  async list(): Promise<ConversationMeta[]> {
    return this.index()
  }

  async read(id: string): Promise<Conversation | null> {
    return this.load(id)
  }

  /** Start a chat turn (creating the chat when id is null). Refuses a busy chat. */
  async begin(id: string | null, username: string, title: string): Promise<BeginResult> {
    let conv: Conversation | null
    if (id === null) {
      conv = newConversation(username, crypto.randomUUID(), title)
    } else {
      conv = await this.load(id)
      if (!conv) return { ok: false, reason: 'not_found' }
      if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    }
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    conv.stop = false
    conv.updatedAt = Date.now()
    await this.save(conv)
    return { ok: true, conv }
  }

  /**
   * Take the pending batch for execution. Atomic: the batch is removed from
   * storage in the same step, so a second claim for it finds nothing.
   */
  async claim(id: string, batchId: string): Promise<ClaimResult> {
    const conv = await this.load(id)
    if (!conv) return { ok: false, reason: 'not_found' }
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    const batch = conv.pending
    if (!batch || batch.id !== batchId) return { ok: false, reason: 'no_pending' }
    conv.pending = null
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    conv.stop = false
    await this.save(conv)
    return { ok: true, conv, batch, expired: batch.expiresAt <= Date.now() }
  }

  /**
   * Take the waiting question to answer it. Atomic like claim(): the lock is
   * taken in the same step, so the same answer can't be applied twice. The
   * question stays on the conversation for the caller to resolve.
   */
  async claimQuestion(id: string, questionId: string): Promise<ClaimQuestionResult> {
    const conv = await this.load(id)
    if (!conv) return { ok: false, reason: 'not_found' }
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    const question = conv.question
    if (!question || question.id !== questionId) return { ok: false, reason: 'no_question' }
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    conv.stop = false
    await this.save(conv)
    return { ok: true, conv, question }
  }

  /**
   * Take the scheduled check-in to run it. Atomic like claim(): the check-in
   * is removed in the same step, so two tabs that both see it due run it once.
   * Refused while changes or a question wait for the operator.
   */
  async claimWakeup(id: string, wakeupId: string): Promise<ClaimWakeupResult> {
    const conv = await this.load(id)
    if (!conv) return { ok: false, reason: 'not_found' }
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    const wakeup = conv.wakeup ?? null
    if (!wakeup || wakeup.id !== wakeupId) return { ok: false, reason: 'no_wakeup' }
    if (conv.pending || conv.question) return { ok: false, reason: 'pending' }
    conv.wakeup = null
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    conv.stop = false
    await this.save(conv)
    return { ok: true, conv, wakeup }
  }

  /** The operator cancels the scheduled check-in. */
  async cancelWakeup(
    id: string,
    wakeupId: string,
  ): Promise<{ ok: true; conv: Conversation } | { ok: false; reason: 'busy' | 'no_wakeup' | 'not_found' }> {
    const conv = await this.load(id)
    if (!conv) return { ok: false, reason: 'not_found' }
    // A running turn saves the whole chat when it ends, which would undo this.
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    if (!conv.wakeup || conv.wakeup.id !== wakeupId) return { ok: false, reason: 'no_wakeup' }
    conv.wakeup = null
    conv.ui = conv.ui.map((x) => (x.kind === 'wakeup' && x.id === wakeupId ? { ...x, status: 'cancelled' as const } : x))
    const next: Conversation = { ...conv, rev: conv.rev + 1, updatedAt: Date.now() }
    await this.save(next)
    return { ok: true, conv: next }
  }

  /**
   * Save progress mid-turn and renew the lock. Called after approved changes
   * run and before every further model call, so a slow turn never loses the
   * record of what already happened, and its lock never lapses while it works.
   * The stop flag is read from storage, so a Stop pressed meanwhile survives.
   */
  async checkpoint(conv: Conversation): Promise<void> {
    const current = await this.core(conv.id)
    await this.save({
      ...conv,
      stop: current?.stop ?? conv.stop,
      busyUntil: Date.now() + TURN_LOCK_MS,
      updatedAt: Date.now(),
    })
  }

  /** Save the result of a turn and release the lock. */
  async commit(conv: Conversation): Promise<Conversation> {
    const next: Conversation = { ...conv, rev: conv.rev + 1, busyUntil: 0, stop: false, updatedAt: Date.now() }
    await this.save(next)
    return next
  }

  /** Release the lock without other changes (turn failed before any change). */
  async release(id: string): Promise<void> {
    const core = await this.core(id)
    if (!core) return
    await this.ctx.storage.put(`c:${id}`, { ...core, busyUntil: 0 })
  }

  /** The Stop button: honoured between steps, never in the middle of a change. */
  async requestStop(id: string): Promise<boolean> {
    const core = await this.core(id)
    if (!core || core.busyUntil <= Date.now()) return false
    await this.ctx.storage.put(`c:${id}`, { ...core, stop: true })
    return true
  }

  async shouldStop(id: string): Promise<boolean> {
    return !!(await this.core(id))?.stop
  }

  async rename(id: string, title: string): Promise<boolean> {
    const core = await this.core(id)
    if (!core) return false
    await this.ctx.storage.put(`c:${id}`, { ...core, title })
    const idx = (await this.index()).map((m) => (m.id === id ? { ...m, title } : m))
    await this.ctx.storage.put('index', idx)
    return true
  }

  /** Delete a chat. Refused while a turn is running (its commit would race). */
  async remove(id: string): Promise<'ok' | 'busy' | 'not_found'> {
    const core = await this.core(id)
    if (!core) return 'not_found'
    if (core.busyUntil > Date.now()) return 'busy'
    await this.ctx.storage.delete([`c:${id}`, `u:${id}`])
    await this.dropImages([id])
    await this.ctx.storage.put('index', (await this.index()).filter((m) => m.id !== id))
    return 'ok'
  }

  /** Daily sweep: delete chats nobody touched for 30 days. */
  async alarm(): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS
    const idx = await this.index()
    const keep = idx.filter((m) => m.updatedAt >= cutoff)
    const old = idx.filter((m) => m.updatedAt < cutoff)
    if (old.length) {
      await this.ctx.storage.delete(old.flatMap((m) => [`c:${m.id}`, `u:${m.id}`]))
      await this.dropImages(old.map((m) => m.id))
      await this.ctx.storage.put('index', keep)
    }
    if (keep.length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
  }
}

/**
 * Conversation state, one Durable Object per login session (keyed by the
 * session hash, so a conversation dies with its session and nobody else can
 * reach it).
 *
 * Why a Durable Object and not KV: approving a batch must run it exactly
 * once. The gateway has no idempotency on payouts, so two approval requests
 * racing (double click, retry, two tabs) must not both execute. Each method
 * here runs its storage read-check-write without yielding to another request
 * (Durable Object input gates), so `claim` and `begin` are atomic.
 *
 * Conversations are deleted 24 hours after their last change (alarm), so
 * gateway data the assistant read does not pile up.
 */

import { DurableObject } from 'cloudflare:workers'
import { emptyConversation, type Conversation, type PendingBatch } from './types'

const TURN_LOCK_MS = 5 * 60 * 1000
const IDLE_DELETE_MS = 24 * 60 * 60 * 1000

export type BeginResult = { ok: true; conv: Conversation } | { ok: false; reason: 'busy' }

export type ClaimResult =
  | { ok: true; conv: Conversation; batch: PendingBatch; expired: boolean }
  | { ok: false; reason: 'busy' | 'no_pending' }

/**
 * The methods as callers see them. Conversations are plain JSON, but the
 * generated RPC types can't prove that for the SDK's message types, so callers
 * use this interface (see routes.ts `store()`).
 */
export interface AssistantStoreApi {
  read(username: string): Promise<Conversation>
  begin(username: string): Promise<BeginResult>
  claim(username: string, batchId: string): Promise<ClaimResult>
  commit(conv: Conversation): Promise<Conversation>
  checkpoint(conv: Conversation): Promise<void>
  release(username: string): Promise<void>
  reset(username: string): Promise<boolean>
}

export class AssistantStore extends DurableObject implements AssistantStoreApi {
  private async load(username: string): Promise<Conversation> {
    return (await this.ctx.storage.get<Conversation>('conv')) ?? emptyConversation(username)
  }

  private async save(conv: Conversation): Promise<void> {
    await this.ctx.storage.put('conv', conv)
    await this.ctx.storage.setAlarm(Date.now() + IDLE_DELETE_MS)
  }

  async read(username: string): Promise<Conversation> {
    return this.load(username)
  }

  /** Start a chat turn: refuse if another turn is running. */
  async begin(username: string): Promise<BeginResult> {
    const conv = await this.load(username)
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    await this.save(conv)
    return { ok: true, conv }
  }

  /**
   * Take the pending batch for execution. Atomic: the batch is removed from
   * storage in the same step, so a second claim for it finds nothing.
   */
  async claim(username: string, batchId: string): Promise<ClaimResult> {
    const conv = await this.load(username)
    if (conv.busyUntil > Date.now()) return { ok: false, reason: 'busy' }
    const batch = conv.pending
    if (!batch || batch.id !== batchId) return { ok: false, reason: 'no_pending' }
    conv.pending = null
    conv.busyUntil = Date.now() + TURN_LOCK_MS
    await this.save(conv)
    return { ok: true, conv, batch, expired: batch.expiresAt <= Date.now() }
  }

  /** Save the result of a turn and release the lock. */
  async commit(conv: Conversation): Promise<Conversation> {
    const next: Conversation = { ...conv, rev: conv.rev + 1, busyUntil: 0, updatedAt: Date.now() }
    await this.save(next)
    return next
  }

  /**
   * Save progress mid-turn and renew the lock. Called after approved changes
   * run and before every further model call, so a slow turn never loses the
   * record of what already happened, and its lock never lapses while it works.
   */
  async checkpoint(conv: Conversation): Promise<void> {
    await this.save({ ...conv, busyUntil: Date.now() + TURN_LOCK_MS, updatedAt: Date.now() })
  }

  /** Release the lock without other changes (turn failed before any change). */
  async release(username: string): Promise<void> {
    const conv = await this.load(username)
    conv.busyUntil = 0
    await this.save(conv)
  }

  /** Start over. Refused while a turn is running (its commit would race). */
  async reset(username: string): Promise<boolean> {
    const conv = await this.load(username)
    if (conv.busyUntil > Date.now()) return false
    await this.ctx.storage.deleteAll()
    return true
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}

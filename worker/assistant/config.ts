/**
 * Assistant settings: the operator's Anthropic API key and model choice.
 *
 * The key is sealed with DASHBOARD_KEK (AES-GCM) before it is written to KV,
 * exactly like the gateway admin key, and is never returned to the browser:
 * the UI only ever sees whether one is set and its last four characters.
 */

import { seal, unseal } from '../lib/crypto'
import { kek, type Bindings } from '../lib/env'
import { kvDelete, kvGet, kvPut } from '../lib/kv'

const K_KEY = 'ai:anthropic_key'
const K_HINT = 'ai:anthropic_key_hint'
const K_MODEL = 'ai:model'

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', fallbacks: false },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5'

export function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && MODELS.some((m) => m.id === v)
}

// Anthropic API keys: "sk-ant-" then url-safe characters.
const KEY_RX = /^sk-ant-[A-Za-z0-9_-]{20,250}$/

export function validApiKey(v: unknown): v is string {
  return typeof v === 'string' && KEY_RX.test(v)
}

export interface AssistantConfig {
  configured: boolean
  keyHint: string | null
  model: ModelId
}

export async function readConfig(env: Bindings): Promise<AssistantConfig> {
  const [sealed, hint, model] = await Promise.all([
    kvGet(env, K_KEY, 'text'),
    kvGet(env, K_HINT, 'text'),
    kvGet(env, K_MODEL, 'text'),
  ])
  return {
    configured: !!sealed,
    keyHint: sealed ? (hint ?? null) : null,
    model: isModelId(model) ? model : DEFAULT_MODEL,
  }
}

export async function readApiKey(env: Bindings): Promise<string | null> {
  const sealed = await kvGet(env, K_KEY, 'text')
  return sealed ? unseal(sealed, kek(env)) : null
}

export async function writeApiKey(env: Bindings, key: string): Promise<void> {
  await kvPut(env, K_KEY, await seal(key, kek(env)))
  await kvPut(env, K_HINT, key.slice(-4))
}

export async function deleteApiKey(env: Bindings): Promise<void> {
  await kvDelete(env, K_KEY)
  await kvDelete(env, K_HINT)
}

export async function writeModel(env: Bindings, model: ModelId): Promise<void> {
  await kvPut(env, K_MODEL, model)
}

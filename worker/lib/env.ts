/**
 * Env accessors with early fail-fast for missing bindings/secrets.
 */

export interface Bindings extends Env {}

export function kv(env: Bindings): KVNamespace {
  if (!env.DASHBOARD_KV) {
    throw new Error('DASHBOARD_KV binding is missing. Create a KV namespace and wire it in wrangler.jsonc.')
  }
  return env.DASHBOARD_KV
}

export function kek(env: Bindings): string {
  const v = (env as unknown as { DASHBOARD_KEK?: string }).DASHBOARD_KEK
  if (!v) {
    throw new Error(
      'DASHBOARD_KEK secret is missing. Run: wrangler secret put DASHBOARD_KEK',
    )
  }
  return v
}

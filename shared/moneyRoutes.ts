/**
 * Which dashboard API calls move money (or hand out the means to) and so need
 * a fresh authenticator code on top of session + CSRF.
 *
 * Shared by the Worker (enforces it) and the browser (asks for the code before
 * sending, so the first request already carries it). The Worker is the only
 * place that decides; the browser copy just avoids a refused round trip.
 *
 * The code travels in the `X-TOTP-Code` request header so request bodies that
 * are forwarded to the gateway stay unchanged. Neither proxy forwards that
 * header upstream (both use a request-header allowlist).
 */

export const STEPUP_HEADER = 'X-TOTP-Code'

type Rule = {
  methods: readonly string[]
  rx: RegExp
  label: string
  /** The gateway treats a body of `{ dryRun: true }` as a side-effect-free
   * preview (checked in crypto-gateway admin.ts / payout-rbf.ts). */
  dryRunOk?: boolean
}

const SEG = '[^/]+'
const POST = ['POST'] as const
const r = (
  methods: readonly string[],
  path: string,
  label: string,
  opts: { dryRunOk?: boolean } = {},
): Rule => ({
  methods,
  rx: new RegExp(`^${path}$`),
  label,
  ...opts,
})
const DRY = { dryRunOk: true }

const RULES: readonly Rule[] = [
  /* merchant-scoped surface */
  r(POST, `/api/mg/${SEG}/payouts`, 'Send a payout'),
  r(POST, `/api/mg/${SEG}/payouts/batch`, 'Send a payout batch'),

  /* local merchant records (PATCH goes to the gateway's merchant settings) */
  r(['PATCH'], `/api/merchants/${SEG}`, 'Change store settings'),
  // A new key can carry payouts:write and is shown in plain text once.
  r(POST, `/api/merchants/${SEG}/api-keys`, 'Create a store API key'),

  /* gateway admin proxy */
  r(POST, `/api/gw/admin/payouts/${SEG}/recover`, 'Recover a held payout'),
  r(POST, `/api/gw/admin/payouts/${SEG}/bump-fee`, 'Bump a payout fee', DRY),
  r(POST, `/api/gw/admin/pool/consolidate`, 'Consolidate pool funds'),
  r(POST, `/api/gw/admin/consolidation-schedules`, 'Create a consolidation schedule'),
  r(['PATCH'], `/api/gw/admin/consolidation-schedules/${SEG}`, 'Change a consolidation schedule'),
  r(['DELETE'], `/api/gw/admin/consolidation-schedules/${SEG}`, 'Delete a consolidation schedule'),
  r(POST, `/api/gw/admin/treasury/destinations`, 'Add a treasury destination'),
  r(['PATCH'], `/api/gw/admin/treasury/destinations/${SEG}`, 'Change a treasury destination'),
  r(['DELETE'], `/api/gw/admin/treasury/destinations/${SEG}`, 'Remove a treasury destination'),
  r(POST, `/api/gw/admin/treasury/destinations/${SEG}/verify`, 'Verify a treasury destination'),
  r(POST, `/api/gw/admin/treasury/destinations/${SEG}/mark-verified`, 'Mark a treasury destination verified'),
  r(POST, `/api/gw/admin/treasury/destinations/${SEG}/transfer`, 'Transfer to treasury', DRY),
  r(POST, `/api/gw/admin/exchange/kraken/run`, 'Run the Kraken exchange', DRY),
  r(POST, `/api/gw/admin/fee-wallets/${SEG}/use-pool`, 'Switch fee wallet to the pool'),
  // Importing a key the caller knows would let them drain the fee wallet.
  r(POST, `/api/gw/admin/fee-wallets/${SEG}/import`, 'Import a fee wallet'),
  r(['DELETE'], `/api/gw/admin/fee-wallets/${SEG}`, 'Remove a fee wallet'),
  r(POST, `/api/gw/admin/fee-wallets/tron/(freeze|unfreeze|delegate|undelegate)`, 'Change TRON fee-wallet staking'),
  r(POST, `/api/gw/admin/orphan-transactions/${SEG}/attribute`, 'Attribute an orphan transaction'),
  r(POST, `/api/gw/admin/balances/reconcile`, 'Reconcile balances', DRY),
  r(POST, `/api/gw/admin/webhook-deliveries/${SEG}/replay`, 'Replay a webhook'),
  // Same effect as PATCH /api/merchants/:id / POST …/api-keys, reached
  // through the generic admin proxy.
  r(['PATCH'], `/api/gw/admin/merchants/${SEG}`, 'Change store settings'),
  r(POST, `/api/gw/admin/merchants/${SEG}/api-keys`, 'Create a store API key'),
]

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const tidy = (p: string) => {
  let out = p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/**
 * The shapes a path is matched in: as sent (slashes collapsed, lower-case, no
 * trailing slash — how the Worker's own routing splits it) and fully decoded
 * (percent-decoded repeatedly so `%252F` can't hide a slash, dot segments
 * resolved — how the gateway behind the proxy may read it). Returns null if
 * the path can't be decoded to a stable form; callers treat that as "needs
 * the code" (fail closed).
 */
export function apiPathForms(rawPath: string): string[] | null {
  const raw = rawPath.split('?')[0].split('#')[0]
  let p = raw
  let stable = false
  for (let i = 0; i < 5 && !stable; i++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(p).replace(/\\/g, '/')
    } catch {
      return null
    }
    // Resolve `.` / `..` segments the same way the proxy's URL join does.
    const resolved = new URL(decoded.startsWith('/') ? decoded : '/' + decoded, 'http://x').pathname
    stable = resolved === p
    p = resolved
  }
  if (!stable) return null
  return [tidy(raw), tidy(p)]
}

export type MoneyAction = { label: string; dryRunOk: boolean }

/**
 * The money action a request performs, or null if it needs no step-up.
 * `path` is the dashboard API path (`/api/...`, query allowed). When the
 * result has `dryRunOk`, a body for which `isDryRunBody` is true needs no code.
 */
export function moneyActionFor(method: string, path: string): MoneyAction | null {
  const m = method.toUpperCase()
  if (SAFE_METHODS.has(m)) return null
  const forms = apiPathForms(path)
  if (forms === null) return { label: 'Protected action', dryRunOk: false }
  for (const p of forms) {
    // Writes through the raw merchant proxy, or through the admin proxy
    // outside /admin/*, have no UI caller: always protect them.
    if (/^\/api\/mg\/[^/]+\/raw(\/|$)/.test(p)) return { label: 'Raw store API call', dryRunOk: false }
    if (p.startsWith('/api/gw/') && !p.startsWith('/api/gw/admin/')) {
      return { label: 'Raw gateway call', dryRunOk: false }
    }
    for (const rule of RULES) {
      if (rule.methods.includes(m) && rule.rx.test(p)) {
        return { label: rule.label, dryRunOk: rule.dryRunOk === true }
      }
    }
  }
  return null
}

/**
 * True only for a JSON object body whose `dryRun` is the boolean `true` —
 * the exact shape the gateway's schemas read as a preview. Anything else
 * (unparsable, `"true"`, `1`, missing) is a real run.
 */
export function isDryRunBody(text: string | null | undefined): boolean {
  if (!text) return false
  try {
    const v: unknown = JSON.parse(text)
    return (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      (v as Record<string, unknown>).dryRun === true
    )
  } catch {
    return false
  }
}

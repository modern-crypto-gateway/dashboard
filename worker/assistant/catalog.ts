/**
 * The assistant's allowlist: every dashboard API call it may make, and how
 * risky each one is. Anything not listed here is refused before it reaches
 * the router. The risk class decides approval, never the model:
 *
 *   read   runs immediately
 *   write  changes something; the operator approves it with a click
 *   money  moves funds, or changes where or when funds move; the operator
 *          approves it and enters a fresh authenticator code
 *
 * Deliberately absent (the assistant tells the operator to use the page):
 *   - anything that returns or sets a secret: store creation, key creation
 *     and rotation, webhook-secret rotation, fee-wallet key import, Alchemy
 *     signing keys and bootstrap
 *   - dashboard settings, security, setup and login, and the assistant's own
 *     settings (it must never be able to change its own guardrails)
 *   - deleting a store record, gateway debug / migrate / repair endpoints,
 *     and the raw merchant proxy
 */

export type Risk = 'read' | 'write' | 'money'
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface Endpoint {
  method: Method
  /** Path template; `:name` matches one safe path segment. */
  path: string
  risk: Risk
  /** Short operator-facing label, also shown on approval cards. */
  label: string
  /** Extra guidance for the model (body shape, query params). */
  hint?: string
}

const STORE = '/api/mg/:storeId'
const GW = '/api/gw/admin'

export const ENDPOINTS: Endpoint[] = [
  /* ── stores (dashboard records) ─────────────────────────── */
  { method: 'GET', path: '/api/merchants', risk: 'read', label: 'List stores' },
  { method: 'GET', path: '/api/merchants/:storeId/api-keys', risk: 'read', label: "List a store's API keys" },
  { method: 'POST', path: '/api/merchants/:storeId/activate', risk: 'write', label: 'Activate store' },
  { method: 'POST', path: '/api/merchants/:storeId/deactivate', risk: 'write', label: 'Deactivate store' },
  {
    method: 'PATCH',
    path: '/api/merchants/:storeId',
    risk: 'money',
    label: 'Change store settings',
    hint: 'Body: any of name, webhookUrl (string|null), paymentToleranceUnderBps, paymentToleranceOverBps, addressCooldownSeconds, confirmationThresholds (object|null), confirmationTiers (object|null). Tolerances and confirmations decide when an invoice counts as paid.',
  },
  { method: 'DELETE', path: '/api/merchants/:storeId/api-keys/:keyId', risk: 'write', label: 'Revoke store API key' },

  /* ── invoices (per store) ───────────────────────────────── */
  {
    method: 'GET',
    path: `${STORE}/invoices`,
    risk: 'read',
    label: 'List invoices',
    hint: 'Query: status, extraStatus, chainId, token, externalId, externalIdContains, toAddress (exact receive address), addressContains, fromAddress (payer), txHash, hasPayments, amountUsdMin/Max, paidUsdMin/Max, createdFrom/To, updatedFrom/To, confirmedFrom/To, expiresFrom/To (ms epoch), sortBy, sortDir, limit (<=100), offset.',
  },
  { method: 'GET', path: `${STORE}/invoices/:invoiceId`, risk: 'read', label: 'Get invoice' },
  {
    method: 'POST',
    path: `${STORE}/invoices`,
    risk: 'write',
    label: 'Create invoice',
    hint: 'Body: chainId, token, exactly one of amountUsd ("12.50") | amountRaw (base units string) | fiatAmount+fiatCurrency; optional acceptedFamilies[], externalId, metadata{}, expiresInMinutes (1-1440).',
  },
  { method: 'POST', path: `${STORE}/invoices/:invoiceId/expire`, risk: 'write', label: 'Expire invoice' },

  /* ── payouts (per store) ────────────────────────────────── */
  {
    method: 'GET',
    path: `${STORE}/payouts`,
    risk: 'read',
    label: 'List payouts',
    hint: 'Query: status, chainId, token, destinationAddress, destinationAddressContains, sourceAddress, sourceAddressContains, batchId, txHash, feeTier, hasError, amountUsdMin/Max, createdFrom/To, submittedFrom/To, confirmedFrom/To (ms epoch), sortBy, sortDir, limit (<=100), offset.',
  },
  { method: 'GET', path: `${STORE}/payouts/:payoutId`, risk: 'read', label: 'Get payout' },
  {
    method: 'POST',
    path: `${STORE}/payouts/estimate`,
    risk: 'read',
    label: 'Estimate payout fees',
    hint: 'Same body as Send payout. Quotes fees, moves nothing.',
  },
  {
    method: 'POST',
    path: `${STORE}/payouts`,
    risk: 'money',
    label: 'Send payout',
    hint: 'Body: chainId, token, destinationAddress, exactly one of amount (decimal string in token units) | amountRaw (base units) | amountUSD; optional feeTier low|medium|high. Estimate first.',
  },
  {
    method: 'POST',
    path: `${STORE}/payouts/batch`,
    risk: 'money',
    label: 'Send batch payout',
    hint: 'Body: { payouts: [ same row shape as Send payout ] } (max 100 rows).',
  },
  { method: 'POST', path: `${STORE}/payouts/:payoutId/cancel`, risk: 'write', label: 'Cancel payout' },

  /* ── gateway admin: reads ───────────────────────────────── */
  { method: 'GET', path: '/api/gw/health', risk: 'read', label: 'Gateway health' },
  { method: 'GET', path: `${GW}/merchants`, risk: 'read', label: 'List gateway merchants' },
  { method: 'GET', path: `${GW}/merchants/:storeId`, risk: 'read', label: 'Get gateway merchant' },
  { method: 'GET', path: `${GW}/chains`, risk: 'read', label: 'List chains' },
  { method: 'GET', path: `${GW}/balances`, risk: 'read', label: 'Balances' },
  { method: 'GET', path: `${GW}/pool/stats`, risk: 'read', label: 'Address pool stats' },
  { method: 'GET', path: `${GW}/pool/addresses`, risk: 'read', label: 'Pool addresses', hint: 'Query: family, status, limit, offset.' },
  { method: 'GET', path: `${GW}/pool/addresses/disabled`, risk: 'read', label: 'Disabled pool addresses' },
  { method: 'GET', path: `${GW}/pool/audit`, risk: 'read', label: 'Pool audit' },
  { method: 'GET', path: `${GW}/pool/consolidations/:id`, risk: 'read', label: 'Get consolidation' },
  { method: 'GET', path: `${GW}/monero-pool/stats`, risk: 'read', label: 'Monero pool stats' },
  { method: 'GET', path: `${GW}/payouts/held`, risk: 'read', label: 'Held payouts', hint: 'Query: chainId, token, limit.' },
  { method: 'GET', path: `${GW}/consolidation-schedules`, risk: 'read', label: 'Consolidation schedules' },
  { method: 'GET', path: `${GW}/consolidation-schedules/:id`, risk: 'read', label: 'Get consolidation schedule' },
  { method: 'GET', path: `${GW}/treasury/destinations`, risk: 'read', label: 'Treasury destinations' },
  { method: 'GET', path: `${GW}/treasury/destinations/:id`, risk: 'read', label: 'Get treasury destination' },
  { method: 'GET', path: `${GW}/treasury/transfers`, risk: 'read', label: 'Treasury transfers' },
  { method: 'GET', path: `${GW}/exchange/kraken`, risk: 'read', label: 'Kraken exchange status' },
  { method: 'GET', path: `${GW}/exchange/kraken/actions`, risk: 'read', label: 'Kraken exchange actions' },
  { method: 'GET', path: `${GW}/webhook-deliveries`, risk: 'read', label: 'Webhook deliveries' },
  { method: 'GET', path: `${GW}/orphan-transactions`, risk: 'read', label: 'Orphan transactions' },
  { method: 'GET', path: `${GW}/fee-wallets`, risk: 'read', label: 'Fee wallets' },
  { method: 'GET', path: `${GW}/fee-wallets/tron/resources`, risk: 'read', label: 'Tron fee-wallet resources' },

  /* ── gateway admin: changes ─────────────────────────────── */
  { method: 'POST', path: `${GW}/pool/addresses/disable`, risk: 'write', label: 'Disable pool addresses' },
  { method: 'POST', path: `${GW}/pool/addresses/enable`, risk: 'write', label: 'Enable pool addresses' },
  { method: 'POST', path: `${GW}/pool/initialize`, risk: 'write', label: 'Initialize address pool' },
  { method: 'POST', path: `${GW}/monero-pool/initialize`, risk: 'write', label: 'Initialize Monero pool' },
  { method: 'POST', path: `${GW}/audit-address`, risk: 'write', label: 'Audit address', hint: 'Body: chainId, address (gateway-controlled addresses only).' },
  { method: 'POST', path: `${GW}/orphan-transactions/:id/dismiss`, risk: 'write', label: 'Dismiss orphan transaction' },

  /* ── gateway admin: money ───────────────────────────────── */
  // Reconcile with dryRun:false writes signed ledger adjustments that change
  // spendable balances; a replayed "paid" webhook can make a store ship twice.
  { method: 'POST', path: `${GW}/balances/reconcile`, risk: 'money', label: 'Reconcile balances (ledger adjustment)' },
  { method: 'POST', path: `${GW}/webhook-deliveries/:id/replay`, risk: 'money', label: 'Replay webhook delivery' },
  { method: 'POST', path: `${GW}/orphan-transactions/:id/attribute`, risk: 'money', label: 'Credit orphan transaction to invoice' },
  { method: 'POST', path: `${GW}/payouts/:id/recover`, risk: 'money', label: 'Recover payout' },
  { method: 'POST', path: `${GW}/payouts/:id/bump-fee`, risk: 'money', label: 'Bump payout fee' },
  { method: 'POST', path: `${GW}/pool/consolidate`, risk: 'money', label: 'Consolidate pool funds' },
  { method: 'POST', path: `${GW}/consolidation-schedules`, risk: 'money', label: 'Create consolidation schedule' },
  { method: 'PATCH', path: `${GW}/consolidation-schedules/:id`, risk: 'money', label: 'Change consolidation schedule' },
  { method: 'DELETE', path: `${GW}/consolidation-schedules/:id`, risk: 'money', label: 'Delete consolidation schedule' },
  { method: 'POST', path: `${GW}/treasury/destinations`, risk: 'money', label: 'Add treasury destination' },
  { method: 'PATCH', path: `${GW}/treasury/destinations/:id`, risk: 'money', label: 'Change treasury destination' },
  { method: 'DELETE', path: `${GW}/treasury/destinations/:id`, risk: 'money', label: 'Delete treasury destination' },
  { method: 'POST', path: `${GW}/treasury/destinations/:id/verify`, risk: 'money', label: 'Verify treasury destination' },
  { method: 'POST', path: `${GW}/treasury/destinations/:id/mark-verified`, risk: 'money', label: 'Mark treasury destination verified' },
  { method: 'POST', path: `${GW}/treasury/destinations/:id/transfer`, risk: 'money', label: 'Transfer to treasury' },
  { method: 'POST', path: `${GW}/exchange/kraken/run`, risk: 'money', label: 'Run Kraken exchange' },
  { method: 'POST', path: `${GW}/fee-wallets/:family/use-pool`, risk: 'money', label: 'Use pool as fee wallet' },
  { method: 'DELETE', path: `${GW}/fee-wallets/:family`, risk: 'money', label: 'Remove fee wallet' },
  { method: 'POST', path: `${GW}/fee-wallets/tron/freeze`, risk: 'money', label: 'Freeze TRX for resources' },
  { method: 'POST', path: `${GW}/fee-wallets/tron/unfreeze`, risk: 'money', label: 'Unfreeze TRX' },
  { method: 'POST', path: `${GW}/fee-wallets/tron/delegate`, risk: 'money', label: 'Delegate Tron resources' },
  { method: 'POST', path: `${GW}/fee-wallets/tron/undelegate`, risk: 'money', label: 'Undelegate Tron resources' },
]

/* ── matching ─────────────────────────────────────────────── */

// One path segment: ids, chain ids, families. No dots-only segments, no
// encoded characters, no slashes.
const SEGMENT_RX = /^[A-Za-z0-9_~:-][A-Za-z0-9_.~:-]{0,127}$/

export interface Match {
  endpoint: Endpoint
  params: Record<string, string>
}

export function matchEndpoint(method: string, path: string): Match | null {
  if (typeof path !== 'string' || path.length > 512 || !path.startsWith('/api/')) return null
  if (path.includes('?') || path.includes('#') || path.includes('%') || path.includes('\\')) return null
  const parts = path.split('/').slice(1)
  if (parts.some((p) => !SEGMENT_RX.test(p) || p === '.' || p === '..')) return null
  for (const ep of ENDPOINTS) {
    if (ep.method !== method) continue
    const tpl = ep.path.split('/').slice(1)
    if (tpl.length !== parts.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < tpl.length; i++) {
      if (tpl[i].startsWith(':')) params[tpl[i].slice(1)] = parts[i]
      else if (tpl[i] !== parts[i]) {
        ok = false
        break
      }
    }
    if (ok) return { endpoint: ep, params }
  }
  return null
}

/** The endpoint list as the model sees it (stable text, cached with the tools). */
export function catalogText(): string {
  const tag = { read: 'runs now', write: 'needs approval', money: 'needs approval + 2FA' }
  return ENDPOINTS.map(
    (e) => `${e.method} ${e.path}  [${tag[e.risk]}] ${e.label}${e.hint ? `. ${e.hint}` : ''}`,
  ).join('\n')
}

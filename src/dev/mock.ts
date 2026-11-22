/**
 * Dev-only mock API for design preview (`npm run dev:mock`).
 *
 * `installMockApi()` swaps `window.fetch` for a handler that answers
 * same-origin `/api/...` requests from an in-memory fixture DB
 * (`./mockData`) with 150–400 ms of fake latency. Anything else falls through
 * to the real fetch. Loaded only via a dynamic import guarded by
 * `import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'` in `main.tsx`.
 *
 * Preview switches — add `?mock=<flags>` to any URL (comma-separated, sticky
 * for the tab via sessionStorage; `?mock=default` clears):
 *   empty        list endpoints return empty lists (merchants are kept)
 *   nomerchants  /api/merchants returns no merchants
 *   error        every GET /api/gw/* answers 500 upstream_error
 *   loggedout    session is unauthenticated → login screen
 *   setup        setupComplete=false → setup wizard
 */
import type {
  AutoConsolidationSchedule,
  Family,
  GatewayInvoice,
  GatewayPayout,
  Merchant,
  MerchantApiKey,
  PayoutEstimate,
  TreasuryDestination,
  TreasuryTransfer,
} from '@/lib/types'
import {
  CHAIN_DEFS,
  PRICES,
  addressFor,
  chainFamily,
  createDb,
  invoiceAmounts,
  tokenDecimals,
  txFor,
  type MockDb,
} from './mockData'
import { DAY, HOUR, MIN, fromRaw, gen, iso, sec, toRaw, usd } from './mockUtil'

/* ── preview flags ─────────────────────────────────────────── */

type Flag = 'empty' | 'nomerchants' | 'error' | 'loggedout' | 'setup'
const FLAGS: readonly Flag[] = ['empty', 'nomerchants', 'error', 'loggedout', 'setup']
const FLAG_KEY = 'gw:mock-flags'

function readFlags(): Set<Flag> {
  let stored: string | null = null
  try {
    const q = new URLSearchParams(window.location.search).get('mock')
    if (q != null) {
      const parts = q
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is Flag => (FLAGS as readonly string[]).includes(s))
      stored = q.trim().toLowerCase() === 'default' ? '' : parts.join(',')
      sessionStorage.setItem(FLAG_KEY, stored)
    } else {
      stored = sessionStorage.getItem(FLAG_KEY)
    }
  } catch {
    /* storage blocked — flags just don't persist */
  }
  return new Set((stored ?? '').split(',').filter(Boolean) as Flag[])
}

/* ── tiny router ───────────────────────────────────────────── */

type Ctx = {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: Record<string, unknown>
}
type Reply = { status: number; body: unknown; headers?: Record<string, string> }
type Handler = (ctx: Ctx) => Reply | unknown

const reply = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  body,
  headers,
})
const isReply = (x: unknown): x is Reply =>
  typeof x === 'object' && x != null && '__reply' in x
const R = (status: number, body: unknown, headers?: Record<string, string>) =>
  Object.assign(reply(status, body, headers), { __reply: true })
const notFound = (what: string) =>
  R(404, { error: { code: 'not_found', message: `${what} not found` } })

type Route = { method: string; re: RegExp; keys: string[]; handler: Handler }

function route(method: string, pattern: string, handler: Handler): Route {
  const keys: string[] = []
  const re = new RegExp(
    '^' +
      pattern.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
        keys.push(k)
        return '([^/]+)'
      }) +
      '$',
  )
  return { method, re, keys, handler }
}

/* ── handlers ──────────────────────────────────────────────── */

function buildRoutes(db: MockDb, flags: Set<Flag>, auth: { authenticated: boolean; setupComplete: boolean }) {
  const r = db.rng
  const empty = flags.has('empty')
  const list = <T>(rows: T[]): T[] => (empty ? [] : rows)
  const now = () => Date.now()

  const merchantById = (id: string) => db.merchants.find((m) => m.id === id)
  const page = <T>(rows: T[], q: URLSearchParams, fallback = 50) => {
    const limit = Math.min(500, Number(q.get('limit') ?? fallback) || fallback)
    const offset = Number(q.get('offset') ?? 0) || 0
    return { rows: rows.slice(offset, offset + limit), limit, offset, hasMore: offset + limit < rows.length }
  }
  const inSet = (q: URLSearchParams, key: string, v: string) => {
    const raw = q.get(key)
    if (!raw) return true
    return raw.split(',').map((s) => s.trim().toLowerCase()).includes(v.toLowerCase())
  }
  const sortRows = <T extends Record<string, unknown>>(rows: T[], q: URLSearchParams) => {
    const by = q.get('sortBy') ?? 'createdAt'
    const dir = q.get('sortDir') === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = a[by]
      const bv = b[by]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const na = Number(av)
      const nb = Number(bv)
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }
  const contains = (q: URLSearchParams, key: string, v: string | null | undefined) => {
    const needle = q.get(key)
    return !needle || (v ?? '').toLowerCase().includes(needle.toLowerCase())
  }
  const exact = (q: URLSearchParams, key: string, v: string | null | undefined) => {
    const needle = q.get(key)
    return !needle || (v ?? '').toLowerCase() === needle.toLowerCase()
  }

  const merchantView = (m: Merchant): Merchant =>
    flags.has('error') ? { ...m, active: null } : m

  const newPayout = (merchantId: string, body: Record<string, unknown>, batchId: string | null = null): GatewayPayout => {
    const chainId = Number(body.chainId ?? 728)
    const token = String(body.token ?? 'USDT').toUpperCase()
    const dec = tokenDecimals(chainId, token)
    const price = PRICES[token] ?? 1
    const amountRaw =
      body.amountRaw != null
        ? String(body.amountRaw)
        : body.amount != null
          ? toRaw(String(body.amount), dec)
          : toRaw((Number(body.amountUSD ?? body.amountUsd ?? 100) / price).toFixed(Math.min(dec, 6)), dec)
    const u = Number(fromRaw(amountRaw, dec)) * price
    const fam = chainFamily(chainId)
    const t = now()
    return {
      id: gen.uuid(r),
      merchantId,
      status: 'reserved',
      chainId,
      token,
      amountRaw,
      quotedAmountUsd: usd(u),
      quotedRate: price.toFixed(4),
      destinationAddress: String(body.destinationAddress ?? addressFor(r, fam, chainId)),
      sourceAddress: db.srcAddr(fam, 0),
      txHash: null,
      feeEstimateNative: null,
      lastError: null,
      webhookUrl: null,
      createdAt: iso(t),
      submittedAt: null,
      confirmedAt: null,
      updatedAt: iso(t),
      feeTier: (body.feeTier as GatewayPayout['feeTier']) ?? 'medium',
      feeQuotedNative: null,
      batchId,
      broadcastAttemptedAt: null,
      kind: 'standard',
      parentPayoutId: null,
      topUpTxHash: null,
      topUpSponsorAddress: null,
      topUpAmountRaw: null,
    }
  }

  const estimate = (body: Record<string, unknown>): PayoutEstimate => {
    const p = newPayout('estimate', body)
    const fam = chainFamily(p.chainId)
    const native = CHAIN_DEFS.find((c) => c.chainId === p.chainId)?.tokens.find((t) => !t.isStable && t.contractAddress == null)
    const nSym = native?.symbol ?? 'ETH'
    const nDec = native?.decimals ?? 18
    const nPrice = PRICES[nSym] ?? 1
    const base = fam === 'tron' ? 13.4 : fam === 'solana' ? 0.000015 : p.chainId === 1 ? 0.00031 : 0.0000042
    const tier = (k: 'low' | 'medium' | 'high', m: number) => {
      const n = base * m
      return { tier: k, nativeAmountRaw: toRaw(n.toFixed(Math.min(nDec, 9)), nDec), usdAmount: (n * nPrice).toFixed(4) }
    }
    const dec = tokenDecimals(p.chainId, p.token)
    const srcs = [0, 1, 2].map((i) => ({
      address: db.srcAddr(fam, i),
      tokenBalance: toRaw(String([18420.11, 6200.5, 940][i]), dec),
      tokenSymbol: p.token,
      nativeBalance: toRaw(String([fam === 'tron' ? 412 : 0.21, fam === 'tron' ? 2.1 : 0.0003, 0.05][i]), nDec),
      nativeSymbol: nSym,
    }))
    const needsTopUp = fam === 'tron'
    return {
      amountRaw: p.amountRaw,
      quotedAmountUsd: p.quotedAmountUsd,
      quotedRate: p.quotedRate,
      tiers: {
        tieringSupported: fam === 'evm',
        nativeSymbol: nSym,
        nativeDecimals: nDec,
        low: tier('low', 0.8),
        medium: tier('medium', 1),
        high: tier('high', 1.6),
      },
      source: srcs[0],
      topUp: needsTopUp
        ? {
            required: true,
            sponsor: { address: db.srcAddr(fam, 7), nativeBalance: toRaw('1840.5', nDec) },
            amountRaw: toRaw('30', nDec),
          }
        : null,
      alternatives: srcs.slice(1),
      warnings: [],
    }
  }

  const consolidationStatus = (id: string) => {
    const legs = [0, 1, 2].map((i) => ({
      payoutId: gen.uuid(r),
      sourceAddress: db.srcAddr('tron', 10 + i),
      amountRaw: toRaw(String([420.5, 88.1, 1290][i]), 6),
      status: (['confirmed', 'submitted', 'confirmed'] as const)[i],
      txHash: txFor(r, 'tron'),
      topUpTxHash: i === 1 ? txFor(r, 'tron') : null,
      lastError: null,
    }))
    return {
      consolidationId: id,
      legs,
      summary: { total: 3, pendingOrInFlight: 1, confirmed: 2, failed: 0, canceled: 0 },
    }
  }

  return [
    /* auth / setup */
    route('GET', '/api/auth/setup-status', () => ({
      setupComplete: auth.setupComplete,
      hasAdminKey: auth.setupComplete,
      hasUser: auth.setupComplete,
      hasTotp: auth.setupComplete,
      hasBaseUrl: auth.setupComplete,
    })),
    route('GET', '/api/auth/session', () =>
      auth.authenticated
        ? { authenticated: true, user: { username: 'operator' }, baseUrl: 'https://gateway.wizzpay.example' }
        : { authenticated: false },
    ),
    route('GET', '/api/auth/login-config', () => ({ turnstileSiteKey: null })),
    route('POST', '/api/auth/login/password', () => ({ ok: true })),
    route('POST', '/api/auth/login/totp', () => {
      auth.authenticated = true
      return { authenticated: true }
    }),
    route('POST', '/api/auth/login/recovery', () => {
      auth.authenticated = true
      return { authenticated: true }
    }),
    route('POST', '/api/auth/logout', () => {
      auth.authenticated = false
      return { ok: true }
    }),
    route('POST', '/api/setup/totp/begin', () => {
      const secret = gen.b58(r, 32).toUpperCase().replace(/[^A-Z2-7]/g, 'Q')
      return { secret, otpauthUrl: `otpauth://totp/Gateway:operator?secret=${secret}&issuer=Gateway` }
    }),
    route('POST', '/api/setup/complete', () => {
      auth.setupComplete = true
      auth.authenticated = true
      return { recoveryCodes: Array.from({ length: 10 }, () => `${gen.alnum(r, 5)}-${gen.alnum(r, 5)}`.toLowerCase()) }
    }),

    /* settings / security */
    route('GET', '/api/settings/config', () => ({
      baseUrl: 'https://gateway.wizzpay.example',
      hasAdminKey: true,
      adminKeyHint: '…7f3c',
      defaultMerchantId: db.merchantIds.northwind,
    })),
    route('GET', '/api/security/sessions', () => ({ sessions: db.sessions })),
    route('POST', '/api/security/sessions/revoke-all', () => {
      const n = db.sessions.filter((s) => !s.current).length
      db.sessions = db.sessions.filter((s) => s.current)
      return { revoked: n }
    }),
    route('POST', '/api/security/totp/begin', () => {
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
      return { secret, otpauthUrl: `otpauth://totp/Gateway:operator?secret=${secret}&issuer=Gateway` }
    }),
    route('POST', '/api/security/recovery/regenerate', () => ({
      recoveryCodes: Array.from({ length: 10 }, () => `${gen.alnum(r, 5)}-${gen.alnum(r, 5)}`.toLowerCase()),
    })),

    /* merchants (in-memory CRUD) */
    route('GET', '/api/merchants', () => ({
      merchants: flags.has('nomerchants') ? [] : db.merchants.map(merchantView),
      gatewayReachable: !flags.has('error'),
    })),
    route('POST', '/api/merchants', ({ body }) => {
      const t = sec(now())
      const m: Merchant = {
        id: gen.uuid(r),
        name: String(body.name ?? 'New merchant'),
        source: 'dashboard',
        webhookUrl: (body.webhookUrl as string) ?? null,
        apiKeyFingerprint: gen.alnum(r, 4).toLowerCase(),
        active: true,
        paymentToleranceUnderBps: (body.paymentToleranceUnderBps as number) ?? null,
        paymentToleranceOverBps: (body.paymentToleranceOverBps as number) ?? null,
        addressCooldownSeconds: (body.addressCooldownSeconds as number) ?? null,
        confirmationThresholds: null,
        confirmationTiers: null,
        createdAt: t,
        updatedAt: t,
      }
      db.merchants.push(m)
      return { merchant: m, apiKey: `sk_live_${gen.alnum(r, 40)}`, webhookSecret: `whsec_${gen.alnum(r, 32)}` }
    }),
    route('POST', '/api/merchants/import', ({ body }) => {
      const t = sec(now())
      const m: Merchant = {
        id: String(body.merchantId ?? body.id ?? gen.uuid(r)),
        name: String(body.name ?? 'Imported merchant'),
        source: 'imported',
        webhookUrl: (body.webhookUrl as string) ?? null,
        apiKeyFingerprint: String(body.apiKey ?? 'xxxx').slice(-4),
        active: true,
        paymentToleranceUnderBps: null,
        paymentToleranceOverBps: null,
        addressCooldownSeconds: null,
        confirmationThresholds: null,
        confirmationTiers: null,
        createdAt: t,
        updatedAt: t,
      }
      db.merchants.push(m)
      return { merchant: m }
    }),
    route('PATCH', '/api/merchants/:id', ({ params, body }) => {
      const m = merchantById(params.id)
      if (!m) return notFound('Merchant')
      Object.assign(m, body, { updatedAt: sec(now()) })
      return { merchant: m }
    }),
    route('PUT', '/api/merchants/:id', ({ params, body }) => {
      const m = merchantById(params.id)
      if (!m) return notFound('Merchant')
      Object.assign(m, body, { updatedAt: sec(now()) })
      return { merchant: m }
    }),
    route('DELETE', '/api/merchants/:id', ({ params }) => {
      db.merchants = db.merchants.filter((m) => m.id !== params.id)
      return { deleted: true }
    }),
    route('POST', '/api/merchants/:id/activate', ({ params }) => {
      const m = merchantById(params.id)
      if (!m) return notFound('Merchant')
      m.active = true
      m.updatedAt = sec(now())
      return { merchant: m }
    }),
    route('POST', '/api/merchants/:id/deactivate', ({ params }) => {
      const m = merchantById(params.id)
      if (!m) return notFound('Merchant')
      m.active = false
      m.updatedAt = sec(now())
      return { merchant: m }
    }),
    route('POST', '/api/merchants/:id/rotate-key', ({ params }) => {
      const m = merchantById(params.id)
      if (!m) return notFound('Merchant')
      const apiKey = `sk_live_${gen.alnum(r, 40)}`
      m.apiKeyFingerprint = apiKey.slice(-4)
      if (m.source === 'gateway-only') m.source = 'dashboard'
      return { apiKey }
    }),
    route('POST', '/api/merchants/:id/rotate-webhook-secret', () => ({
      webhookSecret: `whsec_${gen.alnum(r, 32)}`,
    })),
    route('GET', '/api/merchants/:id/api-keys', ({ params }) => ({
      keys: list(db.apiKeys.filter((k) => k.merchantId === params.id)),
    })),
    route('POST', '/api/merchants/:id/api-keys', ({ params, body }) => {
      const apiKey = `sk_live_${gen.alnum(r, 40)}`
      const key: MerchantApiKey = {
        id: gen.uuid(r),
        merchantId: params.id,
        label: (body.label as string) ?? null,
        fingerprint: apiKey.slice(-4),
        scopes: (body.scopes as MerchantApiKey['scopes']) ?? ['invoices:read'],
        createdAt: iso(now()),
        revokedAt: null,
      }
      db.apiKeys.unshift(key)
      return { key, apiKey }
    }),
    route('DELETE', '/api/merchants/:id/api-keys/:keyId', ({ params }) => {
      const key = db.apiKeys.find((k) => k.id === params.keyId)
      if (!key) return notFound('API key')
      key.revokedAt = iso(now())
      return { key }
    }),

    /* merchant-scoped gateway proxy: invoices */
    route('GET', '/api/mg/:mid/invoices', ({ params, query }) => {
      let rows = list(db.invoices.filter((i) => i.merchantId === params.mid))
      rows = rows.filter(
        (i) =>
          inSet(query, 'status', String(i.status)) &&
          inSet(query, 'token', i.token) &&
          (!query.get('chainId') || inSet(query, 'chainId', String(i.chainId))) &&
          exact(query, 'externalId', i.externalId) &&
          contains(query, 'externalIdContains', i.externalId) &&
          exact(query, 'toAddress', i.receiveAddress) &&
          contains(query, 'addressContains', i.receiveAddress),
      )
      const sorted = sortRows(rows as unknown as Record<string, unknown>[], query) as unknown as GatewayInvoice[]
      const p = page(sorted, query)
      return { invoices: p.rows, limit: p.limit, offset: p.offset, hasMore: p.hasMore, sortBy: query.get('sortBy') ?? 'createdAt', sortDir: query.get('sortDir') ?? 'desc' }
    }),
    route('GET', '/api/mg/:mid/invoices/:id', ({ params }) => {
      const inv = db.invoices.find((i) => i.id === params.id)
      if (!inv) return notFound('Invoice')
      const txs = db.invoiceTxs.get(inv.id) ?? []
      return { invoice: inv, amounts: invoiceAmounts(inv, txs), transactions: txs }
    }),
    route('POST', '/api/mg/:mid/invoices/:id/expire', ({ params }) => {
      const inv = db.invoices.find((i) => i.id === params.id)
      if (!inv) return notFound('Invoice')
      inv.status = 'expired'
      inv.updatedAt = iso(now())
      return { invoice: inv }
    }),
    route('POST', '/api/mg/:mid/invoices', ({ params, body }) => {
      const chainId = Number(body.chainId ?? 728)
      const token = String(body.token ?? 'USDT').toUpperCase()
      const dec = tokenDecimals(chainId, token)
      const price = PRICES[token] ?? 1
      const fam: Family = chainFamily(chainId)
      const amountUsd =
        body.amountUsd != null ? Number(body.amountUsd) : body.fiatAmount != null ? Number(body.fiatAmount) : null
      const requiredAmountRaw =
        body.amountRaw != null ? String(body.amountRaw) : toRaw(((amountUsd ?? 10) / price).toFixed(Math.min(dec, 6)), dec)
      const t = now()
      const inv: GatewayInvoice = {
        id: gen.uuid(r),
        merchantId: params.mid,
        status: 'pending',
        extraStatus: null,
        chainId,
        token,
        receiveAddress: db.srcAddr(fam, 20 + r.int(0, 30)),
        addressIndex: 20 + r.int(0, 30),
        requiredAmountRaw,
        receivedAmountRaw: '0',
        fiatAmount: (body.fiatAmount as string) ?? (amountUsd != null ? usd(amountUsd) : null),
        fiatCurrency: (body.fiatCurrency as string) ?? (amountUsd != null ? 'USD' : null),
        quotedRate: price.toFixed(4),
        amountUsd: usd(amountUsd ?? Number(fromRaw(requiredAmountRaw, dec)) * price),
        paidUsd: null,
        overpaidUsd: null,
        externalId: (body.externalId as string) ?? null,
        metadata: (body.metadata as Record<string, unknown>) ?? null,
        webhookUrl: (body.webhookUrl as string) ?? null,
        paymentToleranceUnderBps: Number(body.paymentToleranceUnderBps ?? 50),
        paymentToleranceOverBps: Number(body.paymentToleranceOverBps ?? 100),
        createdAt: iso(t),
        expiresAt: iso(t + Number(body.expiresInMinutes ?? 30) * MIN),
        confirmedAt: null,
        updatedAt: iso(t),
        ...(Array.isArray(body.acceptedFamilies) ? { acceptedFamilies: body.acceptedFamilies as Family[] } : {}),
      }
      db.invoices.unshift(inv)
      db.invoiceTxs.set(inv.id, [])
      return { invoice: inv }
    }),

    /* merchant-scoped gateway proxy: payouts */
    route('GET', '/api/mg/:mid/payouts', ({ params, query }) => {
      let rows = list(db.payouts.filter((p) => p.merchantId === params.mid))
      rows = rows.filter(
        (p) =>
          inSet(query, 'status', p.status) &&
          inSet(query, 'kind', p.kind) &&
          inSet(query, 'token', p.token) &&
          inSet(query, 'feeTier', p.feeTier ?? '') &&
          (!query.get('chainId') || inSet(query, 'chainId', String(p.chainId))) &&
          (query.get('hasError') == null || (query.get('hasError') === 'true') === (p.lastError != null)) &&
          exact(query, 'destinationAddress', p.destinationAddress) &&
          contains(query, 'destinationAddressContains', p.destinationAddress) &&
          exact(query, 'sourceAddress', p.sourceAddress) &&
          contains(query, 'sourceAddressContains', p.sourceAddress) &&
          exact(query, 'txHash', p.txHash) &&
          exact(query, 'batchId', p.batchId),
      )
      const sorted = sortRows(rows as unknown as Record<string, unknown>[], query) as unknown as GatewayPayout[]
      const p = page(sorted, query)
      return { payouts: p.rows, limit: p.limit, offset: p.offset, hasMore: p.hasMore, sortBy: query.get('sortBy') ?? 'createdAt', sortDir: query.get('sortDir') ?? 'desc' }
    }),
    route('POST', '/api/mg/:mid/payouts/estimate', ({ body }) => estimate(body)),
    route('POST', '/api/mg/:mid/payouts/batch', ({ params, body }) => {
      const rows = Array.isArray(body.payouts) ? (body.payouts as Record<string, unknown>[]) : []
      const batchId = gen.uuid(r)
      const results = rows.map((row, index) => {
        if (index % 7 === 6) {
          return { index, status: 'failed' as const, error: { code: 'INSUFFICIENT_BALANCE', message: 'No source address has sufficient token balance' } }
        }
        const p = newPayout(params.mid, row, batchId)
        db.payouts.unshift(p)
        return { index, status: 'planned' as const, payout: p }
      })
      const planned = results.filter((x) => x.status === 'planned').length
      return { batchId, results, summary: { planned, failed: results.length - planned } }
    }),
    route('GET', '/api/mg/:mid/payouts/:id', ({ params }) => {
      const p = db.payouts.find((x) => x.id === params.id)
      return p ? { payout: p } : notFound('Payout')
    }),
    route('POST', '/api/mg/:mid/payouts/:id/cancel', ({ params }) => {
      const p = db.payouts.find((x) => x.id === params.id)
      if (!p) return notFound('Payout')
      p.status = 'canceled'
      p.updatedAt = iso(now())
      return { payout: p }
    }),
    route('POST', '/api/mg/:mid/payouts', ({ params, body }) => {
      const p = newPayout(params.mid, body)
      db.payouts.unshift(p)
      return { payout: p }
    }),

    /* gateway admin */
    route('GET', '/api/gw/health', () => ({ status: 'ok', phase: 4 })),
    route('GET', '/api/gw/admin/chains', () => ({ chains: db.chains })),
    route('GET', '/api/gw/admin/pool/stats', () => ({ stats: list(db.poolStats()) })),
    route('GET', '/api/gw/admin/monero-pool/stats', () => ({ stats: list(db.moneroStats) })),
    route('GET', '/api/gw/admin/pool/addresses', ({ query }) => {
      const fam = (query.get('family') ?? 'evm') as keyof MockDb['pool']
      const status = query.get('status')
      const rows = list((db.pool[fam] ?? []).filter((a) => !status || a.status === status))
      const p = page(rows, query)
      return { addresses: p.rows, total: rows.length, limit: p.limit, offset: p.offset }
    }),
    route('GET', '/api/gw/admin/pool/addresses/disabled', ({ query }) => {
      const fam = (query.get('family') ?? 'evm') as keyof MockDb['pool']
      return { addresses: list((db.pool[fam] ?? []).filter((a) => a.disabledAt != null)) }
    }),
    route('POST', '/api/gw/admin/pool/addresses/:action', ({ params, body }) => {
      const fam = String(body.family ?? 'evm') as keyof MockDb['pool']
      const a = (db.pool[fam] ?? []).find((x) => x.address === body.address || x.addressIndex === body.addressIndex)
      if (!a) return notFound('Pool address')
      a.disabledAt = params.action === 'disable' ? now() : null
      return { address: a }
    }),
    route('POST', '/api/gw/admin/pool/initialize', ({ body }) => ({
      results: ((body.families as Family[]) ?? ['evm']).map((family, i) => ({
        family,
        status: i === 0 ? 'seeded' : 'already-sufficient',
        added: i === 0 ? Number(body.initialSize ?? 10) : 0,
      })),
    })),
    route('POST', '/api/gw/admin/monero-pool/initialize', () => ({ added: 20, total: 200 })),
    route('GET', '/api/gw/admin/pool/audit', () => ({
      status: 'healthy',
      scanLimit: 500,
      reports: db.poolStats().map((s) => ({
        family: s.family,
        scanned: s.total,
        matches: s.total,
        unscannedBeyondLimit: 0,
        mismatches: [],
      })),
    })),
    route('POST', '/api/gw/admin/pool/audit', () => ({ status: 'healthy', scanLimit: 500, reports: [] })),
    route('POST', '/api/gw/admin/pool/consolidate', ({ body }) => {
      const chainId = Number(body.chainId ?? 728)
      const token = String(body.token ?? 'USDT')
      const fam = chainFamily(chainId)
      const dec = tokenDecimals(chainId, token)
      return {
        consolidationId: gen.uuid(r),
        chainId,
        token,
        targetAddress: String(body.targetAddress ?? db.srcAddr(fam, 0)),
        legs: [1, 2, 3].map((i) => ({
          payoutId: gen.uuid(r),
          sourceAddress: db.srcAddr(fam, 10 + i),
          amountRaw: toRaw(String([420.5, 88.1, 1290][i - 1]), dec),
        })),
        skipped: [
          { sourceAddress: db.srcAddr(fam, 20), amountRaw: toRaw('3.2', dec), reason: 'NO_GAS_SPONSOR_AVAILABLE: no sponsor has enough native gas' },
        ],
      }
    }),
    route('GET', '/api/gw/admin/pool/consolidations/:id', ({ params }) => consolidationStatus(params.id)),
    route('GET', '/api/gw/admin/balances', ({ query }) => {
      const fam = query.get('family')
      const snap = db.balances
      const families = empty ? [] : fam ? snap.families.filter((f) => f.family === fam) : snap.families
      return {
        snapshot: {
          ...snap,
          source: query.get('live') ? 'rpc' : 'db',
          generatedAt: query.get('live') ? iso(now()) : snap.generatedAt,
          families,
          totalUsd: empty ? '0.00' : fam ? (families[0]?.totalUsd ?? '0.00') : snap.totalUsd,
        },
        cached: !query.get('live'),
      }
    }),
    route('POST', '/api/gw/admin/balances/reconcile', ({ body }) => ({
      dryRun: body.dryRun !== false,
      checked: 14,
      adjusted: body.dryRun === false ? 1 : 0,
      deltas: [
        {
          chainId: Number(body.chainId ?? 728),
          address: db.srcAddr(chainFamily(Number(body.chainId ?? 728)), 3),
          token: 'USDT',
          onChainRaw: '1204500000',
          ledgerRaw: '1210000000',
          deltaRaw: '-5500000',
        },
      ],
      errors: [],
    })),
    route('GET', '/api/gw/admin/payouts/held', () => {
      const held = list(db.held).map((h) => ({
        ...h,
        heldForMs: h.broadcastAttemptedAt ? now() - Date.parse(h.broadcastAttemptedAt) : null,
      }))
      return { count: held.length, held }
    }),
    route('POST', '/api/gw/admin/payouts/:id/recover', ({ params, body }) => {
      const h = db.held.find((x) => x.id === params.id)
      if (!h) return notFound('Held payout')
      db.held = db.held.filter((x) => x.id !== params.id)
      const p = newPayout(db.merchantIds.northwind, { chainId: h.chainId, token: h.token, amountRaw: h.amountRaw, destinationAddress: h.destinationAddress })
      return { payout: { ...p, id: h.id, status: 'submitted', txHash: String(body.txHash ?? txFor(r, chainFamily(h.chainId))) } }
    }),
    route('POST', '/api/gw/admin/payouts/:id/bump-fee', ({ params, body }) => ({
      bump: {
        payoutId: params.id,
        attemptNumber: 1,
        txHash: gen.utxoTx(r),
        priorTxHash: gen.utxoTx(r),
        priorFeeSats: '1410',
        newFeeSats: '4230',
        priorFeerateSatVb: '10',
        newFeerateSatVb: '30',
        vsize: 141,
        strategy: (body.strategy as string) ?? 'shrink_change',
        changeAddress: gen.btcAddress(r),
        changeValueSats: '182044',
        dryRun: body.dryRun === true,
      },
    })),
    route('GET', '/api/gw/admin/webhook-deliveries', ({ query }) => {
      const status = query.get('status')
      const rows = list(db.deliveries.filter((d) => !status || d.status === status))
      return { deliveries: rows.slice(0, Number(query.get('limit') ?? 50) || 50) }
    }),
    route('POST', '/api/gw/admin/webhook-deliveries/:id/replay', ({ params }) => {
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound('Delivery')
      d.status = 'pending'
      d.nextAttemptAt = now() + 5_000
      d.updatedAt = now()
      return { delivery: d }
    }),
    route('GET', '/api/gw/admin/orphan-transactions', () => ({ orphans: list(db.orphans) })),
    route('POST', '/api/gw/admin/orphan-transactions/:id/attribute', ({ params, body }) => {
      db.orphans = db.orphans.filter((o) => o.id !== params.id)
      return { attribution: { orphanId: params.id, invoiceId: body.invoiceId ?? null, attributedAt: iso(now()) } }
    }),
    route('POST', '/api/gw/admin/orphan-transactions/:id/dismiss', ({ params }) => {
      db.orphans = db.orphans.filter((o) => o.id !== params.id)
      return { dismissed: true }
    }),
    route('POST', '/api/gw/admin/audit-address', ({ body }) => ({
      audit: {
        chainId: Number(body.chainId ?? 1),
        address: String(body.address ?? ''),
        sinceMs: Number(body.sinceMs ?? now() - 7 * DAY),
        scanned: 37,
        inserted: 2,
        alreadyPresent: 35,
        insertedTxIds: [gen.uuid(r), gen.uuid(r)],
      },
    })),

    /* consolidation schedules */
    route('GET', '/api/gw/admin/consolidation-schedules', () => ({ schedules: list(db.schedules) })),
    route('POST', '/api/gw/admin/consolidation-schedules', ({ body }) => {
      const t = now()
      const s: AutoConsolidationSchedule = {
        id: gen.uuid(r),
        chainId: Number(body.chainId ?? 728),
        token: String(body.token ?? 'USDT'),
        targetAddress: String(body.targetAddress ?? ''),
        intervalHours: Number(body.intervalHours ?? 24),
        minSourceBalanceRaw: String(body.minSourceBalanceRaw ?? '0'),
        maxFeeUsd: (body.maxFeeUsd as string) ?? null,
        maxSourcesPerRun: Number(body.maxSourcesPerRun ?? 20),
        enabled: body.enabled !== false,
        lastRunAt: null,
        lastConsolidationId: null,
        lastLegCount: null,
        lastSkippedCount: null,
        lastSkippedReasons: null,
        nextRunDue: t + Number(body.intervalHours ?? 24) * HOUR,
        createdAt: t,
        updatedAt: t,
      }
      db.schedules.push(s)
      return { schedule: s }
    }),
    route('PATCH', '/api/gw/admin/consolidation-schedules/:id', ({ params, body }) => {
      const s = db.schedules.find((x) => x.id === params.id)
      if (!s) return notFound('Schedule')
      Object.assign(s, body, { updatedAt: now() })
      return { schedule: s }
    }),
    route('DELETE', '/api/gw/admin/consolidation-schedules/:id', ({ params }) => {
      db.schedules = db.schedules.filter((x) => x.id !== params.id)
      return { deleted: true }
    }),

    /* fee wallets */
    route('GET', '/api/gw/admin/fee-wallets', () => ({
      feeWallets: empty ? db.feeWallets.map((f) => ({ ...f, configured: null })) : db.feeWallets,
    })),
    route('GET', '/api/gw/admin/fee-wallets/tron/resources', () => db.tronResources),
    // use-pool / import must precede `tron/:op`, which would also match them.
    route('POST', '/api/gw/admin/fee-wallets/:family/use-pool', ({ params, body }) => ({
      feeWallet: { family: params.family, mode: 'hd-pool', address: String(body.address ?? '') },
    })),
    route('POST', '/api/gw/admin/fee-wallets/:family/import', ({ params, body }) => ({
      feeWallet: { family: params.family, mode: 'imported', address: String(body.address ?? '') },
    })),
    route('POST', '/api/gw/admin/fee-wallets/tron/:op', ({ body }) => ({
      txHash: gen.tronTx(r),
      receiver: (body.receiver as string) ?? db.srcAddr('tron', 2),
      balance: Number(body.balance ?? 0),
      resource: (body.resource as string) ?? 'ENERGY',
      lock: body.lock === true,
      receiverIsInPool: true,
    })),
    route('DELETE', '/api/gw/admin/fee-wallets/:family', () => ({ removed: true })),

    /* alchemy */
    route('POST', '/api/gw/admin/bootstrap/alchemy-webhooks', () => ({
      results: db.chains
        .filter((c) => c.wired)
        .map((c) =>
          c.webhooksSupported
            ? { chainId: c.chainId, status: 'existing', webhookId: `wh_${gen.alnum(r, 16).toLowerCase()}` }
            : { chainId: c.chainId, status: 'unsupported' },
        ),
    })),
    route('POST', '/api/gw/admin/alchemy-webhooks/signing-keys', ({ body }) => ({
      registered: { chainId: body.chainId, webhookId: body.webhookId, webhookUrl: body.webhookUrl, updatedAt: iso(now()) },
    })),
    route('GET', '/api/gw/admin/alchemy-webhooks/signing-keys', () => ({
      webhooks: list(
        db.chains
          .filter((c) => c.webhooksSupported && c.alchemyConfigured)
          .map((c) => ({
            chainId: c.chainId,
            chain: c.slug,
            webhookId: `wh_${c.slug}_${gen.alnum(r, 10).toLowerCase()}`,
            webhookUrl: `https://gateway.wizzpay.example/webhooks/alchemy/${c.slug}`,
            createdAt: iso(now() - 60 * DAY),
            updatedAt: iso(now() - 9 * DAY),
          })),
      ),
    })),

    /* treasury */
    route('GET', '/api/gw/admin/treasury/destinations', () => ({ destinations: list(db.destinations) })),
    route('GET', '/api/gw/admin/treasury/destinations/:id', ({ params }) => {
      const d = db.destinations.find((x) => x.id === params.id)
      return d ? { destination: d, eligibility: db.eligibilityFor(d) } : notFound('Destination')
    }),
    route('POST', '/api/gw/admin/treasury/destinations', ({ body }) => {
      const t = now()
      const d: TreasuryDestination = {
        id: gen.uuid(r),
        label: String(body.label ?? 'New destination'),
        exchange: (body.exchange as TreasuryDestination['exchange']) ?? 'kraken',
        chainId: Number(body.chainId ?? 728),
        token: String(body.token ?? 'USDT'),
        address: String(body.address ?? ''),
        memo: (body.memo as string) ?? null,
        enabled: false,
        verifiedAt: null,
        disabledAt: null,
        exchangeMinRaw: String(body.exchangeMinRaw ?? '0'),
        minTransferUsd: String(body.minTransferUsd ?? '100'),
        maxPerTransferUsd: String(body.maxPerTransferUsd ?? '10000'),
        maxDailyUsd: String(body.maxDailyUsd ?? '25000'),
        keepFloatRaw: String(body.keepFloatRaw ?? '0'),
        autoIntervalHours: (body.autoIntervalHours as number) ?? null,
        nextRunDue: null,
        lastRunAt: null,
        lastTransferId: null,
        createdAt: t,
        updatedAt: t,
      }
      db.destinations.push(d)
      return { destination: d }
    }),
    route('PATCH', '/api/gw/admin/treasury/destinations/:id', ({ params, body }) => {
      const d = db.destinations.find((x) => x.id === params.id)
      if (!d) return notFound('Destination')
      Object.assign(d, body, { updatedAt: now() })
      return { destination: d }
    }),
    route('DELETE', '/api/gw/admin/treasury/destinations/:id', ({ params }) => {
      db.destinations = db.destinations.filter((x) => x.id !== params.id)
      return { deleted: true }
    }),
    route('POST', '/api/gw/admin/treasury/destinations/:id/mark-verified', ({ params }) => {
      const d = db.destinations.find((x) => x.id === params.id)
      if (!d) return notFound('Destination')
      d.verifiedAt = now()
      return { destination: d }
    }),
    route('POST', '/api/gw/admin/treasury/destinations/:id/verify', ({ params, body }) => {
      const d = db.destinations.find((x) => x.id === params.id)
      if (!d) return notFound('Destination')
      return { transfer: mockTransfer(d, 'verification', String(body.amountRaw ?? d.exchangeMinRaw), 1) }
    }),
    route('POST', '/api/gw/admin/treasury/destinations/:id/transfer', ({ params, body }) => {
      const d = db.destinations.find((x) => x.id === params.id)
      if (!d) return notFound('Destination')
      const eligibility = db.eligibilityFor(d)
      if (body.dryRun) return { eligibility }
      const transfer = mockTransfer(d, 'manual', eligibility.budgetRaw, eligibility.sources.length)
      db.transfers.unshift(transfer)
      return { transfer, eligibility }
    }),
    route('GET', '/api/gw/admin/treasury/transfers', ({ query }) => {
      const dest = query.get('destinationId')
      return { transfers: list(db.transfers.filter((t) => !dest || t.destinationId === dest)) }
    }),

    /* exchange (Kraken) */
    route('GET', '/api/gw/admin/exchange/kraken', ({ query }) => {
      const s = db.exchange
      const live = query.get('live') === '1'
      return {
        ...s,
        lastRun: empty ? null : s.lastRun,
        balances: list(s.balances),
        openOrders: list(s.openOrders),
        withdrawKeys: list(s.withdrawKeys),
        snapshotAt: empty ? null : live ? now() : s.snapshotAt,
      }
    }),
    route('GET', '/api/gw/admin/exchange/kraken/actions', () => ({ actions: list(db.exchangeActions) })),
    route('GET', '/api/gw/admin/exchange/kraken/destinations', () => ({ destinations: list(db.exchange.withdrawKeys) })),
    route('POST', '/api/gw/admin/exchange/kraken/run', ({ body }) => {
      const result = {
        ran: true,
        mode: db.exchange.policy.mode,
        dryRun: body.dryRun === true || db.exchange.policy.mode === 'dry-run',
        synced: 3,
        placed: 1,
        requoted: 0,
        marketFallbacks: 0,
        filled: 1,
        canceled: 0,
        withdrawals: 0,
        skipped: [{ asset: 'SOL', reason: 'below minOrderUsd (18.42 < 50)' }],
        errors: [],
        at: now(),
      }
      db.exchange.lastRun = result
      return result
    }),
  ]

  function mockTransfer(
    d: TreasuryDestination,
    mode: TreasuryTransfer['mode'],
    plannedAmountRaw: string,
    legCount: number,
  ): TreasuryTransfer {
    const dec = tokenDecimals(d.chainId, d.token)
    return {
      id: gen.uuid(r),
      destinationId: d.id,
      mode,
      batchId: gen.uuid(r),
      plannedAmountRaw,
      plannedUsd: usd(Number(fromRaw(plannedAmountRaw, dec)) * (PRICES[d.token] ?? 1)),
      legCount,
      skippedCount: 0,
      skippedReasons: [],
      createdAt: now(),
      status: {
        planned: 0,
        reserved: legCount,
        toppingUp: 0,
        submitted: 0,
        confirmed: 0,
        failed: 0,
        canceled: 0,
        confirmedAmountRaw: '0',
      },
    }
  }
}

/* ── install ───────────────────────────────────────────────── */

let installed = false

export function installMockApi() {
  if (installed) return
  installed = true

  const flags = readFlags()
  const db = createDb()
  const auth = { authenticated: !flags.has('loggedout'), setupComplete: !flags.has('setup') }
  const routes = buildRoutes(db, flags, auth)
  const realFetch = window.fetch.bind(window)

  console.info(
    `%c[mock api]%c serving /api/* from fixtures. Flags: ${[...flags].join(', ') || 'none'} — switch with ?mock=empty|nomerchants|error|loggedout|setup|default`,
    'color:#7c3aed;font-weight:600',
    'color:inherit',
  )

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(rawUrl, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return realFetch(input, init)
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

    await new Promise((res) => setTimeout(res, 150 + Math.random() * 250))

    // Avatar <img> is served by the vite plugin; answer fetch() callers too.
    if (url.pathname === '/api/avatar') {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d0e1ff"/></svg>'
      return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    }

    let body: Record<string, unknown> = {}
    if (typeof init?.body === 'string') {
      try {
        const parsed: unknown = JSON.parse(init.body)
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
      } catch {
        /* non-JSON body */
      }
    }

    let result: Reply
    if (flags.has('error') && method === 'GET' && url.pathname.startsWith('/api/gw/')) {
      result = reply(500, { error: { code: 'upstream_error', message: 'Gateway unreachable' } })
    } else {
      const match = routes
        .filter((rt) => rt.method === method)
        .map((rt) => ({ rt, m: rt.re.exec(url.pathname) }))
        .find((x) => x.m != null)
      if (!match) {
        console.warn(`[mock api] unhandled ${method} ${url.pathname}${url.search}`)
        result = reply(200, method === 'GET' ? {} : { ok: true })
      } else {
        const params: Record<string, string> = {}
        match.rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m![i + 1])))
        try {
          const out = match.rt.handler({ method, path: url.pathname, params, query: url.searchParams, body })
          result = isReply(out) ? out : reply(200, out)
        } catch (e) {
          console.error('[mock api] handler threw', method, url.pathname, e)
          result = reply(500, { error: { code: 'mock_error', message: String(e) } })
        }
      }
    }

    const headers = new Headers({ 'content-type': 'application/json', ...result.headers })
    if (url.pathname.startsWith('/api/mg/')) {
      headers.set('X-RateLimit-Limit', '120')
      headers.set('X-RateLimit-Remaining', String(96 + Math.floor(Math.random() * 20)))
      headers.set('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 42))
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers })
  }
}

/**
 * Fixture database for the dev mock API (`src/dev/mock.ts`). Every shape is
 * typed against `src/lib/types.ts` so a type change there breaks this file
 * loudly instead of the preview silently drifting. Dev-only.
 */
import type {
  AutoConsolidationSchedule,
  BalancesSnapshot,
  ChainInventoryEntry,
  ChainToken,
  ExchangeAction,
  ExchangeStatus,
  Family,
  FeeTier,
  FeeWalletEntry,
  GatewayInvoice,
  GatewayPayout,
  HeldLeg,
  InvoiceAmounts,
  InvoiceExtraStatus,
  InvoiceStatus,
  InvoiceTransaction,
  Merchant,
  MerchantApiKey,
  MoneroPoolStatsRow,
  OrphanTransaction,
  PayoutStatus,
  PoolAddressAdminView,
  PoolStatsRow,
  TreasuryDestination,
  TreasuryEligibility,
  TreasuryTransfer,
  TronFeeWalletResources,
  WebhookDelivery,
} from '@/lib/types'
import { DAY, HOUR, MIN, fromRaw, gen, iso, makeRng, sec, toRaw, usd, type Rng } from './mockUtil'

/* ── chain catalog ─────────────────────────────────────────── */

type ChainDef = Omit<ChainInventoryEntry, 'tokens'> & { tokens: ChainToken[] }

const tok = (
  symbol: string,
  decimals: number,
  displayName: string,
  contractAddress: string | null,
): ChainToken => ({
  symbol,
  decimals,
  isStable: symbol === 'USDT' || symbol === 'USDC',
  displayName,
  contractAddress,
})

const evmBase = {
  family: 'evm' as const,
  wired: true,
  webhooksSupported: true,
  alchemyConfigured: true,
  webhooks: true,
  feeWallets: false,
  detection: 'alchemy' as const,
  bootstrapReady: true,
}

export const CHAIN_DEFS: ChainDef[] = [
  {
    ...evmBase,
    chainId: 1,
    slug: 'ethereum',
    displayName: 'Ethereum',
    confirmationsRequired: 12,
    tokens: [
      tok('USDT', 6, 'Tether USD', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
      tok('USDC', 6, 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      tok('ETH', 18, 'Ether', null),
    ],
  },
  {
    ...evmBase,
    chainId: 8453,
    slug: 'base',
    displayName: 'Base',
    confirmationsRequired: 10,
    tokens: [
      tok('USDC', 6, 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
      tok('ETH', 18, 'Ether', null),
    ],
  },
  {
    ...evmBase,
    chainId: 137,
    slug: 'polygon',
    displayName: 'Polygon',
    confirmationsRequired: 64,
    tokens: [
      tok('USDT', 6, 'Tether USD', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
      tok('USDC', 6, 'USD Coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
      tok('POL', 18, 'Polygon Ecosystem Token', null),
    ],
  },
  {
    ...evmBase,
    chainId: 56,
    slug: 'bsc',
    displayName: 'BNB Chain',
    confirmationsRequired: 15,
    alchemyConfigured: false,
    webhooks: false,
    detection: 'rpc-poll',
    bootstrapReady: false,
    tokens: [
      tok('USDT', 18, 'Tether USD (BEP-20)', '0x55d398326f99059fF775485246999027B3197955'),
      tok('USDC', 18, 'USD Coin (BEP-20)', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
      tok('BNB', 18, 'BNB', null),
    ],
  },
  {
    chainId: 728,
    slug: 'tron',
    family: 'tron',
    displayName: 'Tron',
    wired: true,
    webhooksSupported: false,
    alchemyConfigured: false,
    webhooks: false,
    feeWallets: true,
    detection: 'rpc-poll',
    bootstrapReady: false,
    confirmationsRequired: 19,
    tokens: [
      tok('USDT', 6, 'Tether USD (TRC-20)', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
      tok('TRX', 6, 'TRON', null),
    ],
  },
  {
    chainId: 900,
    slug: 'solana',
    family: 'solana',
    displayName: 'Solana',
    wired: true,
    webhooksSupported: true,
    alchemyConfigured: true,
    webhooks: true,
    feeWallets: true,
    detection: 'alchemy',
    bootstrapReady: true,
    confirmationsRequired: 32,
    tokens: [
      tok('USDC', 6, 'USD Coin (SPL)', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      tok('USDT', 6, 'Tether USD (SPL)', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
      tok('SOL', 9, 'Solana', null),
    ],
  },
  {
    chainId: 800,
    slug: 'bitcoin',
    family: 'utxo',
    displayName: 'Bitcoin',
    wired: true,
    webhooksSupported: false,
    alchemyConfigured: false,
    webhooks: false,
    feeWallets: false,
    detection: 'rpc-poll',
    bootstrapReady: false,
    confirmationsRequired: 2,
    tokens: [tok('BTC', 8, 'Bitcoin', null)],
  },
  {
    chainId: 801,
    slug: 'litecoin',
    family: 'utxo',
    displayName: 'Litecoin',
    wired: false,
    webhooksSupported: false,
    alchemyConfigured: false,
    webhooks: false,
    feeWallets: false,
    detection: 'rpc-poll',
    bootstrapReady: false,
    confirmationsRequired: 6,
    tokens: [tok('LTC', 8, 'Litecoin', null)],
  },
  {
    chainId: 1000,
    slug: 'monero',
    family: 'monero',
    displayName: 'Monero',
    wired: true,
    webhooksSupported: false,
    alchemyConfigured: false,
    webhooks: false,
    feeWallets: false,
    detection: 'rpc-poll',
    bootstrapReady: false,
    confirmationsRequired: 10,
    tokens: [tok('XMR', 12, 'Monero', null)],
  },
]

const CHAIN_BY_ID = new Map(CHAIN_DEFS.map((c) => [c.chainId, c]))

export function chainFamily(chainId: number): Family {
  return CHAIN_BY_ID.get(chainId)?.family ?? 'evm'
}

export function tokenDecimals(chainId: number, token: string): number {
  const t = CHAIN_BY_ID.get(chainId)?.tokens.find((x) => x.symbol === token.toUpperCase())
  return t?.decimals ?? 18
}

export const PRICES: Record<string, number> = {
  USDT: 1.0,
  USDC: 0.9999,
  ETH: 3412.55,
  BNB: 612.4,
  POL: 0.4127,
  TRX: 0.2418,
  SOL: 182.37,
  BTC: 96840.12,
  LTC: 98.31,
  XMR: 168.2,
}

const NATIVE: Record<number, string> = {
  1: 'ETH',
  8453: 'ETH',
  137: 'POL',
  56: 'BNB',
  728: 'TRX',
  900: 'SOL',
  800: 'BTC',
  801: 'LTC',
  1000: 'XMR',
}

/** Display precision for a token amount (stables 2dp; volatile up to 8). */
function amountFor(usdValue: number, token: string, decimals: number): string {
  const p = PRICES[token] ?? 1
  if (p > 0.98 && p < 1.02) return usdValue.toFixed(2)
  return (usdValue / p).toFixed(Math.min(decimals, p > 1000 ? 8 : 6))
}

export function addressFor(r: Rng, family: Family, chainId?: number): string {
  switch (family) {
    case 'evm':
      return gen.evmAddress(r)
    case 'tron':
      return gen.tronAddress(r)
    case 'solana':
      return gen.solAddress(r)
    case 'utxo':
      return chainId === 801 ? gen.ltcAddress(r) : gen.btcAddress(r)
    case 'monero':
      return gen.xmrAddress(r)
  }
}

export function txFor(r: Rng, family: Family): string {
  switch (family) {
    case 'evm':
      return gen.evmTx(r)
    case 'tron':
      return gen.tronTx(r)
    case 'solana':
      return gen.solTx(r)
    case 'utxo':
      return gen.utxoTx(r)
    case 'monero':
      return gen.xmrTx(r)
  }
}

/* ── database ──────────────────────────────────────────────── */

export type MockDb = ReturnType<typeof createDb>

export function createDb(now = Date.now()) {
  const r = makeRng(0x5eed_2026)

  /* pool addresses (HD, per family) */
  const POOL_SIZES: Record<Exclude<Family, 'monero'>, number> = {
    evm: 162,
    tron: 96,
    solana: 64,
    utxo: 40,
  }
  const pool: Record<Exclude<Family, 'monero'>, PoolAddressAdminView[]> = {
    evm: [],
    tron: [],
    solana: [],
    utxo: [],
  }
  for (const fam of Object.keys(POOL_SIZES) as Array<Exclude<Family, 'monero'>>) {
    for (let i = 0; i < POOL_SIZES[fam]; i++) {
      pool[fam].push({
        family: fam,
        address: addressFor(r, fam, 800),
        addressIndex: i,
        status: 'available',
        disabledAt: null,
        allocatedToInvoiceId: null,
      })
    }
  }
  // A few quarantined + operator-disabled rows so every badge renders.
  const markQuarantine = (fam: Exclude<Family, 'monero'>, idx: number) => {
    pool[fam][idx].status = 'quarantined'
  }
  markQuarantine('evm', 41)
  markQuarantine('evm', 97)
  markQuarantine('tron', 12)
  pool.evm[3].disabledAt = now - 4 * DAY
  pool.evm[77].disabledAt = now - 2 * DAY - 3 * HOUR
  pool.tron[55].disabledAt = now - 6 * DAY
  pool.solana[8].disabledAt = now - 1 * DAY

  let nextPoolIdx: Record<Exclude<Family, 'monero'>, number> = {
    evm: 10,
    tron: 10,
    solana: 10,
    utxo: 4,
  }
  const allocate = (fam: Family, invoiceId: string | null) => {
    if (fam === 'monero') {
      return { address: gen.xmrAddress(r), addressIndex: r.int(20, 180) }
    }
    const rows = pool[fam]
    let idx = nextPoolIdx[fam]
    while (rows[idx].status !== 'available' || rows[idx].disabledAt) idx++
    nextPoolIdx = { ...nextPoolIdx, [fam]: idx + 1 }
    if (invoiceId) {
      rows[idx].status = 'allocated'
      rows[idx].allocatedToInvoiceId = invoiceId
    }
    return { address: rows[idx].address, addressIndex: idx }
  }
  // Treasury / payout sources: the first few HD indices hold the float.
  const srcAddr = (fam: Family, i = r.int(0, 5)) =>
    fam === 'monero' ? gen.xmrAddress(r) : pool[fam][i].address

  /* merchants */
  const merchantIds = {
    northwind: 'a3f1c2d4-6b7e-4f80-9a1b-2c3d4e5f6071',
    lumen: 'b8e2d1c0-3f4a-4b5c-8d6e-7f8091a2b3c4',
    kestrel: 'c1d2e3f4-a5b6-4c7d-9e8f-0a1b2c3d4e5f',
    harbor: 'd4c3b2a1-0f9e-4d8c-b7a6-958473625140',
  }
  const merchants: Merchant[] = [
    {
      id: merchantIds.northwind,
      name: 'Northwind Games',
      source: 'dashboard',
      webhookUrl: 'https://api.northwindgames.gg/webhooks/payments',
      apiKeyFingerprint: 'a9f3',
      active: true,
      paymentToleranceUnderBps: 50,
      paymentToleranceOverBps: 100,
      addressCooldownSeconds: 3600,
      confirmationThresholds: { '1': 6, '728': 19 },
      confirmationTiers: {
        '1:USDT': [
          { amount: '10000', op: '>=', confirmations: 24 },
          { amount: '500', op: '<', confirmations: 3 },
          { confirmations: 12 },
        ],
        '728:USDT': [{ amount: '5000', op: '>', confirmations: 30 }, { confirmations: 19 }],
      },
      createdAt: sec(now - 142 * DAY),
      updatedAt: sec(now - 3 * DAY),
    },
    {
      id: merchantIds.lumen,
      name: 'Lumen Store',
      source: 'imported',
      webhookUrl: 'https://lumen.store/api/crypto/webhook',
      apiKeyFingerprint: '4e1b',
      active: true,
      paymentToleranceUnderBps: null,
      paymentToleranceOverBps: null,
      addressCooldownSeconds: null,
      confirmationThresholds: null,
      confirmationTiers: null,
      createdAt: sec(now - 88 * DAY),
      updatedAt: sec(now - 21 * DAY),
    },
    {
      id: merchantIds.kestrel,
      name: 'Kestrel Gift Cards',
      source: 'dashboard',
      webhookUrl: 'https://hooks.kestrelgifts.com/gw',
      apiKeyFingerprint: '7c21',
      active: false,
      paymentToleranceUnderBps: 25,
      paymentToleranceOverBps: 300,
      addressCooldownSeconds: 900,
      confirmationThresholds: { '8453': 20 },
      confirmationTiers: null,
      createdAt: sec(now - 61 * DAY),
      updatedAt: sec(now - 5 * DAY),
    },
    {
      id: merchantIds.harbor,
      name: 'Harbor & Pine Coffee',
      source: 'gateway-only',
      webhookUrl: null,
      apiKeyFingerprint: null,
      active: true,
      paymentToleranceUnderBps: null,
      paymentToleranceOverBps: null,
      addressCooldownSeconds: null,
      confirmationThresholds: null,
      confirmationTiers: null,
      createdAt: sec(now - 33 * DAY),
      updatedAt: sec(now - 33 * DAY),
    },
  ]

  /* scoped API keys */
  const apiKeys: MerchantApiKey[] = [
    {
      id: '0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
      merchantId: merchantIds.northwind,
      label: 'Storefront checkout',
      fingerprint: 'k2Qd',
      scopes: ['invoices:read', 'invoices:write'],
      createdAt: iso(now - 40 * DAY),
      revokedAt: null,
    },
    {
      id: '1a2b3c4d-5e6f-4708-9a0b-1c2d3e4f5a6b',
      merchantId: merchantIds.northwind,
      label: 'Payout worker (prod)',
      fingerprint: 'X9vp',
      scopes: ['payouts:read', 'payouts:write', 'invoices:read'],
      createdAt: iso(now - 18 * DAY),
      revokedAt: null,
    },
    {
      id: '2b3c4d5e-6f70-4819-ab2c-3d4e5f60718a',
      merchantId: merchantIds.northwind,
      label: 'Analytics export',
      fingerprint: 'm7Ta',
      scopes: ['invoices:read', 'payouts:read'],
      createdAt: iso(now - 9 * DAY),
      revokedAt: null,
    },
    {
      id: '3c4d5e6f-7081-492a-bc3d-4e5f60718293',
      merchantId: merchantIds.northwind,
      label: 'Old staging key',
      fingerprint: 'Lp0e',
      scopes: ['invoices:read', 'invoices:write', 'payouts:read'],
      createdAt: iso(now - 96 * DAY),
      revokedAt: iso(now - 30 * DAY),
    },
    {
      id: '4d5e6f70-8192-4a3b-8d4e-5f6071829304',
      merchantId: merchantIds.lumen,
      label: 'Shopify plugin',
      fingerprint: 'Qe5s',
      scopes: ['invoices:read', 'invoices:write'],
      createdAt: iso(now - 60 * DAY),
      revokedAt: null,
    },
  ]

  /* invoices + their transactions */
  const INVOICE_PICKS: Array<[number, string]> = [
    [728, 'USDT'],
    [728, 'USDT'],
    [728, 'USDT'],
    [728, 'USDT'],
    [1, 'USDT'],
    [1, 'USDT'],
    [1, 'USDC'],
    [8453, 'USDC'],
    [8453, 'USDC'],
    [137, 'USDT'],
    [137, 'USDC'],
    [56, 'USDT'],
    [900, 'USDC'],
    [900, 'USDC'],
    [900, 'SOL'],
    [1, 'ETH'],
    [800, 'BTC'],
  ]
  const PRICES_USD = [4.99, 9.99, 14.99, 19.99, 24.5, 49.99, 74, 99, 120, 149.99, 250, 499, 1200, 2500]
  const SKUS = ['gems-500', 'gems-1200', 'battle-pass-s7', 'starter-bundle', 'gift-50', 'gift-100', 'sub-annual', 'skin-aurora']

  const invoices: GatewayInvoice[] = []
  const invoiceTxs = new Map<string, InvoiceTransaction[]>()

  type InvPlan = { status: InvoiceStatus; extra: InvoiceExtraStatus }
  const plan = (
    counts: Partial<Record<InvoiceStatus | 'partial' | 'overpaid', number>>,
  ): InvPlan[] => {
    const out: InvPlan[] = []
    const push = (n: number | undefined, p: InvPlan) => {
      for (let i = 0; i < (n ?? 0); i++) out.push(p)
    }
    push(counts.pending, { status: 'pending', extra: null })
    push(counts.processing, { status: 'processing', extra: null })
    push(counts.partial, { status: 'processing', extra: 'partial' })
    push(counts.completed, { status: 'completed', extra: null })
    push(counts.overpaid, { status: 'completed', extra: 'overpaid' })
    push(counts.expired, { status: 'expired', extra: null })
    push(counts.canceled, { status: 'canceled', extra: null })
    return out
  }

  const makeInvoices = (merchantId: string, prefix: string, plans: InvPlan[], bigTicket = false) => {
    plans.forEach((p, i) => {
      const id = gen.uuid(r)
      const [chainId, token] = r.pick(INVOICE_PICKS)
      const fam = chainFamily(chainId)
      const dec = tokenDecimals(chainId, token)
      const priceUsd = bigTicket ? r.pick([25, 50, 100, 200, 500]) : r.pick(PRICES_USD)
      const amt = amountFor(priceUsd, token, dec)
      const rate = PRICES[token] ?? 1
      const createdAt =
        p.status === 'pending'
          ? now - r.int(2, 38) * MIN
          : p.status === 'processing'
            ? now - r.int(5, 110) * MIN
            : now - r.int(1, 10 * 24) * HOUR - r.int(0, 59) * MIN
      const ttl = r.pick([30, 30, 60, 15]) * MIN
      const expiresAt = createdAt + ttl
      const multi = r.chance(0.25) && (token === 'USDT' || token === 'USDC')
      const { address, addressIndex } = allocate(
        fam,
        p.status === 'pending' || p.status === 'processing' ? id : null,
      )
      const fiat = r.next()
      const fiatCurrency = fiat < 0.7 ? 'USD' : fiat < 0.85 ? 'EUR' : null
      const fiatAmount =
        fiatCurrency === 'USD' ? usd(priceUsd) : fiatCurrency === 'EUR' ? usd(priceUsd / 1.08) : null

      let receivedUsd = 0
      if (p.status === 'completed') receivedUsd = priceUsd
      if (p.extra === 'overpaid') receivedUsd = priceUsd + r.pick([0.5, 1, 5, 12.25])
      if (p.extra === 'partial') receivedUsd = Math.round(priceUsd * r.pick([0.4, 0.5, 0.75]) * 100) / 100
      if (p.status === 'processing' && !p.extra) receivedUsd = priceUsd
      if (p.status === 'expired' && r.chance(0.25)) receivedUsd = Math.round(priceUsd * 0.3 * 100) / 100

      const confirmedAt =
        p.status === 'completed' ? createdAt + r.int(2, Math.max(3, ttl / MIN - 2)) * MIN : null
      const updatedAt =
        confirmedAt ??
        (p.status === 'expired'
          ? expiresAt
          : p.status === 'canceled'
            ? createdAt + r.int(1, 10) * MIN
            : createdAt + r.int(0, 3) * MIN)

      const inv: GatewayInvoice = {
        id,
        merchantId,
        status: p.status,
        extraStatus: p.extra,
        chainId,
        token,
        receiveAddress: address,
        addressIndex,
        ...(multi
          ? {
              acceptedFamilies: ['evm', 'tron', 'solana'] as Family[],
              receiveAddresses: (['evm', 'tron', 'solana'] as const).map((f) => ({
                family: f,
                address: f === fam ? address : allocate(f, null).address,
              })),
              rates: { USDT: '1.0000', USDC: '0.9999' },
              rateWindowExpiresAt: iso(createdAt + 15 * MIN),
            }
          : {}),
        requiredAmountRaw: toRaw(amt, dec),
        receivedAmountRaw: toRaw(amountFor(receivedUsd, token, dec), dec),
        fiatAmount,
        fiatCurrency,
        quotedRate: rate.toFixed(rate > 100 ? 2 : 4),
        amountUsd: usd(priceUsd),
        paidUsd: receivedUsd ? usd(receivedUsd) : p.status === 'pending' ? null : '0.00',
        overpaidUsd: p.extra === 'overpaid' ? usd(receivedUsd - priceUsd) : null,
        externalId: r.chance(0.85) ? `${prefix}-${100480 + invoices.length * 7 + i}` : null,
        metadata: r.chance(0.6)
          ? { sku: r.pick(SKUS), customerId: `cus_${gen.alnum(r, 10)}`, channel: r.pick(['web', 'ios', 'android']) }
          : null,
        webhookUrl: r.chance(0.1) ? 'https://staging.northwindgames.gg/hooks/pay' : null,
        paymentToleranceUnderBps: 50,
        paymentToleranceOverBps: 100,
        createdAt: iso(createdAt),
        expiresAt: iso(expiresAt),
        confirmedAt: confirmedAt ? iso(confirmedAt) : null,
        updatedAt: iso(updatedAt),
      }
      invoices.push(inv)

      // Transactions for anything that received funds.
      const txs: InvoiceTransaction[] = []
      if (receivedUsd > 0) {
        const chainDef = CHAIN_BY_ID.get(chainId)!
        const legs = p.extra === 'overpaid' && r.chance(0.5) ? 2 : 1
        let remainingUsd = receivedUsd
        for (let l = 0; l < legs; l++) {
          const legUsd = l === legs - 1 ? remainingUsd : Math.round(receivedUsd * 0.8 * 100) / 100
          remainingUsd = Math.round((remainingUsd - legUsd) * 100) / 100
          const legAmt = amountFor(legUsd, token, dec)
          const confirming = p.status === 'processing' && !p.extra
          const detectedAt = createdAt + r.int(1, 12) * MIN + l * 2 * MIN
          txs.push({
            id: gen.uuid(r),
            txHash: txFor(r, fam),
            logIndex: fam === 'evm' ? r.int(0, 240) : fam === 'tron' ? 0 : null,
            chainId,
            chain: chainDef.slug,
            token,
            fromAddress: addressFor(r, fam, chainId),
            toAddress: address,
            amountRaw: toRaw(legAmt, dec),
            amount: legAmt,
            amountUsd: usd(legUsd),
            usdRate: rate.toFixed(4),
            status: confirming ? 'detected' : 'confirmed',
            confirmations: confirming
              ? r.int(1, chainDef.confirmationsRequired - 1)
              : chainDef.confirmationsRequired + r.int(10, 4000),
            blockNumber: fam === 'evm' ? 21_400_000 + r.int(0, 600_000) : fam === 'tron' ? 67_800_000 + r.int(0, 300_000) : fam === 'solana' ? 302_000_000 + r.int(0, 9_000_000) : 872_400 + r.int(0, 2_000),
            detectedAt: iso(detectedAt),
            confirmedAt: confirming ? null : iso(detectedAt + r.int(1, 8) * MIN),
          })
        }
      }
      invoiceTxs.set(id, txs)
    })
  }

  makeInvoices(
    merchantIds.northwind,
    'nw-order',
    plan({ pending: 4, processing: 2, partial: 2, completed: 15, overpaid: 2, expired: 6, canceled: 2 }),
  )
  makeInvoices(
    merchantIds.lumen,
    'lumen',
    plan({ pending: 2, processing: 1, completed: 8, partial: 1, expired: 2 }),
  )
  makeInvoices(
    merchantIds.kestrel,
    'kgc',
    plan({ completed: 6, overpaid: 1, expired: 3, canceled: 1 }),
    true,
  )
  invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  /* payouts */
  const PAYOUT_PICKS: Array<[number, string]> = [
    [728, 'USDT'],
    [728, 'USDT'],
    [728, 'USDT'],
    [1, 'USDT'],
    [1, 'USDC'],
    [8453, 'USDC'],
    [8453, 'USDC'],
    [137, 'USDT'],
    [56, 'USDT'],
    [900, 'USDC'],
    [900, 'SOL'],
    [1, 'ETH'],
  ]
  const FEE_NATIVE: Record<number, [number, number]> = {
    1: [0.00018, 0.0011],
    8453: [0.0000012, 0.000009],
    137: [0.004, 0.03],
    56: [0.00006, 0.0003],
    728: [0, 27.6],
    900: [0.000005, 0.00009],
    800: [0.000012, 0.00006],
  }
  const ERRORS = [
    'execution reverted: ERC20: transfer amount exceeds balance',
    'insufficient funds for gas * price + value: have 210000000000000 want 412000000000000',
    'TRON: BANDWIDTH_ERROR — account resource insufficient',
    'Transaction simulation failed: Blockhash not found',
    'nonce too low: next nonce 1184, tx nonce 1183',
  ]

  const payouts: GatewayPayout[] = []
  const batchIds = [gen.uuid(r), gen.uuid(r)]

  const makePayout = (
    merchantId: string,
    status: PayoutStatus,
    opts: { batchId?: string | null; pick?: [number, string]; kind?: GatewayPayout['kind'] } = {},
  ): GatewayPayout => {
    const [chainId, token] = opts.pick ?? r.pick(PAYOUT_PICKS)
    const fam = chainFamily(chainId)
    const dec = tokenDecimals(chainId, token)
    const native = NATIVE[chainId]
    const nativeDec = tokenDecimals(chainId, native)
    const amtUsd = r.pick([12.5, 40, 75, 150, 320, 640, 1000, 1850, 2500, 4200, 9800])
    const amt = amountFor(amtUsd, token, dec)
    const recent = status === 'reserved' || status === 'topping-up' || status === 'submitted'
    const createdAt = recent ? now - r.int(1, 25) * MIN : now - r.int(2, 10 * 24) * HOUR
    const [fmin, fmax] = FEE_NATIVE[chainId] ?? [0.0001, 0.001]
    const fee = fmin + (fmax - fmin) * r.next()
    const feeRaw = toRaw(fee.toFixed(Math.min(nativeDec, 9)), nativeDec)
    const quoted = toRaw((fee * (0.9 + r.next() * 0.2)).toFixed(Math.min(nativeDec, 9)), nativeDec)
    const submitted = status === 'submitted' || status === 'confirmed' || status === 'failed'
    const submittedAt = submitted ? createdAt + r.int(5, 90) * 1000 : null
    const confirmedAt = status === 'confirmed' && submittedAt ? submittedAt + r.int(1, 15) * MIN : null
    const topUp = status === 'topping-up' || (status === 'confirmed' && fam === 'tron' && r.chance(0.3))
    const p: GatewayPayout = {
      id: gen.uuid(r),
      merchantId,
      status,
      chainId,
      token,
      amountRaw: toRaw(amt, dec),
      quotedAmountUsd: usd(amtUsd),
      quotedRate: (PRICES[token] ?? 1).toFixed(4),
      destinationAddress: addressFor(r, fam, chainId),
      sourceAddress: status === 'planned' ? null : srcAddr(fam),
      txHash: submitted ? txFor(r, fam) : null,
      feeEstimateNative: status === 'canceled' ? null : feeRaw,
      lastError: status === 'failed' ? r.pick(ERRORS) : null,
      webhookUrl: null,
      createdAt: iso(createdAt),
      submittedAt: submittedAt ? iso(submittedAt) : null,
      confirmedAt: confirmedAt ? iso(confirmedAt) : null,
      updatedAt: iso(confirmedAt ?? submittedAt ?? createdAt + r.int(1, 30) * 1000),
      feeTier: r.pick<FeeTier>(['low', 'medium', 'medium', 'high']),
      feeQuotedNative: quoted,
      batchId: opts.batchId ?? null,
      broadcastAttemptedAt: submittedAt ? iso(submittedAt - 800) : null,
      kind: opts.kind ?? 'standard',
      parentPayoutId: null,
      topUpTxHash: topUp && status !== 'topping-up' ? txFor(r, fam) : null,
      topUpSponsorAddress: topUp ? srcAddr(fam, r.int(6, 9)) : null,
      topUpAmountRaw: topUp ? toRaw(fam === 'tron' ? '30' : '0.002', nativeDec) : null,
    }
    if (status === 'confirmed' && fam === 'tron' && !topUp && r.chance(0.5)) {
      // Energy delegated by the fee wallet → zero TRX burned.
      p.feeEstimateNative = '0'
    }
    payouts.push(p)
    return p
  }

  const nw = merchantIds.northwind
  for (let i = 0; i < 14; i++) makePayout(nw, 'confirmed')
  for (let i = 0; i < 5; i++) makePayout(nw, 'confirmed', { batchId: batchIds[0], pick: [728, 'USDT'] })
  makePayout(nw, 'submitted')
  makePayout(nw, 'submitted', { batchId: batchIds[1], pick: [8453, 'USDC'] })
  makePayout(nw, 'submitted', { batchId: batchIds[1], pick: [8453, 'USDC'] })
  makePayout(nw, 'reserved')
  makePayout(nw, 'reserved', { batchId: batchIds[1], pick: [8453, 'USDC'] })
  makePayout(nw, 'topping-up', { pick: [728, 'USDT'] })
  makePayout(nw, 'failed')
  makePayout(nw, 'failed')
  makePayout(nw, 'failed')
  makePayout(nw, 'canceled')
  makePayout(nw, 'canceled')
  // UTXO payout that was RBF-bumped once.
  const btc = makePayout(nw, 'confirmed', { pick: [800, 'BTC'] })
  btc.originalTxHash = gen.utxoTx(r)
  btc.feeBumpAttempts = 1
  btc.lastFeeBumpAt = Date.parse(btc.submittedAt!) + 22 * MIN
  const btcStuck = makePayout(nw, 'submitted', { pick: [800, 'BTC'] })
  btcStuck.feeBumpAttempts = 0
  btcStuck.originalTxHash = null

  for (let i = 0; i < 6; i++) makePayout(merchantIds.lumen, 'confirmed')
  makePayout(merchantIds.lumen, 'submitted')
  makePayout(merchantIds.lumen, 'failed')
  for (let i = 0; i < 5; i++) makePayout(merchantIds.kestrel, 'confirmed')
  makePayout(merchantIds.kestrel, 'canceled')
  payouts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  /* held payout legs (recovery queue) */
  const heldSpecs: Array<{ chainId: number; token: string; kind: HeldLeg['kind']; status: HeldLeg['status']; ageH: number; usd: number }> = [
    { chainId: 1, token: 'USDT', kind: 'standard', status: 'reserved', ageH: 146, usd: 2500 },
    { chainId: 728, token: 'USDT', kind: 'consolidation_sweep', status: 'topping-up', ageH: 19, usd: 8420.55 },
    { chainId: 8453, token: 'USDC', kind: 'standard', status: 'reserved', ageH: 2.5, usd: 640 },
  ]
  const held: HeldLeg[] = heldSpecs.map((h) => {
    const fam = chainFamily(h.chainId)
    const dec = tokenDecimals(h.chainId, h.token)
    const attempted = now - h.ageH * HOUR
    return {
      id: gen.uuid(r),
      kind: h.kind,
      chainId: h.chainId,
      token: h.token,
      amountRaw: toRaw(amountFor(h.usd, h.token, dec), dec),
      sourceAddress: srcAddr(fam),
      destinationAddress: h.kind === 'consolidation_sweep' ? srcAddr(fam, 0) : addressFor(r, fam, h.chainId),
      status: h.status,
      topUpTxHash: h.status === 'topping-up' ? txFor(r, fam) : null,
      batchId: null,
      parentPayoutId: null,
      lastError:
        h.chainId === 728
          ? 'Broadcast outcome unknown: TronGrid responded 504 Gateway Timeout'
          : 'Broadcast outcome unknown: fetch failed (ETIMEDOUT after 30000ms)',
      broadcastAttemptedAt: iso(attempted),
      heldForMs: Math.round(h.ageH * HOUR),
      createdAt: iso(attempted - 40_000),
      updatedAt: iso(attempted),
    }
  })

  /* orphan transactions */
  const orphanSpecs: Array<[number, string, number, number]> = [
    [728, 'USDT', 250, 30],
    [728, 'USDT', 18.4, 70],
    [1, 'USDC', 1200, 100],
    [900, 'USDC', 49.99, 150],
    [8453, 'USDC', 5, 200],
    [137, 'USDT', 0.01, 230],
  ]
  const orphans: OrphanTransaction[] = orphanSpecs.map(([chainId, token, u, ageH]) => {
    const fam = chainFamily(chainId)
    const dec = tokenDecimals(chainId, token)
    const amt = amountFor(u, token, dec)
    return {
      id: gen.uuid(r),
      chainId,
      txHash: txFor(r, fam),
      logIndex: fam === 'evm' ? r.int(0, 200) : null,
      fromAddress: addressFor(r, fam, chainId),
      toAddress: pool[fam as Exclude<Family, 'monero'>][r.int(10, 60)].address,
      token,
      amountRaw: toRaw(amt, dec),
      amountUsd: usd(u),
      usdRate: (PRICES[token] ?? 1).toFixed(4),
      blockNumber: fam === 'evm' ? 21_700_000 + r.int(0, 200_000) : fam === 'tron' ? 67_900_000 + r.int(0, 200_000) : 305_000_000 + r.int(0, 4_000_000),
      confirmations: r.int(40, 9000),
      status: 'orphaned',
      detectedAt: iso(now - ageH * HOUR),
    }
  })

  /* webhook deliveries */
  const deliveries: WebhookDelivery[] = []
  const merchantUrl = (id: string) => merchants.find((m) => m.id === id)?.webhookUrl ?? 'https://example.invalid/webhook'
  const addDelivery = (
    eventType: string,
    resourceType: 'invoice' | 'payout',
    res: { id: string; merchantId: string; updatedAt: string } & Record<string, unknown>,
    status: WebhookDelivery['status'],
  ) => {
    const created = Date.parse(res.updatedAt)
    const attempts = status === 'delivered' ? r.pick([1, 1, 1, 2]) : status === 'dead' ? 12 : r.int(1, 5)
    const failCode = r.pick([500, 502, 503, 404, null])
    deliveries.push({
      id: gen.uuid(r),
      merchantId: res.merchantId,
      eventType,
      idempotencyKey: `${eventType}:${res.id}:${String(res.status ?? 'event')}`,
      payload: {
        event: eventType,
        timestamp: iso(created),
        data: {
          id: res.id,
          status: res.status,
          chainId: res.chainId,
          token: res.token,
          ...(resourceType === 'invoice'
            ? { amountUsd: res.amountUsd, paidUsd: res.paidUsd, externalId: res.externalId }
            : { amountRaw: res.amountRaw, txHash: res.txHash, destinationAddress: res.destinationAddress }),
        },
      },
      targetUrl: merchantUrl(res.merchantId),
      resourceType,
      resourceId: res.id,
      status,
      attempts,
      lastStatusCode: status === 'delivered' ? 200 : failCode,
      lastError:
        status === 'delivered'
          ? null
          : failCode == null
            ? 'connect ECONNREFUSED 203.0.113.24:443'
            : `HTTP ${failCode} from merchant endpoint`,
      nextAttemptAt: status === 'pending' ? now + r.int(1, 20) * MIN : null,
      deliveredAt: status === 'delivered' ? created + r.int(200, 4000) : null,
      createdAt: created,
      updatedAt: status === 'delivered' ? created + r.int(200, 4000) : now - r.int(1, 120) * MIN,
    })
  }
  invoices.slice(0, 40).forEach((inv, i) => {
    const s = inv.status
    const ev =
      s === 'completed' ? 'invoice:completed' : s === 'expired' ? 'invoice:expired' : s === 'canceled' ? 'invoice:canceled' : s === 'processing' ? 'invoice:payment_detected' : null
    if (!ev) return
    const status: WebhookDelivery['status'] =
      inv.merchantId === merchantIds.kestrel && i % 2 === 0 ? 'dead' : i % 11 === 4 ? 'pending' : 'delivered'
    addDelivery(ev, 'invoice', inv, status)
    if (s === 'completed' && i % 4 === 0) addDelivery('invoice:payment_confirmed', 'invoice', inv, 'delivered')
  })
  payouts.slice(0, 26).forEach((p, i) => {
    const ev =
      p.status === 'confirmed' ? 'payout:confirmed' : p.status === 'failed' ? 'payout:failed' : p.status === 'submitted' ? 'payout:submitted' : null
    if (!ev) return
    addDelivery(ev, 'payout', p, p.status === 'failed' && i % 2 === 0 ? 'dead' : i % 9 === 5 ? 'pending' : 'delivered')
  })
  deliveries.sort((a, b) => b.createdAt - a.createdAt)

  /* balances snapshot */
  const BAL_TOTALS: Record<number, Record<string, number>> = {
    1: { USDT: 48210.4, USDC: 31044.18, ETH: 2.41 },
    8453: { USDC: 12480.95, ETH: 0.384 },
    137: { USDT: 6204.11, USDC: 3110.5, POL: 220.4 },
    56: { USDT: 9810.0, USDC: 1205.75, BNB: 0.92 },
    728: { USDT: 84310.62, TRX: 5412.8 },
    900: { USDC: 22014.3, USDT: 4108.0, SOL: 18.62 },
    800: { BTC: 0.8412 },
    1000: { XMR: 12.53 },
  }
  const balanceAddrs: Record<number, string[]> = {}
  const famMap = new Map<Family, BalancesSnapshot['families'][number]>()
  for (const [cid, totals] of Object.entries(BAL_TOTALS)) {
    const chainId = Number(cid)
    const def = CHAIN_BY_ID.get(chainId)!
    const fam = def.family
    const n = fam === 'monero' ? 1 : r.int(3, 6)
    const addrs = Array.from({ length: n }, (_, i) => srcAddr(fam, i))
    balanceAddrs[chainId] = addrs
    const native = NATIVE[chainId]
    const weights = addrs.map(() => 0.2 + r.next())
    const wsum = weights.reduce((s, w) => s + w, 0)
    const addrRows = addrs.map((address) => ({
      address,
      kind: 'pool' as 'pool' | 'fee',
      totalUsd: '0',
      tokens: [] as BalancesSnapshot['families'][number]['chains'][number]['addresses'][number]['tokens'],
    }))
    const tokenRows: BalancesSnapshot['families'][number]['chains'][number]['tokens'] = []
    let chainUsd = 0
    for (const [token, total] of Object.entries(totals)) {
      const dec = tokenDecimals(chainId, token)
      const price = PRICES[token] ?? 1
      let rawSum = 0n
      addrRows.forEach((row, i) => {
        let share = (total * weights[i]) / wsum
        // One EVM/Tron/Solana source runs almost dry on gas → low-gas badge.
        if (token === native && i === addrRows.length - 1 && fam !== 'utxo' && fam !== 'monero') share = share * 0.004
        const amountDecimal = share.toFixed(price > 50 ? 6 : 2)
        const raw = toRaw(amountDecimal, dec)
        rawSum += BigInt(raw)
        const u = Number(amountDecimal) * price
        row.tokens.push({ token, decimals: dec, amountRaw: raw, amountDecimal, usd: usd(u) })
        row.totalUsd = usd(Number(row.totalUsd) + u)
      })
      const amountDecimal = fromRaw(rawSum.toString(), dec)
      const u = Number(amountDecimal) * price
      chainUsd += u
      tokenRows.push({ token, amountRaw: rawSum.toString(), amountDecimal, usd: usd(u) })
    }
    // Fee wallets on Tron / Solana show up as `kind: 'fee'`.
    if (fam === 'tron' || fam === 'solana') {
      const feeNative = fam === 'tron' ? '1840.5' : '2.315'
      const dec = tokenDecimals(chainId, native)
      const u = Number(feeNative) * PRICES[native]
      addrRows.push({
        address: fam === 'tron' ? FEE_WALLET.tron : FEE_WALLET.solana,
        kind: 'fee',
        totalUsd: usd(u),
        tokens: [{ token: native, decimals: dec, amountRaw: toRaw(feeNative, dec), amountDecimal: feeNative, usd: usd(u) }],
      })
    }
    const famRow = famMap.get(fam) ?? { family: fam, totalUsd: '0', chains: [] }
    famRow.chains.push({
      chainId,
      totalUsd: usd(chainUsd),
      tokens: tokenRows,
      addresses: addrRows,
      errors: chainId === 56 ? 1 : 0,
    })
    famRow.totalUsd = usd(Number(famRow.totalUsd) + chainUsd)
    famMap.set(fam, famRow)
  }
  const balanceFamilies = [...famMap.values()]
  const balances: BalancesSnapshot = {
    generatedAt: iso(now - 4 * MIN),
    source: 'db',
    totalUsd: usd(balanceFamilies.reduce((s, f) => s + Number(f.totalUsd), 0)),
    families: balanceFamilies,
  }

  /* fee wallets */
  const feeWallets: FeeWalletEntry[] = [
    { family: 'evm', capability: 'none', configured: null },
    { family: 'tron', capability: 'delegate', configured: { mode: 'hd-pool', address: FEE_WALLET.tron } },
    { family: 'solana', capability: 'co-sign', configured: { mode: 'imported', address: FEE_WALLET.solana } },
    { family: 'utxo', capability: 'none', configured: null },
  ]
  const tronResources: TronFeeWalletResources = {
    feeWallet: FEE_WALLET.tron,
    resources: {
      energyAvailable: 412_380,
      energyLimit: 650_000,
      bandwidthAvailable: 3_912,
      bandwidthLimit: 5_000,
    },
  }

  /* consolidation schedules */
  const schedules: AutoConsolidationSchedule[] = [
    {
      id: gen.uuid(r),
      chainId: 728,
      token: 'USDT',
      targetAddress: pool.tron[0].address,
      intervalHours: 6,
      minSourceBalanceRaw: toRaw('25', 6),
      maxFeeUsd: null,
      maxSourcesPerRun: 20,
      enabled: true,
      lastRunAt: now - 2 * HOUR - 14 * MIN,
      lastConsolidationId: gen.uuid(r),
      lastLegCount: 7,
      lastSkippedCount: 2,
      lastSkippedReasons: [
        { sourceAddress: pool.tron[31].address, amountRaw: toRaw('18.4', 6), reason: 'BELOW_MIN_SOURCE_BALANCE' },
        { sourceAddress: pool.tron[44].address, amountRaw: toRaw('310', 6), reason: 'NO_GAS_SPONSOR_AVAILABLE: no sponsor holds ≥ 30 TRX' },
      ],
      nextRunDue: now + 3 * HOUR + 46 * MIN,
      createdAt: now - 40 * DAY,
      updatedAt: now - 2 * HOUR,
    },
    {
      id: gen.uuid(r),
      chainId: 1,
      token: 'USDC',
      targetAddress: pool.evm[0].address,
      intervalHours: 24,
      minSourceBalanceRaw: toRaw('250', 6),
      maxFeeUsd: '4.50',
      maxSourcesPerRun: 10,
      enabled: true,
      lastRunAt: now - 20 * HOUR,
      lastConsolidationId: gen.uuid(r),
      lastLegCount: 0,
      lastSkippedCount: 0,
      lastSkippedReasons: null,
      nextRunDue: now + 4 * HOUR,
      createdAt: now - 25 * DAY,
      updatedAt: now - 20 * HOUR,
    },
    {
      id: gen.uuid(r),
      chainId: 900,
      token: 'USDC',
      targetAddress: pool.solana[0].address,
      intervalHours: 12,
      minSourceBalanceRaw: toRaw('10', 6),
      maxFeeUsd: null,
      maxSourcesPerRun: 25,
      enabled: false,
      lastRunAt: null,
      lastConsolidationId: null,
      lastLegCount: null,
      lastSkippedCount: null,
      lastSkippedReasons: null,
      nextRunDue: now + 12 * HOUR,
      createdAt: now - 3 * DAY,
      updatedAt: now - 3 * DAY,
    },
  ]

  /* treasury */
  const destinations: TreasuryDestination[] = [
    {
      id: gen.uuid(r),
      label: 'Kraken USDT (TRC-20)',
      exchange: 'kraken',
      chainId: 728,
      token: 'USDT',
      address: 'TKrkn' + gen.b58(r, 29),
      memo: null,
      enabled: true,
      verifiedAt: now - 30 * DAY,
      disabledAt: null,
      exchangeMinRaw: toRaw('5', 6),
      minTransferUsd: '500',
      maxPerTransferUsd: '25000',
      maxDailyUsd: '60000',
      keepFloatRaw: toRaw('5000', 6),
      autoIntervalHours: 6,
      nextRunDue: now + 2 * HOUR + 10 * MIN,
      lastRunAt: now - 3 * HOUR - 50 * MIN,
      lastTransferId: null,
      createdAt: now - 31 * DAY,
      updatedAt: now - 3 * HOUR,
    },
    {
      id: gen.uuid(r),
      label: 'Kraken USDC (Base)',
      exchange: 'kraken',
      chainId: 8453,
      token: 'USDC',
      address: gen.evmAddress(r),
      memo: null,
      enabled: true,
      verifiedAt: now - 12 * DAY,
      disabledAt: null,
      exchangeMinRaw: toRaw('1', 6),
      minTransferUsd: '250',
      maxPerTransferUsd: '10000',
      maxDailyUsd: '20000',
      keepFloatRaw: toRaw('1500', 6),
      autoIntervalHours: null,
      nextRunDue: null,
      lastRunAt: now - 2 * DAY,
      lastTransferId: null,
      createdAt: now - 13 * DAY,
      updatedAt: now - 2 * DAY,
    },
    {
      id: gen.uuid(r),
      label: 'Cold storage — ETH',
      exchange: 'other',
      chainId: 1,
      token: 'ETH',
      address: gen.evmAddress(r),
      memo: null,
      enabled: false,
      verifiedAt: null,
      disabledAt: null,
      exchangeMinRaw: toRaw('0.01', 18),
      minTransferUsd: '1000',
      maxPerTransferUsd: '15000',
      maxDailyUsd: '15000',
      keepFloatRaw: toRaw('0.5', 18),
      autoIntervalHours: 24,
      nextRunDue: null,
      lastRunAt: null,
      lastTransferId: null,
      createdAt: now - 1 * DAY,
      updatedAt: now - 1 * DAY,
    },
  ]
  const mkTransfer = (
    d: TreasuryDestination,
    mode: TreasuryTransfer['mode'],
    plannedUsdN: number,
    ageMs: number,
    roll: Partial<TreasuryTransfer['status']>,
    legs: number,
  ): TreasuryTransfer => {
    const dec = tokenDecimals(d.chainId, d.token)
    const planned = toRaw(amountFor(plannedUsdN, d.token, dec), dec)
    const status = {
      planned: 0,
      reserved: 0,
      toppingUp: 0,
      submitted: 0,
      confirmed: 0,
      failed: 0,
      canceled: 0,
      confirmedAmountRaw: '0',
      ...roll,
    }
    if (roll.confirmed && roll.confirmedAmountRaw == null) {
      status.confirmedAmountRaw = roll.confirmed === legs ? planned : (BigInt(planned) * BigInt(roll.confirmed) / BigInt(legs)).toString()
    }
    return {
      id: gen.uuid(r),
      destinationId: d.id,
      mode,
      batchId: gen.uuid(r),
      plannedAmountRaw: planned,
      plannedUsd: usd(plannedUsdN),
      legCount: legs,
      skippedCount: legs > 3 ? 1 : 0,
      skippedReasons:
        legs > 3
          ? [{ sourceAddress: pool.tron[23].address, amountRaw: toRaw('12.5', 6), reason: 'BELOW_EXCHANGE_MIN' }]
          : [],
      createdAt: now - ageMs,
      status,
    }
  }
  const [dTron, dBase] = destinations
  const transfers: TreasuryTransfer[] = [
    mkTransfer(dTron, 'scheduled', 18240.5, 3 * HOUR + 50 * MIN, { submitted: 2, confirmed: 3 }, 5),
    mkTransfer(dTron, 'scheduled', 24990, 9 * HOUR + 50 * MIN, { confirmed: 6 }, 6),
    mkTransfer(dBase, 'manual', 6500, 2 * DAY, { confirmed: 3 }, 3),
    mkTransfer(dTron, 'scheduled', 21012.33, 15 * HOUR + 50 * MIN, { confirmed: 4, failed: 1 }, 5),
    mkTransfer(dTron, 'scheduled', 25000, 21 * HOUR + 50 * MIN, { confirmed: 5 }, 5),
    mkTransfer(dBase, 'verification', 1, 12 * DAY, { confirmed: 1 }, 1),
    mkTransfer(dTron, 'verification', 5, 30 * DAY, { confirmed: 1 }, 1),
  ]
  dTron.lastTransferId = transfers[0].id
  dBase.lastTransferId = transfers[2].id

  const eligibilityFor = (d: TreasuryDestination): TreasuryEligibility => {
    const dec = tokenDecimals(d.chainId, d.token)
    const fam = chainFamily(d.chainId)
    const rate = PRICES[d.token] ?? 1
    const sources = (balanceAddrs[d.chainId] ?? [srcAddr(fam, 0)]).map((address, i) => {
      const spend = [8200, 4100.5, 2210.75, 880, 120.2, 40][i % 6] / rate
      const heldPart = i === 0 ? spend * 0.15 : 0
      const elig = spend - heldPart
      return {
        address,
        spendableRaw: toRaw(spend.toFixed(Math.min(dec, 6)), dec),
        heldRaw: toRaw(heldPart.toFixed(Math.min(dec, 6)), dec),
        eligibleRaw: toRaw(elig.toFixed(Math.min(dec, 6)), dec),
      }
    })
    const sum = (k: 'spendableRaw' | 'heldRaw' | 'eligibleRaw') =>
      sources.reduce((s, x) => s + BigInt(x[k]), 0n)
    const eligible = sum('eligibleRaw') - BigInt(d.keepFloatRaw)
    const capRaw = BigInt(toRaw((Number(d.maxPerTransferUsd) / rate).toFixed(Math.min(dec, 6)), dec))
    const budget = eligible < 0n ? 0n : eligible < capRaw ? eligible : capRaw
    const budgetUsd = Number(fromRaw(budget.toString(), dec)) * rate
    return {
      chainId: d.chainId,
      token: d.token,
      decimals: dec,
      usdRate: rate.toFixed(4),
      holdHours: 72,
      spendableRaw: sum('spendableRaw').toString(),
      heldForRefundsRaw: sum('heldRaw').toString(),
      keepFloatRaw: d.keepFloatRaw,
      perTransferCapUsd: d.maxPerTransferUsd,
      dailyRemainingUsd: usd(Math.max(0, Number(d.maxDailyUsd) - (d === dTron ? 43240.5 : 0))),
      budgetRaw: budget.toString(),
      budgetUsd: usd(budgetUsd),
      sources,
      blocked: !d.enabled
        ? 'DISABLED'
        : d.verifiedAt == null
          ? 'NOT_VERIFIED'
          : budgetUsd < Number(d.minTransferUsd)
            ? 'BELOW_MIN_TRANSFER'
            : null,
    }
  }

  /* exchange (Kraken) */
  const exchange: ExchangeStatus = {
    configured: true,
    policy: {
      mode: 'on',
      minOrderUsd: '50',
      dailyCapUsd: '100000',
      requoteMinutes: 10,
      maxRequotes: 6,
      intervalMinutes: 15,
      sellable: { USDT: 'USDTZUSD', USDC: 'USDCUSD', XETH: 'XETHZUSD', XXBT: 'XXBTZUSD', SOL: 'SOLUSD' },
      userref: 424242,
      withdraw: {
        enabled: true,
        key: 'Mercury Ops ••4417',
        asset: 'ZUSD',
        minUsd: '5000',
        dailyCapUsd: '250000',
      },
    },
    lastRun: {
      ran: true,
      mode: 'on',
      dryRun: false,
      synced: 4,
      placed: 2,
      requoted: 1,
      marketFallbacks: 0,
      filled: 3,
      canceled: 0,
      withdrawals: 1,
      skipped: [{ asset: 'SOL', reason: 'below minOrderUsd (18.42 < 50)' }],
      errors: [],
      at: now - 7 * MIN,
    },
    balances: [
      { asset: 'ZUSD', balance: '41822.1934', holdTrade: '0.0000', available: '41822.1934', pair: null, price: null, usd: '41822.19' },
      { asset: 'USDT', balance: '18240.50000000', holdTrade: '18240.50000000', available: '0.00000000', pair: 'USDTZUSD', price: '0.99980000', usd: '0.00' },
      { asset: 'USDC', balance: '2104.880000', holdTrade: '0.000000', available: '2104.880000', pair: 'USDCUSD', price: '0.99990000', usd: '2104.67' },
      { asset: 'XETH', balance: '0.4120000000', holdTrade: '0.0000000000', available: '0.4120000000', pair: 'XETHZUSD', price: '3410.12', usd: '1404.97' },
      { asset: 'SOL', balance: '0.1010000000', holdTrade: '0.0000000000', available: '0.1010000000', pair: 'SOLUSD', price: '182.31', usd: '18.41' },
      { asset: 'XXBT', balance: '0.0000000000', holdTrade: '0.0000000000', available: '0.0000000000', pair: 'XXBTZUSD', price: '96812.40', usd: '0.00' },
    ],
    openOrders: [
      {
        txid: 'OQCLML-BW3P3-BUCMWZ',
        pair: 'USDTZUSD',
        status: 'open',
        volume: '18240.50000000',
        volumeExecuted: '6100.00000000',
        cost: '6098.78',
        fee: '1.22',
        averagePrice: '0.99980000',
        openedAt: now - 11 * MIN,
      },
      {
        txid: 'O7HN2K-QX4TR-ZPL8YE',
        pair: 'XETHZUSD',
        status: 'pending',
        volume: '0.41200000',
        volumeExecuted: '0.00000000',
        cost: '0.00',
        fee: '0.00',
        averagePrice: null,
        openedAt: now - 2 * MIN,
      },
    ],
    withdrawKeys: [
      { key: 'Mercury Ops ••4417', address: 'Mercury Bank — Checking ••4417', verified: true },
      { key: 'Wise EUR ••0921', address: 'Wise — EUR IBAN ••0921', verified: false },
    ],
    snapshotAt: now - 7 * MIN,
    lockedUntil: null,
    error: null,
  }

  const exchangeActions: ExchangeAction[] = []
  const actSpecs: Array<{
    kind: ExchangeAction['kind']
    asset: string
    pair: string | null
    vol: number
    price: number | null
    status: ExchangeAction['status']
    ageMin: number
    requotes?: number
    error?: string
    dry?: boolean
  }> = [
    { kind: 'sell', asset: 'USDT', pair: 'USDTZUSD', vol: 18240.5, price: 0.9998, status: 'open', ageMin: 11, requotes: 1 },
    { kind: 'sell', asset: 'XETH', pair: 'XETHZUSD', vol: 0.412, price: 3410.12, status: 'validated', ageMin: 2 },
    { kind: 'withdraw', asset: 'ZUSD', pair: null, vol: 25000, price: null, status: 'requested', ageMin: 7 },
    { kind: 'sell', asset: 'USDT', pair: 'USDTZUSD', vol: 24990, price: 0.9999, status: 'filled', ageMin: 9 * 60 + 30 },
    { kind: 'market_sell', asset: 'USDC', pair: 'USDCUSD', vol: 6500, price: null, status: 'filled', ageMin: 2 * 24 * 60 - 40 },
    { kind: 'withdraw', asset: 'ZUSD', pair: null, vol: 30000, price: null, status: 'completed', ageMin: 26 * 60 },
    { kind: 'sell', asset: 'USDT', pair: 'USDTZUSD', vol: 21012.33, price: 0.9997, status: 'canceled', ageMin: 15 * 60, requotes: 6 },
    { kind: 'market_sell', asset: 'USDT', pair: 'USDTZUSD', vol: 21012.33, price: null, status: 'filled', ageMin: 14 * 60 },
    { kind: 'sell', asset: 'SOL', pair: 'SOLUSD', vol: 3.2, price: 181.9, status: 'failed', ageMin: 3 * 24 * 60, error: 'EOrder:Insufficient funds' },
    { kind: 'sell', asset: 'USDT', pair: 'USDTZUSD', vol: 25000, price: 0.9999, status: 'filled', ageMin: 21 * 60 },
    { kind: 'sell', asset: 'USDC', pair: 'USDCUSD', vol: 1200, price: 0.9999, status: 'validated', ageMin: 5 * 24 * 60, dry: true },
    { kind: 'withdraw', asset: 'ZUSD', pair: null, vol: 45000, price: null, status: 'completed', ageMin: 4 * 24 * 60 },
  ]
  for (const a of actSpecs) {
    const unit = a.price ?? (a.asset === 'ZUSD' ? 1 : PRICES[a.asset.replace(/^X/, '')] ?? 1)
    const usdEst = a.vol * unit
    const done = a.status === 'filled' || a.status === 'completed'
    const created = now - a.ageMin * MIN
    exchangeActions.push({
      id: gen.uuid(r),
      exchange: 'kraken',
      kind: a.kind,
      asset: a.asset,
      pair: a.pair,
      volume: a.vol.toFixed(a.vol < 10 ? 8 : 2),
      price: a.price != null ? String(a.price) : null,
      usdEstimate: usd(usdEst),
      exchangeRef:
        a.dry || a.status === 'validated'
          ? null
          : a.kind === 'withdraw'
            ? 'FTQ' + gen.alnum(r, 4).toUpperCase() + '-' + gen.alnum(r, 6).toUpperCase()
            : 'O' + gen.alnum(r, 5).toUpperCase() + '-' + gen.alnum(r, 5).toUpperCase() + '-' + gen.alnum(r, 6).toUpperCase(),
      status: a.status,
      requoteOf: null,
      requotes: a.requotes ?? 0,
      dryRun: a.dry ? 1 : 0,
      executedVolume: done ? a.vol.toFixed(a.vol < 10 ? 8 : 2) : a.status === 'open' ? '6100.00' : null,
      cost: done && a.kind !== 'withdraw' ? usd(usdEst) : null,
      fee: done ? usd(a.kind === 'withdraw' ? 4 : usdEst * 0.0016) : null,
      error: a.error ?? null,
      createdAt: created,
      updatedAt: done ? created + r.int(1, 30) * MIN : created,
    })
  }

  /* pool stats (derived from the pool rows so pages agree) */
  const poolStats = (): PoolStatsRow[] =>
    (Object.keys(pool) as Array<Exclude<Family, 'monero'>>).map((family) => {
      const rows = pool[family]
      const count = (s: PoolAddressAdminView['status']) => rows.filter((x) => x.status === s).length
      return {
        family,
        available: count('available'),
        allocated: count('allocated'),
        quarantined: count('quarantined'),
        total: rows.length,
        highestIndex: rows.length - 1,
      }
    })
  const moneroStats: MoneroPoolStatsRow[] = [
    { chainId: 1000, total: 180, available: 171, allocated: 8, quarantined: 1, highestIndex: 179 },
  ]

  /* operator sessions */
  const sessions = [
    {
      hash: gen.hex(r, 16),
      current: true,
      createdAt: sec(now - 3 * HOUR),
      lastSeenAt: sec(now - 20_000),
      expiresAt: sec(now + 9 * HOUR),
      idleSeconds: 20,
      ip: '203.0.113.42',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    },
    {
      hash: gen.hex(r, 16),
      current: false,
      createdAt: sec(now - 26 * HOUR),
      lastSeenAt: sec(now - 5 * HOUR),
      expiresAt: sec(now + 2 * HOUR),
      idleSeconds: 5 * 3600,
      ip: '198.51.100.17',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    },
    {
      hash: gen.hex(r, 16),
      current: false,
      createdAt: sec(now - 3 * DAY),
      lastSeenAt: sec(now - 2 * DAY),
      expiresAt: sec(now + 4 * DAY),
      idleSeconds: 2 * 86400,
      ip: null,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    },
  ]

  return {
    rng: r,
    now,
    merchantIds,
    chains: CHAIN_DEFS as ChainInventoryEntry[],
    pool,
    poolStats,
    moneroStats,
    merchants,
    apiKeys,
    invoices,
    invoiceTxs,
    payouts,
    held,
    orphans,
    deliveries,
    balances,
    feeWallets,
    tronResources,
    schedules,
    destinations,
    transfers,
    eligibilityFor,
    exchange,
    exchangeActions,
    sessions,
    srcAddr,
  }
}

const FEE_WALLET = {
  tron: 'TFeeWa11etQ7m3kz8RHxvJp2N4cYbVtLsD',
  solana: 'FeeWa11etSo1ana9xKq7RmZ3vT8pLcN2hYdBwJ4uEgA',
}

/* ── derived views ─────────────────────────────────────────── */

export function invoiceAmounts(inv: GatewayInvoice, txs: InvoiceTransaction[]): InvoiceAmounts {
  const sum = (s: InvoiceTransaction['status']) =>
    txs.filter((t) => t.status === s).reduce((a, t) => a + Number(t.amountUsd ?? 0), 0)
  const required = inv.amountUsd != null ? Number(inv.amountUsd) : null
  const confirmed = sum('confirmed')
  const confirming = sum('detected')
  const remaining =
    required == null ? null : Math.max(0, required - confirmed - confirming)
  return {
    requiredUsd: inv.amountUsd,
    confirmedUsd: usd(confirmed),
    confirmingUsd: usd(confirming),
    remainingUsd: remaining == null ? null : usd(remaining),
    overpaidUsd: inv.overpaidUsd,
  }
}

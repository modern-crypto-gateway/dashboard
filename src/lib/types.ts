export type SetupStatus = {
  setupComplete: boolean
  hasAdminKey: boolean
  hasUser: boolean
  hasTotp: boolean
  hasBaseUrl: boolean
}

export type Session = {
  authenticated: boolean
  user?: { username: string }
  baseUrl?: string
}

export type LoginStage = 'creds' | 'totp'

export type Family = 'evm' | 'tron' | 'solana'

export type PoolStatsRow = {
  family: Family
  available: number
  allocated: number
  quarantined: number
  total: number
  highestIndex?: number
}

export type Health = { status: 'ok' | 'degraded'; phase: number }

export type Merchant = {
  id: string
  name: string
  source: 'dashboard' | 'imported' | 'gateway-only'
  webhookUrl: string | null
  /** null when source === 'gateway-only' (no sealed key held locally) */
  apiKeyFingerprint: string | null
  /** null if the gateway was unreachable when the list was fetched */
  active: boolean | null
  paymentToleranceUnderBps: number | null
  paymentToleranceOverBps: number | null
  addressCooldownSeconds: number | null
  createdAt: number
  updatedAt: number
}

export type GatewayInvoice = {
  id: string
  merchantId: string
  status: string
  chainId: number
  token: string
  receiveAddress: string
  addressIndex: number
  acceptedFamilies?: Family[]
  receiveAddresses?: Array<{ family: Family; address: string }>
  requiredAmountRaw: string
  receivedAmountRaw: string
  fiatAmount: string | null
  fiatCurrency: string | null
  quotedRate: string | null
  amountUsd: string | null
  paidUsd: string | null
  overpaidUsd: string | null
  externalId: string | null
  metadata: Record<string, unknown> | null
  webhookUrl: string | null
  paymentToleranceUnderBps: number
  paymentToleranceOverBps: number
  createdAt: string
  expiresAt: string
  confirmedAt: string | null
  updatedAt: string
}

export type InvoiceAmounts = {
  requiredUsd: string | null
  confirmedUsd: string | null
  confirmingUsd: string | null
  remainingUsd: string | null
  overpaidUsd: string | null
}

export type InvoiceTransaction = {
  id: string
  txHash: string
  logIndex: number | null
  chainId: number
  chain: string | null
  token: string
  fromAddress: string
  toAddress: string
  amountRaw: string
  amount: string
  amountUsd: string | null
  usdRate: string | null
  status: 'detected' | 'confirmed' | 'reverted' | 'orphaned'
  confirmations: number
  blockNumber: number | null
  detectedAt: string
  confirmedAt: string | null
}

export type InvoiceDetails = {
  invoice: GatewayInvoice
  amounts: InvoiceAmounts
  transactions: InvoiceTransaction[]
}

export type InvoiceListResponse = {
  invoices: GatewayInvoice[]
  limit: number
  offset: number
  hasMore: boolean
}

export type PayoutListResponse = {
  payouts: GatewayPayout[]
  limit: number
  offset: number
  hasMore: boolean
}

export type FeeTier = 'low' | 'medium' | 'high'

/**
 * v2.2: `planned` is retained for migration safety but no new payout is ever
 * inserted in that state — the server picks a source + reserves synchronously
 * on POST, so rows start at `reserved`. `topping-up` is inserted between
 * `reserved` and `submitted` when the source lacks native gas and the
 * gateway JIT-sponsors from another HD address.
 */
export type PayoutStatus =
  | 'planned'
  | 'reserved'
  | 'topping-up'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'canceled'

/** `gas_top_up` rows are internal sibling payouts the executor inserts to sponsor gas for a parent token payout. */
export type PayoutKind = 'standard' | 'gas_top_up'

export type GatewayPayout = {
  id: string
  merchantId: string
  status: PayoutStatus
  chainId: number
  token: string
  amountRaw: string
  quotedAmountUsd: string | null
  quotedRate: string | null
  destinationAddress: string
  sourceAddress: string | null
  txHash: string | null
  feeEstimateNative: string | null
  lastError: string | null
  webhookUrl: string | null
  createdAt: string
  submittedAt: string | null
  confirmedAt: string | null
  updatedAt: string
  /** Tier picked at plan time. */
  feeTier: FeeTier | null
  /** Native-units fee quoted at plan time, before broadcast. Pair with `feeEstimateNative` for drift. */
  feeQuotedNative: string | null
  /** Set when the row was created via POST /payouts/batch. */
  batchId: string | null
  /** Set on the first broadcast attempt so ops can distinguish "still reserved" from "stuck after a try". */
  broadcastAttemptedAt: string | null
  /** v2.2: whether this is a merchant payout or an internal gas top-up. Merchants should filter to `standard`. */
  kind: PayoutKind
  /** v2.2: for `gas_top_up` rows, the parent payout they sponsor. */
  parentPayoutId: string | null
  /** v2.2: hash of the sponsor → source gas transfer that preceded this payout. */
  topUpTxHash: string | null
  /** v2.2: address that sponsored the gas top-up. */
  topUpSponsorAddress: string | null
  /** v2.2: raw native amount sent to the source for gas. */
  topUpAmountRaw: string | null
}

export type PayoutFeeTierQuote = {
  tier: FeeTier
  nativeAmountRaw: string
  usdAmount: string | null
}

export type PayoutFeeTiers = {
  tieringSupported: boolean
  nativeSymbol: string
  nativeDecimals?: number
  low: PayoutFeeTierQuote
  medium: PayoutFeeTierQuote
  high: PayoutFeeTierQuote
}

/**
 * v2.2 estimate warnings. Open-ended string set — backend may add more.
 * `fee_quote_unavailable` still applies: the tier picker should fall back.
 */
export type PayoutEstimateWarning =
  | 'no_source_address_has_sufficient_token_balance'
  | 'no_gas_sponsor_available'
  | 'max_amount_exceeds_net_spendable'
  | 'fee_quote_unavailable'

/** The HD address the gateway would draw the payout from, with its live ledger balances. */
export type PayoutEstimateSource = {
  address: string
  /** Raw smallest-units of the target token held by this source. */
  tokenBalance: string
  tokenSymbol: string
  /** Raw smallest-units of native gas currency held by this source. */
  nativeBalance: string
  nativeSymbol: string
}

/**
 * Present only when the picked source is short on native gas. The executor
 * will JIT-transfer `amountRaw` from the `sponsor` to the source before
 * broadcasting. `sponsor: null` means no sponsor has enough gas — the plan
 * will fail with NO_GAS_SPONSOR_AVAILABLE if submitted.
 */
export type PayoutEstimateTopUp = {
  required: true
  sponsor: {
    address: string
    /** Raw smallest-units of native gas held by the sponsor. */
    nativeBalance: string
  } | null
  /** Raw native amount the sponsor would transfer to the source. */
  amountRaw: string
}

export type PayoutEstimate = {
  amountRaw: string
  quotedAmountUsd: string | null
  quotedRate: string | null
  tiers: PayoutFeeTiers
  /** v2.2: the HD address picked as payout source. null when no source qualifies. */
  source: PayoutEstimateSource | null
  /** v2.2: only present when gas top-up is needed. */
  topUp: PayoutEstimateTopUp | null
  /** v2.2: up to 4 next-best candidates for operator visibility. */
  alternatives: PayoutEstimateSource[]
  /** Warning codes — may contain unknown future codes. */
  warnings: string[]
}

export type PayoutBatchRowResult =
  | { index: number; status: 'planned'; payout: GatewayPayout }
  | { index: number; status: 'failed'; error: { code?: string; message: string } }

export type PayoutBatchResponse = {
  batchId: string
  results: PayoutBatchRowResult[]
  summary: { planned: number; failed: number }
}

export type WebhookDelivery = {
  id: string
  merchantId: string
  eventType: string
  status: 'pending' | 'delivered' | 'dead'
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  nextAttemptAt: number | null
  deliveredAt: number | null
  createdAt: number
  updatedAt: number
}

export type OrphanTransaction = {
  id: string
  chainId: number
  txHash: string
  logIndex: number | null
  fromAddress: string
  toAddress: string
  token: string
  amountRaw: string
  amountUsd: string | null
  usdRate: string | null
  blockNumber: number | null
  confirmations: number
  status: 'orphaned'
  detectedAt: string
}

export type AuditResult = {
  chainId: number
  address: string
  sinceMs: number
  scanned: number
  inserted: number
  alreadyPresent: number
  insertedTxIds: string[]
}

export type AlchemyBootstrapResult = {
  chainId: number
  status: 'created' | 'existing' | 'unsupported' | 'failed'
  webhookId?: string
  signingKey?: string
  error?: string
}


export type ChainToken = {
  symbol: string
  decimals: number
  isStable: boolean
  displayName: string
  contractAddress?: string | null
}

export type ChainInventoryEntry = {
  chainId: number
  slug: string
  family: Family
  displayName: string
  wired: boolean
  webhooksSupported: boolean
  alchemyConfigured: boolean
  webhooks: boolean
  feeWallets: boolean
  detection: 'alchemy' | 'rpc-poll'
  bootstrapReady: boolean
  confirmationsRequired: number
  tokens: ChainToken[]
}

export type AlchemyWebhookEntry = {
  chainId: number
  chain: string | null
  webhookId: string
  webhookUrl: string
  createdAt: string
  updatedAt: string
}

export type BalancesSnapshot = {
  generatedAt: string
  source: 'db' | 'rpc'
  totalUsd: string
  families: Array<{
    family: Family
    totalUsd: string
    chains: Array<{
      chainId: number
      totalUsd: string
      tokens: Array<{ token: string; amountRaw: string; amountDecimal: string; usd: string }>
      addresses: Array<{
        address: string
        kind: 'pool' | 'fee'
        totalUsd: string
        tokens: Array<{ token: string; amountDecimal: string; usd: string }>
      }>
      errors: number
    }>
  }>
}

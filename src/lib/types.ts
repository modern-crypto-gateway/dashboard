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

export type GatewayPayout = {
  id: string
  merchantId: string
  status: 'planned' | 'reserved' | 'submitted' | 'confirmed' | 'failed' | 'canceled'
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
  /** v2: tier picked at plan time. */
  feeTier: FeeTier | null
  /** v2: native-units fee quoted at plan time, before broadcast. Pair with `feeEstimateNative` for drift. */
  feeQuotedNative: string | null
  /** v2: when the row was created via POST /payouts/batch. */
  batchId: string | null
  /** v2: opt-in split across multiple fee wallets. */
  allowMultiSource: boolean
  /** v2: full list of fee wallets that contributed to the broadcast. Only populated on multi-source runs. */
  sourceAddresses: string[] | null
  /** v2: one hash per on-chain leg. Single-source payouts still use `txHash`; multi-source populates this array. */
  txHashes: string[] | null
  /** v2: set on the first broadcast attempt so ops can distinguish "still planned" from "stuck after a try". */
  broadcastAttemptedAt: string | null
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

export type PayoutEstimate = {
  amountRaw: string
  quotedAmountUsd: string | null
  quotedRate: string | null
  tiers: PayoutFeeTiers
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

export type FeeWalletResult = {
  address: string
  label: string
  family: Family
  chainIds: number[]
}

export type FeeWalletRow = {
  id: string
  chainId: number
  chain?: string | null
  address: string
  label: string
  active: boolean
  reservedByPayoutId: string | null
  reservedAt: string | null
  createdAt: string
  nativeSymbol?: string | null
  nativeDecimals?: number | null
  nativeBalance?: string | null
  nativeBalanceError?: 'chain_not_wired' | 'rpc_error' | null
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

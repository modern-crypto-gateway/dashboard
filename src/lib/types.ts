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

export type Family = 'evm' | 'tron' | 'solana' | 'utxo' | 'monero'

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
  /**
   * Per-chain confirmation override map (`{ "<chainId>": <blockCount> }`).
   * `null` = no override → gateway default applies. Resolution order at
   * invoice/payout create time: this map > FINALITY_OVERRIDES env > per-chain
   * gateway default. Setting a value below the gateway default surfaces a
   * `merchant_confirmation_below_default` WARN log on the gateway.
   */
  confirmationThresholds: Record<string, number> | null
  /**
   * Per-(chain, token) amount-tiered confirmation rules — keys are
   * `"<chainId>:<TOKEN>"`. Resolution layer **above** `confirmationThresholds`:
   * for an invoice/payout, the gateway evaluates each rule of the matching
   * key in order against the resource's amount; the first predicate that
   * matches wins. A rule with no `amount`/`op` acts as a catch-all. Falls
   * back to `confirmationThresholds` then the gateway default if no rule
   * matches. Snapshotted onto each invoice/payout at create time and frozen.
   */
  confirmationTiers: Record<string, ConfirmationTierRule[]> | null
  createdAt: number
  updatedAt: number
}

export type ConfirmationTierOp = '<' | '<=' | '>' | '>=' | '=' | '<>'

export type ConfirmationTierRule = {
  /** Decimal string (whole-token units, e.g. `"100"`, `"0.5"`). Omit with
   * `op` for a catch-all rule. */
  amount?: string
  op?: ConfirmationTierOp
  confirmations: number
}

/**
 * Invoice lifecycle stage. As of the v3 spec, fidelity (partial /
 * overpaid) is no longer a status — it lives on the orthogonal
 * `extraStatus` field.
 */
export type InvoiceStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'canceled'

/**
 * Payment-fidelity signal, orthogonal to status. `null` is the normal flow.
 * `partial` pairs with `status='processing'`; `overpaid` pairs with
 * `status='completed'`.
 */
export type InvoiceExtraStatus = 'partial' | 'overpaid' | null

export type GatewayInvoice = {
  id: string
  merchantId: string
  /** v3 lifecycle. Older deployments may still emit legacy values
   * (`created` / `partial` / `detected` / `confirmed` / `overpaid`); the UI
   * coerces those to v3 for display. */
  status: InvoiceStatus | string
  extraStatus?: InvoiceExtraStatus
  chainId: number
  token: string
  receiveAddress: string
  addressIndex: number
  acceptedFamilies?: Family[]
  receiveAddresses?: Array<{
    family: Family
    address: string
    poolAddressId?: string
  }>
  /** Pinned USD-per-token rates for this invoice's window (USD-path only). */
  rates?: Record<string, string> | null
  /** Wall-clock when the pinned rate window expires (USD-path only). */
  rateWindowExpiresAt?: string | null
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
  /** Echo of the applied sort — present on gateways that support sorting. */
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export type PayoutListResponse = {
  payouts: GatewayPayout[]
  limit: number
  offset: number
  hasMore: boolean
  /** Echo of the applied sort — present on gateways that support sorting. */
  sortBy?: string
  sortDir?: 'asc' | 'desc'
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

/**
 * Payout row classification.
 * - `standard` — merchant-facing
 * - `gas_top_up` — internal sibling row inserted by the executor when the
 *   chosen source needs JIT gas top-up.
 * - `gas_burn` — synthetic debit row recording native fees a
 *   failed-but-broadcast tx burned (keeps `computeSpendable` in sync).
 * - `consolidation_sweep` — admin-triggered internal token transfer
 *   between two pool addresses, planned by `POST /admin/pool/consolidate`.
 *
 * All three internal kinds are filtered out of merchant-scoped list
 * endpoints; they only surface via admin queries (`GET /admin/payouts`,
 * `GET /admin/pool/consolidations/:id`).
 */
export type PayoutKind =
  | 'standard'
  | 'gas_top_up'
  | 'gas_burn'
  | 'consolidation_sweep'

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
  /**
   * UTXO-only. The original tx hash from the very first broadcast,
   * preserved across RBF replacements. `txHash` always reflects the latest
   * broadcast; `originalTxHash` is null until the first bump.
   */
  originalTxHash?: string | null
  /** UTXO-only. Number of times the payout has been re-broadcast via RBF. */
  feeBumpAttempts?: number | null
  /** UTXO-only. Epoch ms of the most recent RBF bump. */
  lastFeeBumpAt?: number | null
}

export type BumpFeeStrategy = 'shrink_change' | 'drop_change' | 'add_inputs'

export type BumpFeeResponse = {
  bump: {
    payoutId: string
    attemptNumber: number
    txHash: string
    priorTxHash: string
    priorFeeSats: string
    newFeeSats: string
    priorFeerateSatVb: string
    newFeerateSatVb: string
    vsize: number
    strategy: BumpFeeStrategy
    changeAddress: string | null
    changeValueSats: string | null
    dryRun: boolean
  }
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
  /**
   * Emitted alongside `no_source_address_has_sufficient_token_balance` when
   * the AGGREGATE balance across pool addresses IS sufficient but it's
   * fragmented. Account-model chains pick one sender per payout, so the
   * payout can't proceed until the balance is consolidated. UI hint: surface
   * a "Consolidate first" CTA that triggers `POST /admin/pool/consolidate`.
   */
  | 'single_source_insufficient_consolidate_required'
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

/* ── Pool consolidation (admin) ───────────────────────────── */

export type ConsolidationLeg = {
  payoutId: string
  sourceAddress: string
  /** Full balance being swept from the source, in the token's smallest unit. */
  amountRaw: string
}

export type ConsolidationSkipped = {
  sourceAddress: string
  amountRaw: string
  /** e.g. `NO_GAS_SPONSOR_AVAILABLE: ...` */
  reason: string
}

export type ConsolidationPlanResponse = {
  consolidationId: string
  chainId: number
  token: string
  targetAddress: string
  legs: ConsolidationLeg[]
  skipped: ConsolidationSkipped[]
}

export type ConsolidationLegStatus = {
  payoutId: string
  sourceAddress: string
  amountRaw: string
  status:
    | 'planned'
    | 'reserved'
    | 'topping-up'
    | 'submitted'
    | 'confirmed'
    | 'failed'
    | 'canceled'
  txHash: string | null
  topUpTxHash: string | null
  lastError: string | null
}

export type ConsolidationStatusResponse = {
  consolidationId: string
  legs: ConsolidationLegStatus[]
  summary: {
    total: number
    /** Legs in planned/reserved/topping-up/submitted. Poll until 0. */
    pendingOrInFlight: number
    confirmed: number
    failed: number
    canceled: number
  }
}

/* ── Auto-consolidation schedules (admin) ─────────────────── */

export type AutoConsolidationSchedule = {
  id: string
  chainId: number
  token: string
  targetAddress: string
  intervalHours: number
  /** Per-source dust floor in token's smallest unit (decimal string). */
  minSourceBalanceRaw: string
  maxSourcesPerRun: number
  enabled: boolean
  /** Epoch ms of the most recent cron firing. NULL until first run. */
  lastRunAt: number | null
  /** UUID of the consolidationId returned by the most recent firing. */
  lastConsolidationId: string | null
  /** How many legs the most recent firing planned. */
  lastLegCount: number | null
  /** How many sources the most recent firing skipped. */
  lastSkippedCount: number | null
  /**
   * Per-leg skip reasons from the most recent firing (capped at 50
   * server-side). NULL when the last firing had zero skips or the schedule
   * hasn't fired yet.
   */
  lastSkippedReasons?:
    | Array<{ sourceAddress: string; amountRaw: string; reason: string }>
    | null
  /** Epoch ms when the cron will next attempt to fire. */
  nextRunDue: number
  createdAt: number
  updatedAt: number
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
  /** Stable de-dup key, e.g. `invoice.confirmed:<id>:confirmed`. */
  idempotencyKey?: string
  /** Full event body — `{ event, timestamp, data: ... }`. */
  payload?: {
    event: string
    timestamp: string
    data: Record<string, unknown>
  }
  /** Destination URL the dispatcher POSTed to (per-resource override or merchant default). */
  targetUrl?: string
  /** Family of the originating resource. */
  resourceType?: 'invoice' | 'payout' | string
  /** UUID of the originating invoice / payout. */
  resourceId?: string
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

export type PoolAuditMismatch = {
  family: Family
  addressIndex: number
  storedAddress: string
  expectedAddress: string
}

export type PoolAuditFamilyReport = {
  family: Family
  scanned: number
  matches: number
  unscannedBeyondLimit: number
  mismatches: PoolAuditMismatch[]
}

export type PoolAuditResponse = {
  status: 'healthy' | 'mismatches-detected'
  scanLimit: number
  reports: PoolAuditFamilyReport[]
}

/**
 * How the registered fee wallet covers gas for payouts on this family.
 * - `none`     — family doesn't use a fee wallet today (EVM, pending AA).
 * - `top-up`   — fee wallet sits in the top-up sponsor pool; the source
 *                still burns native, but the top-up is funded by the
 *                fee wallet rather than another pool address (Tron).
 * - `delegate` — fee wallet pre-delegates resources out-of-band so payouts
 *                spend zero native (Tron, future Phase 4 integration).
 * - `co-sign`  — fee wallet signs every payout as the tx fee payer (Solana).
 */
export type FeeWalletCapability = 'none' | 'top-up' | 'delegate' | 'co-sign'
export type FeeWalletMode = 'hd-pool' | 'imported'

export type FeeWalletEntry = {
  family: Family
  capability: FeeWalletCapability
  configured: { mode: FeeWalletMode; address: string } | null
}

export type TronFeeWalletResources = {
  feeWallet: string
  resources: {
    energyAvailable: number
    energyLimit: number
    bandwidthAvailable: number
    bandwidthLimit: number
  }
}

export type TronResource = 'ENERGY' | 'BANDWIDTH'

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
        tokens: Array<{
          token: string
          decimals?: number
          amountRaw?: string
          amountDecimal: string
          usd: string
        }>
      }>
      errors: number
    }>
  }>
}

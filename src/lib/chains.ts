import type { Family } from './types'

export const CHAINS: Record<
  number,
  { name: string; short: string; family: Family; color: string }
> = {
  1: { name: 'Ethereum', short: 'ETH', family: 'evm', color: 'var(--chain-evm)' },
  56: { name: 'BNB Chain', short: 'BSC', family: 'evm', color: 'oklch(0.74 0.16 85)' },
  137: {
    name: 'Polygon',
    short: 'POLY',
    family: 'evm',
    color: 'oklch(0.62 0.2 295)',
  },
  8453: {
    name: 'Base',
    short: 'BASE',
    family: 'evm',
    color: 'oklch(0.62 0.17 235)',
  },
  728: { name: 'Tron', short: 'TRX', family: 'tron', color: 'var(--chain-tron)' },
  900: {
    name: 'Solana',
    short: 'SOL',
    family: 'solana',
    color: 'var(--chain-solana)',
  },
  // UTXO chains — native segwit / taproot. Decimals = 8 (sats / litoshi).
  800: { name: 'Bitcoin', short: 'BTC', family: 'utxo', color: 'oklch(0.7 0.18 55)' },
  801: { name: 'Litecoin', short: 'LTC', family: 'utxo', color: 'oklch(0.74 0.02 250)' },
  802: {
    name: 'Bitcoin testnet',
    short: 'tBTC',
    family: 'utxo',
    color: 'oklch(0.7 0.1 55)',
  },
  803: {
    name: 'Litecoin testnet',
    short: 'tLTC',
    family: 'utxo',
    color: 'oklch(0.7 0.02 250)',
  },
  // Monero — privacy chain, 12-decimal piconero native unit.
  1000: { name: 'Monero', short: 'XMR', family: 'monero', color: 'oklch(0.65 0.22 35)' },
}

export const FAMILY_COLOR: Record<Family, string> = {
  evm: 'var(--chain-evm)',
  tron: 'var(--chain-tron)',
  solana: 'var(--chain-solana)',
  utxo: 'oklch(0.7 0.18 55)',
  monero: 'oklch(0.65 0.22 35)',
}

export function chainInfo(chainId: number) {
  return (
    CHAINS[chainId] || {
      name: `Chain ${chainId}`,
      short: String(chainId),
      family: 'evm' as Family,
      color: 'var(--fg-2)',
    }
  )
}

export const LOW_GAS_THRESHOLD: Record<string, number> = {
  ETH: 0.01,
  BNB: 0.05,
  POL: 10,
  MATIC: 10,
  AVAX: 0.5,
  TRX: 100,
  SOL: 0.1,
  // UTXO: there's no separate gas — these are "running low for a payout"
  // thresholds expressed in the asset itself (whole BTC / LTC).
  BTC: 0.001,
  LTC: 0.05,
  // Monero — same idea, native asset is also the fee asset.
  XMR: 0.05,
}

const FAMILY_FALLBACK_THRESHOLD: Record<Family, number> = {
  evm: 0.01,
  tron: 100,
  solana: 0.1,
  utxo: 0.001,
  monero: 0.05,
}

export function gasThreshold(
  symbol: string | null | undefined,
  family: Family,
): number {
  if (symbol) {
    const s = symbol.toUpperCase()
    if (s in LOW_GAS_THRESHOLD) return LOW_GAS_THRESHOLD[s]
  }
  return FAMILY_FALLBACK_THRESHOLD[family]
}

export function nativeBalanceDecimal(
  raw: string | null | undefined,
  decimals: number | null | undefined,
): number | null {
  if (raw == null || decimals == null) return null
  const n = Number(raw) / 10 ** decimals
  return Number.isFinite(n) ? n : null
}

export function isLowGas(
  family: Family,
  balance: number | null,
  symbol?: string | null,
): boolean {
  if (balance == null) return false
  return balance < gasThreshold(symbol, family)
}

/**
 * Native gas asset (symbol + smallest-unit decimals) for a given chainId.
 * Used to render `feeEstimateNative` / `feeQuotedNative` / `topUpAmountRaw`,
 * which the gateway returns as raw smallest units (wei / sun / lamports).
 */
const NATIVE_BY_CHAIN: Record<number, { symbol: string; decimals: number }> = {
  1: { symbol: 'ETH', decimals: 18 },
  56: { symbol: 'BNB', decimals: 18 },
  137: { symbol: 'POL', decimals: 18 },
  8453: { symbol: 'ETH', decimals: 18 },
  43114: { symbol: 'AVAX', decimals: 18 },
  728: { symbol: 'TRX', decimals: 6 },
  900: { symbol: 'SOL', decimals: 9 },
  // UTXO chains — 8 decimals (sat / litoshi).
  800: { symbol: 'BTC', decimals: 8 },
  801: { symbol: 'LTC', decimals: 8 },
  802: { symbol: 'BTC', decimals: 8 },
  803: { symbol: 'LTC', decimals: 8 },
  // Monero — 12 decimals (piconero).
  1000: { symbol: 'XMR', decimals: 12 },
}

const FAMILY_NATIVE_FALLBACK: Record<Family, { symbol: string; decimals: number }> = {
  evm: { symbol: 'ETH', decimals: 18 },
  tron: { symbol: 'TRX', decimals: 6 },
  solana: { symbol: 'SOL', decimals: 9 },
  utxo: { symbol: 'BTC', decimals: 8 },
  monero: { symbol: 'XMR', decimals: 12 },
}

export function nativeMeta(chainId: number): { symbol: string; decimals: number } {
  const exact = NATIVE_BY_CHAIN[chainId]
  if (exact) return exact
  return FAMILY_NATIVE_FALLBACK[chainInfo(chainId).family]
}

/* ── Block explorers ──────────────────────────────────────── */

/**
 * Per-chain block-explorer URL builders. Only chains with a well-known public
 * explorer are listed — unknown chains (and privacy chains like Monero, where
 * address lookups don't exist) return `null`, and callers fall back to a
 * copy-only address. Keep these conservative: a wrong link is worse than none.
 */
type ExplorerFns = { tx: (h: string) => string; address: (a: string) => string }

const EXPLORERS: Record<number, ExplorerFns> = {
  1: { tx: (h) => `https://etherscan.io/tx/${h}`, address: (a) => `https://etherscan.io/address/${a}` },
  56: { tx: (h) => `https://bscscan.com/tx/${h}`, address: (a) => `https://bscscan.com/address/${a}` },
  137: { tx: (h) => `https://polygonscan.com/tx/${h}`, address: (a) => `https://polygonscan.com/address/${a}` },
  8453: { tx: (h) => `https://basescan.org/tx/${h}`, address: (a) => `https://basescan.org/address/${a}` },
  43114: { tx: (h) => `https://snowtrace.io/tx/${h}`, address: (a) => `https://snowtrace.io/address/${a}` },
  728: {
    tx: (h) => `https://tronscan.org/#/transaction/${h}`,
    address: (a) => `https://tronscan.org/#/address/${a}`,
  },
  900: { tx: (h) => `https://solscan.io/tx/${h}`, address: (a) => `https://solscan.io/account/${a}` },
  800: { tx: (h) => `https://mempool.space/tx/${h}`, address: (a) => `https://mempool.space/address/${a}` },
  801: { tx: (h) => `https://litecoinspace.org/tx/${h}`, address: (a) => `https://litecoinspace.org/address/${a}` },
  802: {
    tx: (h) => `https://mempool.space/testnet/tx/${h}`,
    address: (a) => `https://mempool.space/testnet/address/${a}`,
  },
  803: {
    tx: (h) => `https://litecoinspace.org/testnet/tx/${h}`,
    address: (a) => `https://litecoinspace.org/testnet/address/${a}`,
  },
}

export function explorerTxUrl(chainId: number, hash: string): string | null {
  const e = EXPLORERS[chainId]
  return e ? e.tx(hash) : null
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const e = EXPLORERS[chainId]
  return e ? e.address(address) : null
}

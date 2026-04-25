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
}

export const FAMILY_COLOR: Record<Family, string> = {
  evm: 'var(--chain-evm)',
  tron: 'var(--chain-tron)',
  solana: 'var(--chain-solana)',
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
}

const FAMILY_FALLBACK_THRESHOLD: Record<Family, number> = {
  evm: 0.01,
  tron: 100,
  solana: 0.1,
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
}

const FAMILY_NATIVE_FALLBACK: Record<Family, { symbol: string; decimals: number }> = {
  evm: { symbol: 'ETH', decimals: 18 },
  tron: { symbol: 'TRX', decimals: 6 },
  solana: { symbol: 'SOL', decimals: 9 },
}

export function nativeMeta(chainId: number): { symbol: string; decimals: number } {
  const exact = NATIVE_BY_CHAIN[chainId]
  if (exact) return exact
  return FAMILY_NATIVE_FALLBACK[chainInfo(chainId).family]
}

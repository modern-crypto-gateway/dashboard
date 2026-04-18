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

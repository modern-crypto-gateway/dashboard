/* eslint-disable react-refresh/only-export-components -- icon maps live with the components */
import * as React from 'react'
import {
  NetworkArbitrumOne,
  NetworkAvalanche,
  NetworkBase,
  NetworkBinanceSmartChain,
  NetworkBitcoin,
  NetworkEthereum,
  NetworkLitecoin,
  NetworkOptimism,
  NetworkPolygon,
  NetworkSolana,
  NetworkTron,
  TokenARB,
  TokenAVAX,
  TokenBNB,
  TokenBTC,
  TokenDAI,
  TokenETH,
  TokenFDUSD,
  TokenLTC,
  TokenMATIC,
  TokenOP,
  TokenPOL,
  TokenPYUSD,
  TokenSOL,
  TokenTRX,
  TokenUSDC,
  TokenUSDT,
  TokenXMR,
} from '@web3icons/react'

import { chainInfo } from '@/lib/chains'
import type { Family } from '@/lib/types'
import { cn } from '@/lib/utils'

type Svg = React.ComponentType<{ size?: number | string; variant?: 'branded' | 'mono' | 'background'; className?: string }>

/** Network logos by chain id (mainnets + the testnets the UI knows). */
const CHAIN_ICON: Record<number, Svg> = {
  1: NetworkEthereum,
  11155111: NetworkEthereum,
  8453: NetworkBase,
  84532: NetworkBase,
  137: NetworkPolygon,
  80002: NetworkPolygon,
  56: NetworkBinanceSmartChain,
  97: NetworkBinanceSmartChain,
  42161: NetworkArbitrumOne,
  10: NetworkOptimism,
  43114: NetworkAvalanche,
  728: NetworkTron,
  900: NetworkSolana,
  800: NetworkBitcoin,
  801: NetworkLitecoin,
  802: NetworkBitcoin,
  803: NetworkLitecoin,
  1000: TokenXMR,
}

const FAMILY_ICON: Record<Family, Svg> = {
  evm: NetworkEthereum,
  tron: NetworkTron,
  solana: NetworkSolana,
  utxo: NetworkBitcoin,
  monero: TokenXMR,
}

const TOKEN_ICON: Record<string, Svg> = {
  USDT: TokenUSDT,
  USDC: TokenUSDC,
  ETH: TokenETH,
  WETH: TokenETH,
  TRX: TokenTRX,
  SOL: TokenSOL,
  BTC: TokenBTC,
  LTC: TokenLTC,
  XMR: TokenXMR,
  BNB: TokenBNB,
  POL: TokenPOL,
  MATIC: TokenMATIC,
  DAI: TokenDAI,
  PYUSD: TokenPYUSD,
  FDUSD: TokenFDUSD,
  ARB: TokenARB,
  OP: TokenOP,
  AVAX: TokenAVAX,
}

function Fallback({ text, color, size }: { text: string; color?: string; size: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.42), background: color ?? 'var(--fg-3)' }}
    >
      {(text || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

function testnetOf(chainId: number) {
  return /testnet|sepolia|amoy|nile|devnet/i.test(chainInfo(chainId).name)
}

/** Network logo for a chain id; letter disc for unknown chains. */
export function ChainIcon({
  chainId,
  size = 18,
  className,
}: {
  chainId: number
  size?: number
  className?: string
}) {
  const Icon = CHAIN_ICON[chainId]
  const info = chainInfo(chainId)
  return (
    <span
      title={info.name}
      className={cn('inline-grid shrink-0 place-items-center', testnetOf(chainId) && 'opacity-60 grayscale', className)}
      style={{ width: size, height: size }}
    >
      {Icon ? (
        <Icon size={size} variant="branded" className="rounded-full" />
      ) : (
        <Fallback text={info.name} color={info.color} size={size} />
      )}
    </span>
  )
}

export function FamilyIcon({ family, size = 18 }: { family: Family; size?: number }) {
  const Icon = FAMILY_ICON[family]
  return (
    <span title={family.toUpperCase()} className="inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <Icon size={size} variant="branded" className="rounded-full" />
    </span>
  )
}

/** Token logo by symbol; letter disc for unknown tokens (and "?" when the
 * symbol is missing, so bad data shows a placeholder instead of crashing). */
export function TokenIcon({
  symbol: rawSymbol,
  size = 18,
  className,
}: {
  symbol: string | null | undefined
  size?: number
  className?: string
}) {
  const symbol = typeof rawSymbol === 'string' ? rawSymbol : ''
  const Icon = symbol ? TOKEN_ICON[symbol.toUpperCase()] : undefined
  return (
    <span title={symbol} className={cn('inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      {Icon ? (
        <Icon size={size} variant="branded" className="rounded-full" />
      ) : (
        <Fallback text={symbol} size={size} />
      )}
    </span>
  )
}

/** Token logo with a small network badge in the corner (e.g. USDT on Tron). */
export function TokenOnChain({
  symbol,
  chainId,
  size = 32,
}: {
  symbol: string | null | undefined
  chainId: number
  size?: number
}) {
  const badge = Math.round(size * 0.5)
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <TokenIcon symbol={symbol} size={size} />
      <span
        className="absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-card ring-2 ring-[var(--bg-1)]"
        style={{ width: badge, height: badge }}
      >
        <ChainIcon chainId={chainId} size={badge} />
      </span>
    </span>
  )
}

/** Overlapping network logos for multi-family invoices (EVM · Tron · Solana). */
export function FamilyStack({ families, size = 20 }: { families: Family[]; size?: number }) {
  return (
    <span className="inline-flex items-center" title={families.map((f) => f.toUpperCase()).join(' · ')}>
      {families.map((f, i) => (
        <span
          key={f}
          className="grid place-items-center rounded-full bg-card ring-2 ring-[var(--bg-1)]"
          style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: families.length - i }}
        >
          <FamilyIcon family={f} size={size} />
        </span>
      ))}
    </span>
  )
}

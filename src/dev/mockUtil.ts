/**
 * Deterministic fake-data helpers for the dev mock API. Seeded so the same
 * rows (ids, addresses, hashes) come back on every reload — design review
 * screenshots stay comparable. Dev-only; never imported by production code.
 */

/** mulberry32 — tiny seeded PRNG, good enough for fixtures. */
export function makeRng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]
  const chance = (p: number) => next() < p
  const chars = (alphabet: string, n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(next() * alphabet.length)]
    return s
  }
  return { next, int, pick, chance, chars }
}

export type Rng = ReturnType<typeof makeRng>

const HEX = '0123456789abcdef'
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** EIP-55-ish mixed case (not a real checksum — just looks right). */
function mixCase(r: Rng, hex: string) {
  return hex
    .split('')
    .map((c) => (/[a-f]/.test(c) && r.chance(0.5) ? c.toUpperCase() : c))
    .join('')
}

export const gen = {
  uuid(r: Rng) {
    const h = r.chars(HEX, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[r.int(0, 3)]}${h.slice(17, 20)}-${h.slice(20, 32)}`
  },
  evmAddress: (r: Rng) => '0x' + mixCase(r, r.chars(HEX, 40)),
  evmTx: (r: Rng) => '0x' + r.chars(HEX, 64),
  tronAddress: (r: Rng) => 'T' + r.chars(B58, 33),
  tronTx: (r: Rng) => r.chars(HEX, 64),
  solAddress: (r: Rng) => r.chars(B58, r.int(43, 44)),
  solTx: (r: Rng) => r.chars(B58, r.int(86, 88)),
  btcAddress: (r: Rng) => 'bc1q' + r.chars(BECH32, 38),
  ltcAddress: (r: Rng) => 'ltc1q' + r.chars(BECH32, 38),
  utxoTx: (r: Rng) => r.chars(HEX, 64),
  xmrAddress: (r: Rng) => '8' + r.chars(B58, 94),
  xmrTx: (r: Rng) => r.chars(HEX, 64),
  hex: (r: Rng, n: number) => r.chars(HEX, n),
  b58: (r: Rng, n: number) => r.chars(B58, n),
  alnum: (r: Rng, n: number) =>
    r.chars('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', n),
}

/** Decimal string → raw smallest-unit integer string (truncates extra places). */
export function toRaw(amount: string | number, decimals: number): string {
  const s = typeof amount === 'number' ? amount.toFixed(Math.min(decimals, 12)) : amount
  const neg = s.startsWith('-')
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  const out = (i + frac).replace(/^0+(?=\d)/, '') || '0'
  return neg && out !== '0' ? '-' + out : out
}

/** Raw smallest-unit string → decimal string (trailing zeros trimmed). */
export function fromRaw(raw: string, decimals: number): string {
  const neg = raw.startsWith('-')
  const digits = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0')
  const i = digits.slice(0, digits.length - decimals)
  const f = decimals ? digits.slice(digits.length - decimals).replace(/0+$/, '') : ''
  return (neg ? '-' : '') + (f ? `${i}.${f}` : i)
}

export const usd = (n: number) => n.toFixed(2)

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export const iso = (ms: number) => new Date(ms).toISOString()

/** Epoch ms → unix seconds (the dashboard worker stores merchants/sessions in seconds). */
export const sec = (ms: number) => Math.floor(ms / 1000)

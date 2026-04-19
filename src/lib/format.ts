export const fmtUsd = (v: string | number | null | undefined): string => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0)
  if (!isFinite(n)) return '$0.00'
  if (Math.abs(n) >= 1000)
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return '$' + n.toFixed(2)
}

export const fmtNum = (v: string | number, d = 4): string => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '0'
  return n.toFixed(d).replace(/\.?0+$/, '')
}

export const truncateAddr = (s: string, a = 6, b = 4) =>
  s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s

/**
 * Format a raw integer (smallest-unit string) as a human decimal string using
 * the given token decimals. Trims trailing zeros. Safe for arbitrary size —
 * uses string math, not Number, to avoid precision loss.
 */
export function formatUnits(
  raw: string | null | undefined,
  decimals: number | null | undefined,
): string {
  if (raw == null || decimals == null) return '—'
  if (!/^\d+$/.test(raw)) return raw
  const d = Math.max(0, decimals | 0)
  if (d === 0) return raw
  const padded = raw.padStart(d + 1, '0')
  const intPart = padded.slice(0, -d).replace(/^0+(?=\d)/, '')
  const fracPart = padded.slice(-d).replace(/0+$/, '')
  return fracPart ? `${intPart}.${fracPart}` : intPart
}

/** Count decimal places in a human decimal string. Returns 0 for integers. */
export function decimalPlaces(s: string): number {
  const dot = s.indexOf('.')
  if (dot < 0) return 0
  return s.length - dot - 1
}

/** Compact relative time. Input is unix seconds. */
export const fmtRel = (unixSec: number): string => {
  if (!unixSec) return '—'
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 30) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`
  if (diff < 2_592_000) return `${Math.floor(diff / 604_800)}w ago`
  return new Date(unixSec * 1000).toLocaleDateString()
}

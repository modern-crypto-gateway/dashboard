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

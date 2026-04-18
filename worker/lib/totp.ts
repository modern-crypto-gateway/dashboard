/**
 * RFC 6238 TOTP (HOTP over 30s step) with base32 secrets.
 *
 *   generateTotpSecret()  → { secretB32, otpauthUrl() }
 *   verifyTotp(code, secretB32) → boolean (±1 step window)
 */

import { hmacSha1, randomBytes } from './crypto'

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f]
  return out
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '')
  if (!/^[A-Z2-7]+$/.test(clean)) {
    throw new Error('Invalid base32 secret')
  }
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8))
  let bits = 0
  let value = 0
  let idx = 0
  for (let i = 0; i < clean.length; i++) {
    const v = B32_ALPHABET.indexOf(clean[i])
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  return out
}

export function generateTotpSecretB32(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

export function otpauthUrl(opts: {
  secretB32: string
  label: string // "Gateway Dashboard:alice"
  issuer: string
  digits?: number
  period?: number
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
}): string {
  const digits = opts.digits ?? 6
  const period = opts.period ?? 30
  const algorithm = opts.algorithm ?? 'SHA1'
  const params = new URLSearchParams({
    secret: opts.secretB32,
    issuer: opts.issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${encodeURIComponent(opts.label)}?${params.toString()}`
}

async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  // high 32 bits are 0 for 2^53-bounded ints
  view.setUint32(0, Math.floor(counter / 0x100000000))
  view.setUint32(4, counter >>> 0)
  const sig = await hmacSha1(secret, new Uint8Array(buf))
  const offset = sig[sig.length - 1] & 0x0f
  const code =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff)
  const mod = 10 ** digits
  return String(code % mod).padStart(digits, '0')
}

export async function verifyTotp(
  code: string,
  secretB32: string,
  opts: { window?: number; step?: number; digits?: number } = {},
): Promise<boolean> {
  const step = opts.step ?? 30
  const window = opts.window ?? 1
  const digits = opts.digits ?? 6
  const now = Math.floor(Date.now() / 1000 / step)
  const secret = base32Decode(secretB32)
  const cleanCode = code.replace(/\s+/g, '')
  if (cleanCode.length !== digits || !/^\d+$/.test(cleanCode)) return false
  for (let i = -window; i <= window; i++) {
    const expected = await hotp(secret, now + i, digits)
    // constant-time-ish per character compare
    let diff = 0
    for (let j = 0; j < digits; j++) diff |= expected.charCodeAt(j) ^ cleanCode.charCodeAt(j)
    if (diff === 0) return true
  }
  return false
}

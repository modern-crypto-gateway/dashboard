/**
 * WebCrypto-based primitives:
 *   - PBKDF2-SHA256 password hashing (derivesBits → salted + encoded)
 *   - AES-GCM sealing/unsealing for secrets at rest (uses DASHBOARD_KEK)
 *   - Constant-time buffer compare
 *   - Random bytes / tokens
 *
 * Wire-format for hashed passwords:
 *   pbkdf2$sha256$<iter>$<b64 salt>$<b64 hash>
 *
 * Wire-format for sealed secrets (AES-GCM 256):
 *   aesgcm1$<b64 iv 12B>$<b64 ciphertext+tag>
 */

const ENC = new TextEncoder()

/* ── base64 helpers ─────────────────────────────────────────── */

export function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function b64decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ── random ─────────────────────────────────────────────────── */

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function randomToken(bytes = 32): string {
  // URL-safe base64 without padding
  return b64encode(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomHex(bytes = 16): string {
  const b = randomBytes(bytes)
  let hex = ''
  for (let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0')
  return hex
}

/**
 * Mint a single-use recovery code with ~80 bits of entropy.
 * Format: `xxxx-xxxx-xxxx` (12 hex chars = 48 bits from `randomBytes`,
 * actually 10 bytes = 80 bits, formatted as 5-5-5-5).
 *
 * Brute-forcing given a KV dump:
 *   2^80 hashes × ~1µs each (SHA-256 on commodity hw) = ~38M years per code.
 */
export function mintRecoveryCode(): string {
  // 10 random bytes → 20 hex chars → group as 5-5-5-5 for readability.
  const b = randomBytes(10)
  let hex = ''
  for (let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0')
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`
}

/* ── constant-time compare ──────────────────────────────────── */

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(ENC.encode(a), ENC.encode(b))
}

/* ── SHA-256 hex ────────────────────────────────────────────── */

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const buf = typeof input === 'string' ? ENC.encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/* ── PBKDF2 password hashing ────────────────────────────────── */

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_SALT_BYTES = 16
const PBKDF2_KEY_BYTES = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PBKDF2_SALT_BYTES)
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false
  const iter = parseInt(parts[2], 10)
  if (!Number.isFinite(iter) || iter < 10_000 || iter > 2_000_000) return false
  const salt = b64decode(parts[3])
  const expected = b64decode(parts[4])
  const actual = await pbkdf2(password, salt, iter, expected.length)
  return timingSafeEqual(new Uint8Array(actual), expected)
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  keyLen: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENC.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    keyLen * 8,
  )
}

/* ── AES-GCM sealing (KEK-wrapped secrets in KV) ─────────────── */

async function importKek(kekB64: string): Promise<CryptoKey> {
  const keyBytes = b64decode(kekB64)
  if (keyBytes.length !== 32) {
    throw new Error(`DASHBOARD_KEK must decode to 32 bytes (got ${keyBytes.length}). Generate with: openssl rand -base64 32`)
  }
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function seal(plaintext: string, kekB64: string): Promise<string> {
  const key = await importKek(kekB64)
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    ENC.encode(plaintext),
  )
  return `aesgcm1$${b64encode(iv)}$${b64encode(ct)}`
}

export async function unseal(blob: string, kekB64: string): Promise<string> {
  const parts = blob.split('$')
  if (parts.length !== 3 || parts[0] !== 'aesgcm1') {
    throw new Error('unseal: unsupported blob format')
  }
  const key = await importKek(kekB64)
  const iv = b64decode(parts[1])
  const ct = b64decode(parts[2])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

/* ── HMAC-SHA1 (for TOTP) ────────────────────────────────────── */

export async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', ck, data as unknown as ArrayBuffer)
  return new Uint8Array(sig)
}

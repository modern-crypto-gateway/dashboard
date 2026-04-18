/**
 * Security response headers applied to every response the worker emits.
 *
 * For `/api/*` responses we only need a narrow set (no-store + frame-denial +
 * referrer-policy). For the SPA shell we never reach here — CF Assets serves
 * those — so the HTML response uses <meta> fallbacks in `index.html`.
 *
 * Rationale (each flag):
 *
 *   Strict-Transport-Security (1 year, include subdomains, preload)
 *     Lock the domain to HTTPS. workers.dev is already HTTPS-only, custom
 *     domains may not be — belt-and-braces.
 *   X-Content-Type-Options: nosniff
 *     Stop browser MIME sniffing on our JSON responses.
 *   X-Frame-Options: DENY
 *     No embedding; combined with CSP frame-ancestors in the SPA.
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     Don't leak session-bearing URLs to third parties.
 *   Permissions-Policy (all off)
 *     No camera / mic / geolocation / payment access needed.
 *   Cross-Origin-Opener-Policy: same-origin
 *     Isolate browsing context.
 *   Cross-Origin-Resource-Policy: same-origin
 *     Disallow cross-origin embedding of our JSON.
 */

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

export function applySecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v)
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

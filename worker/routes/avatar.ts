import type { Bindings } from '../lib/env'

const UPSTREAM = 'https://api.dicebear.com/9.x/lorelei-neutral/svg'
const MAX_SEED = 128
const MAX_BG = 128

export async function getAvatar(req: Request, _env: Bindings): Promise<Response> {
  const url = new URL(req.url)
  const seed = (url.searchParams.get('seed') || 'user').slice(0, MAX_SEED)
  const bg = (url.searchParams.get('bg') || '').slice(0, MAX_BG)

  const upstream = new URL(UPSTREAM)
  upstream.searchParams.set('seed', seed)
  if (bg && /^[a-f0-9,]+$/i.test(bg)) {
    upstream.searchParams.set('backgroundColor', bg)
  }
  upstream.searchParams.set('radius', '50')

  const upstreamResp = await fetch(upstream.toString(), {
    headers: { Accept: 'image/svg+xml' },
  })

  if (!upstreamResp.ok) {
    return new Response('avatar_upstream_error', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const body = await upstreamResp.arrayBuffer()
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

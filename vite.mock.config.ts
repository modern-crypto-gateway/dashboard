/**
 * Dev-only preview config: the SPA with a fake in-browser API, no Worker.
 *
 *   npm run dev:mock   →   http://localhost:5199/
 *
 * Same plugins / alias as `vite.config.ts` minus `@cloudflare/vite-plugin`
 * (which needs wrangler.jsonc + real secrets). `src/main.tsx` installs the
 * fetch mock from `src/dev/mock.ts` only when `import.meta.env.DEV` is true
 * AND `VITE_MOCK === '1'` — this config is the only place that sets the flag.
 *
 * Switches (sticky per tab via sessionStorage, comma-combinable):
 *   ?mock=empty | nomerchants | error | loggedout | setup | default
 */
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `<img src="/api/avatar?...">` is loaded by the browser directly, not via
 * `fetch`, so the in-page mock can't answer it. Serve a tiny SVG from the dev
 * server instead (otherwise the SPA fallback returns index.html → broken img).
 */
function mockAvatar(): Plugin {
  return {
    name: 'mock-avatar',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/avatar', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const seed = (url.searchParams.get('seed') || 'op').slice(0, 2).toUpperCase()
        const hex = (url.searchParams.get('bg') || '')
          .split(',')
          .map((c) => c.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))
          .filter((c) => c.length === 6)
        const a = hex[0] ?? 'd0e1ff'
        const b = hex[1] ?? a
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="#${a}"/><stop offset="1" stop-color="#${b}"/>` +
          `</linearGradient></defs><rect width="64" height="64" fill="url(#g)"/>` +
          `<text x="32" y="40" font-family="system-ui,sans-serif" font-size="22" ` +
          `font-weight="600" text-anchor="middle" fill="#1f2a44">${seed.replace(/[^A-Z0-9]/g, '')}</text></svg>`
        res.setHeader('Content-Type', 'image/svg+xml')
        res.setHeader('Cache-Control', 'no-store')
        res.end(svg)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mockAvatar()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_MOCK': JSON.stringify('1'),
  },
  server: {
    port: 5199,
    strictPort: true,
  },
})

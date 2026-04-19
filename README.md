# Gateway Dashboard

An operator console for the [crypto-gateway](./openapi.yaml) — built to run on
Cloudflare Workers (SPA + Worker API) with **Cloudflare KV as the only backing
store** for dashboard-side state (config, users, sessions, rate-limit counters,
CSRF tokens, merchant API keys, tracked invoices / payouts).

## What ships

### Operator surface — every OpenAPI endpoint reachable from the UI
- **Onboarding** — base URL → admin key → super-admin → TOTP 2FA → 10 recovery codes (one-shot)
- **Login** — password + TOTP (or single-use recovery code)
- **Dashboard home** — KPIs, balances, pool stats, runtime, live-wired to `/admin/pool/stats`, `/admin/balances`, `/health`
- **Activity** — live merge of pending/delivered/dead webhook deliveries
- **Balances** — DB vs live-RPC toggle, stacked-bar summary, per-chain/per-address drilldown
- **Address pool** — availability colour-coded, seed dialog
- **Invoices** — list (KV-tracked), create (USD/raw/fiat modes), lookup-by-id, detail + force-expire, per-tx USD axis
- **Payouts** — list, plan, lookup, detail (tx hash, fee estimate, last error)
- **Orphan txs** — list, attribute-to-invoice, dismiss-with-reason
- **Webhooks** — status tabs, row-level replay, delivery detail
- **Merchants** — create (via gateway) or import, edit (name + webhook + tolerance + cooldown via gateway PATCH), delete
- **Audit address** — on-chain diff + result table
- **Fee wallets** — register HD-derived wallet
- **Alchemy webhooks** — bootstrap + manual signing-key registration
- **Settings** — gateway base URL, admin-key rotation, password change, **2FA rotation**, **recovery-code regeneration**, **active-session list + per-session revoke**

### Security
- PBKDF2-SHA256 (210k iter) password hashing; AES-GCM sealing of admin key + TOTP secret + merchant API keys
- Sessions: HttpOnly `gw_sess` cookie carrying the raw token; KV keyed by `sha256(token)`; per-user session index for list/revoke
- CSRF: `gw_csrf` double-submit token, verified on every non-GET mutation
- Two-layer rate limiting: **Cloudflare native `ratelimits` bindings** (60s windows — blanket API 300/m, gw proxy 120/m, setup 5/m, session-revoke 30/m) + **KV sliding-window** for longer windows (login 10/5m, TOTP 20/5m, password change 5/10m, recovery regen 3/hr)
- ⌘K command palette; responsive layout; dark / light / system theme + blue/violet/mint accent

### Stack
- React 19 + Vite + TypeScript
- Tailwind CSS **v4** + shadcn/ui primitives (inlined)
- lucide-react, @tanstack/react-query, react-router-dom, sonner, cmdk, qrcode
- Cloudflare Workers + KV + CF Assets SPA fallback
- WebCrypto everywhere (PBKDF2, AES-GCM, HMAC-SHA1)

### Build output
- Worker: **60 KB / 14 KB gzip**
- SPA entry bundle: **325 KB / 99 KB gzip** after route-level code splitting
- Per-screen chunks: 6–18 KB gzip (lazy-loaded on first visit)

## Getting started

### Prerequisites

- **Node.js 20+** and npm.
- A **running gateway** reachable from the Worker (either a deployed URL or
  `http://localhost:8787` alongside `wrangler dev`) — and its `ADMIN_KEY`.
  The dashboard is an operator console on top of the gateway; without one it
  has nothing to proxy to.
- A **Cloudflare account** if you intend to deploy (free tier is fine).

### Local dev

```sh
npm install
cp .dev.vars.example .dev.vars
# generate a DASHBOARD_KEK (see the next block) and paste it into .dev.vars
npm run dev   # ready at http://localhost:5173
```

Vite hosts the SPA, `@cloudflare/vite-plugin` runs the Worker alongside it, and
the SPA calls the Worker on the same origin under `/api/*`. `.dev.vars` is
ignored by git — the only required entry is `DASHBOARD_KEK`.

#### Generating `DASHBOARD_KEK`

32 random bytes, base64-encoded. Any of these produce an equivalent value —
pick the one for your shell:

```sh
# Cross-platform (Node is already installed for this repo):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Linux / macOS / WSL / Git Bash:
openssl rand -base64 32

# Windows PowerShell:
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Windows CMD (shells out to PowerShell):
powershell -NoProfile -Command "[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"
```

Paste the output as `DASHBOARD_KEK="…"` in `.dev.vars`.

Open the URL — you'll land on the onboarding wizard because KV is empty. After
setup you auto-login into the dashboard.

### Connecting to your gateway

During onboarding you'll be asked for:

- **Gateway base URL** — e.g. `http://localhost:8787` for a local gateway, or
  `https://gateway.example.com` in prod. The Worker proxies `/api/gw/*` and
  `/api/mg/*` here with the sealed admin key injected.
- **Gateway `ADMIN_KEY`** — shown once by the gateway when it was provisioned.
  Sealed with `DASHBOARD_KEK` before landing in KV; never leaves the Worker
  from then on.

If the gateway later moves or rotates its admin key, update both from
**Settings** — the dashboard does not require re-onboarding.

## Deploying to Cloudflare

1. **Create the KV namespace** and paste the returned id into `wrangler.jsonc`
   under `kv_namespaces[0].id`:

   ```sh
   npx wrangler login
   npx wrangler kv namespace create DASHBOARD_KV
   ```

2. **Upload the production KEK** (separate from the dev value in `.dev.vars`).
   Pipe the output from the generator in your shell straight into
   `wrangler secret put`:

   ```sh
   # Cross-platform (works on Windows PowerShell, CMD, bash, zsh):
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put DASHBOARD_KEK
   ```

   ```sh
   # Linux / macOS / WSL / Git Bash:
   openssl rand -base64 32 | npx wrangler secret put DASHBOARD_KEK
   ```

   ```powershell
   # Windows PowerShell (no openssl):
   [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) | npx wrangler secret put DASHBOARD_KEK
   ```

   > Rotating this invalidates every sealed blob — only do it alongside a
   > dashboard re-onboarding.

3. **Regenerate types** after editing `wrangler.jsonc`:

   ```sh
   npx wrangler types
   ```

4. **Deploy:**

   ```sh
   npm run deploy
   ```

## Onboarding flow

1. **Point at your gateway** — base URL the dashboard proxies to.
2. **Verify admin key** — `ADMIN_KEY` from your gateway. AES-GCM-sealed before landing in KV.
3. **Create your account** — username 3–32 chars, password ≥12 chars (PBKDF2-SHA256).
4. **Bind 2FA** — scan the QR in Google Authenticator / Authy / 1Password / any TOTP app.
5. **Save recovery codes** — ten single-use codes, shown **once**. Download or copy; the dashboard stores only SHA-256 hashes.

From that point `/` is the dashboard, `/login` is the login screen, and
`/setup` 404s (the worker rejects every setup endpoint once `cfg:setup_complete = 1`).

## After onboarding — operational bootstrap

Dashboard setup is done, but the *gateway* still needs its per-chain plumbing
before invoices confirm and payouts broadcast. Work through the checklist
below in order — the UI surfaces a warn-tinted banner on the Dashboard
whenever any of these are incomplete.

1. **Chains → bootstrap readiness**. Open **Chains**. Every chain returned by
   `GET /admin/chains` is listed with three flags (`wired` / `webhook` / `fee
   wallet`) and a `ready` or `incomplete` badge. The stats strip at the top
   tells you how many chains are bootstrap-ready at a glance.
2. **Register Alchemy webhooks**. For chains where `webhooksSupported &&
   !webhooks`, click **Bootstrap webhooks** and pick the chains in the dialog
   (gaps are pre-selected). Alchemy signing keys are shown once on success —
   copy them if you want to verify signatures off-gateway. Tron is
   `webhooksSupported: false` and uses RPC polling, so it won't appear here.
3. **Register fee wallets**. Per-row **Fee wallet** CTA opens a dialog that
   derives an address from `MASTER_SEED` for `(chain.family, label)` (default
   label is `{chain} Fee`, e.g. `Ethereum Fee`). Fund the returned address
   out-of-band — payouts reserve fee wallets via CAS before broadcasting.
4. **Watch gas runway**. **Fee wallets** lists balances with per-symbol
   thresholds (ETH&nbsp;<&nbsp;0.01, BNB&nbsp;<&nbsp;0.05, POL&nbsp;<&nbsp;10,
   AVAX&nbsp;<&nbsp;0.5, TRX&nbsp;<&nbsp;100, SOL&nbsp;<&nbsp;0.1). A
   **⛽ low** chip flags any wallet below cutoff; the Dashboard shows a
   banner with up to 3 labels + a link here.
5. **Create merchants**. **Merchants → New merchant** posts to `/admin/merchants`
   via the dashboard admin key; the returned plaintext API key is sealed with
   `DASHBOARD_KEK` and stored in KV. Optional advanced fields: webhook URL,
   payment tolerance (bps — `1 bps = 0.01%`), address cooldown. Use
   **Import key** if the merchant was created outside the dashboard (e.g.
   Postman) and you still have the plaintext; the merchant will de-orphan
   from `source: gateway-only` to `source: imported`.
6. **Invoice / payout smoke test**. From any merchant, create an invoice with
   `amountUsd` and `acceptedFamilies: ['evm', 'tron', 'solana']` — the success
   view shows a QR per receive address. For payouts, the three amount modes
   (`Token amount` / `Raw` / `USD`) all work for ERC-20s, SPL, and native
   gas tokens (ETH/POL/BNB/AVAX/TRX/SOL). Use the **Use max** button to fill
   from pool balance.

## Project layout

```
.
├─ worker/                      # Cloudflare Worker (API backend)
│  ├─ index.ts                  # fetch entry + router wiring
│  ├─ lib/
│  │  ├─ env.ts                 # typed bindings accessors
│  │  ├─ http.ts                # json/error/HttpError
│  │  ├─ router.ts              # method+path router
│  │  ├─ crypto.ts              # PBKDF2 / AES-GCM / HMAC / random / compare
│  │  ├─ totp.ts                # RFC 6238 TOTP
│  │  ├─ kv.ts                  # KV accessors + key layout
│  │  ├─ session.ts             # cookies + per-user session index + CSRF
│  │  └─ ratelimit.ts           # KV sliding-window rate limiter
│  └─ routes/
│     ├─ setup.ts               # onboarding endpoints
│     ├─ auth.ts                # login / logout / session
│     ├─ security.ts            # password / TOTP rotation / recovery / sessions
│     ├─ settings.ts            # base URL + admin key rotation
│     ├─ merchants.ts           # create / import / edit / delete merchants
│     ├─ invoices.ts            # merchant-scoped invoice tracking
│     ├─ payouts.ts             # merchant-scoped payout tracking
│     ├─ proxy.ts               # /api/gw/*  →  gateway  (admin-key injected)
│     └─ proxy-merchant.ts      # /api/mg/:id/raw/*  →  gateway (merchant-key)
│
└─ src/                         # Vite + React SPA
   ├─ screens/                  # Login, Setup, AppShell, Dashboard,
   │                            #   Activity, Balances, Pool, Invoices,
   │                            #   Payouts, Orphans, Webhooks, Merchants,
   │                            #   AuditAddress, FeeWallets, AlchemyWebhooks,
   │                            #   Settings, SecurityPanel
   ├─ components/               # Logo, Sidebar, Topbar, Stepper, OtpInput,
   │  │                           CommandPalette, MerchantSwitcher, …
   │  └─ ui/                    # shadcn primitives (Button, Card, Input,
   │                              Dialog, Select, Command, Sonner, …)
   ├─ lib/                      # api, theme, session, format, chains, types, merchants
   ├─ App.tsx                   # router + ThemeProvider + QueryClient
   └─ index.css                 # Tailwind v4 + design tokens
```

## Security model

- **`DASHBOARD_KEK`** is a Worker secret. Without it the gateway admin key and
  TOTP secrets sealed in KV are opaque blobs. Treat it like a root credential.
- **Gateway admin key** is only ever decrypted in the Worker request path,
  never sent to the browser.
- **Sessions**: raw token in `gw_sess` (HttpOnly, Secure, SameSite=Strict).
  Storage key is `sha256(token)` so reading KV does not yield session tokens.
  **Idle timeout** 30 min, **absolute TTL** 8 h (7 d with "remember me"). A
  per-user session index lets the UI enumerate and revoke active sessions.
- **CSRF**: `gw_csrf` cookie (non-HttpOnly, SameSite=Strict) is echoed by the
  SPA in `X-CSRF-Token` on every non-GET request; the worker compares it
  against a per-session value in KV.
- **Rate limiting** runs in two layers. 60-second windows use Cloudflare's
  native `ratelimits` binding (declared in [wrangler.jsonc](wrangler.jsonc) —
  `API_RL` 300/m, `GW_RL` 120/m, `SETUP_RL` 5/m, `SESS_RL` 30/m). Longer
  windows (login 10 / 5 min, TOTP 20 / 5 min, password change 5 / 10 min,
  recovery regen 3 / hour) use a KV-backed sliding window because CF's
  binding only supports 10s / 60s periods. See [SECURITY.md](SECURITY.md) for the full table.
- **Setup is one-shot**: once `cfg:setup_complete = 1`, every setup endpoint
  is rejected with `SETUP_DONE`.

## Scripts

| command              | what it does                                                |
| -------------------- | ----------------------------------------------------------- |
| `npm run dev`        | Vite dev server + local Workers runtime                     |
| `npm run build`      | Type-check + bundle worker + bundle SPA                     |
| `npm run preview`    | Build + serve production bundle locally                     |
| `npm run deploy`     | Build + `wrangler deploy`                                   |
| `npm run lint`       | ESLint on the whole tree                                    |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`|

## Troubleshooting

- **"DASHBOARD_KV binding is missing"** — you haven't pasted the namespace id
  into `wrangler.jsonc` or haven't run `npx wrangler types`.
- **"DASHBOARD_KEK secret is missing"** — for prod, run the `openssl rand |
  wrangler secret put` step. For dev, create `.dev.vars` from the example.
- **Stuck on the setup wizard** — every query hits `/api/auth/setup-status`,
  which reads `cfg:setup_complete` from KV. If you aborted midway, the
  `cfg:*` keys may be partially set; run
  `npx wrangler kv key delete cfg:setup_complete --binding DASHBOARD_KV`
  (or nuke the namespace and re-create).
- **Reset onboarding completely** — wipe the `cfg:*`, `user:*`, and
  `session:*` keyspaces (or delete the whole KV namespace and recreate it).
  The next page load will land back on the wizard.
- **502 UPSTREAM_UNREACHABLE on the dashboard home** — the stored base URL
  can't be reached from the worker. Fix in Settings. For local dev with a
  local gateway, double-check the port matches `wrangler dev` on the gateway
  side.
- **Bootstrap banner won't clear** — open **Chains** and check the row flags.
  A wired chain stays "incomplete" until it has both a webhook (for EVM +
  Solana) and at least one fee wallet. `bootstrapReady` is the single source
  of truth; trust it rather than re-deriving client-side.
- **Dashboard gas banner says "N wallets below threshold"** — open **Fee
  wallets**, identify the ⛽ **low** wallets, and top them up. Thresholds are
  per-symbol; an EVM chain with a native `MATIC` balance uses the POL cutoff,
  not the generic ETH one.

## Verified end-to-end

The following flows were smoke-tested against `npm run dev` as of this commit:

- `GET /api/health`, `/api/auth/setup-status`, `/api/auth/session` — all return
  expected shapes before onboarding.
- `POST /api/setup/base-url` → `/admin-key` → `/user` → `/totp/begin` →
  `/complete` with a computed TOTP — returns 10 recovery codes and auto-logs in.
- `GET /api/security/sessions` — lists the current session with `current: true`,
  captures the UA.
- `POST /api/auth/logout` — clears both cookies; subsequent `/session` returns
  `{ authenticated: false }`.
- Fresh `POST /api/auth/login/password` → `/login/totp` with a computed TOTP
  — recreates the session.
- `GET /api/gw/health` — against a non-running gateway returns a structured
  `UPSTREAM_UNREACHABLE` error with 502 (proxy wiring confirmed).

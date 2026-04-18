import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, KeyRound, Rocket } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { AlchemyBootstrapResult } from '@/lib/types'

import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordField } from '@/components/PasswordField'

export function AlchemyWebhooksPage() {
  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Alchemy webhooks
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Bootstrap Alchemy Notify webhooks for on-chain ingest, or register a
          signing key you created in the Alchemy dashboard.
        </p>
      </div>

      <BootstrapCard />
      <SigningKeyCard />
    </div>
  )
}

function BootstrapCard() {
  const [chainIdsRaw, setChainIdsRaw] = React.useState('1, 137, 8453')
  const run = useMutation({
    mutationFn: () => {
      const chainIds = chainIdsRaw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
      return api<{ results: AlchemyBootstrapResult[] }>(
        '/api/gw/admin/bootstrap/alchemy-webhooks',
        {
          method: 'POST',
          body: JSON.stringify({ chainIds }),
        },
      )
    },
    onSuccess: () => toast.success('Bootstrap complete'),
    onError: (e: ApiError) => toast.error(e.message || 'Bootstrap failed'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bootstrap webhooks</CardTitle>
        <CardDescription>
          Calls <span className="font-mono">POST /admin/bootstrap/alchemy-webhooks</span>.
          For each chain, creates a new Alchemy webhook (or notes the existing one)
          and persists the signing key encrypted. Target URL is env-pinned to
          <span className="font-mono"> GATEWAY_PUBLIC_URL</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run.mutate()
          }}
        >
          <Field
            label="Chain IDs"
            hint="Comma-separated. Leave blank to use the env-configured default."
          >
            <Input
              value={chainIdsRaw}
              onChange={(e) => setChainIdsRaw(e.target.value)}
              className="font-mono"
              placeholder="1, 137, 8453"
            />
          </Field>
          <div>
            <Button type="submit" disabled={run.isPending}>
              <Rocket className="size-3.5" />{' '}
              {run.isPending ? 'Bootstrapping…' : 'Bootstrap'}
            </Button>
          </div>
        </form>

        {run.data && run.data.results.length > 0 && (
          <div className="mt-5 space-y-2">
            <div className="eyebrow">Results</div>
            {run.data.results.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-sm"
              >
                <Badge
                  variant={
                    r.status === 'created'
                      ? 'success'
                      : r.status === 'existing'
                        ? 'default'
                        : r.status === 'unsupported'
                          ? 'warn'
                          : 'danger'
                  }
                >
                  {r.status}
                </Badge>
                <span className="font-mono text-[12.5px]">chain {r.chainId}</span>
                {r.webhookId && (
                  <span className="font-mono text-xs text-[var(--fg-2)]">
                    {r.webhookId}
                  </span>
                )}
                {r.error && (
                  <span className="font-mono text-xs text-destructive">
                    {r.error}
                  </span>
                )}
                {r.signingKey && (
                  <>
                    <span className="flex-1" />
                    <span className="font-mono text-xs text-[var(--fg-2)]">
                      signing key
                    </span>
                    <CopyButton value={r.signingKey} label={r.signingKey.slice(0, 8) + '…'} />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SigningKeyCard() {
  const [chainId, setChainId] = React.useState('1')
  const [webhookId, setWebhookId] = React.useState('')
  const [signingKey, setSigningKey] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')

  const save = useMutation({
    mutationFn: () =>
      api<{ registered: Record<string, unknown> }>(
        '/api/gw/admin/alchemy-webhooks/signing-keys',
        {
          method: 'POST',
          body: JSON.stringify({
            chainId: parseInt(chainId, 10),
            webhookId,
            signingKey,
            webhookUrl,
          }),
        },
      ),
    onSuccess: () => {
      toast.success('Signing key registered')
      setSigningKey('')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not register key'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register signing key</CardTitle>
        <CardDescription>
          For webhooks created via the Alchemy dashboard UI (or to rotate a key
          after delete + recreate). Keys are encrypted with{' '}
          <span className="font-mono">SECRETS_ENCRYPTION_KEY</span> before being
          written to <span className="font-mono">alchemy_webhook_registry</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="Chain ID">
              <Input
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
            <Field label="Webhook ID (from Alchemy)">
              <Input
                value={webhookId}
                onChange={(e) => setWebhookId(e.target.value)}
                placeholder="wh_…"
                className="font-mono"
                maxLength={128}
              />
            </Field>
          </div>
          <Field
            label="Webhook URL"
            hint="The public URL your gateway exposes for Alchemy ingest."
          >
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              type="url"
              className="font-mono"
              placeholder="https://gateway.example.com/webhooks/alchemy"
            />
          </Field>
          <Field label="Signing key">
            <PasswordField
              value={signingKey}
              onChange={(e) => setSigningKey(e.target.value)}
              placeholder="whk_…"
            />
          </Field>
          <div>
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !/^\d+$/.test(chainId) ||
                webhookId.length < 1 ||
                signingKey.length < 1 ||
                !/^https?:\/\//.test(webhookUrl)
              }
            >
              <KeyRound className="size-3.5" />{' '}
              {save.isPending ? 'Saving…' : 'Register key'}
            </Button>
          </div>
        </form>
        {save.data && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" /> Registered.
          </div>
        )}
      </CardContent>
    </Card>
  )
}


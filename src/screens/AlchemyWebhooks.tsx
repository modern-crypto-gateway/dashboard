import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, KeyRound, Rocket } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { AlchemyBootstrapResult, ChainInventoryEntry } from '@/lib/types'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PasswordField } from '@/components/PasswordField'

const CHAINS_Q = {
  queryKey: ['gw', 'chains'] as const,
  queryFn: () =>
    api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
  refetchInterval: 120_000,
  staleTime: 30_000,
}

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
  const chainsQ = useQuery(CHAINS_Q)

  const candidates = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired && c.webhooksSupported)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )

  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [initialized, setInitialized] = React.useState(false)

  // Seed the default selection to the gaps (wired + webhookSupported but !webhooks).
  React.useEffect(() => {
    if (initialized || candidates.length === 0) return
    setSelected(
      new Set(candidates.filter((c) => !c.webhooks).map((c) => c.chainId)),
    )
    setInitialized(true)
  }, [candidates, initialized])

  const toggle = (chainId: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(chainId) ? next.delete(chainId) : next.add(chainId)
      return next
    })

  const allChecked =
    candidates.length > 0 && selected.size === candidates.length
  const gaps = candidates.filter((c) => !c.webhooks).map((c) => c.chainId)

  const run = useMutation({
    mutationFn: () => {
      const chainIds = Array.from(selected)
      const body = chainIds.length > 0 ? { chainIds } : {}
      return api<{ results: AlchemyBootstrapResult[] }>(
        '/api/gw/admin/bootstrap/alchemy-webhooks',
        {
          method: 'POST',
          body: JSON.stringify(body),
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
          For each chain, creates a new Alchemy webhook (or notes the existing
          one) and persists the signing key encrypted. Target URL is env-pinned
          to <span className="font-mono">GATEWAY_PUBLIC_URL</span>. Pick nothing
          to fall back to the env-configured default.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run.mutate()
          }}
        >
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--fg-2)]">
              <span>
                <span className="font-mono">{selected.size}</span> /{' '}
                <span className="font-mono">{candidates.length}</span> selected
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="font-medium text-primary hover:underline disabled:opacity-50"
                  disabled={gaps.length === 0}
                  onClick={() => setSelected(new Set(gaps))}
                >
                  Gaps only
                </button>
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() =>
                    setSelected(
                      allChecked
                        ? new Set()
                        : new Set(candidates.map((c) => c.chainId)),
                    )
                  }
                >
                  {allChecked ? 'Clear all' : 'Select all'}
                </button>
              </div>
            </div>
            <ChainCheckboxList
              loading={chainsQ.isLoading}
              error={chainsQ.isError}
              candidates={candidates}
              selected={selected}
              onToggle={toggle}
            />
          </div>

          <div>
            <Button type="submit" disabled={run.isPending}>
              <Rocket className="size-3.5" />{' '}
              {run.isPending
                ? 'Bootstrapping…'
                : selected.size === 0
                  ? 'Bootstrap (env default)'
                  : `Bootstrap ${selected.size} chain${selected.size === 1 ? '' : 's'}`}
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

function ChainCheckboxList({
  loading,
  error,
  candidates,
  selected,
  onToggle,
}: {
  loading: boolean
  error: boolean
  candidates: ChainInventoryEntry[]
  selected: Set<number>
  onToggle: (chainId: number) => void
}) {
  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="size-3.5" />
        Could not load chains. Check admin key in settings.
      </div>
    )
  }
  if (candidates.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        <AlertTriangle className="size-3.5" />
        No wired webhook-supported chains. Deploy adapters first.
      </div>
    )
  }
  return (
    <ul className="max-h-[280px] space-y-1 overflow-y-auto rounded-md border border-border p-1">
      {candidates.map((c) => {
        const checked = selected.has(c.chainId)
        const already = c.webhooks
        return (
          <li key={c.chainId}>
            <label
              className={
                'flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm transition-colors ' +
                (checked
                  ? 'bg-primary/5 ring-1 ring-primary/40'
                  : 'hover:bg-[var(--bg-2)]')
              }
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(c.chainId)}
                className="size-4 accent-[var(--primary)]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{c.displayName}</span>
                  <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--fg-2)]">
                    {c.chainId}
                  </span>
                  {already ? (
                    <span className="inline-flex items-center gap-1 rounded border border-[var(--success-border)] bg-[var(--success-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-success">
                      <CheckCircle2 className="size-3" /> registered
                    </span>
                  ) : (
                    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">
                      gap
                    </span>
                  )}
                  {!c.alchemyConfigured && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-warn"
                      title="ALCHEMY_CHAINS env does not list this chainId"
                    >
                      <AlertTriangle className="size-3" />
                      not configured
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--fg-3)]">
                  {c.slug}
                </div>
              </div>
              <Badge variant="outline" className="uppercase">
                {c.family}
              </Badge>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function SigningKeyCard() {
  const chainsQ = useQuery(CHAINS_Q)
  const [chainId, setChainId] = React.useState('')
  const [webhookId, setWebhookId] = React.useState('')
  const [signingKey, setSigningKey] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')

  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired && c.webhooksSupported)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )

  React.useEffect(() => {
    if (chainId || chainOptions.length === 0) return
    setChainId(String(chainOptions[0].chainId))
  }, [chainId, chainOptions])

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
            <Field label="Chain">
              <Select
                value={chainId}
                onValueChange={setChainId}
                disabled={chainsQ.isLoading || chainOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      chainsQ.isLoading
                        ? 'Loading…'
                        : chainOptions.length === 0
                          ? 'No eligible chains'
                          : 'Select chain'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {chainOptions.map((c) => (
                    <SelectItem key={c.chainId} value={String(c.chainId)}>
                      <span className="flex items-center gap-2">
                        <span>{c.displayName}</span>
                        <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
                          {c.chainId}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

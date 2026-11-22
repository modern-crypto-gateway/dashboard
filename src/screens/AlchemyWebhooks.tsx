import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info, KeyRound, Rocket, Webhook } from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { cn } from '@/lib/utils'
import type { AlchemyBootstrapResult, ChainInventoryEntry } from '@/lib/types'

import { SegmentedBar } from '@/components/charts'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, FamilyIcon } from '@/components/CryptoIcon'
import { TableCard, TableToolbar } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState, ErrorState, ListSkeleton } from '@/components/States'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
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
    <div className="fade-in space-y-8">
      <PageHeader title="Alchemy webhooks" description="Notify ingest, per chain" />

      <BootstrapSection />
      <SigningKeyCard />
    </div>
  )
}

/* ── summary + bootstrap table ───────────────────────────── */

function BootstrapSection() {
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

  // Seed the default selection to the gaps (wired + webhookSupported but
  // !webhooks) the first time candidates load. Done in render rather than
  // an effect so we don't double-render.
  if (!initialized && candidates.length > 0) {
    setInitialized(true)
    setSelected(
      new Set(candidates.filter((c) => !c.webhooks).map((c) => c.chainId)),
    )
  }

  const toggle = (chainId: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(chainId) ? next.delete(chainId) : next.add(chainId)
      return next
    })

  const allChecked =
    candidates.length > 0 && selected.size === candidates.length
  const gaps = candidates.filter((c) => !c.webhooks).map((c) => c.chainId)
  const registered = candidates.length - gaps.length
  const unconfigured = candidates.filter((c) => !c.alchemyConfigured).length

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

  const loading = chainsQ.isLoading

  return (
    <>
      <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatTile
          label="Registered"
          loading={loading}
          value={
            <>
              {registered}
              <span className="text-[var(--fg-3)]">/{candidates.length}</span>
            </>
          }
          footer={
            <SegmentedBar
              parts={[
                { key: 'reg', name: 'Registered', value: registered, color: 'var(--st-ok-dot)' },
                { key: 'gap', name: 'Gaps', value: gaps.length, color: 'var(--st-warn-dot)' },
              ]}
            />
          }
        />
        <StatTile
          label="Gaps"
          loading={loading}
          value={gaps.length}
          badge={
            gaps.length > 0 ? (
              <StatusPill tone="warn">Needs bootstrap</StatusPill>
            ) : (
              <StatusPill tone="ok">None</StatusPill>
            )
          }
          sub="Wired, no webhook"
        />
        <StatTile
          label="Alchemy not configured"
          loading={loading}
          value={unconfigured}
          sub="Missing from ALCHEMY_CHAINS"
        />
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : chainsQ.isError ? (
        <ErrorState message="Could not load chains. Check admin key in settings." />
      ) : candidates.length === 0 ? (
        <EmptyState
          framed
          icon={Webhook}
          title="No webhook chains"
          description="No wired webhook-supported chains. Deploy adapters first."
        />
      ) : (
        <TableCard
          toolbar={
            <TableToolbar title="Webhook chains" count={candidates.length}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={gaps.length === 0}
                onClick={() => setSelected(new Set(gaps))}
              >
                Gaps only
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setSelected(
                    allChecked
                      ? new Set()
                      : new Set(candidates.map((c) => c.chainId)),
                  )
                }
              >
                {allChecked ? 'Clear all' : 'Select all'}
              </Button>
            </TableToolbar>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-sm text-[var(--fg-2)]">
                <span className="figure">
                  <span className="font-medium text-foreground">{selected.size}</span> of{' '}
                  {candidates.length} selected
                </span>
                <span
                  className="inline-flex text-[var(--fg-3)]"
                  title="Target URL is env-pinned to GATEWAY_PUBLIC_URL. Pick nothing to fall back to the env-configured default."
                >
                  <Info className="size-4" />
                </span>
              </div>
              <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
                <Rocket className="size-4" />
                {run.isPending
                  ? 'Bootstrapping…'
                  : selected.size === 0
                    ? 'Bootstrap (env default)'
                    : `Bootstrap ${selected.size} chain${selected.size === 1 ? '' : 's'}`}
              </Button>
            </div>
          }
        >
          <TableWrap>
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <Th className="w-12">
                    <span className="sr-only">Select</span>
                  </Th>
                  <Th>Chain</Th>
                  <Th>Family</Th>
                  <Th>Webhook</Th>
                  <Th>Alchemy</Th>
                </tr>
              </THead>
              <TBody>
                {candidates.map((c) => {
                  const checked = selected.has(c.chainId)
                  return (
                    <Tr
                      key={c.chainId}
                      interactive
                      tabIndex={0}
                      aria-selected={checked}
                      onClick={() => toggle(c.chainId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggle(c.chainId)
                        }
                      }}
                      className={cn(
                        'focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none',
                        checked && 'bg-[var(--bg-2)]',
                      )}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.displayName}`}
                          checked={checked}
                          onChange={() => toggle(c.chainId)}
                          onClick={(e) => e.stopPropagation()}
                          className="size-4 cursor-pointer accent-[var(--primary)]"
                        />
                      </Td>
                      <Td>
                        <div className="flex min-w-0 items-center gap-3">
                          <ChainIcon chainId={c.chainId} size={32} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.displayName}</div>
                            <div className="truncate font-mono text-xs text-[var(--fg-3)]">
                              {c.chainId} · {c.slug}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <FamilyIcon family={c.family} size={20} />
                      </Td>
                      <Td>
                        {c.webhooks ? (
                          <StatusPill tone="ok">Registered</StatusPill>
                        ) : (
                          <StatusPill tone="warn">Gap</StatusPill>
                        )}
                      </Td>
                      <Td>
                        {c.alchemyConfigured ? (
                          <StatusPill tone="ok">Configured</StatusPill>
                        ) : (
                          <span title="ALCHEMY_CHAINS env does not list this chainId">
                            <StatusPill tone="warn">Not configured</StatusPill>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          </TableWrap>
        </TableCard>
      )}

      {run.data && run.data.results.length > 0 && (
        <ResultsTable results={run.data.results} />
      )}
    </>
  )
}

function resultTone(status: AlchemyBootstrapResult['status']): StatusTone {
  switch (status) {
    case 'created':
      return 'ok'
    case 'existing':
      return 'info'
    case 'unsupported':
      return 'warn'
    default:
      return 'bad'
  }
}

function ResultsTable({ results }: { results: AlchemyBootstrapResult[] }) {
  return (
    <TableCard
      className="fade-in"
      toolbar={<TableToolbar title="Results" count={results.length} />}
    >
      <TableWrap>
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <Th>Chain</Th>
              <Th>Status</Th>
              <Th>Webhook ID</Th>
              <Th align="right">Signing key</Th>
            </tr>
          </THead>
          <TBody>
            {results.map((r, i) => (
              <Tr key={i}>
                <Td>
                  <div className="flex items-center gap-3">
                    <ChainIcon chainId={r.chainId} size={24} />
                    <span className="font-medium">{chainInfo(r.chainId).name}</span>
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <StatusPill tone={resultTone(r.status)}>{r.status}</StatusPill>
                    {r.error && (
                      <span className="break-words font-mono text-xs text-destructive">
                        {r.error}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  {r.webhookId ? (
                    <span className="break-all font-mono text-xs text-[var(--fg-1)]">
                      {r.webhookId}
                    </span>
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </Td>
                <Td className="text-right">
                  {r.signingKey ? (
                    <CopyButton
                      value={r.signingKey}
                      label={r.signingKey.slice(0, 8) + '…'}
                      className="font-mono"
                    />
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </TableCard>
  )
}

function StatTile({
  label,
  value,
  sub,
  badge,
  footer,
  loading,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  badge?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--fg-2)]">{label}</span>
        {!loading && badge}
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--fg-2)]">{sub}</div>}
      {footer && !loading && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

/* ── signing key form ────────────────────────────────────── */

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

  // Default to the first option once chainOptions has loaded. Render-time
  // setState is safe here: the condition becomes false on the next render.
  if (!chainId && chainOptions.length > 0) {
    setChainId(String(chainOptions[0].chainId))
  }

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
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
          <KeyRound className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold tracking-[-0.01em]">
            Register signing key
            <span
              className="inline-flex text-[var(--fg-3)]"
              title="Keys are encrypted with SECRETS_ENCRYPTION_KEY before being written to alchemy_webhook_registry."
            >
              <Info className="size-4" />
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--fg-2)]">
            For webhooks made in the Alchemy dashboard, or to rotate a key.
          </p>
        </div>
      </div>

      <form
        className="mt-6 max-w-2xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      <ChainIcon chainId={c.chainId} size={16} />
                      <span>{c.displayName}</span>
                      <span className="font-mono text-xs text-[var(--fg-3)]">
                        {c.chainId}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Webhook ID">
            <Input
              value={webhookId}
              onChange={(e) => setWebhookId(e.target.value)}
              placeholder="wh_…"
              className="font-mono"
              maxLength={128}
            />
          </Field>
        </div>
        <Field label="Webhook URL" hint="Your gateway's public Alchemy ingest URL.">
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
        {save.data && <Callout tone="success">Registered.</Callout>}
        <div className="flex justify-end">
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
            <KeyRound className="size-4" />
            {save.isPending ? 'Saving…' : 'Register key'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

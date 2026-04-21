import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Radio,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type {
  AlchemyBootstrapResult,
  ChainInventoryEntry,
} from '@/lib/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/CopyButton'

const CHAINS_Q = ['gw', 'chains'] as const

export function ChainsPage() {
  const qc = useQueryClient()
  const chains = useQuery({
    queryKey: CHAINS_Q,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
  })

  const rows = React.useMemo(() => {
    return (chains.data?.chains ?? [])
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [chains.data])

  const stats = React.useMemo(() => {
    const total = rows.length
    const ready = rows.filter((c) => c.bootstrapReady).length
    const webhookGaps = rows.filter(
      (c) => c.wired && c.webhooksSupported && !c.webhooks,
    ).length
    const notDeployed = rows.filter((c) => !c.wired).length
    return { total, ready, webhookGaps, notDeployed }
  }, [rows])

  const [revealed, setRevealed] = React.useState<AlchemyBootstrapResult[] | null>(
    null,
  )
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const bootstrapableChains = React.useMemo(
    () =>
      rows.filter((c) => c.wired && c.webhooksSupported && !c.webhooks),
    [rows],
  )

  const bootstrapWebhooks = useMutation({
    mutationFn: (chainIds: number[]) =>
      api<{ results: AlchemyBootstrapResult[] }>(
        '/api/gw/admin/bootstrap/alchemy-webhooks',
        {
          method: 'POST',
          body: JSON.stringify({ chainIds }),
        },
      ),
    onSuccess: (res) => {
      const withKey = res.results.filter((r) => r.signingKey)
      if (withKey.length > 0) setRevealed(withKey)
      const ok = res.results.filter(
        (r) => r.status === 'created' || r.status === 'existing',
      ).length
      toast.success(`Bootstrapped ${ok} / ${res.results.length} chains`)
      qc.invalidateQueries({ queryKey: CHAINS_Q })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Bootstrap failed'),
  })

  return (
    <div className="fade-in space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Chains</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Every chain the gateway knows about, with adapter, webhook, and
            fee-wallet readiness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => chains.refetch()}
            disabled={chains.isFetching}
          >
            <RefreshCw
              className={`size-3.5 ${chains.isFetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
          {bootstrapableChains.length > 0 && (
            <Button
              size="sm"
              onClick={() => setPickerOpen(true)}
              disabled={bootstrapWebhooks.isPending}
            >
              <Rocket className="size-3.5" />
              Bootstrap webhooks
              <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px]">
                {bootstrapableChains.length}
              </span>
            </Button>
          )}
        </div>
      </div>

      <StatsGrid stats={stats} loading={chains.isLoading} />

      {chains.isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5" />
          {(chains.error as ApiError)?.message ||
            'Could not load chains. Check admin key / base URL in settings.'}
        </div>
      )}

      {chains.isLoading ? (
        <MatrixSkeleton />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-[var(--fg-2)]">
          No chains reported by the gateway.
        </div>
      ) : (
        <ChainMatrix
          rows={rows}
          onBootstrapWebhook={(id) => bootstrapWebhooks.mutate([id])}
          bootstrappingId={
            bootstrapWebhooks.isPending &&
            bootstrapWebhooks.variables?.length === 1
              ? bootstrapWebhooks.variables[0]
              : null
          }
        />
      )}

      <SigningKeysDialog
        results={revealed}
        onClose={() => setRevealed(null)}
      />

      <BootstrapPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        candidates={bootstrapableChains}
        submitting={bootstrapWebhooks.isPending}
        onSubmit={(ids) => {
          bootstrapWebhooks.mutate(ids, {
            onSuccess: () => setPickerOpen(false),
          })
        }}
      />
    </div>
  )
}

/* ── stats row ───────────────────────────────────────────── */

function StatsGrid({
  stats,
  loading,
}: {
  stats: {
    total: number
    ready: number
    webhookGaps: number
    notDeployed: number
  }
  loading: boolean
}) {
  const allReady = !loading && stats.total > 0 && stats.ready === stats.total
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        icon={<CheckCircle2 className="size-4" />}
        tone={allReady ? 'success' : 'neutral'}
        label="Ready"
        value={loading ? '…' : `${stats.ready}/${stats.total}`}
        sub="bootstrapReady"
      />
      <StatCard
        icon={<Radio className="size-4" />}
        tone={stats.webhookGaps > 0 ? 'warn' : 'success'}
        label="Webhook gaps"
        value={loading ? '…' : String(stats.webhookGaps)}
        sub="wired, no webhook"
      />
      <StatCard
        icon={<CircleDashed className="size-4" />}
        tone="neutral"
        label="Not deployed"
        value={loading ? '…' : String(stats.notDeployed)}
        sub="adapter not loaded"
      />
    </div>
  )
}

function StatCard({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  tone: 'success' | 'warn' | 'neutral'
  label: string
  value: string
  sub: string
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-[var(--fg-2)]'
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <div className="eyebrow">{label}</div>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[var(--fg-2)]">{sub}</div>
    </div>
  )
}

/* ── matrix ──────────────────────────────────────────────── */

function ChainMatrix({
  rows,
  onBootstrapWebhook,
  bootstrappingId,
}: {
  rows: ChainInventoryEntry[]
  onBootstrapWebhook: (chainId: number) => void
  bootstrappingId: number | null
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[1.7fr_90px_1fr_190px] gap-4 border-b border-border bg-[var(--bg-2)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-3)] sm:grid">
        <div>Chain</div>
        <div>Family</div>
        <div>Status</div>
        <div className="text-right">Actions</div>
      </div>
      <ul>
        {rows.map((c) => (
          <ChainRow
            key={c.chainId}
            chain={c}
            onBootstrapWebhook={() => onBootstrapWebhook(c.chainId)}
            bootstrapping={bootstrappingId === c.chainId}
          />
        ))}
      </ul>
    </div>
  )
}

function ChainRow({
  chain,
  onBootstrapWebhook,
  bootstrapping,
}: {
  chain: ChainInventoryEntry
  onBootstrapWebhook: () => void
  bootstrapping: boolean
}) {
  const canBootstrapWebhook =
    chain.wired && chain.webhooksSupported && !chain.webhooks

  return (
    <li className="border-b border-border last:border-0">
      <div className="grid grid-cols-1 items-center gap-3 px-5 py-3 sm:grid-cols-[1.7fr_90px_1fr_190px] sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {chain.displayName}
            </span>
            <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--fg-2)]">
              {chain.chainId}
            </span>
            <ReadyBadge chain={chain} />
            <DetectionBadge detection={chain.detection} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--fg-3)]">
            <span className="font-mono">{chain.slug}</span>
            <span>·</span>
            <span>
              {chain.confirmationsRequired} conf · {chain.tokens.length} token
              {chain.tokens.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="text-xs">
          <Badge variant="outline" className="uppercase">
            {chain.family}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Flag label="wired" ok={chain.wired} />
          {chain.webhooksSupported && (
            <>
              <Flag
                label="alchemy"
                ok={chain.alchemyConfigured}
                dim={!chain.wired}
              />
              <Flag label="webhook" ok={chain.webhooks} dim={!chain.wired} />
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          {!chain.wired ? (
            <span className="text-xs text-[var(--fg-3)]" title="Adapter not loaded — requires backend deploy">
              Not deployed
            </span>
          ) : chain.bootstrapReady ? (
            <span className="text-xs text-[var(--fg-3)]">—</span>
          ) : canBootstrapWebhook ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onBootstrapWebhook}
              disabled={bootstrapping}
            >
              {bootstrapping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              Webhook
            </Button>
          ) : (
            <span className="text-xs text-[var(--fg-3)]">—</span>
          )}
        </div>
      </div>
    </li>
  )
}

function DetectionBadge({
  detection,
}: {
  detection: ChainInventoryEntry['detection']
}) {
  if (detection === 'alchemy') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-border bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--fg-2)]"
        title="Transactions received via Alchemy webhook"
      >
        <Radio className="size-3" /> webhook
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-border bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--fg-2)]"
      title="Transactions detected via RPC polling (no webhook)"
    >
      <RefreshCw className="size-3" /> polling
    </span>
  )
}

function ReadyBadge({ chain }: { chain: ChainInventoryEntry }) {
  if (!chain.wired) {
    return (
      <span className="rounded border border-border bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
        not deployed
      </span>
    )
  }
  if (chain.bootstrapReady) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[var(--success-border)] bg-[var(--success-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-success">
        <CheckCircle2 className="size-3" /> ready
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">
      <AlertTriangle className="size-3" /> incomplete
    </span>
  )
}

function Flag({
  label,
  ok,
  dim,
}: {
  label: string
  ok: boolean
  dim?: boolean
}) {
  const Icon = ok ? CheckCircle2 : XCircle
  const tone = dim
    ? 'text-[var(--fg-3)]'
    : ok
      ? 'text-success'
      : 'text-warn'
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon className="size-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  )
}

/* ── bootstrap picker dialog ─────────────────────────────── */

function BootstrapPickerDialog({
  open,
  onOpenChange,
  candidates,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  candidates: ChainInventoryEntry[]
  submitting: boolean
  onSubmit: (chainIds: number[]) => void
}) {
  const [selected, setSelected] = React.useState<Set<number>>(new Set())

  React.useEffect(() => {
    if (open) setSelected(new Set(candidates.map((c) => c.chainId)))
  }, [open, candidates])

  const toggle = (chainId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(chainId)) next.delete(chainId)
      else next.add(chainId)
      return next
    })
  }

  const allChecked =
    candidates.length > 0 && selected.size === candidates.length
  const noneChecked = selected.size === 0

  const close = () => {
    if (submitting) return
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bootstrap Alchemy webhooks</DialogTitle>
          <DialogDescription>
            Register webhooks with Alchemy for the selected chains. Only chains
            that are wired, webhook-supported, and not yet registered appear
            here. Signing keys are shown once on success.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-border pb-2 text-xs text-[var(--fg-2)]">
          <span>
            <span className="font-mono">{selected.size}</span> /{' '}
            <span className="font-mono">{candidates.length}</span> selected
          </span>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() =>
              setSelected(
                allChecked
                  ? new Set()
                  : new Set(candidates.map((c) => c.chainId)),
              )
            }
            disabled={submitting}
          >
            {allChecked ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <ul className="max-h-[320px] space-y-1 overflow-y-auto">
          {candidates.map((c) => {
            const checked = selected.has(c.chainId)
            return (
              <li key={c.chainId}>
                <label
                  className={
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ' +
                    (checked
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border hover:bg-[var(--bg-2)]')
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.chainId)}
                    disabled={submitting}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {c.displayName}
                      </span>
                      <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--fg-2)]">
                        {c.chainId}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--fg-3)]">
                      <span className="font-mono">{c.slug}</span>
                      {!c.alchemyConfigured && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-warn">
                            <AlertTriangle className="size-3" />
                            alchemy not configured
                          </span>
                        </>
                      )}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || noneChecked}
            onClick={() => onSubmit(Array.from(selected))}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            {submitting
              ? 'Bootstrapping…'
              : `Bootstrap ${selected.size} chain${selected.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── signing key reveal dialog ──────────────────────────── */

function SigningKeysDialog({
  results,
  onClose,
}: {
  results: AlchemyBootstrapResult[] | null
  onClose: () => void
}) {
  const withKey = results ?? []
  return (
    <Dialog open={withKey.length > 0} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing keys</DialogTitle>
          <DialogDescription>
            Shown once. The gateway has persisted an encrypted copy — this
            plaintext is only needed if you want to verify signatures
            off-gateway.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {withKey.map((r) => (
            <div
              key={r.chainId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm"
            >
              <Badge variant={r.status === 'created' ? 'success' : 'default'}>
                {r.status}
              </Badge>
              <span className="font-mono text-xs">chain {r.chainId}</span>
              {r.webhookId && (
                <span className="font-mono text-[11px] text-[var(--fg-2)]">
                  {r.webhookId}
                </span>
              )}
              <span className="flex-1" />
              <code className="font-mono text-xs text-[var(--fg-2)]">
                {r.signingKey?.slice(0, 10)}…
              </code>
              {r.signingKey && <CopyButton value={r.signingKey} />}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── skeleton ────────────────────────────────────────────── */

function MatrixSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.7fr_90px_1fr_190px] items-center gap-4 border-b border-border px-5 py-3 last:border-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-3.5 w-40" />
          <div className="justify-self-end">
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

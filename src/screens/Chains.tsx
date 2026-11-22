import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Network,
  Radio,
  RefreshCw,
  Rocket,
  XCircle,
} from '@/components/icons'

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
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { CopyButton } from '@/components/CopyButton'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton, Stat } from '@/components/States'

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
      <PageHeader
        eyebrow="Infrastructure"
        title="Chains"
        description="Every chain the gateway knows about, with adapter, webhook, and fee-wallet readiness."
        actions={
          <>
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
                <span className="ml-0.5 rounded-sm bg-primary-foreground/20 px-1.5 font-mono text-2xs tabular-nums">
                  {bootstrapableChains.length}
                </span>
              </Button>
            )}
          </>
        }
      />

      <StatsGrid stats={stats} loading={chains.isLoading} />

      {chains.isError && (
        <ErrorState
          title="Could not load chains"
          message={
            (chains.error as ApiError)?.message ||
            'Could not load chains. Check admin key / base URL in settings.'
          }
        />
      )}

      {chains.isLoading ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          framed
          icon={Network}
          title="No chains reported by the gateway."
        />
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
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
      <StatCard
        icon={<CheckCircle2 className="size-3.5" />}
        tone={allReady ? 'success' : 'neutral'}
        label="Ready"
        value={loading ? null : `${stats.ready}/${stats.total}`}
        sub="bootstrapReady"
      />
      <StatCard
        icon={<Radio className="size-3.5" />}
        tone={stats.webhookGaps > 0 ? 'warn' : 'success'}
        label="Webhook gaps"
        value={loading ? null : String(stats.webhookGaps)}
        sub="wired, no webhook"
      />
      <StatCard
        icon={<CircleDashed className="size-3.5" />}
        tone="neutral"
        label="Not deployed"
        value={loading ? null : String(stats.notDeployed)}
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
  /** null while loading */
  value: string | null
  sub: string
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-[var(--fg-2)]'
  return (
    <div className="bg-card px-5 py-4">
      <Stat
        label={
          <span className="inline-flex items-center gap-1.5">
            <span className={toneClass}>{icon}</span>
            {label}
          </span>
        }
        value={value ?? <Skeleton className="h-7 w-14" />}
        sub={sub}
      />
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
      <TableWrap>
        <Table className="min-w-[760px]">
          <THead>
            <tr>
              <Th>Chain</Th>
              <Th className="w-[96px]">Family</Th>
              <Th>Status</Th>
              <Th align="right" className="w-[160px]">
                Actions
              </Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <ChainRow
                key={c.chainId}
                chain={c}
                onBootstrapWebhook={() => onBootstrapWebhook(c.chainId)}
                bootstrapping={bootstrappingId === c.chainId}
              />
            ))}
          </TBody>
        </Table>
      </TableWrap>
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
    <Tr>
      <Td className="py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {chain.displayName}
            </span>
            <span className="rounded-sm bg-[var(--bg-2)] px-1.5 font-mono text-2xs text-[var(--fg-2)]">
              {chain.chainId}
            </span>
            <ReadyBadge chain={chain} />
            <DetectionBadge detection={chain.detection} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--fg-3)]">
            <span className="font-mono">{chain.slug}</span>
            <span>·</span>
            <span>
              <span className="font-mono tabular-nums">{chain.confirmationsRequired}</span> conf ·{' '}
              <span className="font-mono tabular-nums">{chain.tokens.length}</span> token
              {chain.tokens.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </Td>

      <Td className="py-3">
        <Badge variant="outline" className="uppercase">
          {chain.family}
        </Badge>
      </Td>

      <Td className="py-3">
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
      </Td>

      <Td className="py-3 text-right">
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
      </Td>
    </Tr>
  )
}

function DetectionBadge({
  detection,
}: {
  detection: ChainInventoryEntry['detection']
}) {
  if (detection === 'alchemy') {
    return (
      <Badge title="Transactions received via Alchemy webhook">
        <Radio /> webhook
      </Badge>
    )
  }
  return (
    <Badge title="Transactions detected via RPC polling (no webhook)">
      <RefreshCw /> polling
    </Badge>
  )
}

function ReadyBadge({ chain }: { chain: ChainInventoryEntry }) {
  if (!chain.wired) {
    return <Badge>not deployed</Badge>
  }
  if (chain.bootstrapReady) {
    return (
      <Badge variant="success">
        <CheckCircle2 /> ready
      </Badge>
    )
  }
  return (
    <Badge variant="warn">
      <AlertTriangle /> incomplete
    </Badge>
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
  // Re-seed selection on every closed → open transition without an effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setSelected(new Set(candidates.map((c) => c.chainId)))
  }

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

        <div className="flex items-center justify-between gap-2 border-b border-border pb-2 text-xs text-[var(--fg-2)]">
          <span>
            <span className="font-mono">{selected.size}</span> /{' '}
            <span className="font-mono">{candidates.length}</span> selected
          </span>
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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
                      ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                      : 'border-border hover:bg-[var(--bg-hover)]')
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
                      <span className="rounded-sm bg-[var(--bg-2)] px-1.5 font-mono text-2xs text-[var(--fg-2)]">
                        {c.chainId}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-3)]">
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
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-sm"
            >
              <Badge variant={r.status === 'created' ? 'success' : 'default'}>
                {r.status}
              </Badge>
              <span className="font-mono text-xs">chain {r.chainId}</span>
              {r.webhookId && (
                <span className="break-all font-mono text-2xs text-[var(--fg-2)]">
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

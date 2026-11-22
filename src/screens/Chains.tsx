import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Copy,
  Hash,
  Loader2,
  MoreHorizontal,
  Network,
  Radio,
  RefreshCw,
  Rocket,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { cn } from '@/lib/utils'
import type {
  AlchemyBootstrapResult,
  ChainInventoryEntry,
} from '@/lib/types'

import { SegmentedBar, Segmented } from '@/components/charts'
import { TableCard, TableSearch, TableToolbar } from '@/components/DataTable'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, FamilyIcon, TokenIcon } from '@/components/CryptoIcon'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States'

const CHAINS_Q = ['gw', 'chains'] as const

type Filter = 'all' | 'ready' | 'incomplete' | 'undeployed'

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
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('all')

  const bootstrapableChains = React.useMemo(
    () =>
      rows.filter((c) => c.wired && c.webhooksSupported && !c.webhooks),
    [rows],
  )

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((c) => {
      if (filter === 'ready' && !c.bootstrapReady) return false
      if (filter === 'incomplete' && (!c.wired || c.bootstrapReady)) return false
      if (filter === 'undeployed' && c.wired) return false
      if (!q) return true
      return (
        c.displayName.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        String(c.chainId).includes(q) ||
        c.family.includes(q)
      )
    })
  }, [rows, search, filter])

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
    <div className="fade-in space-y-8">
      <PageHeader
        title="Chains"
        description="Adapter, webhook and fee-wallet readiness"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => chains.refetch()}
              disabled={chains.isFetching}
            >
              <RefreshCw
                className={cn('size-4', chains.isFetching && 'animate-spin')}
              />
              Refresh
            </Button>
            {bootstrapableChains.length > 0 && (
              <Button
                size="sm"
                onClick={() => setPickerOpen(true)}
                disabled={bootstrapWebhooks.isPending}
              >
                <Rocket className="size-4" />
                Bootstrap webhooks
                <span className="figure ml-0.5 rounded-full bg-primary-foreground/20 px-1.5 text-xs">
                  {bootstrapableChains.length}
                </span>
              </Button>
            )}
          </>
        }
      />

      <SummaryStrip stats={stats} loading={chains.isLoading} />

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
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        !chains.isError && (
          <EmptyState framed icon={Network} title="No chains reported" />
        )
      ) : (
        <TableCard
          toolbar={
            <TableToolbar title="All chains" count={visible.length}>
              <Segmented<Filter>
                ariaLabel="Filter chains"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'incomplete', label: 'Incomplete' },
                  { value: 'undeployed', label: 'Not deployed' },
                ]}
              />
              <TableSearch
                value={search}
                onChange={setSearch}
                placeholder="Search chains"
                className="w-48"
              />
            </TableToolbar>
          }
        >
          {visible.length === 0 ? (
            <EmptyState
              compact
              icon={Network}
              title="No matching chains"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ChainTable
              rows={visible}
              onBootstrapWebhook={(id) => bootstrapWebhooks.mutate([id])}
              bootstrappingId={
                bootstrapWebhooks.isPending &&
                bootstrapWebhooks.variables?.length === 1
                  ? bootstrapWebhooks.variables[0]
                  : null
              }
            />
          )}
        </TableCard>
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

/* ── summary strip ───────────────────────────────────────── */

function SummaryStrip({
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
  const incomplete = Math.max(0, stats.total - stats.ready - stats.notDeployed)
  const parts = [
    { key: 'ready', name: 'Ready', value: stats.ready, color: 'var(--st-ok-dot)' },
    { key: 'incomplete', name: 'Incomplete', value: incomplete, color: 'var(--st-warn-dot)' },
    { key: 'off', name: 'Not deployed', value: stats.notDeployed, color: 'var(--st-wait-dot)' },
  ]
  return (
    <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
      <StatTile
        label="Ready"
        loading={loading}
        value={
          <>
            {stats.ready}
            <span className="text-[var(--fg-3)]">/{stats.total}</span>
          </>
        }
        footer={
          <div className="space-y-2.5">
            <SegmentedBar parts={parts} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--fg-2)]">
              {parts.map((p) => (
                <span key={p.key} className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: p.color }} />
                  {p.name}
                  <span className="figure text-foreground">{p.value}</span>
                </span>
              ))}
            </div>
          </div>
        }
      />
      <StatTile
        label="Webhook gaps"
        loading={loading}
        value={stats.webhookGaps}
        badge={
          stats.webhookGaps > 0 ? (
            <StatusPill tone="warn">Needs bootstrap</StatusPill>
          ) : (
            <StatusPill tone="ok">None</StatusPill>
          )
        }
        sub="Wired, no webhook"
      />
      <StatTile
        label="Not deployed"
        loading={loading}
        value={stats.notDeployed}
        sub="Adapter not loaded"
      />
    </div>
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

/* ── table ───────────────────────────────────────────────── */

function ChainTable({
  rows,
  onBootstrapWebhook,
  bootstrappingId,
}: {
  rows: ChainInventoryEntry[]
  onBootstrapWebhook: (chainId: number) => void
  bootstrappingId: number | null
}) {
  return (
    <TableWrap>
      <Table className="min-w-[960px]">
        <THead>
          <tr>
            <Th>Chain</Th>
            <Th>Family</Th>
            <Th>Ready</Th>
            <Th>Detection</Th>
            <Th>Webhook</Th>
            <Th>Fee wallet</Th>
            <Th align="right">Conf.</Th>
            <Th align="right">Tokens</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
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
  // Same gate as before: only wired, not-yet-ready chains with a webhook gap.
  const showBootstrap = chain.wired && !chain.bootstrapReady && canBootstrapWebhook

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${what} copied`)
    } catch {
      /* ignore */
    }
  }

  return (
    <Tr>
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <ChainIcon chainId={chain.chainId} size={32} />
          <div className="min-w-0">
            <div className="truncate font-medium">{chain.displayName}</div>
            <div className="truncate font-mono text-xs text-[var(--fg-3)]">
              {chain.chainId} · {chain.slug}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <FamilyIcon family={chain.family} size={20} />
      </Td>
      <Td>
        <ReadyPill chain={chain} />
      </Td>
      <Td>
        <DetectionPill detection={chain.detection} />
      </Td>
      <Td>
        <WebhookPill chain={chain} bootstrapping={bootstrapping} />
      </Td>
      <Td>
        {chain.feeWallets ? (
          <StatusPill tone="ok">Set</StatusPill>
        ) : (
          <StatusPill tone="off" icon={null}>
            None
          </StatusPill>
        )}
      </Td>
      <Td align="right" className="text-[var(--fg-1)]">
        {chain.confirmationsRequired}
      </Td>
      <Td align="right">
        <TokenStack symbols={chain.tokens.map((t) => t.symbol)} />
      </Td>
      <Td className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${chain.displayName}`}
            >
              {bootstrapping ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MoreHorizontal className="size-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={!showBootstrap || bootstrapping}
              onSelect={onBootstrapWebhook}
            >
              <Rocket /> Bootstrap webhook
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => copy(String(chain.chainId), 'Chain ID')}>
              <Hash /> Copy chain ID
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copy(chain.slug, 'Slug')}>
              <Copy /> Copy slug
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Td>
    </Tr>
  )
}

/** Overlapping token logos; symbols listed in the tooltip. */
function TokenStack({ symbols }: { symbols: string[] }) {
  const shown = symbols.slice(0, 4)
  const extra = symbols.length - shown.length
  return (
    <span className="inline-flex items-center justify-end" title={symbols.join(', ')}>
      {shown.map((s, i) => (
        <span
          key={s}
          className="grid place-items-center rounded-full bg-card ring-2 ring-[var(--bg-1)]"
          style={{ marginLeft: i === 0 ? 0 : -6, zIndex: shown.length - i }}
        >
          <TokenIcon symbol={s} size={20} />
        </span>
      ))}
      {extra > 0 && <span className="figure ml-1.5 text-xs text-[var(--fg-2)]">+{extra}</span>}
    </span>
  )
}

function ReadyPill({ chain }: { chain: ChainInventoryEntry }) {
  if (!chain.wired) {
    return (
      <span title="Adapter not loaded — requires backend deploy">
        <StatusPill tone="off">Not deployed</StatusPill>
      </span>
    )
  }
  if (chain.bootstrapReady) return <StatusPill tone="ok">Ready</StatusPill>
  return <StatusPill tone="warn">Incomplete</StatusPill>
}

function DetectionPill({
  detection,
}: {
  detection: ChainInventoryEntry['detection']
}) {
  if (detection === 'alchemy') {
    return (
      <span title="Transactions received via Alchemy webhook">
        <StatusPill tone="info" icon={Radio}>
          Webhook
        </StatusPill>
      </span>
    )
  }
  return (
    <span title="Transactions detected via RPC polling (no webhook)">
      <StatusPill tone="wait" icon={RefreshCw}>
        Polling
      </StatusPill>
    </span>
  )
}

function WebhookPill({
  chain,
  bootstrapping,
}: {
  chain: ChainInventoryEntry
  bootstrapping: boolean
}) {
  if (!chain.webhooksSupported) {
    return (
      <span className="text-sm text-[var(--fg-3)]" title="Webhooks not supported">
        —
      </span>
    )
  }
  if (bootstrapping) return <StatusPill tone="run">Registering</StatusPill>
  if (chain.webhooks) return <StatusPill tone="ok">Live</StatusPill>
  if (!chain.wired) {
    return (
      <span className="text-sm text-[var(--fg-3)]" title="Adapter not loaded">
        —
      </span>
    )
  }
  if (!chain.alchemyConfigured) {
    return (
      <span title="Alchemy not configured for this chain">
        <StatusPill tone="warn">No Alchemy</StatusPill>
      </span>
    )
  }
  return (
    <span title="Wired, webhook supported, not registered">
      <StatusPill tone="warn">Gap</StatusPill>
    </span>
  )
}

function bootstrapTone(status: AlchemyBootstrapResult['status']): StatusTone {
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

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-[var(--bg-2)] px-4 py-2 text-xs text-[var(--fg-2)]">
            <span className="figure">
              <span className="font-medium text-foreground">{selected.size}</span> of{' '}
              {candidates.length} selected
            </span>
            <button
              type="button"
              className="cursor-pointer font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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

          <ul className="max-h-[320px] divide-y divide-border overflow-y-auto">
            {candidates.map((c) => {
              const checked = selected.has(c.chainId)
              return (
                <li key={c.chainId}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      checked ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-2)]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.chainId)}
                      disabled={submitting}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <ChainIcon chainId={c.chainId} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.displayName}</div>
                      <div className="truncate font-mono text-xs text-[var(--fg-3)]">
                        {c.chainId} · {c.slug}
                      </div>
                    </div>
                    {!c.alchemyConfigured && (
                      <span title="alchemy not configured">
                        <StatusPill tone="warn" size="sm" icon={AlertTriangle}>
                          No Alchemy
                        </StatusPill>
                      </span>
                    )}
                    <FamilyIcon family={c.family} size={18} />
                  </label>
                </li>
              )
            })}
          </ul>
        </div>

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
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
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
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {withKey.map((r) => {
            const info = chainInfo(r.chainId)
            return (
              <li
                key={r.chainId}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <ChainIcon chainId={r.chainId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{info.name}</span>
                    <StatusPill tone={bootstrapTone(r.status)} size="sm">
                      {r.status}
                    </StatusPill>
                  </div>
                  <div className="truncate font-mono text-xs text-[var(--fg-3)]">
                    chain {r.chainId}
                    {r.webhookId && <> · {r.webhookId}</>}
                  </div>
                </div>
                <span className="flex items-center gap-1 rounded-[10px] border border-border bg-[var(--bg-2)] py-1 pr-1 pl-2.5">
                  <code className="font-mono text-xs text-[var(--fg-1)]">
                    {r.signingKey?.slice(0, 10)}…
                  </code>
                  {r.signingKey && <CopyButton value={r.signingKey} />}
                </span>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

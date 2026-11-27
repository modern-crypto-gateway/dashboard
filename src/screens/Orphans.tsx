import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  Info,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  X,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtLocal, fmtUsd, useNow } from '@/lib/format'
import type { OrphanTransaction } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { ChainPill } from '@/components/ChainPill'
import { ChainIcon, TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { Pager, TableCard, TableSearch, usePaged } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/States'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

export function OrphansPage() {
  const qc = useQueryClient()
  const now = useNow()
  const list = useQuery({
    queryKey: ['orphans'] as const,
    queryFn: () =>
      api<{ orphans: OrphanTransaction[] }>(
        '/api/gw/admin/orphan-transactions?limit=100',
      ),
    refetchInterval: 60_000,
  })

  const [target, setTarget] = React.useState<OrphanTransaction | null>(null)
  const [mode, setMode] = React.useState<'attribute' | 'dismiss' | null>(null)
  const open = !!target && !!mode
  const close = () => {
    setTarget(null)
    setMode(null)
    qc.invalidateQueries({ queryKey: ['orphans'] })
  }

  // Links from other pages (e.g. Audit address): ?q=<tx hash> pre-fills the
  // search, ?open=<transaction id> opens that orphan's attribute dialog.
  const [params] = useSearchParams()
  const [query, setQuery] = React.useState(() => params.get('q') ?? '')
  const orphans = React.useMemo(() => list.data?.orphans ?? [], [list.data])
  const linkedId = params.get('open')
  const [link, setLink] = React.useState<'pending' | 'opened' | 'missing'>('pending')
  if (link === 'pending' && linkedId && list.data) {
    const hit = orphans.find((o) => o.id === linkedId)
    setLink(hit ? 'opened' : 'missing')
    if (hit) {
      setTarget(hit)
      setMode('attribute')
    }
  }
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orphans
    return orphans.filter(
      (o) =>
        o.txHash.toLowerCase().includes(q) ||
        o.fromAddress.toLowerCase().includes(q) ||
        o.toAddress.toLowerCase().includes(q) ||
        o.token.toLowerCase().includes(q),
    )
  }, [orphans, query])
  const paged = usePaged(filtered, PAGE_SIZE)

  const summary = React.useMemo(() => {
    let usd = 0
    let noUsd = 0
    let oldest = 0
    const chains = new Map<number, number>()
    for (const o of orphans) {
      if (o.amountUsd) usd += parseFloat(o.amountUsd) || 0
      else noUsd++
      chains.set(o.chainId, (chains.get(o.chainId) ?? 0) + 1)
      const t = Date.parse(o.detectedAt)
      if (isFinite(t) && (oldest === 0 || t < oldest)) oldest = t
    }
    return {
      usd,
      noUsd,
      oldest,
      chains: [...chains.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [orphans])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Orphan transactions"
        description="Unattributed on-chain transfers"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {link === 'missing' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-[var(--fg-2)]">
          <Info className="mt-0.5 size-4 shrink-0" />
          That transfer is not among the latest 100 open orphans. It may already be attributed or dismissed.
        </div>
      )}

      {list.isError ? (
        <ErrorState
          title="Could not load orphan transactions"
          message={list.error instanceof Error ? list.error.message : 'Error'}
        />
      ) : !list.isLoading && orphans.length === 0 ? (
        <EmptyState
          framed
          icon={ShieldCheck}
          title="No open orphans"
          description="Every on-chain transfer is attributed or dismissed."
        />
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-5 xl:grid-cols-4">
            <Tile label="Open" loading={list.isLoading} value={orphans.length} />
            <Tile
              label="Total value"
              loading={list.isLoading}
              value={fmtUsd(summary.usd)}
              sub={summary.noUsd > 0 ? `${summary.noUsd} without a USD rate` : undefined}
            />
            <Tile
              label="Networks"
              loading={list.isLoading}
              value={summary.chains.length}
              footer={
                <div className="flex flex-wrap items-center gap-1.5">
                  {summary.chains.slice(0, 8).map(([id, n]) => (
                    <span key={id} title={`${n}`} className="inline-flex">
                      <ChainIcon chainId={id} size={20} />
                    </span>
                  ))}
                </div>
              }
            />
            <Tile
              label="Oldest"
              loading={list.isLoading}
              value={summary.oldest ? formatAgo(new Date(summary.oldest).toISOString(), now) : '—'}
              sub={summary.oldest ? fmtLocal(summary.oldest) : undefined}
            />
          </div>

          <TableCard
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">Open orphans</h2>
                <TableSearch
                  value={query}
                  onChange={(v) => {
                    setQuery(v)
                    paged.setPage(0)
                  }}
                  placeholder="Search hash, address, token…"
                  className="w-full sm:ml-auto sm:w-64"
                />
              </div>
            }
            footer={
              paged.total > 0 ? (
                <Pager
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hasNext={paged.page < paged.pageCount - 1}
                  onPage={paged.setPage}
                  noun="orphans"
                />
              ) : undefined
            }
          >
            {list.isLoading ? (
              <TableSkeleton />
            ) : filtered.length === 0 ? (
              <EmptyState
                compact
                icon={Search}
                title="No matches"
                action={
                  <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <TableWrap>
                <Table className="min-w-[980px]">
                  <THead>
                    <tr>
                      <Th>Transaction</Th>
                      <Th>Network</Th>
                      <Th>Route</Th>
                      <Th align="right">Amount</Th>
                      <Th align="right">USD</Th>
                      <Th align="right">Conf</Th>
                      <Th align="right">Detected</Th>
                      <Th className="w-12">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </THead>
                  <TBody>
                    {paged.rows.map((o) => (
                      <Tr key={o.id}>
                        <Td>
                          <div className="flex items-center gap-3">
                            <TokenOnChain symbol={o.token} chainId={o.chainId} size={32} />
                            <div className="min-w-0">
                              <div className="font-medium">{o.token}</div>
                              <Addr
                                value={o.txHash}
                                chainId={o.chainId}
                                kind="tx"
                                className="text-[var(--fg-2)]"
                              />
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <ChainPill chainId={o.chainId} />
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1 text-[var(--fg-2)]">
                            <Addr value={o.fromAddress} chainId={o.chainId} />
                            <ArrowRight className="size-3.5 shrink-0 text-[var(--fg-3)]" />
                            <Addr value={o.toAddress} chainId={o.chainId} />
                          </div>
                        </Td>
                        <Td align="right">
                          <span className="inline-flex items-center justify-end gap-1.5 font-medium">
                            <TokenIcon symbol={o.token} size={14} />
                            {o.amountRaw}
                          </span>
                        </Td>
                        <Td align="right" className="font-medium">
                          {o.amountUsd ? fmtUsd(o.amountUsd) : <span className="text-[var(--fg-3)]">—</span>}
                        </Td>
                        <Td align="right" className="text-[var(--fg-2)]">{o.confirmations}</Td>
                        <Td
                          align="right"
                          className="text-sm whitespace-nowrap text-[var(--fg-2)]"
                          title={fmtLocal(o.detectedAt, { seconds: true })}
                        >
                          {formatAgo(o.detectedAt, now)}
                        </Td>
                        <Td align="right" className="w-12">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-sm" variant="ghost" aria-label="Orphan actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setTarget(o)
                                  setMode('attribute')
                                }}
                              >
                                <Target /> Attribute
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  setTarget(o)
                                  setMode('dismiss')
                                }}
                              >
                                <X /> Dismiss
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </TableCard>
        </>
      )}

      {target && mode === 'attribute' && (
        <AttributeDialog open={open} onOpenChange={close} orphan={target} />
      )}
      {target && mode === 'dismiss' && (
        <DismissDialog open={open} onOpenChange={close} orphan={target} />
      )}
    </div>
  )
}

function formatAgo(iso: string, nowMs: number): string {
  const diff = Math.floor((nowMs - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/** Compact summary of the orphan a dialog acts on. */
function OrphanSummary({ orphan }: { orphan: OrphanTransaction }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--bg-2)] px-4 py-3">
      <TokenOnChain symbol={orphan.token} chainId={orphan.chainId} size={32} />
      <div className="min-w-0 flex-1">
        <div className="figure truncate font-semibold">
          {orphan.amountRaw} {orphan.token}
        </div>
        <Addr
          value={orphan.txHash}
          chainId={orphan.chainId}
          kind="tx"
          className="text-[var(--fg-2)]"
        />
      </div>
      {orphan.amountUsd && (
        <div className="figure shrink-0 text-sm font-medium">{fmtUsd(orphan.amountUsd)}</div>
      )}
    </div>
  )
}

function AttributeDialog({
  open,
  onOpenChange,
  orphan,
}: {
  open: boolean
  onOpenChange: () => void
  orphan: OrphanTransaction
}) {
  const [invoiceId, setInvoiceId] = React.useState('')
  const attr = useMutation({
    mutationFn: () =>
      api<{ attribution: Record<string, unknown> }>(
        `/api/gw/admin/orphan-transactions/${encodeURIComponent(orphan.id)}/attribute`,
        {
          method: 'POST',
          body: JSON.stringify({ invoiceId }),
        },
      ),
    onSuccess: () => {
      toast.success('Orphan attributed')
      onOpenChange()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not attribute'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-5" /> Attribute orphan to invoice
          </DialogTitle>
          <DialogDescription>
            Re-points the tx's <span className="font-mono">invoice_id</span> and
            reconciles the target invoice. Terminal invoices may flip to
            <span className="font-mono"> confirmed</span> or
            <span className="font-mono"> overpaid</span> if the payment covers it.
          </DialogDescription>
        </DialogHeader>
        <OrphanSummary orphan={orphan} />
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            attr.mutate()
          }}
        >
          <Field label="Invoice id">
            <Input
              autoFocus
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              placeholder="uuid"
              className="font-mono"
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button type="submit" disabled={attr.isPending || !invoiceId.trim()}>
              <Target className="size-4" />
              {attr.isPending ? 'Attributing…' : 'Attribute'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DismissDialog({
  open,
  onOpenChange,
  orphan,
}: {
  open: boolean
  onOpenChange: () => void
  orphan: OrphanTransaction
}) {
  const [reason, setReason] = React.useState('')
  const dismiss = useMutation({
    mutationFn: () =>
      api(
        `/api/gw/admin/orphan-transactions/${encodeURIComponent(orphan.id)}/dismiss`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => {
      toast.success('Orphan dismissed')
      onOpenChange()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not dismiss'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="size-5" /> Dismiss orphan
          </DialogTitle>
          <DialogDescription>
            The tx stays in the audit log but drops off the open-orphans queue.
          </DialogDescription>
        </DialogHeader>
        <OrphanSummary orphan={orphan} />
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            dismiss.mutate()
          }}
        >
          <Field
            label="Reason"
            hint="1–512 characters. Shown in audit history."
          >
            <Textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="dust · test tx · store asked us to ignore"
              maxLength={512}
              rows={3}
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={dismiss.isPending || reason.trim().length === 0}
            >
              {dismiss.isPending ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── tiles / skeleton ──────────────────────────────────── */

function Tile({
  label,
  value,
  sub,
  footer,
  loading,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="text-sm text-[var(--fg-2)]">{label}</div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {sub && !loading && <div className="mt-1 truncate text-xs text-[var(--fg-2)]">{sub}</div>}
      {footer && !loading && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-border px-6 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-2.5 w-36" />
          </div>
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="hidden h-3.5 w-40 md:block" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

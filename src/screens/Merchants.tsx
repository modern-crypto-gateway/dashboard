import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock,
  Copy,
  Database,
  ClipboardText,
  Download,
  Info,
  KeyRound,
  Layers,
  ListBullets,
  Lock,
  MoreHorizontal,
  Plus,
  Power,
  Save,
  Scale,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Store,
  Timer,
  Trash2,
  Webhook,
  X,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { chainInfo } from '@/lib/chains'
import { merchantsQuery, useMerchants } from '@/lib/merchants'
import { fmtLocal, fmtRel } from '@/lib/format'
import { API_KEY_SCOPES } from '@/lib/types'
import type {
  ApiKeyScope,
  ChainInventoryEntry,
  ConfirmationTierOp,
  ConfirmationTierRule,
  Merchant,
  MerchantApiKey,
} from '@/lib/types'

import { Badge } from '@/components/ui/badge'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetSection,
  SheetTabs,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SegmentedBar, Segmented } from '@/components/charts'
import { CopyButton } from '@/components/CopyButton'
import { ChainIcon, TokenIcon } from '@/components/CryptoIcon'
import {
  Pager,
  RowAvatar,
  TableCard,
  TableSearch,
  TableToolbar,
  usePaged,
} from '@/components/DataTable'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { PasswordField } from '@/components/PasswordField'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { Callout, EmptyState as SharedEmptyState } from '@/components/States'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'inactive' | 'orphan'

const PAGE_SIZE = 25

/* ── page ────────────────────────────────────────────────── */

export function MerchantsPage() {
  const merchants = useMerchants()
  const gatewayReachable = merchants.data?.gatewayReachable !== false

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('all')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  const all = React.useMemo(() => merchants.data?.merchants ?? [], [merchants.data])
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((m) => {
      if (filter === 'active' && m.active !== true) return false
      if (filter === 'inactive' && m.active !== false) return false
      if (filter === 'orphan' && m.source !== 'gateway-only') return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.webhookUrl ?? '').toLowerCase().includes(q)
      )
    })
  }, [all, query, filter])

  // Back to page 1 whenever the search or filter changes.
  const paged = usePaged(filtered, PAGE_SIZE)
  const filterKey = `${query}|${filter}`
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    paged.setPage(0)
  }

  const openMerchant = filtered.find((m) => m.id === openId)
    ?? all.find((m) => m.id === openId)
    ?? null

  return (
    <div className="fade-in space-y-8">
      <PageHeader
        title="Stores"
        description="Stores on the gateway"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Download className="size-4" /> Import key
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New store
            </Button>
          </>
        }
      />

      {!gatewayReachable && merchants.data && (
        <Callout tone="warn">
          Gateway unreachable — live status fields below may be stale.
        </Callout>
      )}

      <SummaryTiles rows={all} loading={merchants.isLoading} />

      {merchants.isLoading ? (
        <TableCard>
          <TableSkeleton />
        </TableCard>
      ) : all.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <TableCard
          toolbar={
            <TableToolbar title="All stores" count={filtered.length}>
              <Segmented<Filter>
                ariaLabel="Status filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'orphan', label: 'Gateway-only' },
                ]}
              />
              <TableSearch
                value={query}
                onChange={setQuery}
                placeholder="Name, id, webhook"
                className="w-full sm:w-56"
              />
            </TableToolbar>
          }
          footer={
            filtered.length > 0 ? (
              <Pager
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                hasNext={paged.page < paged.pageCount - 1}
                onPage={paged.setPage}
                noun="stores"
              />
            ) : undefined
          }
        >
          {filtered.length === 0 ? (
            <NoMatch
              onClear={() => {
                setQuery('')
                setFilter('all')
              }}
            />
          ) : (
            <MerchantTable rows={paged.rows} onOpen={setOpenId} />
          )}
        </TableCard>
      )}

      <CreateMerchantDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportMerchantDialog open={importOpen} onOpenChange={setImportOpen} />
      <MerchantSheet
        merchant={openMerchant}
        stores={all}
        onOpenChange={(v) => !v && setOpenId(null)}
      />
    </div>
  )
}

/* ── summary tiles ───────────────────────────────────────── */

function SummaryTiles({ rows, loading }: { rows: Merchant[]; loading: boolean }) {
  const total = rows.length
  const orphan = rows.filter((m) => m.source === 'gateway-only').length
  const active = rows.filter((m) => m.source !== 'gateway-only' && m.active === true).length
  const inactive = rows.filter((m) => m.source !== 'gateway-only' && m.active === false).length
  const unknown = total - orphan - active - inactive
  const sealed = rows.filter((m) => m.apiKeyFingerprint != null).length
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% of stores` : '—')
  return (
    <div className="stagger grid grid-cols-2 gap-5 lg:grid-cols-4">
      <StatTile
        label="Stores"
        value={total}
        loading={loading}
        footer={
          <SegmentedBar
            parts={[
              { key: 'active', name: 'Active', value: active, color: 'var(--st-ok-dot)' },
              { key: 'inactive', name: 'Inactive', value: inactive, color: 'var(--st-wait-dot)' },
              { key: 'orphan', name: 'Gateway-only', value: orphan, color: 'var(--st-warn-dot)' },
              { key: 'unknown', name: 'Unknown', value: unknown, color: 'var(--chart-muted)' },
            ]}
          />
        }
      />
      <StatTile label="Active" value={active} sub={pct(active)} loading={loading} dot="var(--st-ok-dot)" />
      <StatTile
        label="Inactive"
        value={inactive}
        sub={orphan > 0 ? `${orphan} gateway-only` : 'None gateway-only'}
        loading={loading}
        dot="var(--st-wait-dot)"
      />
      <StatTile
        label="Sealed keys"
        value={sealed}
        sub={total - sealed > 0 ? `${total - sealed} without a key` : 'Every store usable'}
        loading={loading}
        icon={KeyRound}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  footer,
  loading,
  dot,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  loading?: boolean
  dot?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
        {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
        {Icon && <Icon className="size-4 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="figure mt-2 text-xl font-semibold">
        {loading ? <Skeleton className="h-7 w-12" /> : value}
      </div>
      {sub != null && (
        <div className="mt-1 truncate text-xs text-[var(--fg-2)]">
          {loading ? <Skeleton className="h-3 w-20" /> : sub}
        </div>
      )}
      {footer && <div className="mt-auto pt-4">{loading ? <Skeleton className="h-2 w-full" /> : footer}</div>}
    </Card>
  )
}

/* ── table ───────────────────────────────────────────────── */

function MerchantTable({
  rows,
  onOpen,
}: {
  rows: Merchant[]
  onOpen: (id: string) => void
}) {
  return (
    <TableWrap>
      <Table className="min-w-[720px]">
        <THead>
          <tr>
            <Th>Store</Th>
            <Th>Status</Th>
            <Th>API key</Th>
            <Th align="right">Updated</Th>
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((m) => (
            <MerchantRow key={m.id} m={m} onOpen={() => onOpen(m.id)} />
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function MerchantRow({ m, onOpen }: { m: Merchant; onOpen: () => void }) {
  const confCount = m.confirmationThresholds ? Object.keys(m.confirmationThresholds).length : 0
  const tierCount = m.confirmationTiers ? Object.keys(m.confirmationTiers).length : 0
  return (
    <Tr
      interactive
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
    >
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <RowAvatar text={initialsOf(m.name)} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{m.name}</span>
              {confCount > 0 && (
                <Badge variant="outline" className="shrink-0" title="Per-chain confirmation overrides set">
                  <Layers /> {confCount} conf
                </Badge>
              )}
              {tierCount > 0 && (
                <Badge variant="outline" className="shrink-0" title="Per-(chain, token) amount-tier rules set">
                  <Layers /> {tierCount} tier
                </Badge>
              )}
            </div>
            <div className="max-w-[260px] truncate font-mono text-xs text-[var(--fg-3)]">{m.id}</div>
          </div>
        </div>
      </Td>
      <Td>
        <MerchantStatus status={statusOf(m)} />
      </Td>
      <Td>
        {m.apiKeyFingerprint ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--fg-1)]">
            <KeyRound className="size-3.5 text-[var(--fg-3)]" />
            sk_…{m.apiKeyFingerprint}
          </span>
        ) : (
          <span className="text-sm text-[var(--fg-3)]">—</span>
        )}
      </Td>
      <Td
        align="right"
        className="text-sm whitespace-nowrap text-[var(--fg-2)]"
        title={fmtLocal(m.updatedAt)}
      >
        {fmtRel(m.updatedAt)}
      </Td>
      <Td className="w-12">
        <div
          className="flex justify-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <RowKebab m={m} />
        </div>
      </Td>
    </Tr>
  )
}

type Status = 'active' | 'inactive' | 'orphan' | 'unknown'

function statusOf(m: Merchant): Status {
  if (m.source === 'gateway-only') return 'orphan'
  if (m.active === true) return 'active'
  if (m.active === false) return 'inactive'
  return 'unknown'
}

const STATUS_META: Record<Status, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'ok' },
  inactive: { label: 'Inactive', tone: 'off' },
  orphan: { label: 'Gateway-only', tone: 'warn' },
  unknown: { label: 'Unknown', tone: 'wait' },
}

function MerchantStatus({ status, size }: { status: Status; size?: 'sm' | 'md' }) {
  const s = STATUS_META[status]
  return (
    <StatusPill tone={s.tone} size={size}>
      {s.label}
    </StatusPill>
  )
}

const SOURCE_LABEL: Record<Merchant['source'], string> = {
  dashboard: 'Created here',
  imported: 'Imported',
  'gateway-only': 'Gateway-only',
}

/* ── row kebab menu ──────────────────────────────────────── */

function RowKebab({ m }: { m: Merchant }) {
  const qc = useQueryClient()
  const setActive = useMutation({
    mutationFn: (next: boolean) =>
      api(
        `/api/merchants/${encodeURIComponent(m.id)}/${next ? 'activate' : 'deactivate'}`,
        { method: 'POST' },
      ),
    onSuccess: (_res, next) => {
      toast.success(next ? 'Store activated' : 'Store deactivated')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not update'),
  })

  const [confirmRotate, setConfirmRotate] = React.useState(false)
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = React.useState(false)

  const rotate = useMutation({
    mutationFn: () =>
      api<{ apiKey: string }>(
        `/api/merchants/${encodeURIComponent(m.id)}/rotate-key`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      setRevealedKey(res.apiKey)
      setConfirmRotate(false)
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => {
      setConfirmRotate(false)
      toast.error(e.message || 'Could not rotate')
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      api(`/api/merchants/${encodeURIComponent(m.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Local record removed')
      setConfirmRemove(false)
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not remove'),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Store actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setConfirmRotate(true)}>
            <KeyRound className="size-4" />
            {m.source === 'gateway-only' ? 'Rotate & import key' : 'Rotate API key'}
          </DropdownMenuItem>
          {m.active === true && (
            <DropdownMenuItem onSelect={() => setActive.mutate(false)}>
              <Power className="size-4" /> Deactivate
            </DropdownMenuItem>
          )}
          {m.active === false && (
            <DropdownMenuItem onSelect={() => setActive.mutate(true)}>
              <Power className="size-4" /> Activate
            </DropdownMenuItem>
          )}
          {m.source !== 'gateway-only' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmRemove(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" /> Remove from dashboard
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        icon={KeyRound}
        title="Rotate API key?"
        body={
          <>
            The gateway generates a fresh <span className="font-mono">sk_…</span>{' '}
            and invalidates the current key. The new plaintext is shown{' '}
            <span className="font-semibold">once</span> and sealed here.
          </>
        }
        cta="Rotate key"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />

      <RevealOnceDialog
        value={revealedKey}
        title="New API key"
        description="This is the only time the plaintext is shown. We've sealed a copy for invoice/payout calls; copy it now if you need it elsewhere."
        onClose={() => setRevealedKey(null)}
      />

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        icon={Trash2}
        title="Remove local record?"
        body={
          <>
            Removes the store from this dashboard and drops the sealed key.
            Does <span className="font-semibold">not</span> delete the store on
            the gateway.
          </>
        }
        cta="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

/* ── detail sheet ────────────────────────────────────────── */

type Section = 'overview' | 'keys' | 'webhook' | 'tuning' | 'danger'

function MerchantSheet({
  merchant,
  stores,
  onOpenChange,
}: {
  merchant: Merchant | null
  /** Every store from the already-loaded list (for "copy tiers from store"). */
  stores: Merchant[]
  onOpenChange: (v: boolean) => void
}) {
  const [section, setSection] = React.useState<Section>('overview')
  // Reset to overview whenever a different merchant is opened.
  const merchantId = merchant?.id ?? null
  const [prevMerchantId, setPrevMerchantId] = React.useState<string | null>(merchantId)
  if (prevMerchantId !== merchantId) {
    setPrevMerchantId(merchantId)
    if (merchantId) setSection('overview')
  }

  return (
    <Sheet open={!!merchant} onOpenChange={onOpenChange}>
      <SheetContent>
        {merchant && (
          <>
            <SheetHero
              icon={Store}
              title={merchant.name}
              meta={
                <>
                  <MerchantStatus status={statusOf(merchant)} />
                  {merchant.source !== 'gateway-only' && (
                    <Badge variant="default">{SOURCE_LABEL[merchant.source]}</Badge>
                  )}
                  <span className="max-w-[200px] truncate font-mono text-xs text-[var(--fg-3)]">
                    {merchant.id}
                  </span>
                </>
              }
              actions={<CopyButton value={merchant.id} title="Copy store id" />}
            >
              <MerchantHero m={merchant} />
            </SheetHero>

            <SheetTabs<Section>
              value={section}
              onChange={setSection}
              tabs={[
                { value: 'overview', label: 'Overview', icon: ListBullets },
                { value: 'keys', label: 'API keys', icon: KeyRound },
                { value: 'webhook', label: 'Webhook', icon: Webhook },
                { value: 'tuning', label: 'Tuning', icon: SlidersHorizontal },
                { value: 'danger', label: 'Settings', icon: Settings },
              ]}
            />

            {/* Each tab renders its own SheetBody (+ SheetFooter for its actions). */}
            <React.Fragment key={section}>
              {section === 'overview' && <OverviewSection m={merchant} onNavigate={setSection} />}
              {section === 'keys' && <ApiKeysSection m={merchant} />}
              {section === 'webhook' && <WebhookSection m={merchant} />}
              {section === 'tuning' && <TuningSection m={merchant} stores={stores} />}
              {section === 'danger' && <DangerSection m={merchant} onDone={() => onOpenChange(false)} />}
            </React.Fragment>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* Three key facts under the sheet title. */
function MerchantHero({ m }: { m: Merchant }) {
  const overrides =
    (m.confirmationThresholds ? Object.keys(m.confirmationThresholds).length : 0) +
    (m.confirmationTiers ? Object.keys(m.confirmationTiers).length : 0)
  const cells: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: 'Main key',
      value: m.apiKeyFingerprint ? (
        <span className="font-mono text-sm">sk_…{m.apiKeyFingerprint}</span>
      ) : (
        <span className="text-[var(--fg-3)]">None</span>
      ),
    },
    {
      label: 'Webhook',
      value: m.webhookUrl ? 'Set' : <span className="text-[var(--fg-3)]">Not set</span>,
    },
    {
      label: 'Overrides',
      value: <span className="figure">{overrides}</span>,
    },
  ]
  return (
    <div className="mt-5 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-[var(--bg-2)]">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 px-4 py-3">
          <div className="text-xs text-[var(--fg-2)]">{c.label}</div>
          <div className="mt-0.5 truncate text-base font-semibold">{c.value}</div>
        </div>
      ))}
    </div>
  )
}

/* ── sheet: overview ─────────────────────────────────────── */

function bpsLabel(bps: number): string {
  if (bps === 0) return '0%'
  const pct = bps / 100
  return pct < 1 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`
}

function OverviewSection({
  m,
  onNavigate,
}: {
  m: Merchant
  onNavigate: (s: Section) => void
}) {
  const confCount = m.confirmationThresholds ? Object.keys(m.confirmationThresholds).length : 0
  const tierCount = m.confirmationTiers ? Object.keys(m.confirmationTiers).length : 0
  const hasTolerance = m.paymentToleranceUnderBps != null || m.paymentToleranceOverBps != null
  // Distinct chains that carry an override (flat or tiered), for the logo row.
  const overrideChains = Array.from(
    new Set([
      ...Object.keys(m.confirmationThresholds ?? {}),
      ...Object.keys(m.confirmationTiers ?? {}).map((k) => k.split(':')[0]),
    ]),
  )
    .map((c) => parseInt(c, 10))
    .filter((c) => Number.isFinite(c))
  return (
    <>
    <SheetBody className="fade-in">
    <div className="space-y-6">
      {m.source === 'gateway-only' && (
        <Callout tone="warn" icon={Shield} title="Not usable from this dashboard">
          No sealed API key is held here. In{' '}
          <span className="font-medium">Settings</span>: <em>Attach</em> if
          you still have the plaintext, or <em>Rotate</em> to mint a fresh one.
        </Callout>
      )}

      <SheetSection title="Details">
        <dl className="divide-y divide-border rounded-xl border border-border">
          <Fact icon={Store} label="Name">
            <span className="font-medium">{m.name}</span>
          </Fact>
          <Fact icon={Power} label="Status">
            <span className="inline-flex justify-end">
              <StatusPill
                tone={m.active === true ? 'ok' : m.active === false ? 'off' : 'wait'}
              >
                {m.active === true ? 'Active' : m.active === false ? 'Inactive' : 'Unknown'}
              </StatusPill>
            </span>
          </Fact>
          <Fact icon={Database} label="Source">
            {SOURCE_LABEL[m.source]}
          </Fact>
          <Fact icon={KeyRound} label="Main key">
            {m.apiKeyFingerprint ? (
              <span className="font-mono text-xs">
                sk_…{m.apiKeyFingerprint}
                <span className="ml-1.5 font-sans text-[var(--fg-2)]">· full access</span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">—</span>
            )}
          </Fact>
          <Fact icon={Webhook} label="Webhook">
            {m.webhookUrl ? (
              <span className="flex min-w-0 items-center justify-end gap-1">
                <span className="truncate font-mono text-xs" title={m.webhookUrl}>
                  {m.webhookUrl}
                </span>
                <CopyButton value={m.webhookUrl} />
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">Not set</span>
            )}
          </Fact>
        </dl>
      </SheetSection>

      <SheetSection title="Payments">
        <dl className="divide-y divide-border rounded-xl border border-border">
          <Fact icon={Scale} label="Tolerance">
            {hasTolerance ? (
              <span className="figure">
                −{bpsLabel(m.paymentToleranceUnderBps ?? 0)} / +
                {bpsLabel(m.paymentToleranceOverBps ?? 0)}
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">Default</span>
            )}
          </Fact>
          <Fact icon={Timer} label="Cooldown">
            {m.addressCooldownSeconds != null ? (
              <span className="figure">{m.addressCooldownSeconds}s</span>
            ) : (
              <span className="text-[var(--fg-3)]">Default</span>
            )}
          </Fact>
          <Fact icon={Layers} label="Confirmations">
            {confCount + tierCount > 0 ? (
              <span className="inline-flex items-center justify-end gap-2">
                <span className="inline-flex items-center">
                  {overrideChains.slice(0, 5).map((c, i) => (
                    <span
                      key={c}
                      className="grid place-items-center rounded-full bg-card ring-2 ring-[var(--bg-1)]"
                      style={{ marginLeft: i === 0 ? 0 : -5 }}
                    >
                      <ChainIcon chainId={c} size={18} />
                    </span>
                  ))}
                </span>
                <span className="figure">
                  {confCount} chain{confCount === 1 ? '' : 's'} · {tierCount} tier
                  {tierCount === 1 ? '' : 's'}
                </span>
              </span>
            ) : (
              <span className="text-[var(--fg-3)]">Gateway defaults</span>
            )}
          </Fact>
        </dl>
      </SheetSection>

      <SheetSection title="Activity">
        <dl className="divide-y divide-border rounded-xl border border-border">
          <Fact icon={Calendar} label="Created">
            {fmtLocal(m.createdAt)}
          </Fact>
          <Fact icon={Clock} label="Updated">
            <span title={fmtLocal(m.updatedAt)}>{fmtRel(m.updatedAt)}</span>
          </Fact>
        </dl>
      </SheetSection>
    </div>
    </SheetBody>
    <SheetFooter>
      <Button size="sm" variant="outline" onClick={() => onNavigate('tuning')}>
        <SlidersHorizontal className="size-4" /> Tune
      </Button>
      <Button size="sm" onClick={() => onNavigate('keys')}>
        <KeyRound className="size-4" /> Manage keys
      </Button>
    </SheetFooter>
    </>
  )
}

/** One row of a details list: icon · label on the left, value on the right. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-[var(--fg-2)]">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right">{children}</dd>
    </div>
  )
}

/** Info icon with a tooltip, for guidance that would otherwise be a paragraph. */
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className="inline-flex size-5 cursor-help items-center justify-center rounded-full text-[var(--fg-3)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty font-normal leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/* ── sheet: webhook ──────────────────────────────────────── */

function WebhookSection({ m }: { m: Merchant }) {
  const qc = useQueryClient()
  const [url, setUrl] = React.useState(m.webhookUrl ?? '')
  const [revealed, setRevealed] = React.useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = React.useState(false)

  // Re-sync the URL field when the merchant changes (different sheet) or
  // when the persisted URL itself changes (rotate-secret response).
  const syncKey = `${m.id}|${m.webhookUrl ?? ''}`
  const [prevSyncKey, setPrevSyncKey] = React.useState(syncKey)
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey)
    setUrl(m.webhookUrl ?? '')
  }

  const save = useMutation({
    mutationFn: () =>
      api<{ webhookSecret?: string }>(
        `/api/merchants/${encodeURIComponent(m.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ webhookUrl: url.trim() || null }),
        },
      ),
    onSuccess: (res) => {
      toast.success('Webhook URL saved')
      if (res.webhookSecret) setRevealed(res.webhookSecret)
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not save'),
  })

  const rotate = useMutation({
    mutationFn: () =>
      api<{ webhookSecret: string }>(
        `/api/merchants/${encodeURIComponent(m.id)}/rotate-webhook-secret`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      setRevealed(res.webhookSecret)
      setConfirmRotate(false)
    },
    onError: (e: ApiError) => {
      setConfirmRotate(false)
      toast.error(e.message || 'Could not rotate secret')
    },
  })

  const dirty = (m.webhookUrl ?? '') !== url.trim()
  const firstTime = !m.webhookUrl && !!url.trim()

  const formId = `webhook-${m.id}`

  return (
    <>
    <SheetBody className="fade-in">
    <div className="space-y-6">
      <SheetSection title="Endpoint" icon={Webhook}>
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field
            label="Webhook URL"
            hint={
              firstTime
                ? 'First-time URL — the gateway will mint a signing secret you can view once.'
                : 'Where the gateway POSTs status updates.'
            }
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://store.example.com/hooks/gateway"
              type="url"
              className="font-mono"
            />
          </Field>
        </form>
      </SheetSection>

      <SheetSection title="Signing secret" icon={KeyRound}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border px-4 py-3.5">
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex items-center gap-2">
              {m.webhookUrl ? (
                <StatusPill tone="ok">Issued</StatusPill>
              ) : (
                <StatusPill tone="wait">Not issued</StatusPill>
              )}
              <span className="text-xs text-[var(--fg-2)]">HMAC · 64 hex</span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--fg-2)]">
              {m.webhookUrl
                ? 'Rotating invalidates the old secret immediately — shown once on success.'
                : 'Minted on the first URL save and shown once.'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!m.webhookUrl || rotate.isPending}
            onClick={() => setConfirmRotate(true)}
            title={
              m.webhookUrl
                ? 'Mint a new signing secret'
                : 'Save a webhook URL first'
            }
          >
            <KeyRound className="size-4" /> Rotate
          </Button>
        </div>
      </SheetSection>
    </div>
    </SheetBody>

    <SheetFooter>
      {m.webhookUrl && url.trim() === '' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setUrl(m.webhookUrl ?? '')}
        >
          Undo clear
        </Button>
      )}
      <Button size="sm" type="submit" form={formId} disabled={!dirty || save.isPending}>
        <Save className="size-4" />
        {save.isPending ? 'Saving…' : 'Save URL'}
      </Button>
    </SheetFooter>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        icon={KeyRound}
        title="Rotate webhook secret?"
        body="The gateway will invalidate the current signing secret and mint a fresh one, shown once."
        cta="Rotate secret"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />

      <RevealOnceDialog
        value={revealed}
        title="Webhook signing secret"
        description="Shown once. Paste it into your store's HMAC verifier before dismissing."
        onClose={() => setRevealed(null)}
      />
    </>
  )
}

/* ── sheet: api keys ─────────────────────────────────────── */

const SCOPE_INFO: Record<ApiKeyScope, { label: string; hint: string; risky?: boolean }> = {
  'invoices:read': { label: 'Read invoices', hint: "List and view this store's invoices." },
  'invoices:write': { label: 'Create invoices', hint: 'Create and expire invoices to take payments.' },
  'payouts:read': { label: 'Read payouts', hint: 'List and view payouts.' },
  'payouts:write': {
    label: 'Send payouts',
    hint: 'Send money out of the shared pool. Never put this on a website.',
    risky: true,
  },
}
const DEFAULT_SCOPES: ApiKeyScope[] = ['invoices:read', 'invoices:write']

/** Scopes grouped by resource (the part before ':'), in API_KEY_SCOPES order. */
const SCOPE_GROUPS: Array<{ resource: string; scopes: ApiKeyScope[] }> =
  API_KEY_SCOPES.reduce<Array<{ resource: string; scopes: ApiKeyScope[] }>>(
    (groups, s) => {
      const resource = s.split(':')[0]
      const g = groups.find((x) => x.resource === resource)
      if (g) g.scopes.push(s)
      else groups.push({ resource, scopes: [s] })
      return groups
    },
    [],
  )

function apiKeysQueryKey(merchantId: string) {
  return ['merchant-api-keys', merchantId] as const
}

function unixOf(iso: string): number {
  const t = Date.parse(iso)
  return isFinite(t) ? Math.floor(t / 1000) : 0
}

function ScopeTag({ scope }: { scope: ApiKeyScope }) {
  const info = SCOPE_INFO[scope]
  if (info?.risky) {
    return (
      <Badge variant="warn" title={`${scope} · sensitive`}>
        <ShieldAlert /> {info.label}
      </Badge>
    )
  }
  return (
    <Badge variant="default" title={scope}>
      {info?.label ?? scope}
    </Badge>
  )
}

function ApiKeysSection({ m }: { m: Merchant }) {
  const qc = useQueryClient()
  const queryKey = apiKeysQueryKey(m.id)
  const keys = useQuery({
    queryKey,
    queryFn: () =>
      api<{ keys: MerchantApiKey[] }>(
        `/api/merchants/${encodeURIComponent(m.id)}/api-keys`,
      ),
    select: (r) => r.keys,
    staleTime: 10_000,
  })
  const [createOpen, setCreateOpen] = React.useState(false)
  const [revealed, setRevealed] = React.useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = React.useState<MerchantApiKey | null>(null)
  const [showRevoked, setShowRevoked] = React.useState(false)

  const revoke = useMutation({
    mutationFn: (k: MerchantApiKey) =>
      api<{ key: MerchantApiKey }>(
        `/api/merchants/${encodeURIComponent(m.id)}/api-keys/${encodeURIComponent(k.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      toast.success('API key revoked')
      setRevokeTarget(null)
      qc.invalidateQueries({ queryKey })
    },
    onError: (e: ApiError) => {
      setRevokeTarget(null)
      toast.error(e.message || 'Could not revoke key')
    },
  })

  const all = keys.data ?? []
  const active = all.filter((k) => !k.revokedAt)
  const revoked = all.filter((k) => !!k.revokedAt)
  const shown = showRevoked ? all : active

  return (
    <>
    <SheetBody className="fade-in">
    <div className="space-y-6">
      <Callout icon={KeyRound}>
        One key per website or app, with only the access it needs. Payout
        access is off by default. The main key{' '}
        {m.apiKeyFingerprint && (
          <span className="font-mono">(sk_…{m.apiKeyFingerprint})</span>
        )}{' '}
        keeps full access for this dashboard — don't hand it out.
      </Callout>

      {m.active === false && (
        <Callout tone="warn" title="Store is deactivated">
          All of this store's keys are rejected until it is activated again.
        </Callout>
      )}

      <SheetSection
        title={
          <span className="flex items-center gap-2">
            Keys
            {keys.isSuccess && (
              <span className="figure rounded-full bg-[var(--bg-active)] px-1.5 text-2xs font-medium text-[var(--fg-1)]">
                {active.length}
              </span>
            )}
          </span>
        }
        action={
          revoked.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setShowRevoked((v) => !v)}>
              {showRevoked ? 'Hide revoked' : `Show revoked (${revoked.length})`}
            </Button>
          ) : null
        }
      >
        {keys.isPending && (
          <div className="divide-y divide-border rounded-xl border border-border">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-32" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        )}

        {keys.isError && (
          <Callout tone="warn" title="Couldn't load keys">
            {(keys.error as ApiError)?.message || 'The gateway did not answer.'} If
            this keeps happening, the gateway may not have the scoped-keys update
            (migration 0027) yet.
          </Callout>
        )}

        {keys.isSuccess && shown.length === 0 && (
          <SharedEmptyState
            framed
            compact
            icon={KeyRound}
            title="No extra keys yet"
            description="Create one per website or app."
            action={
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> New key
              </Button>
            }
          />
        )}

        {keys.isSuccess && shown.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {shown.map((k) => (
              <li
                key={k.id}
                className={cn(
                  'flex items-start gap-3 px-4 py-3.5',
                  k.revokedAt && 'bg-[var(--bg-2)]',
                )}
              >
                <div className={cn('flex min-w-0 flex-1 items-start gap-3', k.revokedAt && 'opacity-55')}>
                  <RowAvatar icon={KeyRound} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium">{k.label ?? 'Unnamed key'}</span>
                      <span className="font-mono text-xs text-[var(--fg-2)]">sk_…{k.fingerprint}</span>
                      {k.revokedAt && (
                        <StatusPill tone="bad" size="sm">
                          Revoked
                        </StatusPill>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {k.scopes.length === 0 ? (
                        <StatusPill tone="bad" size="sm">
                          No valid scopes
                        </StatusPill>
                      ) : (
                        k.scopes.map((s) => <ScopeTag key={s} scope={s} />)
                      )}
                    </div>
                    <div
                      className="mt-2 text-xs text-[var(--fg-3)]"
                      title={`Created ${fmtLocal(k.createdAt)}${k.revokedAt ? ` · revoked ${fmtLocal(k.revokedAt)}` : ''}`}
                    >
                      Created {fmtRel(unixOf(k.createdAt))}
                      {k.revokedAt && ` · revoked ${fmtRel(unixOf(k.revokedAt))}`}
                    </div>
                  </div>
                </div>
                {!k.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
                    onClick={() => setRevokeTarget(k)}
                    disabled={revoke.isPending}
                  >
                    <Ban className="size-4" /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SheetSection>
    </div>
    </SheetBody>

    <SheetFooter className="justify-between">
      <div className="figure text-xs text-[var(--fg-2)]">
        {keys.isSuccess &&
          `${active.length} active${revoked.length ? ` · ${revoked.length} revoked` : ''}`}
      </div>
      <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!keys.isSuccess}>
        <Plus className="size-4" /> New key
      </Button>
    </SheetFooter>

      <CreateApiKeyDialog
        merchantId={m.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(apiKey) => {
          setCreateOpen(false)
          setRevealed(apiKey)
          qc.invalidateQueries({ queryKey })
        }}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(v) => !v && setRevokeTarget(null)}
        icon={Ban}
        title="Revoke this API key?"
        body={
          <>
            {revokeTarget?.label ?? 'This key'}{' '}
            <span className="font-mono">(sk_…{revokeTarget?.fingerprint})</span> stops
            working immediately. Anything still using it will get 401 errors. This
            can't be undone — create a new key if you need one.
          </>
        }
        cta="Revoke key"
        destructive
        pending={revoke.isPending}
        onConfirm={() => revokeTarget && revoke.mutate(revokeTarget)}
      />

      <RevealOnceDialog
        value={revealed}
        title="New API key"
        description="Shown once and not stored by this dashboard. Copy it into the store's website or app settings now."
        onClose={() => setRevealed(null)}
      />
    </>
  )
}

function CreateApiKeyDialog({
  merchantId,
  open,
  onOpenChange,
  onCreated,
}: {
  merchantId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (apiKey: string) => void
}) {
  const [label, setLabel] = React.useState('')
  const [scopes, setScopes] = React.useState<ApiKeyScope[]>(DEFAULT_SCOPES)

  // Fresh form every time the dialog opens.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setLabel('')
      setScopes(DEFAULT_SCOPES)
    }
  }

  const create = useMutation({
    mutationFn: () =>
      api<{ key: MerchantApiKey; apiKey: string }>(
        `/api/merchants/${encodeURIComponent(merchantId)}/api-keys`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(label.trim() ? { label: label.trim() } : {}),
            scopes,
          }),
        },
      ),
    onSuccess: (res) => {
      toast.success('API key created')
      onCreated(res.apiKey)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not create key'),
  })

  const toggle = (s: ApiKeyScope) =>
    setScopes((cur) =>
      cur.includes(s)
        ? cur.filter((x) => x !== s)
        : API_KEY_SCOPES.filter((x) => x === s || cur.includes(x)),
    )
  const sendsPayouts = scopes.includes('payouts:write')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            Pick only what this website or app needs. You can't change a key's
            access later — revoke it and create a new one.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (scopes.length > 0) create.mutate()
          }}
        >
          <Field label="Name" hint="e.g. “Main website”">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={64}
              placeholder="Main website"
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Access</legend>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {SCOPE_GROUPS.map((g) => (
                <div key={g.resource}>
                  <div className="bg-[var(--bg-2)] px-4 py-2 text-xs font-medium text-[var(--fg-2)] capitalize">
                    {g.resource}
                  </div>
                  <div className="divide-y divide-border border-t border-border">
                    {g.scopes.map((s) => (
                      <label
                        key={s}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
                          SCOPE_INFO[s].risky && scopes.includes(s)
                            ? 'bg-[var(--warn-bg)]'
                            : 'bg-card hover:bg-[var(--bg-hover)]',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={scopes.includes(s)}
                          onChange={() => toggle(s)}
                          disabled={create.isPending}
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium">{SCOPE_INFO[s].label}</span>
                            <span className="font-mono text-xs text-[var(--fg-3)]">{s}</span>
                            {SCOPE_INFO[s].risky && (
                              <Badge variant="warn">
                                <ShieldAlert /> Sensitive
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--fg-2)]">
                            {SCOPE_INFO[s].hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {sendsPayouts && (
            <Callout tone="warn" title="This key can send money">
              Anyone holding it can pay out from the shared pool. Only give it
              to a server you control, never to a website or browser code.
            </Callout>
          )}
          {scopes.length === 0 && (
            <p className="text-xs text-destructive">Pick at least one permission.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={scopes.length === 0 || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── sheet: tuning ───────────────────────────────────────── */

type ThresholdRow = { id: string; chainId: string; value: string }

function thresholdsToRows(
  m: Record<string, number> | null | undefined,
): ThresholdRow[] {
  if (!m) return []
  return Object.entries(m)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([chainId, value], i) => ({
      id: `${chainId}-${i}`,
      chainId,
      value: String(value),
    }))
}

const TIER_OPS: ConfirmationTierOp[] = ['<', '<=', '=', '<>', '>=', '>']

const TIER_OP_LABEL: Record<ConfirmationTierOp, string> = {
  '<': 'LESS',
  '<=': 'LESS OR EQUALS',
  '=': 'EQUALS',
  '<>': 'NOT EQUALS',
  '>=': 'GREATER OR EQUALS',
  '>': 'GREATER',
}

// Phrasing for the per-rule preview line — slightly more natural English
// than the dropdown labels, which use the standard programmer terms.
const TIER_OP_PREVIEW: Record<ConfirmationTierOp, string> = {
  '<': 'is less than',
  '<=': 'is less than or equal to',
  '=': 'equals',
  '<>': 'does not equal',
  '>=': 'is greater than or equal to',
  '>': 'is greater than',
}

/**
 * Render a rule as a single English sentence. Used for the live preview
 * line beneath each rule editor row so operators can sanity-check what
 * they've just typed.
 */
function describeTierRule(rule: TierRuleRow, token: string): string {
  const tok = token || 'token'
  const conf = rule.confirmations.trim()
  const confLabel = conf === '' ? 'N' : `${conf} confirmation${conf === '1' ? '' : 's'}`
  if (rule.op === '') {
    return `Otherwise → require ${confLabel} (catch-all)`
  }
  const amount = rule.amount.trim() || '?'
  return `If amount ${TIER_OP_PREVIEW[rule.op]} ${amount} ${tok} → require ${confLabel}`
}

type TierRuleRow = {
  id: string
  /** Empty string means "catch-all" (no `amount` / `op` in the wire payload). */
  op: '' | ConfirmationTierOp
  amount: string
  confirmations: string
}
type TierGroup = {
  id: string
  chainId: string
  token: string
  rules: TierRuleRow[]
}

function tiersToGroups(
  m: Record<string, ConfirmationTierRule[]> | null | undefined,
): TierGroup[] {
  if (!m) return []
  return Object.entries(m)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rules], i) => {
      const [chainPart, ...tokenParts] = key.split(':')
      const chainId = chainPart ?? ''
      const token = tokenParts.join(':')
      return {
        id: `${key}-${i}`,
        chainId,
        token,
        rules: rules.map((r, j) => ({
          id: `${key}-${i}-${j}`,
          op: (r.op ?? '') as TierRuleRow['op'],
          amount: r.amount ?? '',
          confirmations: String(r.confirmations),
        })),
      }
    })
}

function TuningSection({ m, stores }: { m: Merchant; stores: Merchant[] }) {
  const qc = useQueryClient()
  const [name, setName] = React.useState(m.name)
  const [under, setUnder] = React.useState(
    m.paymentToleranceUnderBps?.toString() ?? '',
  )
  const [over, setOver] = React.useState(
    m.paymentToleranceOverBps?.toString() ?? '',
  )
  const [cooldown, setCooldown] = React.useState(
    m.addressCooldownSeconds?.toString() ?? '',
  )
  const [thresholdRows, setThresholdRows] = React.useState<ThresholdRow[]>(() =>
    thresholdsToRows(m.confirmationThresholds),
  )
  const [tierGroups, setTierGroups] = React.useState<TierGroup[]>(() =>
    tiersToGroups(m.confirmationTiers),
  )

  // Re-seed inputs when a different merchant is opened.
  const [prevId, setPrevId] = React.useState(m.id)
  if (prevId !== m.id) {
    setPrevId(m.id)
    setName(m.name)
    setUnder(m.paymentToleranceUnderBps?.toString() ?? '')
    setOver(m.paymentToleranceOverBps?.toString() ?? '')
    setCooldown(m.addressCooldownSeconds?.toString() ?? '')
    setThresholdRows(thresholdsToRows(m.confirmationThresholds))
    setTierGroups(tiersToGroups(m.confirmationTiers))
  }

  // Look up gateway-default confirmations per chain so we can flag rows that
  // dip below it (matches the backend's `merchant_confirmation_below_default`
  // WARN log).
  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  })
  const defaultByChainId = React.useMemo(() => {
    const out = new Map<string, number>()
    for (const c of chainsQ.data?.chains ?? []) {
      out.set(String(c.chainId), c.confirmationsRequired)
    }
    return out
  }, [chainsQ.data])

  // Build the JSON payload from current rows. Returns `{ ok, body, error }`
  // — `body` carries the parsed object when ok, `null` to clear (when there
  // are no rows AND the merchant currently has overrides), or `undefined`
  // (skip) when nothing changed.
  const buildThresholdsPatch = ():
    | { ok: true; value: Record<string, number> | null | undefined }
    | { ok: false; error: string } => {
    // No changes (rows are empty AND merchant has no current overrides).
    const cur = m.confirmationThresholds ?? null
    const trimmed = thresholdRows.filter(
      (r) => r.chainId.trim() !== '' || r.value.trim() !== '',
    )

    if (trimmed.length === 0) {
      if (cur === null) return { ok: true, value: undefined }
      return { ok: true, value: null }
    }

    const seen = new Set<string>()
    const out: Record<string, number> = {}
    for (const r of trimmed) {
      const k = r.chainId.trim()
      const v = r.value.trim()
      if (!/^\d+$/.test(k) || Number(k) <= 0) {
        return { ok: false, error: `Invalid chain id "${r.chainId}"` }
      }
      if (seen.has(k)) {
        return { ok: false, error: `Duplicate chain id ${k}` }
      }
      seen.add(k)
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        return {
          ok: false,
          error: `Confirmations for chain ${k} must be 0–10000`,
        }
      }
      out[k] = n
    }
    // Skip if identical to current.
    if (cur && Object.keys(out).length === Object.keys(cur).length) {
      const same = Object.entries(out).every(([k, v]) => cur[k] === v)
      if (same) return { ok: true, value: undefined }
    }
    return { ok: true, value: out }
  }

  // Mirror of buildThresholdsPatch for the tier map. Each tier-key needs at
  // least one rule; rules without an op are catch-alls; ops must come with
  // an amount that parses as decimal.
  const buildTiersPatch = ():
    | {
        ok: true
        value: Record<string, ConfirmationTierRule[]> | null | undefined
      }
    | { ok: false; error: string } => {
    const cur = m.confirmationTiers ?? null
    const trimmedGroups = tierGroups.filter(
      (g) => g.chainId.trim() !== '' || g.token.trim() !== '' || g.rules.length > 0,
    )

    if (trimmedGroups.length === 0) {
      return { ok: cur === null ? true : true, value: cur === null ? undefined : null }
    }

    const seenKeys = new Set<string>()
    const out: Record<string, ConfirmationTierRule[]> = {}
    for (const g of trimmedGroups) {
      const chainId = g.chainId.trim()
      const token = g.token.trim().toUpperCase()
      if (!/^\d+$/.test(chainId) || Number(chainId) <= 0) {
        return { ok: false, error: `Invalid chain id "${g.chainId}"` }
      }
      if (!/^[A-Z0-9]+$/.test(token)) {
        return { ok: false, error: `Pick a token for chain ${chainId}` }
      }
      const key = `${chainId}:${token}`
      if (seenKeys.has(key)) {
        return { ok: false, error: `Duplicate tier key ${key}` }
      }
      seenKeys.add(key)
      if (g.rules.length === 0) {
        return { ok: false, error: `${key} has no rules — add one or remove the group` }
      }
      if (g.rules.length > 20) {
        return { ok: false, error: `${key} has more than 20 rules (max 20)` }
      }
      const rules: ConfirmationTierRule[] = []
      for (const r of g.rules) {
        const conf = parseInt(r.confirmations.trim(), 10)
        if (!Number.isFinite(conf) || conf < 0 || conf > 10000) {
          return {
            ok: false,
            error: `${key}: confirmations must be 0–10000`,
          }
        }
        const opStr = r.op
        const amountStr = r.amount.trim()
        if (opStr === '') {
          // catch-all — amount must be empty
          if (amountStr !== '') {
            return {
              ok: false,
              error: `${key}: catch-all rule cannot have an amount; pick an operator or clear the amount`,
            }
          }
          rules.push({ confirmations: conf })
        } else {
          if (!/^\d+(\.\d+)?$/.test(amountStr)) {
            return {
              ok: false,
              error: `${key}: amount must be a decimal number for op "${opStr}"`,
            }
          }
          rules.push({ op: opStr, amount: amountStr, confirmations: conf })
        }
      }
      out[key] = rules
    }

    // Skip if identical to current.
    if (cur && Object.keys(out).length === Object.keys(cur).length) {
      const same = Object.entries(out).every(([k, v]) => {
        const prev = cur[k]
        if (!prev || prev.length !== v.length) return false
        return v.every((rule, i) => {
          const p = prev[i]
          return (
            (p.op ?? '') === (rule.op ?? '') &&
            (p.amount ?? '') === (rule.amount ?? '') &&
            p.confirmations === rule.confirmations
          )
        })
      })
      if (same) return { ok: true, value: undefined }
    }
    return { ok: true, value: out }
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      if (name.trim() && name.trim() !== m.name) body.name = name.trim()
      const u = under.trim()
      const o = over.trim()
      const c = cooldown.trim()
      if (u !== '' && parseInt(u, 10) !== m.paymentToleranceUnderBps)
        body.paymentToleranceUnderBps = parseInt(u, 10)
      if (o !== '' && parseInt(o, 10) !== m.paymentToleranceOverBps)
        body.paymentToleranceOverBps = parseInt(o, 10)
      if (c !== '' && parseInt(c, 10) !== m.addressCooldownSeconds)
        body.addressCooldownSeconds = parseInt(c, 10)
      const t = buildThresholdsPatch()
      if (!t.ok) throw new Error(t.error)
      if (t.value !== undefined) body.confirmationThresholds = t.value
      const tiers = buildTiersPatch()
      if (!tiers.ok) throw new Error(tiers.error)
      if (tiers.value !== undefined) body.confirmationTiers = tiers.value
      if (Object.keys(body).length === 0) throw new Error('Nothing to update')
      return api(`/api/merchants/${encodeURIComponent(m.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      toast.success('Tuning updated')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError | Error) =>
      toast.error(e.message || 'Could not update'),
  })

  const addThresholdRow = () =>
    setThresholdRows((rows) => [
      ...rows,
      { id: `new-${Date.now()}-${Math.random()}`, chainId: '', value: '' },
    ])
  const updateThresholdRow = (id: string, patch: Partial<ThresholdRow>) =>
    setThresholdRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    )
  const removeThresholdRow = (id: string) =>
    setThresholdRows((rows) => rows.filter((r) => r.id !== id))

  const addTierGroup = () =>
    setTierGroups((groups) => [
      ...groups,
      {
        id: `g-${Date.now()}-${Math.random()}`,
        chainId: '',
        token: '',
        rules: [
          {
            id: `r-${Date.now()}-${Math.random()}`,
            op: '',
            amount: '',
            confirmations: '',
          },
        ],
      },
    ])
  const updateTierGroup = (id: string, patch: Partial<TierGroup>) =>
    setTierGroups((groups) =>
      groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    )
  const removeTierGroup = (id: string) =>
    setTierGroups((groups) => groups.filter((g) => g.id !== id))
  const addTierRule = (groupId: string) =>
    setTierGroups((groups) =>
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rules: [
                ...g.rules,
                {
                  id: `r-${Date.now()}-${Math.random()}`,
                  op: '',
                  amount: '',
                  confirmations: '',
                },
              ],
            }
          : g,
      ),
    )
  const updateTierRule = (
    groupId: string,
    ruleId: string,
    patch: Partial<TierRuleRow>,
  ) =>
    setTierGroups((groups) =>
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rules: g.rules.map((r) =>
                r.id === ruleId ? { ...r, ...patch } : r,
              ),
            }
          : g,
      ),
    )
  const removeTierRule = (groupId: string, ruleId: string) =>
    setTierGroups((groups) =>
      groups.map((g) =>
        g.id === groupId
          ? { ...g, rules: g.rules.filter((r) => r.id !== ruleId) }
          : g,
      ),
    )
  const moveTierRule = (
    groupId: string,
    ruleId: string,
    delta: number,
  ) =>
    setTierGroups((groups) =>
      groups.map((g) => {
        if (g.id !== groupId) return g
        const idx = g.rules.findIndex((r) => r.id === ruleId)
        if (idx < 0) return g
        const next = idx + delta
        if (next < 0 || next >= g.rules.length) return g
        const arr = g.rules.slice()
        const [item] = arr.splice(idx, 1)
        arr.splice(next, 0, item)
        return { ...g, rules: arr }
      }),
    )

  // ── tier clipboard / copy-from-store (fills the editor only; Save applies) ──
  const tiersFormId = `tuning-${m.id}`
  const otherStores = stores.filter((s) => s.id !== m.id)

  const copyTiers = async () => {
    const t = buildTiersPatch()
    if (!t.ok) {
      toast.error(t.error)
      return
    }
    const value = t.value === undefined ? (m.confirmationTiers ?? {}) : (t.value ?? {})
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      toast.success(`Copied ${Object.keys(value).length} tier group(s)`)
    } catch {
      toast.error('Clipboard is not available')
    }
  }

  const pasteTiers = async () => {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      toast.error('Clipboard is not available')
      return
    }
    const parsed = parseTiersJson(text)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    setTierGroups(tiersToGroups(parsed.value))
    toast.success('Tiers pasted — press Save to apply')
  }

  const loadTiersFrom = (store: Merchant) => {
    setTierGroups(tiersToGroups(store.confirmationTiers))
    toast.success(`Loaded tiers from ${store.name} — press Save to apply`)
  }

  return (
    <>
      <SheetBody className="fade-in">
        <form
          id={tiersFormId}
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <SheetSection title="General" icon={Store}>
            <Field label="Display name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
              />
            </Field>
          </SheetSection>

          <SheetSection
            title="Payments"
            icon={Scale}
            action={<InfoTip>1 bps = 0.01% (50 = 0.5%, 100 = 1%).</InfoTip>}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Under-pay (bps)">
                <Input
                  value={under}
                  onChange={(e) => setUnder(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="figure"
                />
              </Field>
              <Field label="Over-pay (bps)">
                <Input
                  value={over}
                  onChange={(e) => setOver(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="figure"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Address cooldown (seconds)"
                  hint="Applies to releases AFTER this change; stamped cooldowns are unaffected."
                >
                  <Input
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    placeholder="0 – 604800"
                    inputMode="numeric"
                    className="figure"
                  />
                </Field>
              </div>
            </div>
          </SheetSection>

          <ConfirmationThresholdsEditor
            rows={thresholdRows}
            defaults={defaultByChainId}
            availableChains={chainsQ.data?.chains ?? []}
            onAdd={addThresholdRow}
            onUpdate={updateThresholdRow}
            onRemove={removeThresholdRow}
            onClear={() => setThresholdRows([])}
          />

          <ConfirmationTiersEditor
            groups={tierGroups}
            availableChains={chainsQ.data?.chains ?? []}
            onAddGroup={addTierGroup}
            onUpdateGroup={updateTierGroup}
            onRemoveGroup={removeTierGroup}
            onAddRule={addTierRule}
            onUpdateRule={updateTierRule}
            onRemoveRule={removeTierRule}
            onMoveRule={moveTierRule}
            onClear={() => setTierGroups([])}
            toolbar={
              <TierToolbar
                stores={otherStores}
                onCopy={copyTiers}
                onPaste={pasteTiers}
                onLoadFrom={loadTiersFrom}
              />
            }
          />
        </form>
      </SheetBody>
      <SheetFooter className="justify-between">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--fg-2)]">
          <CircleDashed className="size-4 shrink-0" />
          <span>
            Tolerance, threshold + tier changes apply to{' '}
            <span className="font-medium text-foreground">new</span> invoices only —
            existing invoices keep their snapshotted values.
          </span>
        </div>
        <Button type="submit" form={tiersFormId} size="sm" className="shrink-0" disabled={save.isPending}>
          <Save className="size-4" />
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </SheetFooter>
    </>
  )
}

/** Validates a pasted `confirmationTiers` JSON blob (shape only). */
function parseTiersJson(
  text: string,
):
  | { ok: true; value: Record<string, ConfirmationTierRule[]> }
  | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text.trim())
  } catch {
    return { ok: false, error: 'Clipboard does not hold valid JSON' }
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Expected an object of "chainId:TOKEN" → rules' }
  }
  const out: Record<string, ConfirmationTierRule[]> = {}
  for (const [key, rules] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+:[A-Za-z0-9]+$/.test(key)) {
      return { ok: false, error: `Bad tier key "${key}" — expected "chainId:TOKEN"` }
    }
    if (!Array.isArray(rules)) {
      return { ok: false, error: `${key}: rules must be an array` }
    }
    const list: ConfirmationTierRule[] = []
    for (const r of rules as unknown[]) {
      if (r == null || typeof r !== 'object' || Array.isArray(r)) {
        return { ok: false, error: `${key}: each rule must be an object` }
      }
      const rule = r as Record<string, unknown>
      if (typeof rule.confirmations !== 'number' || !Number.isInteger(rule.confirmations)) {
        return { ok: false, error: `${key}: confirmations must be an integer` }
      }
      if (rule.op == null) {
        list.push({ confirmations: rule.confirmations })
        continue
      }
      if (!TIER_OPS.includes(rule.op as ConfirmationTierOp)) {
        return { ok: false, error: `${key}: unknown operator "${String(rule.op)}"` }
      }
      if (typeof rule.amount !== 'string' && typeof rule.amount !== 'number') {
        return { ok: false, error: `${key}: rule with an operator needs an amount` }
      }
      list.push({
        op: rule.op as ConfirmationTierOp,
        amount: String(rule.amount),
        confirmations: rule.confirmations,
      })
    }
    out[key.split(':')[0] + ':' + key.split(':')[1].toUpperCase()] = list
  }
  return { ok: true, value: out }
}

function ToolIconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function TierToolbar({
  stores,
  onCopy,
  onPaste,
  onLoadFrom,
}: {
  stores: Merchant[]
  onCopy: () => void
  onPaste: () => void
  onLoadFrom: (store: Merchant) => void
}) {
  const tierCount = (s: Merchant) =>
    s.confirmationTiers ? Object.keys(s.confirmationTiers).length : 0
  return (
    <div className="flex items-center gap-0.5 rounded-[10px] border border-border p-0.5">
      <ToolIconButton label="Copy tiers as JSON" onClick={onCopy}>
        <Copy className="size-4" />
      </ToolIconButton>
      <ToolIconButton label="Paste tiers from clipboard" onClick={onPaste}>
        <ClipboardText className="size-4" />
      </ToolIconButton>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Copy from store"
                disabled={stores.length === 0}
              >
                <Store className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Copy from store…</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="max-h-72 w-60 overflow-y-auto">
          <DropdownMenuLabel>Load tiers from</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {stores.map((s) => {
            const n = tierCount(s)
            return (
              <DropdownMenuItem key={s.id} disabled={n === 0} onSelect={() => onLoadFrom(s)}>
                <RowAvatar text={initialsOf(s.name)} className="size-6" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="figure text-xs text-[var(--fg-3)]">{n === 0 ? 'none' : n}</span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function RowIconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-[var(--fg-3)] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'hover:bg-[var(--danger-bg)] hover:text-destructive'
          : 'hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function AddRowButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 text-sm text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="size-4" />
      {children}
    </button>
  )
}

function ConfirmationThresholdsEditor({
  rows,
  defaults,
  availableChains,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
}: {
  rows: ThresholdRow[]
  defaults: Map<string, number>
  availableChains: ChainInventoryEntry[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ThresholdRow>) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  // Sorted chain dropdown — so operators don't have to memorise chainIds.
  const chainOptions = React.useMemo(
    () =>
      availableChains
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [availableChains],
  )
  return (
    <SheetSection
      title={
        <span className="flex items-center gap-1.5">
          Confirmations per chain
          <InfoTip>
            {rows.length === 0
              ? 'Empty = use gateway defaults for every chain. Set a per-chain override to tighten or loosen finality for this store.'
              : 'Lower-than-default values trade reorg risk for faster finality and surface a WARN in gateway logs. 0 = zero-conf: on Bitcoin/Litecoin the payment settles once the mempool holds a non-replaceable (non-RBF) transaction carrying it; on other chains 0 settles at the first block.'}
          </InfoTip>
        </span>
      }
      icon={Layers}
      action={
        rows.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        ) : null
      }
    >
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-[var(--fg-2)]">Using gateway defaults.</p>
        )}
        {rows.length > 0 && (
          <div className="divide-y divide-border rounded-xl border border-border">
            {rows.map((row) => {
              const def = row.chainId.trim()
                ? defaults.get(row.chainId.trim()) ?? null
                : null
              const parsedV = /^\d+$/.test(row.value.trim())
                ? parseInt(row.value.trim(), 10)
                : null
              const belowDefault =
                def != null && parsedV != null && parsedV < def
              const info = row.chainId.trim()
                ? chainInfo(parseInt(row.chainId.trim(), 10))
                : null
              return (
                <div
                  key={row.id}
                  className={cn(
                    'space-y-1.5 px-3 py-2.5 first:rounded-t-xl last:rounded-b-xl',
                    belowDefault && 'bg-[var(--warn-bg)]',
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-2">
                    <Select
                      value={row.chainId}
                      onValueChange={(v) => onUpdate(row.id, { chainId: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pick a chain" />
                      </SelectTrigger>
                      <SelectContent>
                        {chainOptions.map((c) => (
                          <SelectItem key={c.chainId} value={String(c.chainId)}>
                            <span className="flex items-center gap-2">
                              <ChainIcon chainId={c.chainId} size={16} />
                              <span>{c.displayName}</span>
                              <span className="figure text-xs text-[var(--fg-3)]">
                                default {c.confirmationsRequired}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        onUpdate(row.id, { value: e.target.value })
                      }
                      placeholder="blocks"
                      inputMode="numeric"
                      aria-label="Confirmations"
                      className="figure h-9"
                    />
                    <RowIconButton label="Remove override" danger onClick={() => onRemove(row.id)}>
                      <X className="size-4" />
                    </RowIconButton>
                  </div>
                  {info && def != null && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-xs text-[var(--fg-2)]">
                      <span className="font-mono">{info.short}</span>
                      <span>·</span>
                      <span>
                        gateway default{' '}
                        <span className="figure font-medium text-[var(--fg-1)]">
                          {def}
                        </span>{' '}
                        blocks
                      </span>
                      {belowDefault && (
                        <span className="inline-flex items-center gap-1 font-medium text-[var(--st-warn)]">
                          <AlertTriangle className="size-3.5" /> below default
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <AddRowButton onClick={onAdd}>Add chain override</AddRowButton>
      </div>
    </SheetSection>
  )
}

function ConfirmationTiersEditor({
  groups,
  availableChains,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onMoveRule,
  onClear,
  toolbar,
}: {
  groups: TierGroup[]
  availableChains: ChainInventoryEntry[]
  onAddGroup: () => void
  onUpdateGroup: (id: string, patch: Partial<TierGroup>) => void
  onRemoveGroup: (id: string) => void
  onAddRule: (groupId: string) => void
  onUpdateRule: (
    groupId: string,
    ruleId: string,
    patch: Partial<TierRuleRow>,
  ) => void
  onRemoveRule: (groupId: string, ruleId: string) => void
  onMoveRule: (groupId: string, ruleId: string, delta: number) => void
  onClear: () => void
  toolbar?: React.ReactNode
}) {
  const chainOptions = React.useMemo(
    () =>
      availableChains
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [availableChains],
  )
  const tokensFor = (chainId: string) => {
    const id = parseInt(chainId, 10)
    return availableChains.find((c) => c.chainId === id)?.tokens ?? []
  }

  return (
    <SheetSection
      title={
        <span className="flex items-center gap-1.5">
          Amount tiers
          <InfoTip>
            {groups.length === 0
              ? 'Optional. Override confirmations by amount tier — e.g. "<$3 LTC: 0 conf (non-RBF mempool), otherwise 12". Falls back to flat thresholds then gateway defaults if no rule matches.'
              : 'Rules evaluate top-down — first matching predicate wins. A rule with no operator acts as a catch-all and should sit last.'}
          </InfoTip>
        </span>
      }
      icon={Layers}
      action={
        <div className="flex items-center gap-1.5">
          {groups.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              Clear all
            </Button>
          )}
          {toolbar}
        </div>
      }
    >
      <div className="space-y-3">
        {groups.length === 0 && (
          <p className="text-sm text-[var(--fg-2)]">No tier rules.</p>
        )}
        {groups.map((group) => {
          const tokenList = tokensFor(group.chainId)
          const info = group.chainId.trim()
            ? chainInfo(parseInt(group.chainId.trim(), 10))
            : null
          return (
            <div
              key={group.id}
              className="overflow-hidden rounded-xl border border-border"
            >
              <div className="space-y-1.5 border-b border-border bg-[var(--bg-2)] px-3 py-2.5">
                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <Select
                    value={group.chainId}
                    onValueChange={(v) =>
                      onUpdateGroup(group.id, { chainId: v, token: '' })
                    }
                  >
                    <SelectTrigger className="h-9 bg-card">
                      <SelectValue placeholder="Pick a chain" />
                    </SelectTrigger>
                    <SelectContent>
                      {chainOptions.map((c) => (
                        <SelectItem key={c.chainId} value={String(c.chainId)}>
                          <span className="flex items-center gap-2">
                            <ChainIcon chainId={c.chainId} size={16} />
                            <span>{c.displayName}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={group.token}
                    onValueChange={(v) => onUpdateGroup(group.id, { token: v })}
                    disabled={tokenList.length === 0}
                  >
                    <SelectTrigger className="h-9 bg-card [&_.token-name]:hidden">
                      <SelectValue
                        placeholder={
                          group.chainId
                            ? tokenList.length === 0
                              ? 'No tokens'
                              : 'Pick token'
                            : 'Pick chain first'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {tokenList.map((t) => (
                        <SelectItem key={t.symbol} value={t.symbol}>
                          <span className="flex items-center gap-2">
                            <TokenIcon symbol={t.symbol} size={16} />
                            <span className="font-medium">{t.symbol}</span>
                            <span className="token-name text-xs text-[var(--fg-3)]">
                              {t.displayName}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <RowIconButton label="Remove tier group" danger onClick={() => onRemoveGroup(group.id)}>
                    <Trash2 className="size-4" />
                  </RowIconButton>
                </div>
                {info && group.chainId && (
                  <div className="px-1 text-xs text-[var(--fg-2)]">
                    Key{' '}
                    <span className="font-mono text-[var(--fg-1)]">
                      {group.chainId}:{group.token || '<token>'}
                    </span>{' '}
                    · {info.short}
                  </div>
                )}
              </div>

              <div className="divide-y divide-border">
                {group.rules.map((rule, idx) => {
                  const isCatchAll = rule.op === ''
                  const last = idx === group.rules.length - 1
                  return (
                    <div key={rule.id} className="space-y-1.5 px-3 py-2.5">
                      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[168px_minmax(0,1fr)_84px_auto]">
                        <Select
                          value={rule.op === '' ? '__any__' : rule.op}
                          onValueChange={(v) =>
                            onUpdateRule(group.id, rule.id, {
                              op: v === '__any__' ? '' : (v as ConfirmationTierOp),
                              ...(v === '__any__' ? { amount: '' } : {}),
                            })
                          }
                        >
                          <SelectTrigger className="h-8 px-2 text-sm [&>span]:truncate [&>span]:whitespace-nowrap">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__any__">
                              <span className="flex items-center gap-2">
                                <span className="w-7 font-mono text-[var(--fg-3)]">
                                  —
                                </span>
                                <span>Otherwise</span>
                              </span>
                            </SelectItem>
                            {TIER_OPS.map((op) => (
                              <SelectItem key={op} value={op}>
                                <span className="flex items-center gap-2">
                                  <span className="w-7 font-mono text-[var(--fg-2)]">
                                    {op}
                                  </span>
                                  <span>{TIER_OP_LABEL[op]}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={rule.amount}
                          onChange={(e) =>
                            onUpdateRule(group.id, rule.id, {
                              amount: e.target.value,
                            })
                          }
                          placeholder={
                            isCatchAll
                              ? 'Any amount'
                              : `amount in ${group.token || 'token'}`
                          }
                          disabled={isCatchAll}
                          inputMode="decimal"
                          aria-label="Amount"
                          className="figure h-8"
                        />
                        <Input
                          value={rule.confirmations}
                          onChange={(e) =>
                            onUpdateRule(group.id, rule.id, {
                              confirmations: e.target.value,
                            })
                          }
                          placeholder="conf"
                          inputMode="numeric"
                          aria-label="Confirmations"
                          className="figure h-8"
                        />
                        <div className="flex items-center justify-end">
                          <RowIconButton
                            label="Move up"
                            onClick={() => onMoveRule(group.id, rule.id, -1)}
                            disabled={idx === 0}
                          >
                            <ChevronUp className="size-4" />
                          </RowIconButton>
                          <RowIconButton
                            label="Move down"
                            onClick={() => onMoveRule(group.id, rule.id, 1)}
                            disabled={last}
                          >
                            <ChevronDown className="size-4" />
                          </RowIconButton>
                          <RowIconButton
                            label="Remove rule"
                            danger
                            onClick={() => onRemoveRule(group.id, rule.id)}
                          >
                            <X className="size-4" />
                          </RowIconButton>
                        </div>
                      </div>
                      <div className="px-1 text-xs text-[var(--fg-2)]">
                        {describeTierRule(rule, group.token)}
                      </div>
                    </div>
                  )
                })}
                <div className="px-3 py-2.5">
                  <AddRowButton
                    onClick={() => onAddRule(group.id)}
                    disabled={group.rules.length >= 20}
                  >
                    Add rule {group.rules.length >= 20 ? '(max 20)' : ''}
                  </AddRowButton>
                </div>
              </div>
            </div>
          )
        })}
        <AddRowButton onClick={onAddGroup}>Add (chain, token) tier group</AddRowButton>
      </div>
    </SheetSection>
  )
}

/* ── sheet: settings (key, status, danger zone) ──────────── */

function DangerSection({
  m,
  onDone,
}: {
  m: Merchant
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const [attachOpen, setAttachOpen] = React.useState(false)

  const rotate = useMutation({
    mutationFn: () =>
      api<{ apiKey: string }>(
        `/api/merchants/${encodeURIComponent(m.id)}/rotate-key`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      setRevealedKey(res.apiKey)
      setConfirmRotate(false)
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => {
      setConfirmRotate(false)
      toast.error(e.message || 'Could not rotate')
    },
  })

  const setActive = useMutation({
    mutationFn: (next: boolean) =>
      api(
        `/api/merchants/${encodeURIComponent(m.id)}/${next ? 'activate' : 'deactivate'}`,
        { method: 'POST' },
      ),
    onSuccess: (_r, next) => {
      toast.success(next ? 'Store activated' : 'Store deactivated')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not update'),
  })

  const remove = useMutation({
    mutationFn: () =>
      api(`/api/merchants/${encodeURIComponent(m.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Local record removed')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      setConfirmRemove(false)
      onDone()
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not remove'),
  })

  return (
    <>
      <SheetBody className="fade-in">
        <div className="space-y-6">
          <SheetSection title="API key" icon={KeyRound}>
            <div className="divide-y divide-border rounded-xl border border-border">
              {m.source === 'gateway-only' && (
                <ActionRow
                  title="Attach existing key"
                  body="Already have the plaintext from elsewhere (e.g. created via Postman)? Paste it here to bind it to this store without rotating."
                  icon={Download}
                  action={
                    <Button size="sm" onClick={() => setAttachOpen(true)}>
                      Attach
                    </Button>
                  }
                />
              )}
              <ActionRow
                title={m.source === 'gateway-only' ? 'Rotate key' : 'Rotate API key'}
                body={
                  m.source === 'gateway-only'
                    ? "Use this only if you've lost the plaintext. Generates a fresh sk_… and invalidates the old key — any integrations still using it will break."
                    : 'Generates a fresh sk_… on the gateway and invalidates the current key. The new plaintext is shown once.'
                }
                icon={KeyRound}
                action={
                  <Button
                    size="sm"
                    variant={m.source === 'gateway-only' ? 'outline' : 'default'}
                    onClick={() => setConfirmRotate(true)}
                  >
                    Rotate
                  </Button>
                }
              />
            </div>
          </SheetSection>

          {(m.active === true || m.active === false) && (
            <SheetSection title="Status" icon={Power}>
              <div className="divide-y divide-border rounded-xl border border-border">
                {m.active === true && (
                  <ActionRow
                    title="Deactivate store"
                    body="Inbound API requests with this store's key are rejected while inactive. Reactivating restores the same key."
                    icon={Ban}
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActive.mutate(false)}
                        disabled={setActive.isPending}
                      >
                        Deactivate
                      </Button>
                    }
                  />
                )}
                {m.active === false && (
                  <ActionRow
                    title="Activate store"
                    body="Re-enable inbound requests with this store's API key."
                    icon={Power}
                    action={
                      <Button
                        size="sm"
                        onClick={() => setActive.mutate(true)}
                        disabled={setActive.isPending}
                      >
                        Activate
                      </Button>
                    }
                  />
                )}
              </div>
            </SheetSection>
          )}
        </div>
      </SheetBody>

      {m.source !== 'gateway-only' && (
        <SheetFooter className="justify-between">
          <div className="min-w-0 text-xs text-[var(--fg-2)]">
            <span className="font-medium text-destructive">Remove from dashboard</span> · Drops
            the sealed API key from KV. The store stays on the gateway; re-import to get it back.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
        </SheetFooter>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        icon={KeyRound}
        title="Rotate API key?"
        body="The gateway generates a fresh sk_… and invalidates the current key. The new plaintext is shown once and sealed here."
        cta="Rotate key"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />

      <RevealOnceDialog
        value={revealedKey}
        title="New API key"
        description="This is the only time the plaintext is shown. We've sealed a copy; copy it now if you need it elsewhere."
        onClose={() => setRevealedKey(null)}
      />

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        icon={Trash2}
        title="Remove local record?"
        body="Removes the store from this dashboard and drops the sealed key. Does not delete it on the gateway."
        cta="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <ImportMerchantDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        prefill={{ id: m.id, name: m.name, lockId: true }}
      />
    </>
  )
}

function ActionRow({
  title,
  body,
  icon: Icon,
  action,
}: {
  title: string
  body: string
  icon: React.ComponentType<{ className?: string }>
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 basis-64 gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <p className="mt-0.5 text-xs text-pretty text-[var(--fg-2)]">{body}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

/* ── shared primitives ───────────────────────────────────── */

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  cta,
  destructive,
  pending,
  onConfirm,
  icon: Icon,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: React.ReactNode
  cta: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          {Icon && (
            <span
              className={cn(
                'mb-2 grid size-10 place-items-center rounded-xl ring-1',
                destructive
                  ? 'bg-[var(--danger-bg)] text-destructive ring-[var(--danger-border)]'
                  : 'bg-[var(--bg-2)] text-foreground ring-border',
              )}
            >
              <Icon className="size-5" />
            </span>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Working…' : cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevealOnceDialog({
  value,
  title,
  description,
  onClose,
}: {
  value: string | null
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-2 grid size-10 place-items-center rounded-xl bg-[var(--warn-bg)] text-[var(--st-warn)] ring-1 ring-[var(--warn-border)]">
            <KeyRound className="size-5" />
          </span>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {value && (
          <Callout
            tone="warn"
            icon={KeyRound}
            title="Copy it now — it won't be shown again."
          >
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <code className="min-w-0 flex-1 font-mono text-sm break-all text-foreground select-all">
                {value}
              </code>
              <CopyButton value={value} label="Copy" className="shrink-0" />
            </div>
          </Callout>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── loading / empty ─────────────────────────────────────── */

function TableSkeleton() {
  return (
    <div>
      <div className="h-11 border-b border-border" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-border px-6 last:border-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="w-48 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-40" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="hidden h-3 w-20 sm:block" />
          <div className="flex-1" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <SharedEmptyState
      framed
      icon={Store}
      title="No stores yet"
      description="Create one, or import a key you already have."
      action={
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" /> New store
        </Button>
      }
    />
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <SharedEmptyState
      compact
      icon={Search}
      title="No stores match"
      action={
        <Button size="sm" variant="outline" onClick={onClear}>
          <X className="size-4" /> Clear filters
        </Button>
      }
    />
  )
}

/* ── dialogs: create / import ────────────────────────────── */

function CreateMerchantDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const [under, setUnder] = React.useState('')
  const [over, setOver] = React.useState('')
  const [cooldown, setCooldown] = React.useState('')
  const qc = useQueryClient()

  // Clear the form on every open → close transition without an effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setName('')
      setWebhookUrl('')
      setUnder('')
      setOver('')
      setCooldown('')
    }
  }

  const underValid = under === '' || /^\d+$/.test(under)
  const overValid = over === '' || /^\d+$/.test(over)
  const cooldownValid = cooldown === '' || /^\d+$/.test(cooldown)
  const tuningValid =
    underValid &&
    overValid &&
    cooldownValid &&
    (under === '' || parseInt(under, 10) <= 2000) &&
    (over === '' || parseInt(over, 10) <= 2000) &&
    (cooldown === '' || parseInt(cooldown, 10) <= 604800)

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name }
      if (webhookUrl) body.webhookUrl = webhookUrl
      if (under !== '') body.paymentToleranceUnderBps = parseInt(under, 10)
      if (over !== '') body.paymentToleranceOverBps = parseInt(over, 10)
      if (cooldown !== '') body.addressCooldownSeconds = parseInt(cooldown, 10)
      return api<{ merchant: Merchant }>('/api/merchants', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      toast.success('Store created')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      onOpenChange(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not create'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New store</DialogTitle>
          <DialogDescription>
            Created on the gateway; its API key is sealed here.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" hint="1–128 characters">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                maxLength={128}
                required
              />
            </Field>
            <Field
              label="Webhook URL"
              right={<span className="text-xs text-[var(--fg-3)]">Optional</span>}
              hint="Mints a signing secret, shown once."
            >
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://store.example.com/hooks"
                type="url"
                className="font-mono"
              />
            </Field>
          </div>

          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="size-4 text-[var(--fg-2)]" />
              Advanced
              <span className="text-[var(--fg-3)] font-normal">· tolerances &amp; cooldown</span>
              <ChevronDown className="ml-auto size-4 text-[var(--fg-2)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
              <Field label="Under-pay (bps)" hint="0–2000 · 100 = 1% · default 0">
                <Input
                  value={under}
                  onChange={(e) => setUnder(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="figure"
                />
              </Field>
              <Field label="Over-pay (bps)" hint="0–2000 · default 0">
                <Input
                  value={over}
                  onChange={(e) => setOver(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="figure"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Address cooldown (seconds)"
                  hint="0–604800 (7 days) · default 0, immediate reuse"
                >
                  <Input
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="figure"
                  />
                </Field>
              </div>
            </div>
          </details>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || name.length === 0 || !tuningValid}
            >
              {create.isPending ? 'Creating…' : 'Create store'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportMerchantDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  prefill?: { id: string; name?: string; lockId?: boolean }
}) {
  const [id, setId] = React.useState('')
  const [name, setName] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const qc = useQueryClient()

  // Re-seed the form on every closed → open transition (or when the
  // prefilled merchant changes while the dialog is open).
  const syncKey = open ? `${prefill?.id ?? ''}|${prefill?.name ?? ''}` : '__closed__'
  const [prevSyncKey, setPrevSyncKey] = React.useState(syncKey)
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey)
    if (open) {
      setId(prefill?.id ?? '')
      setName(prefill?.name ?? '')
      setApiKey('')
      setWebhookUrl('')
    }
  }

  const importIt = useMutation({
    mutationFn: () =>
      api<{ merchant: Merchant }>('/api/merchants/import', {
        method: 'POST',
        body: JSON.stringify({
          id: id || undefined,
          name,
          apiKey,
          ...(webhookUrl ? { webhookUrl } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success('Store imported')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      onOpenChange(false)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not import'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {prefill?.lockId ? 'Attach existing key' : 'Import existing store'}
          </DialogTitle>
          <DialogDescription>
            {prefill?.lockId
              ? 'Bind the plaintext API key you already have to this gateway store. Sealed locally with AES-GCM.'
              : 'For stores created directly on the gateway. The key is AES-GCM sealed before it is stored.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            importIt.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Store id"
              right={
                prefill?.lockId ? (
                  <Lock className="size-3.5 text-[var(--fg-3)]" aria-label="Locked" />
                ) : (
                  <span className="text-xs text-[var(--fg-3)]">Optional</span>
                )
              }
              hint={
                prefill?.lockId
                  ? 'Bound to the gateway record — cannot be changed here.'
                  : 'Blank = generate a local id.'
              }
            >
              <Input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="uuid-or-slug"
                className={cn('font-mono', prefill?.lockId && 'bg-[var(--bg-2)] text-[var(--fg-2)]')}
                readOnly={prefill?.lockId}
              />
            </Field>
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                maxLength={128}
                required
              />
            </Field>
          </div>
          <Field
            label="API key"
            hint="Shown once by the gateway on create. Stored here for invoice/payout calls."
          >
            <PasswordField
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_…"
            />
          </Field>
          <Field
            label="Webhook URL"
            right={<span className="text-xs text-[var(--fg-3)]">Optional</span>}
          >
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://store.example.com/hooks"
              type="url"
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={importIt.isPending || !name || apiKey.length < 8}
            >
              <Download className="size-4" />
              {importIt.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  CircleDashed,
  Download,
  KeyRound,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Shield,
  ShieldAlert,
  Store,
  Trash2,
  Webhook,
  X,
} from 'lucide-react'

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
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { PasswordField } from '@/components/PasswordField'
import {
  Callout,
  EmptyState as SharedEmptyState,
  ListSkeleton,
} from '@/components/States'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'inactive' | 'orphan'

/* ── page ────────────────────────────────────────────────── */

export function MerchantsPage() {
  const merchants = useMerchants()
  const gatewayReachable = merchants.data?.gatewayReachable !== false

  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('all')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  const all = merchants.data?.merchants ?? []
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

  const openMerchant = filtered.find((m) => m.id === openId)
    ?? all.find((m) => m.id === openId)
    ?? null

  return (
    <div className="fade-in space-y-5">
      <PageHeader
        eyebrow="Stores"
        title="Stores"
        description="Every store the gateway exposes, with the ones you can transact against from this dashboard marked usable."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="size-3.5" /> New store
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Add store</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> Create via gateway
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Download className="size-3.5" /> Import existing key
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {!gatewayReachable && merchants.data && (
        <Callout tone="warn">
          Gateway unreachable — live status fields below may be stale.
        </Callout>
      )}

      <Toolbar
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        total={all.length}
        visible={filtered.length}
      />

      {merchants.isLoading ? (
        <ListSkeleton rows={5} />
      ) : all.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} onImport={() => setImportOpen(true)} />
      ) : filtered.length === 0 ? (
        <NoMatch />
      ) : (
        <MerchantList rows={filtered} onOpen={setOpenId} />
      )}

      <CreateMerchantDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportMerchantDialog open={importOpen} onOpenChange={setImportOpen} />
      <MerchantSheet
        merchant={openMerchant}
        onOpenChange={(v) => !v && setOpenId(null)}
      />
    </div>
  )
}

/* ── toolbar ─────────────────────────────────────────────── */

function Toolbar({
  query,
  setQuery,
  filter,
  setFilter,
  total,
  visible,
}: {
  query: string
  setQuery: (v: string) => void
  filter: Filter
  setFilter: (v: Filter) => void
  total: number
  visible: number
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--fg-3)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, id, webhook…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
            <SelectItem value="orphan">Gateway-only</SelectItem>
          </SelectContent>
        </Select>
        <div className="hidden shrink-0 font-mono text-xs tabular-nums text-[var(--fg-2)] sm:block">
          {visible === total ? `${total} total` : `${visible} of ${total}`}
        </div>
      </div>
    </div>
  )
}

/* ── list ────────────────────────────────────────────────── */

function MerchantList({
  rows,
  onOpen,
}: {
  rows: Merchant[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden h-9 grid-cols-[1fr_112px_140px_120px_40px] items-center gap-4 border-b border-border bg-[var(--bg-2)] px-4 text-2xs font-medium uppercase tracking-[0.06em] text-[var(--fg-2)] sm:grid">
        <div>Store</div>
        <div>Status</div>
        <div>Key</div>
        <div>Updated</div>
        <div />
      </div>
      <ul>
        {rows.map((m) => (
          <MerchantRow key={m.id} m={m} onOpen={() => onOpen(m.id)} />
        ))}
      </ul>
    </div>
  )
}

function MerchantRow({ m, onOpen }: { m: Merchant; onOpen: () => void }) {
  return (
    <li className="group border-b border-border last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[1fr_112px_140px_120px_40px] sm:gap-4"
      >
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{m.name}</span>
            {m.source === 'gateway-only' && (
              <Badge variant="warn" className="shrink-0">
                orphan
              </Badge>
            )}
            {m.confirmationThresholds &&
              Object.keys(m.confirmationThresholds).length > 0 && (
                <Badge
                  variant="outline"
                  className="shrink-0"
                  title="Per-chain confirmation overrides set"
                >
                  <Layers className="size-3" />
                  {Object.keys(m.confirmationThresholds).length} conf
                </Badge>
              )}
            {m.confirmationTiers &&
              Object.keys(m.confirmationTiers).length > 0 && (
                <Badge
                  variant="accent"
                  className="shrink-0"
                  title="Per-(chain, token) amount-tier rules set"
                >
                  <Layers className="size-3" />
                  {Object.keys(m.confirmationTiers).length} tier
                </Badge>
              )}
          </div>
          <div className="mt-0.5 truncate font-mono text-2xs text-[var(--fg-3)]">
            {m.id}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status={statusOf(m)} />
          {m.apiKeyFingerprint && (
            <span className="truncate font-mono text-2xs text-[var(--fg-3)] sm:hidden">
              …{m.apiKeyFingerprint}
            </span>
          )}
        </div>

        <div className="hidden font-mono text-xs text-[var(--fg-2)] sm:block">
          {m.apiKeyFingerprint ? (
            <>…{m.apiKeyFingerprint}</>
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </div>

        <div className="hidden text-xs text-[var(--fg-2)] sm:block">{fmtRel(m.updatedAt)}</div>

        <div
          className="col-start-2 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <RowKebab m={m} />
        </div>
      </div>
    </li>
  )
}

type Status = 'active' | 'inactive' | 'orphan' | 'unknown'

function statusOf(m: Merchant): Status {
  if (m.source === 'gateway-only') return 'orphan'
  if (m.active === true) return 'active'
  if (m.active === false) return 'inactive'
  return 'unknown'
}

function labelOf(s: Status): string {
  switch (s) {
    case 'active':
      return 'Active'
    case 'inactive':
      return 'Inactive'
    case 'orphan':
      return 'Gateway-only'
    default:
      return 'Unknown'
  }
}

function StatusBadge({ status }: { status: Status }) {
  const variant =
    status === 'active'
      ? 'success'
      : status === 'inactive'
        ? 'warn'
        : status === 'orphan'
          ? 'danger'
          : 'default'
  return <Badge variant={variant}>{labelOf(status)}</Badge>
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
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmRotate(true)}>
            <KeyRound className="size-3.5" />
            {m.source === 'gateway-only' ? 'Rotate & import key' : 'Rotate API key'}
          </DropdownMenuItem>
          {m.active === true && (
            <DropdownMenuItem onSelect={() => setActive.mutate(false)}>
              <Power className="size-3.5" /> Deactivate
            </DropdownMenuItem>
          )}
          {m.active === false && (
            <DropdownMenuItem onSelect={() => setActive.mutate(true)}>
              <Power className="size-3.5" /> Activate
            </DropdownMenuItem>
          )}
          {m.source !== 'gateway-only' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmRemove(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" /> Remove from dashboard
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
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

function MerchantSheet({
  merchant,
  onOpenChange,
}: {
  merchant: Merchant | null
  onOpenChange: (v: boolean) => void
}) {
  const [section, setSection] = React.useState<
    'overview' | 'keys' | 'webhook' | 'tuning' | 'danger'
  >('overview')
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
            <SheetHeader className="pb-0">
              <div className="eyebrow mb-1">Store</div>
              <div className="flex min-w-0 items-center gap-2 pr-8">
                <SheetTitle className="truncate pr-0">{merchant.name}</SheetTitle>
                <StatusBadge status={statusOf(merchant)} />
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline">{merchant.source}</Badge>
                <span className="min-w-0 truncate font-mono text-2xs text-[var(--fg-2)]">
                  {merchant.id}
                </span>
                <CopyButton value={merchant.id} />
              </div>
              <nav
                role="tablist"
                aria-label="Store sections"
                className="-mx-6 mt-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]"
              >
                {(['overview', 'keys', 'webhook', 'tuning', 'danger'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={section === s}
                    onClick={() => setSection(s)}
                    className={cn(
                      'relative shrink-0 cursor-pointer rounded-t-md px-2 pt-1 pb-2.5 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      section === s
                        ? 'text-foreground'
                        : 'text-[var(--fg-2)] hover:text-foreground',
                    )}
                  >
                    {s === 'danger' ? 'Danger zone' : s === 'keys' ? 'API keys' : s}
                    {section === s && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </nav>
            </SheetHeader>

            <SheetBody>
              {section === 'overview' && <OverviewSection m={merchant} />}
              {section === 'keys' && <ApiKeysSection m={merchant} />}
              {section === 'webhook' && <WebhookSection m={merchant} />}
              {section === 'tuning' && <TuningSection m={merchant} />}
              {section === 'danger' && <DangerSection m={merchant} onDone={() => onOpenChange(false)} />}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── sheet: overview ─────────────────────────────────────── */

function OverviewSection({ m }: { m: Merchant }) {
  return (
    <div className="space-y-5">
      <KeyValueGrid
        rows={[
          ['Name', m.name],
          [
            'Status',
            <Badge
              variant={
                m.active === true ? 'success' : m.active === false ? 'warn' : 'default'
              }
            >
              {m.active === true ? 'Active' : m.active === false ? 'Inactive' : 'Unknown'}
            </Badge>,
          ],
          ['Source', <span className="font-mono text-xs">{m.source}</span>],
          [
            'Main API key',
            m.apiKeyFingerprint ? (
              <span className="font-mono text-xs">
                sk_…{m.apiKeyFingerprint} · full access
              </span>
            ) : (
              '—'
            ),
          ],
          ['Created', fmtLocal(m.createdAt)],
          ['Updated', fmtRel(m.updatedAt)],
        ]}
      />
      {m.source === 'gateway-only' && (
        <Callout tone="warn" icon={Shield} title="Not usable from this dashboard">
          The gateway has this store but we don't hold a sealed API key. In{' '}
          <span className="font-medium">Danger zone</span>: <em>Attach</em> if
          you still have the plaintext, or <em>Rotate</em> to mint a fresh one.
        </Callout>
      )}
    </div>
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

  return (
    <div className="space-y-5">
      <form
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
              : 'Where the gateway POSTs status updates for this store.'
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
        <div className="flex flex-wrap justify-end gap-2">
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
          <Button size="sm" type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save URL'}
          </Button>
        </div>
      </form>

      <div
        className={cn(
          'rounded-lg border px-4 py-3',
          m.webhookUrl
            ? 'border-border bg-[var(--bg-2)]'
            : 'border-dashed border-[var(--border-strong)] bg-card',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Webhook className="size-4 text-[var(--fg-2)]" /> Signing secret
            </div>
            {m.webhookUrl ? (
              <p className="mt-1 text-xs text-[var(--fg-2)]">
                Shared HMAC the gateway uses to sign webhook bodies. Rotating
                invalidates the old secret immediately — shown once on success.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--fg-2)]">
                No secret yet. Save a{' '}
                <span className="font-medium">Webhook URL</span> above first —
                the gateway auto-mints a 64-hex secret on the first save and
                reveals it once. Use{' '}
                <span className="font-mono">Rotate</span> afterwards to issue a
                new one.
              </p>
            )}
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
            <KeyRound className="size-3.5" /> Rotate
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
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
    </div>
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
    <div className="space-y-4">
      <Callout icon={KeyRound} title="Keys for this store's website and apps">
        Give each website or integration its own key with only the access it
        needs. New keys can create and read invoices only; payout access must be
        turned on explicitly. The store's main key{' '}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--fg-2)]">
          {keys.isSuccess &&
            `${active.length} active${revoked.length ? ` · ${revoked.length} revoked` : ''}`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revoked.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowRevoked((v) => !v)}>
              {showRevoked ? 'Hide revoked' : 'Show revoked'}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!keys.isSuccess}>
            <Plus className="size-3.5" /> New key
          </Button>
        </div>
      </div>

      {keys.isPending && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-20" />
              </div>
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
          title="No extra keys yet."
          description="Create one for each website or app that talks to the gateway."
        />
      )}

      {keys.isSuccess && shown.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {shown.map((k) => (
            <li
              key={k.id}
              className={cn('px-4 py-3', k.revokedAt && 'bg-[var(--bg-2)]')}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className={cn('min-w-0 flex-1', k.revokedAt && 'opacity-70')}>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">
                      {k.label ?? 'Unnamed key'}
                    </span>
                    <span className="font-mono text-xs text-[var(--fg-2)]">
                      sk_…{k.fingerprint}
                    </span>
                    {k.revokedAt && <Badge variant="danger">Revoked</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {k.scopes.length === 0 ? (
                      <Badge variant="danger">No valid scopes</Badge>
                    ) : (
                      k.scopes.map((s) => (
                        <Badge
                          key={s}
                          variant={SCOPE_INFO[s]?.risky ? 'warn' : 'default'}
                          title={s}
                        >
                          {SCOPE_INFO[s]?.risky && <ShieldAlert />}
                          {SCOPE_INFO[s]?.label ?? s}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="mt-2 text-2xs text-[var(--fg-3)]">
                    Created {fmtLocal(k.createdAt)}
                    {k.revokedAt && ` · revoked ${fmtLocal(k.revokedAt)}`}
                  </div>
                </div>
                {!k.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRevokeTarget(k)}
                    disabled={revoke.isPending}
                  >
                    <Ban className="size-3.5" /> Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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
    </div>
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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (scopes.length > 0) create.mutate()
          }}
        >
          <Field label="Name" hint="So you can tell keys apart, e.g. “Main website”.">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={64}
              placeholder="Main website"
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Access</legend>
            <div className="space-y-3">
              {SCOPE_GROUPS.map((g) => (
                <div
                  key={g.resource}
                  className="overflow-hidden rounded-md border border-border"
                >
                  <div className="flex h-8 items-center border-b border-border bg-[var(--bg-2)] px-3 text-2xs font-medium uppercase tracking-[0.06em] text-[var(--fg-2)]">
                    {g.resource}
                  </div>
                  <div className="divide-y divide-border">
                    {g.scopes.map((s) => (
                      <label
                        key={s}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors',
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
                            <span className="font-mono text-2xs text-[var(--fg-3)]">{s}</span>
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

function TuningSection({ m }: { m: Merchant }) {
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

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Field label="Display name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Under-pay tolerance (bps)">
          <Input
            value={under}
            onChange={(e) => setUnder(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
        <Field label="Over-pay tolerance (bps)">
          <Input
            value={over}
            onChange={(e) => setOver(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
      </div>
      <Field
        label="Address cooldown (seconds)"
        hint="Applies to releases AFTER this change; stamped cooldowns are unaffected."
      >
        <Input
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
          placeholder="0 – 604800"
          inputMode="numeric"
          className="font-mono"
        />
      </Field>

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
      />

      <Callout icon={CircleDashed}>
        Tolerance, threshold + tier changes apply to{' '}
        <span className="font-medium">new</span> invoices only — existing
        invoices keep their snapshotted values.
      </Callout>

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <Pencil className="size-3.5" />
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
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
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-[var(--fg-3)]" />
          Confirmation thresholds (per chain)
        </span>
      }
      right={
        rows.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer text-xs text-[var(--fg-2)] hover:text-destructive"
          >
            Clear all
          </button>
        ) : null
      }
      hint={
        rows.length === 0
          ? 'Empty = use gateway defaults for every chain. Set a per-chain override to tighten or loosen finality for this store.'
          : 'Lower-than-default values trade reorg risk for faster finality and surface a WARN in gateway logs. 0 = zero-conf: on Bitcoin/Litecoin the payment settles once the mempool holds a non-replaceable (non-RBF) transaction carrying it; on other chains 0 settles at the first block.'
      }
    >
      <div className="space-y-2">
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
              className={
                'grid grid-cols-[minmax(0,1.4fr)_96px_auto] items-start gap-2 rounded-md border p-2 ' +
                (belowDefault
                  ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]'
                  : 'border-border bg-[var(--bg-2)]')
              }
            >
              <div className="space-y-1">
                <Select
                  value={row.chainId}
                  onValueChange={(v) => onUpdate(row.id, { chainId: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pick a chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {chainOptions.map((c) => (
                      <SelectItem key={c.chainId} value={String(c.chainId)}>
                        <span className="flex items-center gap-2">
                          <span>{c.displayName}</span>
                          <span className="font-mono text-2xs text-[var(--fg-3)]">
                            {c.chainId}
                          </span>
                          <span className="text-2xs text-[var(--fg-3)]">
                            default {c.confirmationsRequired}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {info && def != null && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-2xs text-[var(--fg-2)]">
                    <span className="font-mono">{info.short}</span>
                    <span>·</span>
                    <span>
                      gateway default{' '}
                      <span className="font-mono text-[var(--fg-1)]">
                        {def}
                      </span>{' '}
                      blocks
                    </span>
                    {belowDefault && (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <AlertTriangle className="size-3" /> below default
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Input
                value={row.value}
                onChange={(e) =>
                  onUpdate(row.id, { value: e.target.value })
                }
                placeholder="blocks"
                inputMode="numeric"
                className="h-8 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-destructive"
                title="Remove override"
                aria-label="Remove override"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-2.5 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add chain override
        </button>
      </div>
    </Field>
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
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-[var(--fg-3)]" />
          Amount-tiered rules (per chain &amp; token)
        </span>
      }
      right={
        groups.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer text-xs text-[var(--fg-2)] hover:text-destructive"
          >
            Clear all
          </button>
        ) : null
      }
      hint={
        groups.length === 0
          ? 'Optional. Override confirmations by amount tier — e.g. "<$3 LTC: 0 conf (non-RBF mempool), otherwise 12". Falls back to flat thresholds then gateway defaults if no rule matches.'
          : 'Rules evaluate top-down — first matching predicate wins. A rule with no operator acts as a catch-all and should sit last.'
      }
    >
      <div className="space-y-3">
        {groups.map((group) => {
          const tokenList = tokensFor(group.chainId)
          const info = group.chainId.trim()
            ? chainInfo(parseInt(group.chainId.trim(), 10))
            : null
          return (
            <div
              key={group.id}
              className="space-y-2 rounded-md border border-border bg-[var(--bg-2)] p-2"
            >
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2">
                <Select
                  value={group.chainId}
                  onValueChange={(v) =>
                    onUpdateGroup(group.id, { chainId: v, token: '' })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pick a chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {chainOptions.map((c) => (
                      <SelectItem key={c.chainId} value={String(c.chainId)}>
                        <span className="flex items-center gap-2">
                          <span>{c.displayName}</span>
                          <span className="font-mono text-2xs text-[var(--fg-3)]">
                            {c.chainId}
                          </span>
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
                  <SelectTrigger className="h-8 text-xs">
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
                          <span className="font-mono">{t.symbol}</span>
                          <span className="text-2xs text-[var(--fg-3)]">
                            {t.displayName}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => onRemoveGroup(group.id)}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-destructive"
                  title="Remove tier group"
                  aria-label="Remove tier group"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {info && group.chainId && (
                <div className="px-1 text-2xs text-[var(--fg-2)]">
                  Key{' '}
                  <span className="font-mono text-[var(--fg-1)]">
                    {group.chainId}:{group.token || '<token>'}
                  </span>{' '}
                  · {info.short}
                </div>
              )}

              <div className="space-y-1.5">
                {group.rules.map((rule, idx) => {
                  const isCatchAll = rule.op === ''
                  const last = idx === group.rules.length - 1
                  return (
                    <div
                      key={rule.id}
                      className="space-y-1 rounded-md border border-border bg-card p-1.5"
                    >
                      <div className="grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[150px_minmax(0,1.2fr)_88px_auto]">
                        <Select
                          value={rule.op === '' ? '__any__' : rule.op}
                          onValueChange={(v) =>
                            onUpdateRule(group.id, rule.id, {
                              op: v === '__any__' ? '' : (v as ConfirmationTierOp),
                              ...(v === '__any__' ? { amount: '' } : {}),
                            })
                          }
                        >
                          <SelectTrigger className="h-7 px-1.5 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__any__">
                              <span className="flex items-center gap-2">
                                <span className="w-7 font-mono text-[var(--fg-3)]">
                                  —
                                </span>
                                <span>Default · catch-all</span>
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
                              ? 'no amount — applies to all'
                              : `amount in ${group.token || 'token'}`
                          }
                          disabled={isCatchAll}
                          inputMode="decimal"
                          className="h-7 font-mono text-xs"
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
                          className="h-7 font-mono text-xs"
                        />
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => onMoveRule(group.id, rule.id, -1)}
                            disabled={idx === 0}
                            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => onMoveRule(group.id, rule.id, 1)}
                            disabled={last}
                            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveRule(group.id, rule.id)}
                            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-destructive"
                            title="Remove rule"
                            aria-label="Remove rule"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>
                      <div className="px-1 text-2xs text-[var(--fg-2)]">
                        {describeTierRule(rule, group.token)}
                      </div>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => onAddRule(group.id)}
                  disabled={group.rules.length >= 20}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-2 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-3" />
                  Add rule {group.rules.length >= 20 ? '(max 20)' : ''}
                </button>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={onAddGroup}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-2.5 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add (chain, token) tier group
        </button>
      </div>
    </Field>
  )
}

/* ── sheet: danger ───────────────────────────────────────── */

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
    <div className="space-y-3">
      {m.source === 'gateway-only' && (
        <DangerRow
          title="Attach existing key"
          body="Already have the plaintext from elsewhere (e.g. created via Postman)? Paste it here to bind it to this store without rotating."
          icon={<Download className="size-4" />}
          action={
            <Button size="sm" onClick={() => setAttachOpen(true)}>
              Attach
            </Button>
          }
        />
      )}

      <DangerRow
        title={m.source === 'gateway-only' ? 'Rotate key' : 'Rotate API key'}
        body={
          m.source === 'gateway-only'
            ? "Use this only if you've lost the plaintext. Generates a fresh sk_… and invalidates the old key — any integrations still using it will break."
            : 'Generates a fresh sk_… on the gateway and invalidates the current key. The new plaintext is shown once.'
        }
        icon={<KeyRound className="size-4" />}
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

      {m.active === true && (
        <DangerRow
          title="Deactivate store"
          body="Inbound API requests with this store's key are rejected while inactive. Reactivating restores the same key."
          icon={<Ban className="size-4" />}
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
        <DangerRow
          title="Activate store"
          body="Re-enable inbound requests with this store's API key."
          icon={<Power className="size-4" />}
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

      {m.source !== 'gateway-only' && (
        <DangerRow
          title="Remove from dashboard"
          body="Drops the sealed API key from KV. The store stays on the gateway; re-import to get it back."
          icon={<Trash2 className="size-4" />}
          tone="destructive"
          action={
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          }
        />
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
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
    </div>
  )
}

function DangerRow({
  title,
  body,
  icon,
  action,
  tone,
}: {
  title: string
  body: string
  icon: React.ReactNode
  action: React.ReactNode
  tone?: 'destructive'
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-3 rounded-lg border px-4 py-3',
        tone === 'destructive'
          ? 'border-[var(--danger-border)] bg-[var(--danger-bg)]'
          : 'border-border bg-card',
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 gap-3">
        <div
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md border',
            tone === 'destructive'
              ? 'border-[var(--danger-border)] bg-card text-destructive'
              : 'border-border bg-[var(--bg-2)] text-[var(--fg-2)]',
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <p className="mt-0.5 text-xs text-pretty text-[var(--fg-2)]">{body}</p>
        </div>
      </div>
      <div className="shrink-0 self-center">{action}</div>
    </div>
  )
}

/* ── shared primitives ───────────────────────────────────── */

function KeyValueGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-y-3">
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-xs text-[var(--fg-2)] max-sm:mt-2 max-sm:first:mt-0">
            {k}
          </dt>
          <dd className="min-w-0 text-sm break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  cta,
  destructive,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: React.ReactNode
  cta: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {value && (
          <Callout
            tone="warn"
            icon={KeyRound}
            title="Copy it now — it won't be shown again."
          >
            <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2.5">
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

function EmptyState({
  onCreate,
  onImport,
}: {
  onCreate: () => void
  onImport: () => void
}) {
  return (
    <SharedEmptyState
      framed
      icon={Store}
      title="No stores yet"
      description="Create a store via the gateway's admin surface to receive the API key here, or import an existing key you already have."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={onCreate}>
            <Plus className="size-3.5" /> Create store
          </Button>
          <Button size="sm" variant="outline" onClick={onImport}>
            <Download className="size-3.5" /> Import key
          </Button>
        </div>
      }
    />
  )
}

function NoMatch() {
  return (
    <SharedEmptyState
      framed
      compact
      icon={Search}
      title="No stores match the current filter."
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create store</DialogTitle>
          <DialogDescription>
            Calls <span className="font-mono">POST /admin/merchants</span> on the
            gateway. The returned plaintext API key is sealed and stored here.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Name" hint="1–128 characters. Visible in reports.">
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
            label="Webhook URL (optional)"
            hint="Setting this at creation mints a signing secret returned once."
          >
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://store.example.com/hooks/gateway"
              type="url"
              className="font-mono"
            />
          </Field>

          <details className="rounded-md border border-border bg-[var(--bg-2)] open:pb-3">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-[var(--fg-1)] hover:text-foreground">
              Advanced — payment tolerances &amp; cooldown
            </summary>
            <div className="space-y-3 px-3 pt-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Under-pay tolerance (bps)"
                  hint="0–2000. 1 bps = 0.01% (50 = 0.5%, 100 = 1%). Default 0 (strict)."
                >
                  <Input
                    value={under}
                    onChange={(e) => setUnder(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>
                <Field
                  label="Over-pay tolerance (bps)"
                  hint="0–2000. 1 bps = 0.01%. Default 0."
                >
                  <Input
                    value={over}
                    onChange={(e) => setOver(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </Field>
              </div>
              <Field
                label="Address cooldown (seconds)"
                hint="0–604800 (7 days). Default 0 — immediate reuse."
              >
                <Input
                  value={cooldown}
                  onChange={(e) => setCooldown(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="font-mono"
                />
              </Field>
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {prefill?.lockId ? 'Attach existing key' : 'Import existing store'}
          </DialogTitle>
          <DialogDescription>
            {prefill?.lockId
              ? 'Bind the plaintext API key you already have to this gateway store. Sealed locally with AES-GCM.'
              : 'For stores created directly on the gateway. The plaintext key is AES-GCM sealed before writing to KV.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            importIt.mutate()
          }}
        >
          <Field
            label="Store id"
            hint={
              prefill?.lockId
                ? 'Bound to the gateway record — cannot be changed here.'
                : 'Leave blank to generate a local id.'
            }
          >
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="uuid-or-slug"
              className="font-mono"
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
          <Field
            label="API key"
            hint="Shown once by the gateway on create. Store it here to use it for invoice/payout calls."
          >
            <PasswordField
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_…"
            />
          </Field>
          <Field label="Webhook URL (optional)">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://store.example.com/hooks/gateway"
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
              {importIt.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

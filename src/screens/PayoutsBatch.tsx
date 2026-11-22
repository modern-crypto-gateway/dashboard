import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Gauge,
  Info,
  KeyRound,
  Layers,
  ListBullets,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { truncateAddr } from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import { useMerchantRateLimit } from '@/lib/rateLimit'
import type { PayoutBatchResponse, PayoutBatchRowResult } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Addr } from '@/components/Addr'
import { CopyButton } from '@/components/CopyButton'
import { TokenIcon, TokenOnChain } from '@/components/CryptoIcon'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { ChainPill } from '@/components/ChainPill'
import { PageHeader } from '@/components/PageHeader'
import { Pager, RowAvatar, TableCard, TableToolbar, usePaged } from '@/components/DataTable'
import { Callout, EmptyState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

/* ── helpers (module-private) ──────────────────────────── */

const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d+)?$/
const BATCH_MAX = 100

type BatchCsvRow = {
  lineNo: number
  chainId: number
  token: string
  amount: string
  destinationAddress: string
}

type BatchParseError = {
  lineNo: number
  message: string
  raw: string
}

function parseBatchCsv(csv: string): {
  rows: BatchCsvRow[]
  errors: BatchParseError[]
} {
  const rows: BatchCsvRow[] = []
  const errors: BatchParseError[] = []
  const lines = csv.split(/\r?\n/)

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const line = rawLine.trim()
    if (!line) return
    if (line.startsWith('#')) return

    // Skip a header row if present.
    const lc = line.toLowerCase()
    if (
      idx === 0 &&
      lc.includes('chainid') &&
      lc.includes('token') &&
      lc.includes('amount') &&
      lc.includes('destination')
    ) {
      return
    }

    const cols = line.split(',').map((c) => c.trim())
    if (cols.length !== 4) {
      errors.push({
        lineNo,
        message: `Expected 4 columns, got ${cols.length}.`,
        raw: line,
      })
      return
    }
    const [chainIdStr, tokenStr, amountStr, destStr] = cols
    const chainId = parseInt(chainIdStr, 10)
    if (!/^\d+$/.test(chainIdStr) || !isFinite(chainId) || chainId <= 0) {
      errors.push({
        lineNo,
        message: 'chainId must be a positive integer.',
        raw: line,
      })
      return
    }
    if (!/^[A-Za-z0-9]+$/.test(tokenStr)) {
      errors.push({ lineNo, message: 'Invalid token symbol.', raw: line })
      return
    }
    if (!DECIMAL_RE.test(amountStr)) {
      errors.push({
        lineNo,
        message: 'amount must be a non-negative decimal (e.g. 1.5).',
        raw: line,
      })
      return
    }
    if (destStr.length === 0) {
      errors.push({
        lineNo,
        message: 'destinationAddress is required.',
        raw: line,
      })
      return
    }
    rows.push({
      lineNo,
      chainId,
      token: tokenStr.toUpperCase(),
      amount: amountStr,
      destinationAddress: destStr,
    })
  })

  return { rows, errors }
}

function payoutErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'BATCH_TOO_LARGE':
        return 'Batch exceeds 100 rows. Split the file and retry.'
      case 'INSUFFICIENT_TOTAL_BALANCE':
        return 'Even the sum of every fee wallet falls short. Top up before retrying.'
      case 'ORACLE_FAILED':
        return 'Price oracle unreachable — USD pegging unavailable right now.'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : 'Could not submit batch'
}

const CSV_COLUMNS = 'chainId,token,amount,destinationAddress'

/* ── summary tiles ─────────────────────────────────────── */

function Tile({
  label,
  icon: Icon,
  value,
  sub,
  footer,
  tone,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  tone?: 'bad' | 'warn' | 'ok'
}) {
  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
        <Icon className="size-4" />
        {label}
      </div>
      <div
        className={cn(
          'figure mt-2 truncate text-xl font-semibold',
          tone === 'bad' && 'text-[var(--st-bad)]',
          tone === 'warn' && 'text-[var(--st-warn)]',
          tone === 'ok' && 'text-[var(--st-ok)]',
        )}
      >
        {value}
      </div>
      {sub != null && <div className="mt-1 truncate text-xs text-[var(--fg-2)]">{sub}</div>}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  )
}

/** Thin fill bar (used/limit). */
function Meter({ value, max, tone }: { value: number; max: number; tone: 'ok' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--chart-muted)]">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          tone === 'bad'
            ? 'bg-[var(--st-bad-dot)]'
            : tone === 'warn'
              ? 'bg-[var(--st-warn-dot)]'
              : 'bg-[var(--st-ok-dot)]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function QuotaTile({
  remaining,
  limit,
}: {
  remaining: number | null
  limit: number | null
}) {
  if (remaining === null) {
    return <Tile label="Quota" icon={Gauge} value="—" sub="quota unknown" />
  }
  const warn = limit !== null && remaining < Math.max(5, limit * 0.1)
  return (
    <span title="Remaining this minute for the store's API key." className="contents">
      <Tile
        label="Quota"
        icon={Gauge}
        tone={warn ? 'warn' : undefined}
        value={
          <>
            {remaining}
            {limit !== null && (
              <span className="text-base font-medium text-[var(--fg-3)]"> / {limit}</span>
            )}
          </>
        }
        sub="left this minute"
        footer={
          limit !== null ? (
            <Meter value={remaining} max={limit} tone={warn ? 'warn' : 'ok'} />
          ) : undefined
        }
      />
    </span>
  )
}

/* ── page ──────────────────────────────────────────────── */

export function PayoutsBatchPage() {
  const merchants = useMerchants()
  const { active } = useActiveMerchant()
  const canSubmit =
    !!active &&
    active.source !== 'gateway-only' &&
    active.apiKeyFingerprint !== null

  if (merchants.isLoading) {
    return <Loading />
  }
  if ((merchants.data?.merchants.length ?? 0) === 0) {
    return <NoMerchants />
  }

  return (
    <div className="fade-in space-y-8">
      <BatchHeader actions={<MerchantSwitcher />} />

      {!canSubmit && active ? (
        <NoApiKeyCard />
      ) : active && canSubmit ? (
        <BatchForm merchantId={active.id} />
      ) : null}
    </div>
  )
}

function BatchHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <BackToPayouts />
      <PageHeader
        title="Batch payout"
        description={`Plan up to ${BATCH_MAX} payouts at once`}
        actions={actions}
      />
    </div>
  )
}

function BatchForm({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [csv, setCsv] = React.useState('')
  const [result, setResult] = React.useState<PayoutBatchResponse | null>(null)

  // Pre-flight: a cheap list hit warms the rate-limit headers on mount so the
  // quota warning below isn't blank the first time a user deep-links here.
  // Deliberately doesn't gate the form — even if this 5xx's, the user can
  // still submit and fall back to server-side 429 handling.
  useQuery({
    queryKey: ['payouts', 'rate-limit-ping', merchantId] as const,
    queryFn: () =>
      api(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts?limit=1&offset=0`,
      ),
    staleTime: 30_000,
    retry: false,
  })
  const rl = useMerchantRateLimit(merchantId)

  const { rows, errors } = React.useMemo(() => parseBatchCsv(csv), [csv])
  const oversize = rows.length > BATCH_MAX
  const exceedsQuota =
    rl !== null && rl.remaining !== null && rows.length > rl.remaining

  const submit = useMutation({
    mutationFn: () =>
      api<PayoutBatchResponse>(
        `/api/mg/${encodeURIComponent(merchantId)}/payouts/batch`,
        {
          method: 'POST',
          body: JSON.stringify({
            payouts: rows.map((r) => ({
              chainId: r.chainId,
              token: r.token,
              amount: r.amount,
              destinationAddress: r.destinationAddress,
            })),
          }),
        },
      ),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: ['payouts', 'list', merchantId] })
      const { planned, failed } = res.summary
      if (failed === 0) {
        toast.success(`Batch planned: ${planned} rows`)
      } else {
        toast.warning(
          `Batch partial: ${planned} planned, ${failed} failed. Review per-row errors below.`,
        )
      }
    },
    onError: (e: unknown) => toast.error(payoutErrorMessage(e)),
  })

  const submitDisabled =
    submit.isPending ||
    rows.length === 0 ||
    oversize ||
    errors.length > 0 ||
    exceedsQuota

  if (result) {
    return (
      <BatchResultView
        result={result}
        onViewBatch={() => {
          navigate(`/payouts?batchId=${encodeURIComponent(result.batchId)}`)
        }}
        onBack={() => navigate('/payouts')}
        onReset={() => {
          setCsv('')
          setResult(null)
        }}
      />
    )
  }

  const rowsTone = oversize ? 'bad' : rows.length > BATCH_MAX * 0.9 ? 'warn' : 'ok'

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Tile
          label="Rows"
          icon={ListBullets}
          tone={oversize ? 'bad' : undefined}
          value={
            <>
              {rows.length}
              <span className="text-base font-medium text-[var(--fg-3)]"> / {BATCH_MAX}</span>
            </>
          }
          sub={oversize ? 'Over the batch limit' : 'parsed'}
          footer={<Meter value={rows.length} max={BATCH_MAX} tone={rowsTone} />}
        />
        <Tile
          label="Parse errors"
          icon={XCircle}
          tone={errors.length > 0 ? 'bad' : undefined}
          value={errors.length}
          sub={errors.length > 0 ? 'Fix before submitting' : 'All lines valid'}
        />
        <QuotaTile remaining={rl?.remaining ?? null} limit={rl?.limit ?? null} />
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-[var(--fg-2)]" />
            <h2 className="text-lg font-semibold">CSV</h2>
            <span
              className="text-[var(--fg-3)]"
              title="One payout per line. Blank lines and lines starting with '#' are ignored. A header row is optional. Per-row errors don't abort the batch — HTTP 200 with mixed outcomes is normal; you'll see each row's result below."
            >
              <Info className="size-4" />
            </span>
          </div>
          <code className="max-w-full truncate rounded-md bg-[var(--bg-2)] px-2 py-1 font-mono text-xs text-[var(--fg-1)] ring-1 ring-border">
            {CSV_COLUMNS}
          </code>
        </div>
        <Textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={12}
          aria-label="Batch CSV"
          spellCheck={false}
          placeholder={
            'chainId,token,amount,destinationAddress\n42161,USDC,1.5,0x1111111111111111111111111111111111111111\n1,ETH,0.01,0x3333333333333333333333333333333333333333'
          }
          className="rounded-xl font-mono text-xs leading-relaxed"
        />

        {oversize && (
          <Callout tone="danger" icon={AlertTriangle}>
            Exceeds {BATCH_MAX}-row limit — split the file.
          </Callout>
        )}

        {exceedsQuota && rl && (
          <Callout tone="danger" title="Batch exceeds store quota.">
            <span className="text-xs">
              The store has{' '}
              <span className="figure font-medium">{rl.remaining}</span>{' '}
              request{rl.remaining === 1 ? '' : 's'} left this minute; this
              batch needs{' '}
              <span className="figure font-medium">{rows.length}</span>.
              Split the file or wait for the per-minute window to reset.
            </span>
          </Callout>
        )}
      </Card>

      {errors.length > 0 && <ParseErrors errors={errors} />}

      {rows.length > 0 && errors.length === 0 && !oversize && (
        <BatchPreview rows={rows} />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild type="button" variant="outline">
          <Link to="/payouts">Cancel</Link>
        </Button>
        <Button type="submit" disabled={submitDisabled}>
          {submit.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Submitting…
            </>
          ) : (
            <>
              <Send className="size-4" />
              {`Plan ${rows.length} payout${rows.length === 1 ? '' : 's'}`}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function ParseErrors({ errors }: { errors: BatchParseError[] }) {
  const paged = usePaged(errors, 25)
  return (
    <TableCard
      toolbar={<TableToolbar title="Parse errors" count={errors.length} />}
      footer={
        paged.pageCount > 1 ? (
          <Pager
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="errors"
          />
        ) : undefined
      }
    >
      <TableWrap>
        <Table className="min-w-[560px]">
          <THead>
            <tr>
              <Th align="right" className="w-16">Line</Th>
              <Th>Problem</Th>
              <Th>Content</Th>
            </tr>
          </THead>
          <TBody>
            {paged.rows.map((e) => (
              <Tr key={e.lineNo}>
                <Td align="right" className="text-[var(--fg-2)]">
                  {e.lineNo}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-2 text-sm text-destructive">
                    <XCircle weight="fill" className="size-4 shrink-0" />
                    {e.message}
                  </span>
                </Td>
                <Td className="max-w-[320px]">
                  <span className="block truncate font-mono text-xs text-[var(--fg-2)]" title={e.raw}>
                    {e.raw}
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </TableCard>
  )
}

function BatchPreview({ rows }: { rows: BatchCsvRow[] }) {
  const paged = usePaged(rows, 25)
  return (
    <TableCard
      toolbar={<TableToolbar title="Preview" count={rows.length} />}
      footer={
        paged.pageCount > 1 ? (
          <Pager
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            hasNext={paged.page < paged.pageCount - 1}
            onPage={paged.setPage}
            noun="rows"
          />
        ) : undefined
      }
    >
      <TableWrap>
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <Th align="right" className="w-16">Line</Th>
              <Th>Asset</Th>
              <Th>Network</Th>
              <Th>To</Th>
              <Th align="right">Amount</Th>
            </tr>
          </THead>
          <TBody>
            {paged.rows.map((r) => (
              <Tr key={r.lineNo}>
                <Td align="right" className="text-[var(--fg-2)]">
                  {r.lineNo}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-3">
                    <TokenOnChain symbol={r.token} chainId={r.chainId} size={32} />
                    <span className="font-medium">{r.token}</span>
                  </span>
                </Td>
                <Td>
                  <ChainPill chainId={r.chainId} />
                </Td>
                <Td>
                  <Addr value={r.destinationAddress} chainId={r.chainId} />
                </Td>
                <Td align="right">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    {r.amount}
                    <TokenIcon symbol={r.token} size={16} />
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </TableCard>
  )
}

function BatchResultView({
  result,
  onViewBatch,
  onBack,
  onReset,
}: {
  result: PayoutBatchResponse
  onViewBatch: () => void
  onBack: () => void
  onReset: () => void
}) {
  const { summary, results, batchId } = result
  const paged = usePaged(results, 25)
  return (
    <div className="space-y-8">
      <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Tile
          label="Planned"
          icon={CheckCircle2}
          tone={summary.planned > 0 ? 'ok' : undefined}
          value={summary.planned}
          sub={`of ${summary.planned + summary.failed} rows`}
        />
        <Tile
          label="Failed"
          icon={XCircle}
          tone={summary.failed > 0 ? 'bad' : undefined}
          value={summary.failed}
          sub={summary.failed > 0 ? 'Review per-row errors' : 'No failures'}
        />
        <Tile
          label="Batch"
          icon={Layers}
          value={
            <span className="inline-flex items-center gap-1 font-mono text-base">
              {truncateAddr(batchId, 10, 6)}
              <CopyButton value={batchId} />
            </span>
          }
          sub="batch id"
        />
      </div>

      <TableCard
        toolbar={<TableToolbar title="Results" count={results.length} />}
        footer={
          paged.pageCount > 1 ? (
            <Pager
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              hasNext={paged.page < paged.pageCount - 1}
              onPage={paged.setPage}
              noun="rows"
            />
          ) : undefined
        }
      >
        <TableWrap>
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                <Th align="right" className="w-14">#</Th>
                <Th>Payout</Th>
                <Th>Status</Th>
                <Th>Detail</Th>
                <Th align="right">Token</Th>
              </tr>
            </THead>
            <TBody>
              {paged.rows.map((row) => (
                <ResultRow key={row.index} row={row} />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </TableCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onReset}>
          <RotateCcw className="size-4" /> Submit another
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back to payouts
        </Button>
        {summary.planned > 0 && (
          <Button type="button" onClick={onViewBatch}>
            <Layers className="size-4" /> View batch <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function ResultRow({ row }: { row: PayoutBatchRowResult }) {
  if (row.status === 'planned') {
    const po = row.payout
    return (
      <Tr>
        <Td align="right" className="text-[var(--fg-2)]">
          {row.index}
        </Td>
        <Td>
          <span className="flex min-w-0 items-center gap-3">
            <TokenOnChain symbol={po.token} chainId={po.chainId} size={32} />
            <span className="inline-flex items-center gap-1 font-mono text-sm">
              {truncateAddr(po.id, 8, 6)}
              <CopyButton value={po.id} />
            </span>
          </span>
        </Td>
        <Td>
          <StatusPill tone="wait">planned</StatusPill>
        </Td>
        <Td>
          <span className="flex min-w-0 items-center gap-3">
            <ChainPill chainId={po.chainId} iconOnly />
            <Addr value={po.destinationAddress} chainId={po.chainId} />
          </span>
        </Td>
        <Td align="right" className="text-[var(--fg-2)]">
          <span className="inline-flex items-center gap-1.5">
            <TokenIcon symbol={po.token} size={14} />
            {po.token}
          </span>
        </Td>
      </Tr>
    )
  }
  return (
    <Tr>
      <Td align="right" className="text-[var(--fg-2)]">
        {row.index}
      </Td>
      <Td>
        <span className="flex items-center gap-3 text-[var(--fg-3)]">
          <RowAvatar icon={XCircle} />—
        </span>
      </Td>
      <Td>
        <StatusPill tone="bad">failed</StatusPill>
      </Td>
      <Td colSpan={2}>
        <div className="min-w-0 space-y-0.5">
          {row.error.code && (
            <div className="font-mono text-xs text-destructive">{row.error.code}</div>
          )}
          <div className="text-sm break-words text-[var(--fg-1)]">{row.error.message}</div>
        </div>
      </Td>
    </Tr>
  )
}

/* ── misc states ───────────────────────────────────────── */

function BackToPayouts() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to="/payouts">
        <ArrowLeft className="size-4" /> Payouts
      </Link>
    </Button>
  )
}

function Loading() {
  return (
    <div className="fade-in space-y-8">
      <BatchHeader />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-7 w-20" />
          </Card>
        ))}
      </div>
      <Card className="space-y-4 p-6">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </Card>
    </div>
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-8">
      <BatchHeader />
      <EmptyState
        framed
        icon={Layers}
        title="Add a store first"
        description="Batch payouts use a store’s API key."
        action={
          <Button size="sm" asChild>
            <Link to="/stores">Go to Stores</Link>
          </Button>
        }
      />
    </div>
  )
}

function NoApiKeyCard() {
  return (
    <EmptyState
      framed
      icon={KeyRound}
      title="No API key for this store"
      description="Rotate or import the key from Stores to plan payouts."
      action={
        <Button size="sm" asChild>
          <Link to="/stores">
            <KeyRound className="size-4" /> Set up API key
          </Link>
        </Button>
      }
    />
  )
}

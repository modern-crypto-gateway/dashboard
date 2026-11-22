import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Gauge,
  KeyRound,
  Layers,
  Loader2,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { truncateAddr } from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import { useMerchantRateLimit } from '@/lib/rateLimit'
import type { PayoutBatchResponse } from '@/lib/types'

import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { ChainPill } from '@/components/ChainPill'
import { PageHeader } from '@/components/PageHeader'
import { Callout, EmptyState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
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

function QuotaRow({
  remaining,
  limit,
}: {
  remaining: number | null
  limit: number | null
}) {
  if (remaining === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--fg-2)]">
        <Gauge className="size-3.5" />
        quota unknown
      </span>
    )
  }
  const warn = limit !== null && remaining < Math.max(5, limit * 0.1)
  return (
    <span
      className={
        'inline-flex items-center gap-1 ' +
        (warn ? 'text-warn' : 'text-[var(--fg-2)]')
      }
      title="Remaining this minute for the store's API key."
    >
      <Gauge className="size-3.5" />
      <span className="font-mono tabular-nums">{remaining}</span>
      {limit !== null && (
        <span className="text-[var(--fg-3)]">
          /{' '}
          <span className="font-mono tabular-nums">{limit}</span>
        </span>
      )}
      <span className="text-[var(--fg-3)]">quota</span>
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
    <div className="fade-in space-y-5">
      <div className="space-y-2">
        <BackToPayouts />
        <PageHeader
          eyebrow="Payments"
          title="Batch payout"
          description={
            <>
              Plan up to {BATCH_MAX} payouts in one request. Paste CSV with
              columns{' '}
              <span className="font-mono break-all">chainId,token,amount,destinationAddress</span>.
              Per-row errors don&rsquo;t abort the batch — HTTP 200 with mixed
              outcomes is normal; you&rsquo;ll see each row&rsquo;s result below.
            </>
          }
          actions={<MerchantSwitcher />}
        />
      </div>

      {!canSubmit && active ? (
        <NoApiKeyCard />
      ) : active && canSubmit ? (
        <BatchForm merchantId={active.id} />
      ) : null}
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

  return (
    <Card>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate()
        }}
      >
        <Field
          label="CSV"
          hint="One payout per line. Blank lines and lines starting with '#' are ignored. A header row is optional."
        >
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={14}
            placeholder={
              'chainId,token,amount,destinationAddress\n42161,USDC,1.5,0x1111111111111111111111111111111111111111\n1,ETH,0.01,0x3333333333333333333333333333333333333333'
            }
            className="font-mono text-xs"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-[var(--fg-2)]">
            <span className="font-mono tabular-nums text-foreground">{rows.length}</span> parsed
          </span>
          {errors.length > 0 && (
            <span className="text-destructive">
              <span className="font-mono tabular-nums">{errors.length}</span>{' '}
              parse error{errors.length === 1 ? '' : 's'}
            </span>
          )}
          {oversize && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertTriangle className="size-3.5" />
              Exceeds {BATCH_MAX}-row limit — split the file.
            </span>
          )}
          <span className="flex-1" />
          <QuotaRow remaining={rl?.remaining ?? null} limit={rl?.limit ?? null} />
        </div>

        {exceedsQuota && rl && (
          <Callout
            tone="danger"
            title="Batch exceeds store quota."
            className="rounded-md px-3 py-2.5"
          >
            <span className="text-xs">
              The store has{' '}
              <span className="font-mono tabular-nums">{rl.remaining}</span>{' '}
              request{rl.remaining === 1 ? '' : 's'} left this minute; this
              batch needs{' '}
              <span className="font-mono tabular-nums">{rows.length}</span>.
              Split the file or wait for the per-minute window to reset.
            </span>
          </Callout>
        )}

        {errors.length > 0 && (
          <div className="max-h-52 overflow-auto rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs">
            <ul className="space-y-1">
              {errors.slice(0, 30).map((e) => (
                <li key={e.lineNo} className="flex min-w-0 items-start gap-2">
                  <span className="shrink-0 font-mono tabular-nums text-destructive">
                    L{e.lineNo}
                  </span>
                  <span className="shrink-0 text-destructive">{e.message}</span>
                  <span className="flex-1" />
                  <span className="min-w-0 truncate font-mono text-[var(--fg-2)]">
                    {e.raw}
                  </span>
                </li>
              ))}
              {errors.length > 30 && (
                <li className="text-destructive">
                  …and {errors.length - 30} more
                </li>
              )}
            </ul>
          </div>
        )}

        {rows.length > 0 && errors.length === 0 && !oversize && (
          <BatchPreview rows={rows} />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button asChild type="button" variant="outline">
            <Link to="/payouts">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitDisabled}>
            {submit.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Submitting…
              </>
            ) : (
              `Plan ${rows.length} payout${rows.length === 1 ? '' : 's'}`
            )}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function BatchPreview({ rows }: { rows: BatchCsvRow[] }) {
  const preview = rows.slice(0, 10)
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="eyebrow">Preview</div>
        {rows.length > preview.length && (
          <div className="text-xs text-[var(--fg-2)]">
            + {rows.length - preview.length} more
          </div>
        )}
      </div>
      <TableWrap>
        <Table className="min-w-[520px]">
          <THead>
            <tr>
              <Th align="right" className="w-12">L</Th>
              <Th>Chain</Th>
              <Th>Token</Th>
              <Th align="right">Amount</Th>
              <Th>Destination</Th>
            </tr>
          </THead>
          <TBody>
            {preview.map((r) => (
              <Tr key={r.lineNo}>
                <Td align="right" className="py-2 text-xs text-[var(--fg-3)]">
                  {r.lineNo}
                </Td>
                <Td className="py-2">
                  <ChainPill chainId={r.chainId} />
                </Td>
                <Td className="py-2 font-mono text-xs">{r.token}</Td>
                <Td align="right" className="py-2 text-xs">
                  {r.amount}
                </Td>
                <Td className="py-2 font-mono text-xs text-[var(--fg-2)]">
                  {truncateAddr(r.destinationAddress, 8, 6)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </div>
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
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3 text-sm">
          <Layers className="size-4 text-[var(--fg-2)]" />
          <span className="font-mono text-xs text-[var(--fg-1)]">
            {truncateAddr(batchId, 10, 6)}
          </span>
          <CopyButton value={batchId} />
          <span className="flex-1" />
          <Badge variant="success">{summary.planned} planned</Badge>
          {summary.failed > 0 && (
            <Badge variant="danger">{summary.failed} failed</Badge>
          )}
        </div>

        <TableWrap>
          <Table className="min-w-[560px]">
            <THead>
              <tr>
                <Th align="right" className="w-12">#</Th>
                <Th>Status</Th>
                <Th>Payout</Th>
                <Th>Detail</Th>
              </tr>
            </THead>
            <TBody>
              {results.map((row) => (
                <Tr key={row.index} className="align-top">
                  <Td align="right" className="text-xs text-[var(--fg-3)]">
                    {row.index}
                  </Td>
                  <Td>
                    {row.status === 'planned' ? (
                      <Badge variant="success">planned</Badge>
                    ) : (
                      <Badge variant="danger">failed</Badge>
                    )}
                  </Td>
                  <Td>
                    {row.status === 'planned' ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">
                          {truncateAddr(row.payout.id, 8, 6)}
                        </span>
                        <CopyButton value={row.payout.id} />
                      </div>
                    ) : (
                      <span className="text-[var(--fg-3)]">—</span>
                    )}
                  </Td>
                  <Td>
                    {row.status === 'planned' ? (
                      <span className="inline-flex items-center gap-2 text-xs text-[var(--fg-2)]">
                        <ChainPill chainId={row.payout.chainId} />
                        <span className="font-mono">{row.payout.token}</span>
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        {row.error.code && (
                          <div className="font-mono text-2xs uppercase tracking-[0.06em] text-destructive">
                            {row.error.code}
                          </div>
                        )}
                        <div className="break-all text-xs text-destructive">
                          {row.error.message}
                        </div>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onReset}>
          Submit another
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back to payouts
        </Button>
        {summary.planned > 0 && (
          <Button type="button" onClick={onViewBatch}>
            <Layers className="size-3.5" /> View batch
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── misc states ───────────────────────────────────────── */

function BackToPayouts() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2.5">
      <Link to="/payouts">
        <ArrowLeft className="size-3.5" /> Payouts
      </Link>
    </Button>
  )
}

function Loading() {
  return (
    <div className="fade-in space-y-5">
      <div className="space-y-2">
        <BackToPayouts />
        <PageHeader eyebrow="Payments" title="Batch payout" />
      </div>
      <Card className="space-y-4 p-5">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-64 w-full" />
        <div className="flex justify-end gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-32" />
        </div>
      </Card>
    </div>
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-5">
      <div className="space-y-2">
        <BackToPayouts />
        <PageHeader eyebrow="Payments" title="Batch payout" />
      </div>
      <EmptyState
        framed
        icon={Layers}
        title="Add a store first"
        description="Batch payouts are scoped to a store’s API key."
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
            <KeyRound className="size-3.5" /> Set up API key
          </Link>
        </Button>
      }
    />
  )
}

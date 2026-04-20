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
import { chainInfo } from '@/lib/chains'
import { truncateAddr } from '@/lib/format'
import { useActiveMerchant, useMerchants } from '@/lib/merchants'
import { useMerchantRateLimit } from '@/lib/rateLimit'
import type { PayoutBatchResponse } from '@/lib/types'

import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { MerchantSwitcher } from '@/components/MerchantSwitcher'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
      <span className="inline-flex items-center gap-1 text-[var(--fg-3)]">
        <Gauge className="size-3" />
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
      title="Remaining this minute for the merchant's API key."
    >
      <Gauge className="size-3" />
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

function ChainPill({ chainId }: { chainId: number }) {
  const info = chainInfo(chainId)
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-2)]">
      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: info.color }}
      />
      <span className="truncate">{info.name}</span>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link to="/payouts">
                <ArrowLeft className="size-3.5" /> Payouts
              </Link>
            </Button>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Batch payout
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-2)]">
            Plan up to {BATCH_MAX} payouts in one request. Paste CSV with
            columns <span className="font-mono">chainId,token,amount,destinationAddress</span>.
            Per-row errors don&rsquo;t abort the batch — HTTP 200 with mixed
            outcomes is normal; you&rsquo;ll see each row&rsquo;s result below.
          </p>
        </div>
        <MerchantSwitcher />
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
    <form
      className="space-y-4"
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
          className="font-mono text-[12px]"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3 text-[11.5px]">
        <span>
          <span className="font-mono tabular-nums">{rows.length}</span> parsed
        </span>
        {errors.length > 0 && (
          <span className="text-destructive">
            <span className="font-mono tabular-nums">{errors.length}</span>{' '}
            parse error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        {oversize && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="size-3" />
            Exceeds {BATCH_MAX}-row limit — split the file.
          </span>
        )}
        <span className="flex-1" />
        <QuotaRow remaining={rl?.remaining ?? null} limit={rl?.limit ?? null} />
      </div>

      {exceedsQuota && rl && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5 text-[11.5px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <div className="font-semibold">Batch exceeds merchant quota.</div>
            <div className="mt-0.5 text-destructive/90">
              The merchant has{' '}
              <span className="font-mono tabular-nums">{rl.remaining}</span>{' '}
              request{rl.remaining === 1 ? '' : 's'} left this minute; this
              batch needs{' '}
              <span className="font-mono tabular-nums">{rows.length}</span>.
              Split the file or wait for the per-minute window to reset.
            </div>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="max-h-52 overflow-auto rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[11.5px]">
          <ul className="space-y-1">
            {errors.slice(0, 30).map((e) => (
              <li key={e.lineNo} className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[10.5px] text-destructive">
                  L{e.lineNo}
                </span>
                <span className="text-destructive">{e.message}</span>
                <span className="flex-1" />
                <span className="truncate font-mono text-[10.5px] text-[var(--fg-3)]">
                  {e.raw}
                </span>
              </li>
            ))}
            {errors.length > 30 && (
              <li className="text-destructive/80">
                …and {errors.length - 30} more
              </li>
            )}
          </ul>
        </div>
      )}

      {rows.length > 0 && errors.length === 0 && !oversize && (
        <BatchPreview rows={rows} />
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
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
  )
}

function BatchPreview({ rows }: { rows: BatchCsvRow[] }) {
  const preview = rows.slice(0, 10)
  return (
    <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2">
      <div className="eyebrow mb-1">Preview</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
            <tr>
              <th className="py-1 pr-3 text-left">L</th>
              <th className="py-1 pr-3 text-left">Chain</th>
              <th className="py-1 pr-3 text-left">Token</th>
              <th className="py-1 pr-3 text-left">Amount</th>
              <th className="py-1 text-left">Destination</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.lineNo} className="border-t border-border">
                <td className="py-1 pr-3 font-mono text-[10.5px] text-[var(--fg-3)]">
                  {r.lineNo}
                </td>
                <td className="py-1 pr-3">
                  <ChainPill chainId={r.chainId} />
                </td>
                <td className="py-1 pr-3 font-mono">{r.token}</td>
                <td className="py-1 pr-3 font-mono tabular-nums">
                  {r.amount}
                </td>
                <td className="py-1 font-mono text-[11px] text-[var(--fg-2)]">
                  {truncateAddr(r.destinationAddress, 8, 6)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > preview.length && (
        <div className="mt-1 text-[11px] text-[var(--fg-3)]">
          + {rows.length - preview.length} more
        </div>
      )}
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-[12px]">
        <Layers className="size-3.5 text-primary" />
        <span className="font-mono text-[11px] text-[var(--fg-2)]">
          {truncateAddr(batchId, 10, 6)}
        </span>
        <CopyButton value={batchId} />
        <span className="flex-1" />
        <Badge variant="success">{summary.planned} planned</Badge>
        {summary.failed > 0 && (
          <Badge variant="danger">{summary.failed} failed</Badge>
        )}
      </div>

      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-[11.5px]">
          <thead className="bg-[var(--bg-2)] text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
            <tr>
              <th className="py-1.5 pl-3 pr-2 text-left">#</th>
              <th className="py-1.5 pr-2 text-left">Status</th>
              <th className="py-1.5 pr-2 text-left">Payout</th>
              <th className="py-1.5 pr-3 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.index} className="border-t border-border align-top">
                <td className="py-1.5 pl-3 pr-2 font-mono text-[10.5px] text-[var(--fg-3)]">
                  {row.index}
                </td>
                <td className="py-1.5 pr-2">
                  {row.status === 'planned' ? (
                    <Badge variant="success">planned</Badge>
                  ) : (
                    <Badge variant="danger">failed</Badge>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {row.status === 'planned' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10.5px]">
                        {truncateAddr(row.payout.id, 8, 6)}
                      </span>
                      <CopyButton value={row.payout.id} />
                    </div>
                  ) : (
                    <span className="text-[var(--fg-3)]">—</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  {row.status === 'planned' ? (
                    <span className="text-[var(--fg-2)]">
                      <ChainPill chainId={row.payout.chainId} />{' '}
                      <span className="font-mono">{row.payout.token}</span>
                    </span>
                  ) : (
                    <div className="space-y-0.5">
                      {row.error.code && (
                        <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">
                          {row.error.code}
                        </div>
                      )}
                      <div className="break-all text-destructive">
                        {row.error.message}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
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

function Loading() {
  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Batch payout</h1>
      </div>
      <div className="rounded-md border border-dashed border-border bg-card p-10 text-center text-sm text-[var(--fg-2)]">
        Loading…
      </div>
    </div>
  )
}

function NoMerchants() {
  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Batch payout</h1>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
        <div className="text-sm font-medium">Add a merchant first</div>
        <p className="text-xs text-[var(--fg-2)]">
          Batch payouts are scoped to a merchant&rsquo;s API key.
        </p>
        <Button size="sm" asChild>
          <Link to="/merchants">Go to Merchants</Link>
        </Button>
      </div>
    </div>
  )
}

function NoApiKeyCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--bg-2)]">
        <KeyRound className="size-5 text-[var(--fg-2)]" />
      </div>
      <div className="text-sm font-medium">No API key for this merchant</div>
      <p className="max-w-sm text-xs text-[var(--fg-2)]">
        Rotate or import the key from Merchants to plan payouts.
      </p>
      <Button size="sm" asChild>
        <Link to="/merchants">
          <KeyRound className="size-3.5" /> Set up API key
        </Link>
      </Button>
    </div>
  )
}

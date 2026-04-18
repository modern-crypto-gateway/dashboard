import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Shield } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { AuditResult } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function AuditAddressPage() {
  const [chainId, setChainId] = React.useState('1')
  const [address, setAddress] = React.useState('')
  const [sinceDays, setSinceDays] = React.useState('30')

  const audit = useMutation({
    mutationFn: () => {
      const sinceMs = Date.now() - parseInt(sinceDays || '0', 10) * 86_400_000
      return api<{ audit: AuditResult }>('/api/gw/admin/audit-address', {
        method: 'POST',
        body: JSON.stringify({
          chainId: parseInt(chainId, 10),
          address,
          sinceMs,
        }),
      })
    },
    onSuccess: (res) => {
      toast.success(
        res.audit.inserted > 0
          ? `Inserted ${res.audit.inserted} tx${res.audit.inserted === 1 ? '' : 's'}`
          : 'No new transactions',
      )
    },
    onError: (e: ApiError) => toast.error(e.message || 'Audit failed'),
  })

  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Audit address
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Diff an address's on-chain history against the gateway's recorded
          transactions. Missing transfers land as orphans (or credit an open
          invoice).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run audit</CardTitle>
          <CardDescription>
            Scans every registered token on the chosen chain for the address.
            Idempotent — already-known txs are silently skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-xl gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              audit.mutate()
            }}
          >
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <Field label="Chain ID">
                <Input
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </Field>
              <Field label="Lookback (days)" hint="Adapter-clamped; default 30.">
                <Input
                  value={sinceDays}
                  onChange={(e) => setSinceDays(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </Field>
            </div>
            <Field label="Address">
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono"
                required
              />
            </Field>
            <div>
              <Button
                type="submit"
                disabled={
                  audit.isPending || !/^\d+$/.test(chainId) || address.trim().length < 8
                }
              >
                <Search className="size-3.5" />{' '}
                {audit.isPending ? 'Auditing…' : 'Run audit'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {audit.data && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>
              Chain {audit.data.audit.chainId} · {' '}
              <span className="font-mono">{audit.data.audit.address}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="scanned" value={audit.data.audit.scanned} />
              <Stat label="inserted" value={audit.data.audit.inserted} tone="success" />
              <Stat label="already present" value={audit.data.audit.alreadyPresent} />
              <Stat
                label="since"
                value={
                  new Date(audit.data.audit.sinceMs)
                    .toISOString()
                    .slice(0, 10)
                }
                mono
              />
            </div>
            {audit.data.audit.insertedTxIds.length > 0 && (
              <div className="mt-4">
                <div className="eyebrow mb-2">newly inserted</div>
                <div className="space-y-1.5">
                  {audit.data.audit.insertedTxIds.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs"
                    >
                      <Shield className="size-3.5 text-success" />
                      <Addr value={id} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string
  value: React.ReactNode
  tone?: 'success'
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-[var(--bg-2)] px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div
        className={
          (mono ? 'font-mono ' : '') +
          'mt-1 text-lg font-semibold ' +
          (tone === 'success' ? 'text-success' : '')
        }
      >
        {value}
      </div>
    </div>
  )
}

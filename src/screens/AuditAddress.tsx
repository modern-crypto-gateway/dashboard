import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Shield } from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtLocalDate } from '@/lib/format'
import type { AuditResult, ChainInventoryEntry } from '@/lib/types'

import { Addr } from '@/components/Addr'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { Stat } from '@/components/States'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function AuditAddressPage() {
  const [chainId, setChainId] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [sinceDays, setSinceDays] = React.useState('30')

  const chainsQ = useQuery({
    queryKey: ['gw', 'chains'] as const,
    queryFn: () =>
      api<{ chains: ChainInventoryEntry[] }>('/api/gw/admin/chains'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  })
  const chainOptions = React.useMemo(
    () =>
      (chainsQ.data?.chains ?? [])
        .filter((c) => c.wired)
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [chainsQ.data],
  )
  // Default to the first option once chainOptions loads. Render-time
  // setState is safe: the condition becomes false on the next render.
  if (!chainId && chainOptions.length > 0) {
    setChainId(String(chainOptions[0].chainId))
  }

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
      <PageHeader
        eyebrow="Infrastructure"
        title="Audit address"
        description="Diff an address's on-chain history against the gateway's recorded transactions. Missing transfers land as orphans (or credit an open invoice)."
      />

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Chain">
                <Select
                  value={chainId}
                  onValueChange={setChainId}
                  disabled={chainsQ.isLoading || chainOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        chainsQ.isLoading
                          ? 'Loading…'
                          : chainOptions.length === 0
                            ? 'No wired chains'
                            : 'Select chain'
                      }
                    />
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
            <CardDescription className="break-all">
              Chain {audit.data.audit.chainId} · {' '}
              <span className="font-mono text-xs">{audit.data.audit.address}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <AuditStat label="Scanned" value={audit.data.audit.scanned} />
              <AuditStat
                label="Inserted"
                value={audit.data.audit.inserted}
                tone="success"
              />
              <AuditStat
                label="Already present"
                value={audit.data.audit.alreadyPresent}
              />
              <AuditStat
                label="Since"
                value={fmtLocalDate(audit.data.audit.sinceMs)}
              />
            </div>
            {audit.data.audit.insertedTxIds.length > 0 && (
              <div className="mt-5">
                <div className="eyebrow mb-2">Newly inserted</div>
                <div className="space-y-1.5">
                  {audit.data.audit.insertedTxIds.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-3 py-2 text-xs"
                    >
                      <Shield className="size-3.5 shrink-0 text-success" />
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

function AuditStat({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: 'success'
}) {
  return (
    <div className="bg-card px-4 py-3">
      <Stat label={label} value={value} tone={tone} />
    </div>
  )
}

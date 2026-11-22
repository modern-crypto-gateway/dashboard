import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { fmtLocal } from '@/lib/format'

import { CopyButton } from '@/components/CopyButton'
import { TableCard, TableToolbar } from '@/components/DataTable'
import { Field } from '@/components/Field'
import { OtpInput } from '@/components/OtpInput'
import {
  PasswordField,
  PasswordMeter,
  scorePassword,
} from '@/components/PasswordField'
import { QrCode } from '@/components/QrCode'
import { EmptyState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface SessionRow {
  hash: string
  current: boolean
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  idleSeconds: number
  ip: string | null
  userAgent: string | null
}

const sessionsKey = ['security', 'sessions'] as const

export function SecurityPanel() {
  return (
    <div className="space-y-5">
      <ChangePasswordCard />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <RotateTotpCard />
        <RecoveryCodesCard />
      </div>
      <SessionsCard />
    </div>
  )
}

/** Card title row: icon tile, title, one line, optional right slot. */
function CardHead({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{title}</h3>
          {sub && <p className="mt-0.5 text-sm text-pretty text-[var(--fg-2)]">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

/* ── change password ───────────────────────────────────────── */

function ChangePasswordCard() {
  const [oldPassword, setOldPw] = React.useState('')
  const [newPassword, setNewPw] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [totp, setTotp] = React.useState('')

  const change = useMutation({
    mutationFn: () =>
      api('/api/security/password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword, totp }),
      }),
    onSuccess: () => {
      toast.success('Password changed')
      setOldPw('')
      setNewPw('')
      setConfirm('')
      setTotp('')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not change password'),
  })

  const pwScore = scorePassword(newPassword)
  const canSubmit =
    oldPassword.length > 0 &&
    newPassword.length >= 12 &&
    newPassword === confirm &&
    totp.length === 6

  return (
    <Card className="p-6">
      <CardHead
        icon={KeyRound}
        title="Change password"
        sub="Requires your current password and a current authenticator code."
      />
      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          change.mutate()
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
            <Field label="Current password">
              <PasswordField
                value={oldPassword}
                onChange={(e) => setOldPw(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          </div>
          <Field label="New password">
            <PasswordField
              value={newPassword}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 12 characters"
            />
            <PasswordMeter score={pwScore} />
          </Field>
          <Field
            label="Confirm new password"
            error={
              confirm && newPassword !== confirm
                ? "Passwords don't match."
                : undefined
            }
          >
            <PasswordField
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field label="Authenticator code">
            <OtpInput value={totp} onChange={setTotp} autoFocus={false} />
          </Field>
          <Button type="submit" disabled={change.isPending || !canSubmit}>
            <KeyRound className="size-4" />
            {change.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ── rotate TOTP ──────────────────────────────────────────── */

function RotateTotpCard() {
  const [open, setOpen] = React.useState(false)
  return (
    <Card className="flex flex-col p-6">
      <CardHead
        icon={Smartphone}
        title="Authenticator app"
        sub="Scan a new QR with your authenticator. The old one stops working as soon as you confirm the new code."
      />
      <div className="mt-5 flex flex-1 items-end justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Smartphone className="size-4" /> Rotate 2FA
            </Button>
          </DialogTrigger>
          <RotateTotpDialogContent onDone={() => setOpen(false)} />
        </Dialog>
      </div>
    </Card>
  )
}

function RotateTotpDialogContent({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = React.useState<'verify' | 'scan'>('verify')
  const [password, setPassword] = React.useState('')
  const [newSecret, setNewSecret] = React.useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [newCode, setNewCode] = React.useState('')
  const [currentCode, setCurrentCode] = React.useState('')

  const begin = useMutation({
    mutationFn: () =>
      api<{ secret: string; otpauthUrl: string }>('/api/security/totp/begin', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: (r) => {
      setNewSecret(r)
      setStage('scan')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not begin'),
  })

  const commit = useMutation({
    mutationFn: () =>
      api('/api/security/totp/commit', {
        method: 'POST',
        body: JSON.stringify({ code: newCode, currentTotp: currentCode }),
      }),
    onSuccess: () => {
      toast.success('Authenticator rotated')
      onDone()
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Could not commit')
      setNewCode('')
      setCurrentCode('')
    },
  })

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Rotate authenticator</DialogTitle>
        <DialogDescription>
          Step 1 verifies your password · step 2 scans + confirms the new code
          alongside one last old code.
        </DialogDescription>
      </DialogHeader>

      <StepDots step={stage === 'verify' ? 0 : 1} />

      {stage === 'verify' && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            begin.mutate()
          }}
        >
          <Field label="Password">
            <PasswordField
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={begin.isPending || password.length === 0}>
              {begin.isPending ? 'Checking…' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      )}

      {stage === 'scan' && newSecret && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            commit.mutate()
          }}
        >
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-[var(--bg-2)] p-4 sm:flex-row sm:items-start">
            <QrCode value={newSecret.otpauthUrl} />
            <div className="w-full min-w-0 flex-1 space-y-4">
              <div>
                <div className="text-sm font-medium">Scan with your app</div>
                <div className="mt-0.5 text-xs text-[var(--fg-2)]">
                  Add the dashboard as a new entry. Keep the old one until you
                  finish this dialog.
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">Or enter the setup key</div>
                <div className="mt-1.5 flex items-center gap-1.5 rounded-[10px] border border-border bg-card py-1.5 pr-1 pl-3">
                  <span className="min-w-0 break-all font-mono text-xs">
                    {newSecret.secret.match(/.{1,4}/g)?.join(' ')}
                  </span>
                  <div className="flex-1" />
                  <span className="shrink-0">
                    <CopyButton value={newSecret.secret} />
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="New authenticator code">
              <OtpInput value={newCode} onChange={setNewCode} autoFocus />
            </Field>
            <Field label="Current authenticator code (old)">
              <OtpInput
                value={currentCode}
                onChange={setCurrentCode}
                autoFocus={false}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStage('verify')}>
              Back
            </Button>
            <Button
              type="submit"
              disabled={
                commit.isPending ||
                newCode.length !== 6 ||
                currentCode.length !== 6
              }
            >
              {commit.isPending ? 'Rotating…' : 'Rotate & finish'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  )
}

/** Two-step progress for the rotate dialog. */
function StepDots({ step }: { step: 0 | 1 }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of 2`}>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors',
            i <= step ? 'bg-foreground' : 'bg-[var(--chart-muted)]',
          )}
        />
      ))}
    </div>
  )
}

/* ── recovery codes ────────────────────────────────────────── */

function RecoveryCodesCard() {
  const [open, setOpen] = React.useState(false)
  return (
    <Card className="flex flex-col p-6">
      <CardHead
        icon={ShieldCheck}
        title="Recovery codes"
        sub="Mint a fresh set of 10 single-use codes. The old set becomes invalid immediately."
      />
      <div className="mt-5 flex flex-1 items-end justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <ShieldCheck className="size-4" /> Regenerate codes
            </Button>
          </DialogTrigger>
          <RegenerateRecoveryDialog onDone={() => setOpen(false)} />
        </Dialog>
      </div>
    </Card>
  )
}

function RegenerateRecoveryDialog({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = React.useState('')
  const [totp, setTotp] = React.useState('')
  const [codes, setCodes] = React.useState<string[] | null>(null)
  const [revealed, setRevealed] = React.useState(false)

  const regen = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>('/api/security/recovery/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password, totp }),
      }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes)
      toast.success('New recovery codes generated')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not regenerate'),
  })

  const copyAll = async () => {
    if (!codes) return
    await navigator.clipboard.writeText(codes.join('\n'))
    toast.success('Copied')
  }
  const download = () => {
    if (!codes) return
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gateway-dashboard-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Regenerate recovery codes</DialogTitle>
        <DialogDescription>
          The old codes stop working the moment you confirm. Make sure to store
          the new set before closing this dialog.
        </DialogDescription>
      </DialogHeader>

      {!codes ? (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            regen.mutate()
          }}
        >
          <Field label="Password">
            <PasswordField
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="Authenticator code">
            <OtpInput value={totp} onChange={setTotp} autoFocus={false} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={regen.isPending || password.length === 0 || totp.length !== 6}
            >
              {regen.isPending ? 'Minting…' : 'Regenerate'}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-[var(--bg-2)] px-4 py-2.5">
              <div className="text-sm font-semibold">New recovery codes</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? (
                  <>
                    <EyeOff className="size-4" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-4" /> Reveal
                  </>
                )}
              </Button>
            </div>
            <ol className="grid grid-cols-2 gap-2 p-4">
              {codes.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2"
                >
                  <span className="figure w-4 text-right text-xs text-[var(--fg-3)]">
                    {i + 1}
                  </span>
                  <span className="font-mono text-sm tracking-wider">
                    {revealed ? c : '•••• ••••'}
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              <Button variant="outline" size="sm" onClick={copyAll}>
                <Copy className="size-4" /> Copy all
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                <ArrowDown className="size-4" /> Download .txt
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={onDone}>Done</Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  )
}

/* ── sessions ─────────────────────────────────────────────── */

function SessionsCard() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: sessionsKey,
    queryFn: () => api<{ sessions: SessionRow[] }>('/api/security/sessions'),
    refetchInterval: 60_000,
  })

  const revokeAll = useMutation({
    mutationFn: () =>
      api<{ revoked: number }>('/api/security/sessions/revoke-all', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`Revoked ${r.revoked} session${r.revoked === 1 ? '' : 's'}`)
      qc.invalidateQueries({ queryKey: sessionsKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not revoke'),
  })

  const sessions = list.data?.sessions ?? []

  return (
    <TableCard
      toolbar={
        <TableToolbar
          title="Active sessions"
          count={list.isLoading ? undefined : sessions.length}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh sessions"
            title="Refresh"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => revokeAll.mutate()}
            disabled={revokeAll.isPending || (list.data?.sessions.length ?? 0) <= 1}
          >
            <LogOut className="size-4" />
            {revokeAll.isPending ? 'Revoking…' : 'Revoke all others'}
          </Button>
        </TableToolbar>
      }
    >
      {list.isLoading ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-3.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-48 max-w-full" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState compact icon={MonitorSmartphone} title="No active sessions" />
      ) : (
        <TableWrap>
          <Table className="min-w-[680px]">
            <THead>
              <tr>
                <Th>Device</Th>
                <Th>IP</Th>
                <Th align="right">Idle</Th>
                <Th align="right">Expires</Th>
                <Th className="w-24">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {sessions.map((s) => (
                <SessionRowView key={s.hash} row={s} />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </TableCard>
  )
}

function SessionRowView({ row }: { row: SessionRow }) {
  const qc = useQueryClient()
  const revoke = useMutation({
    mutationFn: () =>
      api('/api/security/sessions/revoke', {
        method: 'POST',
        body: JSON.stringify({ hash: row.hash }),
      }),
    onSuccess: () => {
      toast.success('Session revoked')
      qc.invalidateQueries({ queryKey: sessionsKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not revoke'),
  })

  const ua = row.userAgent || ''
  const device = describeUa(ua)
  const DeviceIcon = device.mobile ? Smartphone : Monitor

  return (
    <Tr className={cn(row.current && 'bg-[var(--bg-2)]')}>
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border"
          >
            <DeviceIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{device.label}</span>
              {row.current && (
                <StatusPill tone="ok" size="sm">
                  This device
                </StatusPill>
              )}
            </div>
            <div
              className="max-w-[320px] truncate text-xs text-[var(--fg-3)]"
              title={ua || undefined}
            >
              {ua || 'Unknown client'}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        {row.ip ? (
          <span className="font-mono text-xs text-[var(--fg-1)]">{row.ip}</span>
        ) : (
          <span className="text-[var(--fg-3)]">—</span>
        )}
      </Td>
      <Td align="right" className="text-sm text-[var(--fg-2)]">
        {humanSecs(row.idleSeconds)}
      </Td>
      <Td align="right" className="text-sm whitespace-nowrap text-[var(--fg-2)]">
        {fmtLocal(row.expiresAt)}
      </Td>
      <Td className="text-right">
        {!row.current && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-[var(--danger-bg)] hover:text-destructive"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
          >
            <LogOut className="size-4" />
            Revoke
          </Button>
        )}
      </Td>
    </Tr>
  )
}

/** "Chrome on macOS" from a user-agent string; falls back to a short label. */
function describeUa(ua: string): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown client', mobile: false }
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /iPhone|iPad|iOS/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (browser && os) return { label: `${browser} on ${os}`, mobile }
  if (browser || os) return { label: (browser ?? os)!, mobile }
  return { label: ua.slice(0, 40) + (ua.length > 40 ? '…' : ''), mobile }
}

function humanSecs(n: number): string {
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.floor(n / 60)}m`
  if (n < 86400) return `${Math.floor(n / 3600)}h`
  return `${Math.floor(n / 86400)}d`
}

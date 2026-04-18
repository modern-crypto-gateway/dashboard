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
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'

import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { OtpInput } from '@/components/OtpInput'
import {
  PasswordField,
  PasswordMeter,
  scorePassword,
} from '@/components/PasswordField'
import { QrCode } from '@/components/QrCode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
    <div className="space-y-4">
      <ChangePasswordCard />
      <RotateTotpCard />
      <RecoveryCodesCard />
      <SessionsCard />
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
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Requires your current password and a current authenticator code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-lg gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            change.mutate()
          }}
        >
          <Field label="Current password">
            <PasswordField
              value={oldPassword}
              onChange={(e) => setOldPw(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
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
          <Field label="Authenticator code">
            <OtpInput value={totp} onChange={setTotp} autoFocus={false} />
          </Field>
          <div>
            <Button
              type="submit"
              disabled={change.isPending || !canSubmit}
            >
              <KeyRound className="size-3.5" />
              {change.isPending ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* ── rotate TOTP ──────────────────────────────────────────── */

function RotateTotpCard() {
  const [open, setOpen] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authenticator app</CardTitle>
        <CardDescription>
          Scan a new QR with your authenticator. The old one stops working as
          soon as you confirm the new code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Smartphone className="size-3.5" /> Rotate 2FA
            </Button>
          </DialogTrigger>
          <RotateTotpDialogContent onDone={() => setOpen(false)} />
        </Dialog>
      </CardContent>
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

      {stage === 'verify' && (
        <form
          className="space-y-4"
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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            commit.mutate()
          }}
        >
          <div className="flex items-start gap-4">
            <QrCode value={newSecret.otpauthUrl} />
            <div className="flex-1 space-y-2.5">
              <div>
                <div className="eyebrow mb-1.5">Scan with your app</div>
                <div className="text-[12.5px] text-[var(--fg-2)]">
                  Add the dashboard as a new entry. Keep the old one until you
                  finish this dialog.
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Or enter the setup key</div>
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5">
                  <span className="font-mono text-xs">
                    {newSecret.secret.match(/.{1,4}/g)?.join(' ')}
                  </span>
                  <div className="flex-1" />
                  <CopyButton value={newSecret.secret} />
                </div>
              </div>
            </div>
          </div>
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

/* ── recovery codes ────────────────────────────────────────── */

function RecoveryCodesCard() {
  const [open, setOpen] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery codes</CardTitle>
        <CardDescription>
          Mint a fresh set of 10 single-use codes. The old set becomes invalid
          immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <ShieldCheck className="size-3.5" /> Regenerate codes
            </Button>
          </DialogTrigger>
          <RegenerateRecoveryDialog onDone={() => setOpen(false)} />
        </Dialog>
      </CardContent>
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
          className="space-y-4"
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
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-[13px] font-semibold">New recovery codes</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> Reveal
                  </>
                )}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {codes.map((c, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-secondary px-2.5 py-2 font-mono text-[13px] tracking-wider"
                >
                  {revealed ? c : '•••• ••••'}
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <Button variant="outline" size="sm" onClick={copyAll}>
                <Copy className="size-3" /> Copy all
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                <ArrowDown className="size-3" /> Download .txt
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Devices signed in as you. Revoking ends a session immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={'size-3.5' + (list.isFetching ? ' animate-spin' : '')} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => revokeAll.mutate()}
            disabled={revokeAll.isPending || (list.data?.sessions.length ?? 0) <= 1}
          >
            <LogOut className="size-3.5" />
            {revokeAll.isPending ? 'Revoking…' : 'Revoke all others'}
          </Button>
        </div>
        {list.isLoading ? (
          <div className="py-6 text-center text-sm text-[var(--fg-2)]">Loading…</div>
        ) : (list.data?.sessions.length ?? 0) === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--fg-2)]">
            No active sessions.
          </div>
        ) : (
          <div className="space-y-2">
            {list.data!.sessions.map((s) => (
              <SessionRowView key={s.hash} row={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
  const label = ua
    ? ua.slice(0, 80) + (ua.length > 80 ? '…' : '')
    : 'Unknown client'

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5',
        row.current && 'ring-1 ring-[var(--accent-border)]',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {row.current && <Badge variant="accent">this device</Badge>}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--fg-2)]">
          {row.ip && <span className="font-mono">{row.ip}</span>}
          <span>idle {humanSecs(row.idleSeconds)}</span>
          <span>·</span>
          <span>
            expires{' '}
            {new Date(row.expiresAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}
            Z
          </span>
        </div>
      </div>
      {!row.current && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => revoke.mutate()}
          disabled={revoke.isPending}
        >
          <Trash2 className="size-3.5 text-destructive" />
          Revoke
        </Button>
      )}
    </div>
  )
}

function humanSecs(n: number): string {
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.floor(n / 60)}m`
  if (n < 86400) return `${Math.floor(n / 3600)}h`
  return `${Math.floor(n / 86400)}d`
}

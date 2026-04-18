import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Shield,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { sessionQuery, setupStatusQuery } from '@/lib/session'

import { AuthSide } from '@/components/AuthSide'
import { CopyButton } from '@/components/CopyButton'
import { Field } from '@/components/Field'
import { OtpInput } from '@/components/OtpInput'
import {
  PasswordField,
  PasswordMeter,
  scorePassword,
} from '@/components/PasswordField'
import { QrCode } from '@/components/QrCode'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Step = 0 | 1 | 2 | 3 | 4

interface BindTotpResp {
  otpauthUrl: string
  secret: string
}
interface CompleteResp {
  recoveryCodes: string[]
}

export function SetupScreen() {
  const [step, setStep] = React.useState<Step>(0)
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Step 0 — base URL
  const [baseUrl, setBaseUrl] = React.useState('http://localhost:8787')

  // Step 1 — admin key
  const [adminKey, setAdminKey] = React.useState('')

  // Step 2 — username + password
  const [username, setUsername] = React.useState('admin')
  const [password, setPassword] = React.useState('')
  const [password2, setPassword2] = React.useState('')

  // Step 3 — TOTP binding
  const [totp, setTotp] = React.useState<BindTotpResp | null>(null)
  const [code, setCode] = React.useState('')

  // Step 4 — recovery codes
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])

  const stepsMeta = [
    {
      title: 'Point at your gateway',
      subtitle: 'The base URL of the crypto gateway API this dashboard will control.',
    },
    { title: 'Verify admin key', subtitle: 'Match the ADMIN_KEY env on your gateway.' },
    {
      title: 'Create your account',
      subtitle: 'Choose the first operator username and password.',
    },
    { title: 'Two-factor auth', subtitle: 'Scan the QR with your authenticator, then confirm.' },
    { title: 'Save your recovery codes', subtitle: 'Your gateway is ready.' },
  ]
  const meta = stepsMeta[step]

  const saveBaseUrl = useMutation({
    mutationFn: (body: { baseUrl: string }) =>
      api('/api/setup/base-url', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => setStep(1),
    onError: (e: ApiError) => toast.error(e.message || 'Could not save base URL'),
  })

  const saveAdminKey = useMutation({
    mutationFn: (body: { adminKey: string }) =>
      api('/api/setup/admin-key', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => setStep(2),
    onError: (e: ApiError) => toast.error(e.message || 'Invalid admin key'),
  })

  const createUser = useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api('/api/setup/user', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      const r = await api<BindTotpResp>('/api/setup/totp/begin', { method: 'POST' })
      setTotp(r)
      setStep(3)
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not create user'),
  })

  const bindTotp = useMutation({
    mutationFn: (body: { code: string }) =>
      api<CompleteResp>('/api/setup/complete', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async (res) => {
      setRecoveryCodes(res.recoveryCodes)
      setStep(4)
      await Promise.all([
        qc.invalidateQueries({ queryKey: setupStatusQuery.queryKey }),
        qc.invalidateQueries({ queryKey: sessionQuery.queryKey }),
      ])
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Invalid code')
      setCode('')
    },
  })

  const pwScore = scorePassword(password)

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2 fade-in">
      <AuthSide mode="setup" />
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md space-y-6">
          <Stepper steps={4} current={Math.min(step, 3)} />

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
            <p className="mt-1.5 text-sm text-[var(--fg-2)]">{meta.subtitle}</p>
          </div>

          {step === 0 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                saveBaseUrl.mutate({ baseUrl: baseUrl.trim() })
              }}
            >
              <Field
                label="Gateway base URL"
                hint="The dashboard will proxy admin + merchant calls to this host."
              >
                <Input
                  autoFocus
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  inputMode="url"
                  className="font-mono"
                />
              </Field>

              <Button
                type="submit"
                className="w-full"
                disabled={saveBaseUrl.isPending || !/^https?:\/\//.test(baseUrl)}
              >
                {saveBaseUrl.isPending ? 'Saving…' : 'Continue'}
                <ChevronRight className="size-3.5" />
              </Button>
            </form>
          )}

          {step === 1 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                saveAdminKey.mutate({ adminKey })
              }}
            >
              <Field
                label="Admin key"
                hint="Found in your ADMIN_KEY environment variable. Minimum 32 characters."
                right={
                  <span className="font-mono text-[11px] text-[var(--fg-2)]">
                    gateway secret
                  </span>
                }
              >
                <PasswordField
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="••••••••••••••••••••••••"
                  autoFocus
                />
              </Field>

              <div className="flex gap-2.5 rounded-[var(--radius-md)] border border-border bg-secondary px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--fg-1)]">
                <Shield className="mt-0.5 size-4 shrink-0 text-[var(--fg-2)]" />
                <div>
                  The admin key is sealed with a worker-held encryption key before it lands
                  in KV, and is only ever decrypted in-memory to sign gateway requests.
                </div>
              </div>

              <div className="flex gap-2.5">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={saveAdminKey.isPending || adminKey.length < 32}
                >
                  {saveAdminKey.isPending ? 'Verifying…' : 'Verify key'}
                </Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (password !== password2) return
                createUser.mutate({ username, password })
              }}
            >
              <Field label="Username" hint="3–32 chars · letters, numbers, dash, underscore.">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  placeholder="admin"
                />
              </Field>
              <Field label="Password">
                <PasswordField
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                />
                <PasswordMeter score={pwScore} />
              </Field>
              <Field
                label="Confirm password"
                error={
                  password2 && password !== password2 ? "Passwords don't match." : undefined
                }
              >
                <PasswordField
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>

              <div className="flex gap-2.5">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={
                    createUser.isPending ||
                    !/^[\w-]{3,32}$/.test(username) ||
                    password.length < 12 ||
                    password !== password2
                  }
                >
                  {createUser.isPending ? 'Creating…' : 'Create account'}
                </Button>
              </div>
            </form>
          )}

          {step === 3 && totp && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                bindTotp.mutate({ code })
              }}
            >
              <div className="flex items-start gap-4">
                <QrCode value={totp.otpauthUrl} />
                <div className="flex-1 space-y-2.5">
                  <div>
                    <div className="eyebrow mb-1.5">Scan with your app</div>
                    <div className="text-[12.5px] text-[var(--fg-2)]">
                      Google Authenticator, Authy, 1Password, and any TOTP app work.
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Or enter the setup key</div>
                    <div className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5">
                      <span className="font-mono text-xs">
                        {totp.secret.match(/.{1,4}/g)?.join(' ')}
                      </span>
                      <div className="flex-1" />
                      <CopyButton value={totp.secret} />
                    </div>
                  </div>
                </div>
              </div>

              <Field
                label="Enter the 6-digit code"
                hint="Confirms your authenticator is bound correctly."
              >
                <OtpInput value={code} onChange={setCode} />
              </Field>

              <div className="flex gap-2.5">
                <Button type="button" variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={bindTotp.isPending || code.length < 6}
                >
                  {bindTotp.isPending ? 'Binding…' : 'Bind & finish'}
                </Button>
              </div>
            </form>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-bg)] p-4">
                <div className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-success text-success-foreground">
                  <Check className="size-3.5" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">Setup complete</div>
                  <div className="mt-1 text-[13px] text-[var(--fg-1)]">
                    Your operator account and 2FA are bound. Save your recovery codes
                    before continuing — they are shown only once.
                  </div>
                </div>
              </div>

              <RecoveryCodes codes={recoveryCodes} />

              <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
                Go to dashboard <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [revealed, setRevealed] = React.useState(false)
  const [copiedAll, setCopiedAll] = React.useState(false)

  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1400)
  }
  const download = () => {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gateway-dashboard-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card p-4">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold">Recovery codes</div>
          <div className="text-xs text-[var(--fg-2)]">
            Store these somewhere safe. Each is usable once.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRevealed((r) => !r)}>
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
          <Copy className="size-3" /> {copiedAll ? 'Copied' : 'Copy all'}
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <ArrowDown className="size-3" /> Download .txt
        </Button>
      </div>
    </div>
  )
}

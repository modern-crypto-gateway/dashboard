import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { KeyRound, Lock } from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { sessionQuery, useSetupStatus } from '@/lib/session'

import { AuthSide } from '@/components/AuthSide'
import { LogoMark } from '@/components/Logo'
import { Field } from '@/components/Field'
import { OtpInput } from '@/components/OtpInput'
import { PasswordField } from '@/components/PasswordField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile, type TurnstileHandle } from '@/components/Turnstile'

type Stage = 'creds' | 'totp' | 'recovery'

export function LoginScreen() {
  const [stage, setStage] = React.useState<Stage>('creds')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [recovery, setRecovery] = React.useState('')
  const [remember, setRemember] = React.useState(true)
  const [turnstileToken, setTurnstileToken] = React.useState('')
  const turnstileRef = React.useRef<TurnstileHandle>(null)

  const loginConfig = useQuery({
    queryKey: ['auth', 'login-config'],
    queryFn: () => api<{ turnstileSiteKey: string | null }>('/api/auth/login-config'),
    staleTime: Infinity,
  })
  const siteKey = loginConfig.data?.turnstileSiteKey ?? null

  const qc = useQueryClient()
  const navigate = useNavigate()
  const setup = useSetupStatus()
  const needsSetup = setup.data ? !setup.data.setupComplete : false

  const stepOne = useMutation({
    mutationFn: (body: {
      username: string
      password: string
      remember: boolean
      turnstileToken?: string
    }) =>
      api<{ ok: true }>('/api/auth/login/password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => setStage('totp'),
    onError: (e: ApiError) => {
      toast.error(e.message || 'Invalid credentials')
    },
    // A Turnstile token works once; get a fresh one for the next attempt.
    onSettled: () => turnstileRef.current?.reset(),
  })

  const stepTwo = useMutation({
    mutationFn: (body: { code?: string; recovery?: string }) =>
      api<{ authenticated: true }>('/api/auth/login/totp', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: sessionQuery.queryKey })
      navigate('/', { replace: true })
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Verification failed')
      setCode('')
    },
  })

  return (
    <div className="fade-in relative flex min-h-dvh flex-col overflow-hidden bg-[var(--canvas)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[420px] max-w-3xl rounded-full bg-signal opacity-25 blur-[120px] dark:opacity-15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <AuthSide mode="login" />
      <div className="relative flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px] space-y-6 rounded-[24px] border border-border bg-card p-7 shadow-[var(--shadow-md)] sm:p-9">
          <div className="flex flex-col items-center text-center">
            <LogoMark size={44} />
            <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em]">
              {stage === 'creds' ? 'Sign in' : stage === 'totp' ? 'Two-step check' : 'Recovery code'}
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-2)]">
              {stage === 'creds'
                ? 'Operator console'
                : stage === 'totp'
                  ? '6-digit code from your authenticator'
                  : 'Each code works once'}
            </p>
          </div>

          {stage === 'creds' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                stepOne.mutate({
                  username,
                  password,
                  remember,
                  ...(siteKey ? { turnstileToken } : {}),
                })
              }}
            >
              <Field label="Username" htmlFor="u">
                <Input
                  id="u"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                />
              </Field>
              <Field label="Password" htmlFor="p">
                <PasswordField
                  id="p"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-[var(--fg-1)] select-none">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Keep me signed in for 7 days</span>
              </label>
              {siteKey && (
                <Turnstile
                  ref={turnstileRef}
                  siteKey={siteKey}
                  action="login"
                  onToken={setTurnstileToken}
                  onError={(m) => toast.error(m)}
                />
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  stepOne.isPending ||
                  !username ||
                  !password ||
                  loginConfig.isLoading ||
                  (!!siteKey && !turnstileToken)
                }
              >
                {stepOne.isPending ? (
                  'Signing in…'
                ) : (
                  <>
                    <Lock className="size-3.5" /> Continue
                  </>
                )}
              </Button>
            </form>
          )}

          {stage === 'totp' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                stepTwo.mutate({ code })
              }}
            >
              <Field
                label="Authentication code"
                hint="Your code refreshes every 30 seconds."
              >
                <OtpInput value={code} onChange={setCode} />
              </Field>
              <div className="flex gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStage('creds')
                    setCode('')
                  }}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={stepTwo.isPending || code.length < 6}
                >
                  {stepTwo.isPending ? 'Verifying…' : 'Verify & sign in'}
                </Button>
              </div>
              <button
                type="button"
                className="text-xs text-[var(--fg-2)] hover:text-foreground cursor-pointer"
                onClick={() => setStage('recovery')}
              >
                Use a recovery code instead
              </button>
            </form>
          )}

          {stage === 'recovery' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                stepTwo.mutate({ recovery: recovery.trim() })
              }}
            >
              <Field label="Recovery code" hint="Each recovery code can be used once.">
                <Input
                  autoFocus
                  className="font-mono tracking-wider"
                  placeholder="xxxx-xxxx"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
              </Field>
              <div className="flex gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStage('totp')
                    setRecovery('')
                  }}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={stepTwo.isPending || recovery.length < 6}
                >
                  {stepTwo.isPending ? 'Verifying…' : 'Use recovery code'}
                </Button>
              </div>
            </form>
          )}

          {needsSetup && (
            <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
              <span className="text-[var(--fg-2)]">First deployment?</span>
              <Button asChild variant="outline" size="sm">
                <Link to="/setup">
                  <KeyRound className="size-3" /> Run first-time setup
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

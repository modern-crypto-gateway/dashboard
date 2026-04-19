import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { KeyRound, Lock } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { sessionQuery, useSetupStatus } from '@/lib/session'

import { AuthSide } from '@/components/AuthSide'
import { Field } from '@/components/Field'
import { OtpInput } from '@/components/OtpInput'
import { PasswordField } from '@/components/PasswordField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Stage = 'creds' | 'totp' | 'recovery'

export function LoginScreen() {
  const [stage, setStage] = React.useState<Stage>('creds')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [recovery, setRecovery] = React.useState('')
  const [remember, setRemember] = React.useState(true)

  const qc = useQueryClient()
  const navigate = useNavigate()
  const setup = useSetupStatus()
  const needsSetup = setup.data ? !setup.data.setupComplete : false

  const stepOne = useMutation({
    mutationFn: (body: { username: string; password: string; remember: boolean }) =>
      api<{ challengeToken: string }>('/api/auth/login/password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => setStage('totp'),
    onError: (e: ApiError) => {
      toast.error(e.message || 'Invalid credentials')
    },
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
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2 fade-in">
      <AuthSide mode="login" />
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md space-y-6">
          <div>
            <div className="eyebrow mb-2">Sign in</div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back, operator
            </h1>
            <p className="mt-1.5 text-sm text-[var(--fg-2)]">
              {stage === 'creds'
                ? 'Enter your credentials to continue.'
                : stage === 'totp'
                  ? 'Enter the 6-digit code from your authenticator app.'
                  : 'Enter a single-use recovery code.'}
            </p>
          </div>

          {stage === 'creds' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                stepOne.mutate({ username, password, remember })
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
              <label className="flex items-center gap-2 text-[13px] text-[var(--fg-1)] select-none">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Keep me signed in for 7 days</span>
              </label>
              <Button
                type="submit"
                className="w-full"
                disabled={stepOne.isPending || !username || !password}
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
            <div className="flex items-center justify-between border-t border-border pt-4 text-[13px]">
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

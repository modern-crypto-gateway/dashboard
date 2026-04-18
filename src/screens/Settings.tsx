import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Save } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { SecurityPanel } from './SecurityPanel'

interface DashboardConfig {
  baseUrl: string
  hasAdminKey: boolean
  adminKeyHint?: string // e.g. last 4 chars
}

export function SettingsPage() {
  const qc = useQueryClient()
  const cfg = useQuery({
    queryKey: ['settings', 'config'] as const,
    queryFn: () => api<DashboardConfig>('/api/settings/config'),
  })

  const [baseUrl, setBaseUrl] = React.useState('')
  const [adminKey, setAdminKey] = React.useState('')

  React.useEffect(() => {
    if (cfg.data) setBaseUrl(cfg.data.baseUrl ?? '')
  }, [cfg.data])

  const saveBaseUrl = useMutation({
    mutationFn: (body: { baseUrl: string }) =>
      api('/api/settings/base-url', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Base URL updated')
      qc.invalidateQueries({ queryKey: ['settings', 'config'] })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not update'),
  })

  const rotateKey = useMutation({
    mutationFn: (body: { adminKey: string }) =>
      api('/api/settings/admin-key', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Admin key rotated')
      setAdminKey('')
      qc.invalidateQueries({ queryKey: ['settings', 'config'] })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not rotate'),
  })

  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="eyebrow">System</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Gateway connection + sensitive credentials for the dashboard.
        </p>
      </div>

      <div className="eyebrow mb-3">Gateway</div>
      <Card>
        <CardHeader>
          <CardTitle>Gateway endpoint</CardTitle>
          <CardDescription>
            The base URL of the gateway API this dashboard proxies to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-lg gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              saveBaseUrl.mutate({ baseUrl: baseUrl.trim() })
            }}
          >
            <Field label="Base URL">
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                inputMode="url"
                className="font-mono"
              />
            </Field>
            <div>
              <Button
                type="submit"
                disabled={
                  saveBaseUrl.isPending ||
                  !/^https?:\/\//.test(baseUrl) ||
                  baseUrl === cfg.data?.baseUrl
                }
              >
                <Save className="size-3.5" />
                {saveBaseUrl.isPending ? 'Saving…' : 'Save base URL'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <div className="eyebrow mb-3">Security</div>
        <SecurityPanel />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin key</CardTitle>
          <CardDescription>
            Used by the dashboard to call gateway admin endpoints. Encrypted at rest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2 text-sm text-[var(--fg-1)]">
            {cfg.data?.hasAdminKey ? (
              <>
                <CheckCircle2 className="size-4 text-success" />
                <span>
                  An admin key is set
                  {cfg.data.adminKeyHint && (
                    <>
                      {' '}— fingerprint{' '}
                      <span className="font-mono text-xs text-[var(--fg-2)]">
                        {cfg.data.adminKeyHint}
                      </span>
                    </>
                  )}
                  . Rotate below to replace it.
                </span>
              </>
            ) : (
              <span className="text-warn">No admin key set.</span>
            )}
          </div>
          <form
            className="grid max-w-lg gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              rotateKey.mutate({ adminKey })
            }}
          >
            <Field
              label={cfg.data?.hasAdminKey ? 'New admin key' : 'Admin key'}
              hint="Hex string from your gateway's ADMIN_KEY env. Never leaves the worker — sealed before writing to KV."
            >
              <PasswordField
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="••••••••••••••••"
              />
            </Field>
            <div>
              <Button
                type="submit"
                disabled={rotateKey.isPending || adminKey.length < 32}
              >
                <Save className="size-3.5" />
                {rotateKey.isPending
                  ? 'Saving…'
                  : cfg.data?.hasAdminKey
                    ? 'Rotate admin key'
                    : 'Set admin key'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

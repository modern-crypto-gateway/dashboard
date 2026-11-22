import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Save } from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { configQuery, useMerchants } from '@/lib/merchants'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { PageHeader } from '@/components/PageHeader'
import { Callout } from '@/components/States'
import { SecurityPanel } from './SecurityPanel'

export function SettingsPage() {
  const qc = useQueryClient()
  const cfg = useQuery(configQuery)

  const [baseUrl, setBaseUrl] = React.useState('')
  const [adminKey, setAdminKey] = React.useState('')

  // Re-seed the input when the loaded baseUrl changes (e.g. after save).
  const loadedBaseUrl = cfg.data?.baseUrl ?? null
  const [prevLoadedBaseUrl, setPrevLoadedBaseUrl] = React.useState<string | null>(
    loadedBaseUrl,
  )
  if (prevLoadedBaseUrl !== loadedBaseUrl) {
    setPrevLoadedBaseUrl(loadedBaseUrl)
    if (cfg.data) setBaseUrl(loadedBaseUrl ?? '')
  }

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
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Gateway connection + sensitive credentials for the dashboard."
      />

      <div className="space-y-8">
        <SettingsSection
          title="Gateway"
          description="Where the dashboard sends requests, and the key it uses for admin endpoints."
        >
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

          <Card>
            <CardHeader>
              <CardTitle>Admin key</CardTitle>
              <CardDescription>
                Used by the dashboard to call gateway admin endpoints. Encrypted at rest.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cfg.data?.hasAdminKey ? (
                <div className="mb-4 flex items-start gap-2 text-sm text-[var(--fg-1)]">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
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
                </div>
              ) : (
                <Callout tone="warn" className="mb-4">
                  No admin key set.
                </Callout>
              )}
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
        </SettingsSection>

        <SettingsSection
          title="Defaults"
          description="What every operator sees first when they open a store-scoped screen."
        >
          <DefaultMerchantCard
            currentId={cfg.data?.defaultMerchantId ?? null}
          />
        </SettingsSection>

        <SettingsSection
          title="Security"
          description="Your password, authenticator, recovery codes and signed-in devices."
        >
          <SecurityPanel />
        </SettingsSection>
      </div>
    </div>
  )
}

/** One settings group: label column on the left (wide), controls on the right. */
function SettingsSection({
  title,
  description,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-[-0.005em]">{title}</h2>
        {description && (
          <p className="mt-1 max-w-md text-sm text-pretty text-[var(--fg-2)]">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

function DefaultMerchantCard({ currentId }: { currentId: string | null }) {
  const qc = useQueryClient()
  const merchants = useMerchants()
  const [value, setValue] = React.useState<string>(currentId ?? '__none__')

  // Sync the select when the persisted default merchant changes.
  const [prevCurrentId, setPrevCurrentId] = React.useState<string | null>(currentId)
  if (prevCurrentId !== currentId) {
    setPrevCurrentId(currentId)
    setValue(currentId ?? '__none__')
  }

  const save = useMutation({
    mutationFn: (id: string | null) =>
      api('/api/settings/default-merchant', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: (_res, id) => {
      toast.success(id ? 'Default store updated' : 'Default store cleared')
      qc.invalidateQueries({ queryKey: configQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not update'),
  })

  const usable = (merchants.data?.merchants ?? []).filter(
    (m) => m.source !== 'gateway-only',
  )
  const dirty = (currentId ?? '__none__') !== value

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default store</CardTitle>
        <CardDescription>
          The store pre-selected on Invoices, Payouts and every store-scoped
          screen. Each operator can still override for the current session via the
          switcher in the top bar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-lg gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(value === '__none__' ? null : value)
          }}
        >
          <Field label="Default store">
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger>
                <SelectValue placeholder="No default — show switcher" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default (ask every session)</SelectItem>
                {usable.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="truncate">{m.name}</span>
                    {m.apiKeyFingerprint && (
                      <span className="ml-auto font-mono text-2xs text-[var(--fg-3)]">
                        …{m.apiKeyFingerprint}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {usable.length === 0 && (
            <p className="text-xs text-[var(--fg-2)]">
              No locally-tracked stores yet. Create or import one to pick a default.
            </p>
          )}
          <div>
            <Button type="submit" disabled={save.isPending || !dirty}>
              <Save className="size-3.5" />
              {save.isPending ? 'Saving…' : 'Save default'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

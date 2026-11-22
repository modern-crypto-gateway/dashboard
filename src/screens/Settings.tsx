import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Globe, KeyRound, Save, Store } from '@/components/icons'

import { api, ApiError } from '@/lib/api'
import { configQuery, useMerchants } from '@/lib/merchants'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { PageHeader } from '@/components/PageHeader'
import { Callout } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { SecurityPanel } from './SecurityPanel'
import { AssistantSettingsCard } from './AssistantSettings'

export function SettingsPage() {
  const qc = useQueryClient()
  const cfg = useQuery(configQuery)

  const [baseUrl, setBaseUrl] = React.useState('')
  const [adminKey, setAdminKey] = React.useState('')
  // Both changes decide where the admin key is sent, so each needs a fresh
  // authenticator code; a stolen session alone can't make them.
  const [baseUrlTotp, setBaseUrlTotp] = React.useState('')
  const [adminKeyTotp, setAdminKeyTotp] = React.useState('')

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
    mutationFn: (body: { baseUrl: string; totp: string }) =>
      api('/api/settings/base-url', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Base URL updated')
      setBaseUrlTotp('')
      qc.invalidateQueries({ queryKey: ['settings', 'config'] })
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Could not update')
      setBaseUrlTotp('')
    },
  })

  const rotateKey = useMutation({
    mutationFn: (body: { adminKey: string; totp: string }) =>
      api('/api/settings/admin-key', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Admin key rotated')
      setAdminKey('')
      setAdminKeyTotp('')
      qc.invalidateQueries({ queryKey: ['settings', 'config'] })
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Could not rotate')
      setAdminKeyTotp('')
    },
  })

  return (
    <div className="fade-in space-y-8">
      <PageHeader title="Settings" />

      <div className="space-y-10">
        <SettingsSection title="Gateway" description="Connection and admin key.">
          <Card className="p-6">
            <CardHead
              icon={Globe}
              title="Gateway endpoint"
              sub="The base URL of the gateway API this dashboard proxies to."
            />
            <form
              className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                saveBaseUrl.mutate({ baseUrl: baseUrl.trim(), totp: baseUrlTotp })
              }}
            >
              <div className="min-w-0 flex-1">
                <Field label="Base URL">
                  {cfg.isLoading ? (
                    <Skeleton className="h-9 w-full rounded-[10px]" />
                  ) : (
                    <Input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com"
                      inputMode="url"
                      className="font-mono"
                    />
                  )}
                </Field>
              </div>
              <TotpField value={baseUrlTotp} onChange={setBaseUrlTotp} />
              <Button
                type="submit"
                className="self-end"
                disabled={
                  saveBaseUrl.isPending ||
                  baseUrlTotp.length !== 6 ||
                  !/^https?:\/\//.test(baseUrl) ||
                  baseUrl === cfg.data?.baseUrl
                }
              >
                <Save className="size-4" />
                {saveBaseUrl.isPending ? 'Saving…' : 'Save base URL'}
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <CardHead
              icon={KeyRound}
              title="Admin key"
              sub="Used by the dashboard to call gateway admin endpoints. Encrypted at rest."
              right={
                cfg.data?.hasAdminKey ? (
                  <span className="flex shrink-0 items-center gap-2">
                    {cfg.data.adminKeyHint && (
                      <span
                        className="hidden font-mono text-xs text-[var(--fg-2)] sm:inline"
                        title="Fingerprint"
                      >
                        {cfg.data.adminKeyHint}
                      </span>
                    )}
                    <StatusPill tone="ok">Set</StatusPill>
                  </span>
                ) : cfg.data ? (
                  <StatusPill tone="warn">Not set</StatusPill>
                ) : undefined
              }
            />
            {cfg.data && !cfg.data.hasAdminKey && (
              <Callout tone="warn" className="mt-5">
                No admin key set.
              </Callout>
            )}
            <form
              className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start"
              onSubmit={(e) => {
                e.preventDefault()
                rotateKey.mutate({ adminKey, totp: adminKeyTotp })
              }}
            >
              <div className="min-w-0 flex-1">
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
              </div>
              <TotpField value={adminKeyTotp} onChange={setAdminKeyTotp} />
              <Button
                type="submit"
                className="self-end sm:mt-[26px] sm:self-start"
                disabled={rotateKey.isPending || adminKey.length < 32 || adminKeyTotp.length !== 6}
              >
                <Save className="size-4" />
                {rotateKey.isPending
                  ? 'Saving…'
                  : cfg.data?.hasAdminKey
                    ? 'Rotate admin key'
                    : 'Set admin key'}
              </Button>
            </form>
          </Card>
        </SettingsSection>

        <SettingsSection title="Defaults" description="Store shown first.">
          <DefaultMerchantCard
            currentId={cfg.data?.defaultMerchantId ?? null}
          />
        </SettingsSection>

        <SettingsSection title="AI assistant" description="Claude, inside the dashboard.">
          <AssistantSettingsCard />
        </SettingsSection>

        <SettingsSection title="Security" description="Sign-in, 2FA and devices.">
          <SecurityPanel />
        </SettingsSection>
      </div>
    </div>
  )
}

/** One settings group: short label column on the left, controls on the right. */
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
    <section className="grid grid-cols-1 gap-5 border-t border-border pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-pretty text-[var(--fg-2)]">{description}</p>
        )}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
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
    <Card className="p-6">
      <CardHead
        icon={Store}
        title="Default store"
        sub="Pre-selected on store-scoped screens. The top-bar switcher still overrides it per session."
      />
      <form
        className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(value === '__none__' ? null : value)
        }}
      >
        <div className="min-w-0 flex-1">
          <Field
            label="Default store"
            hint={
              usable.length === 0
                ? 'No locally-tracked stores yet. Create or import one to pick a default.'
                : undefined
            }
          >
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
                      <span className="ml-auto font-mono text-xs text-[var(--fg-3)]">
                        …{m.apiKeyFingerprint}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          type="submit"
          className={usable.length === 0 ? 'self-end sm:mb-[26px]' : 'self-end'}
          disabled={save.isPending || !dirty}
        >
          <Save className="size-4" />
          {save.isPending ? 'Saving…' : 'Save default'}
        </Button>
      </form>
    </Card>
  )
}

/** 6-digit authenticator code input used to confirm sensitive settings. */
function TotpField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="sm:w-32">
      <Field label="Authenticator code">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="font-mono tracking-widest"
        />
      </Field>
    </div>
  )
}

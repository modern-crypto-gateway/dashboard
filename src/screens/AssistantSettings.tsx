import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import { assistantStateQuery, postAssistant, type AssistantConfig } from '@/lib/assistant'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { StatusPill } from '@/components/StatusPill'
import { Callout } from '@/components/States'
import { Check, Save, Sparkle, Trash2 } from '@/components/icons'

/**
 * Settings → AI assistant. The key is write-only: once saved it is sealed on
 * the server and only its last four characters come back. Saving or replacing
 * it needs an authenticator code, because the key decides where future
 * conversations (and the gateway data they read) are sent.
 */
export function AssistantSettingsCard() {
  const qc = useQueryClient()
  const state = useQuery(assistantStateQuery)
  const cfg = state.data?.config
  const models = state.data?.models ?? []

  const [apiKey, setApiKey] = React.useState('')
  const [totp, setTotp] = React.useState('')

  const applyConfig = (config: AssistantConfig) =>
    qc.setQueryData(assistantStateQuery.queryKey, (old: typeof state.data) => (old ? { ...old, config } : old))

  const saveKey = useMutation({
    mutationFn: () => postAssistant<{ config: AssistantConfig }>('config', { apiKey: apiKey.trim(), totp }),
    onSuccess: (r) => {
      applyConfig(r.config)
      setApiKey('')
      setTotp('')
      toast.success('Anthropic API key saved')
    },
    onError: (e: ApiError) => {
      toast.error(e.message || 'Could not save the key')
      setTotp('')
    },
  })

  const saveModel = useMutation({
    mutationFn: (model: string) => postAssistant<{ config: AssistantConfig }>('config', { model }),
    onSuccess: (r) => {
      applyConfig(r.config)
      toast.success('Model updated')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not change the model'),
  })

  const removeKey = useMutation({
    mutationFn: () => postAssistant<{ config: AssistantConfig }>('key/delete'),
    onSuccess: (r) => {
      applyConfig(r.config)
      toast.success('Anthropic API key removed')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not remove the key'),
  })

  const test = useMutation({
    mutationFn: () => postAssistant<{ ok: true; model: string }>('test'),
    onSuccess: (r) => toast.success(`Connected. ${r.model} is available.`),
    onError: (e: ApiError) => toast.error(e.message || 'Connection failed'),
  })

  const keyLooksValid = /^sk-ant-[A-Za-z0-9_-]{20,250}$/.test(apiKey.trim())

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border">
            <Sparkle className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-[-0.01em]">Claude assistant</h3>
            <p className="mt-0.5 text-sm text-pretty text-[var(--fg-2)]">
              The chat button at the bottom right. It can look anything up; every change waits for your
              approval, and money moves also need your authenticator code.
            </p>
          </div>
        </div>
        {cfg?.configured ? (
          <span className="flex shrink-0 items-center gap-2">
            {cfg.keyHint && (
              <span className="hidden font-mono text-xs text-[var(--fg-2)] sm:inline" title="Last 4 characters">
                …{cfg.keyHint}
              </span>
            )}
            <StatusPill tone="ok">Connected</StatusPill>
          </span>
        ) : cfg ? (
          <StatusPill tone="warn">Not set</StatusPill>
        ) : undefined}
      </div>

      <div className="mt-6 space-y-5">
        <Field label="Model">
          <Select
            value={cfg?.model}
            onValueChange={(v) => saveModel.mutate(v)}
            disabled={!cfg || saveModel.isPending}
          >
            <SelectTrigger className="sm:w-72">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <form
          className="flex flex-col gap-4 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault()
            saveKey.mutate()
          }}
        >
          <div className="min-w-0 flex-1">
            <Field
              label={cfg?.configured ? 'Replace API key' : 'Anthropic API key'}
              hint="From console.anthropic.com. Encrypted before it is stored and never shown again."
            >
              <PasswordField
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="sm:w-32">
            <Field label="2FA code">
              <Input
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono tracking-widest"
              />
            </Field>
          </div>
          <Button
            type="submit"
            className="self-end sm:mt-[26px] sm:self-start"
            disabled={saveKey.isPending || !keyLooksValid || totp.length !== 6}
          >
            <Save className="size-4" />
            {saveKey.isPending ? 'Saving…' : 'Save key'}
          </Button>
        </form>

        {cfg?.configured && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              <Check className="size-4" /> {test.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button variant="outline" onClick={() => removeKey.mutate()} disabled={removeKey.isPending}>
              <Trash2 className="size-4" /> Remove key
            </Button>
          </div>
        )}

        <Callout tone="info">
          Conversations go to Anthropic under your API key, including the gateway data the assistant looks up.
          The assistant has no access to endpoints that return keys or secrets, and secret-looking fields are
          stripped from results before anything is sent. Chats are kept for 30 days after their last
          message (at most 200), then deleted.
        </Callout>
      </div>
    </Card>
  )
}

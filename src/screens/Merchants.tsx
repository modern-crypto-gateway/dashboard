import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Pencil, Plus, Store, Trash2 } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { merchantsQuery, useMerchants } from '@/lib/merchants'
import type { Merchant } from '@/lib/types'

import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/Field'
import { PasswordField } from '@/components/PasswordField'
import { CopyButton } from '@/components/CopyButton'

export function MerchantsPage() {
  const merchants = useMerchants()

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Merchants</h1>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            Create merchants via the gateway or import existing API keys. Keys are
            AES-GCM sealed at rest.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportMerchantDialog />
          <CreateMerchantDialog />
        </div>
      </div>

      {merchants.isLoading ? (
        <Card className="p-10 text-center text-sm text-[var(--fg-2)]">Loading…</Card>
      ) : (merchants.data?.merchants.length ?? 0) === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--bg-2)]">
            <Store className="size-5 text-[var(--fg-2)]" />
          </div>
          <div className="mt-3 text-sm text-[var(--fg-1)]">No merchants yet.</div>
          <p className="mt-1 text-xs text-[var(--fg-2)]">
            Create one via the gateway admin surface, or import a key.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {merchants.data!.merchants.map((m) => (
            <MerchantCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function MerchantCard({ m }: { m: Merchant }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () =>
      api(`/api/merchants/${encodeURIComponent(m.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Merchant removed')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not remove'),
  })
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="truncate">{m.name}</CardTitle>
            <Badge variant={m.source === 'dashboard' ? 'accent' : 'outline'}>
              {m.source}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-2)]">
            <span className="font-mono">{m.id}</span>
            <CopyButton value={m.id} />
          </div>
          <div className="mt-0.5 text-xs text-[var(--fg-2)]">
            Key …{m.apiKeyFingerprint}
          </div>
        </div>
        <div className="flex gap-1.5">
          <EditMerchantDialog m={m} />
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button size="icon-sm" variant="outline" title="Remove">
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove merchant?</DialogTitle>
              <DialogDescription>
                This removes the merchant from the dashboard and drops the sealed
                API key. It does <span className="font-semibold">not</span> delete
                the merchant on the gateway — they'll still exist upstream.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  del.mutate()
                  setConfirmOpen(false)
                }}
                disabled={del.isPending}
              >
                {del.isPending ? 'Removing…' : 'Remove'}
              </Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>
      {m.webhookUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs">
          <span className="text-[var(--fg-2)]">webhook</span>
          <span className="truncate font-mono">{m.webhookUrl}</span>
          <CopyButton value={m.webhookUrl} />
        </div>
      )}
    </Card>
  )
}

function EditMerchantDialog({ m }: { m: Merchant }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(m.name)
  const [webhookUrl, setWebhookUrl] = React.useState(m.webhookUrl ?? '')
  const [under, setUnder] = React.useState('')
  const [over, setOver] = React.useState('')
  const [cooldown, setCooldown] = React.useState('')
  const qc = useQueryClient()

  React.useEffect(() => {
    if (open) {
      setName(m.name)
      setWebhookUrl(m.webhookUrl ?? '')
      setUnder('')
      setOver('')
      setCooldown('')
    }
  }, [open, m])

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      if (name.trim() && name.trim() !== m.name) body.name = name.trim()
      const nextHook = webhookUrl.trim() === '' ? null : webhookUrl.trim()
      if (nextHook !== (m.webhookUrl ?? null)) body.webhookUrl = nextHook
      if (under !== '') body.paymentToleranceUnderBps = parseInt(under, 10)
      if (over !== '') body.paymentToleranceOverBps = parseInt(over, 10)
      if (cooldown !== '') body.addressCooldownSeconds = parseInt(cooldown, 10)
      if (Object.keys(body).length === 0) {
        throw new Error('Nothing to update')
      }
      return api<{ merchant: Merchant }>(
        `/api/merchants/${encodeURIComponent(m.id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
    },
    onSuccess: () => {
      toast.success('Merchant updated')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      setOpen(false)
    },
    onError: (e: ApiError | Error) =>
      toast.error(e.message || 'Could not update'),
  })

  const disabledTolerances = m.source === 'imported'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="outline" title="Edit">
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit merchant</DialogTitle>
          <DialogDescription>
            Dashboard-local fields (name, webhook URL) are updated here.
            Tolerance and cooldown changes <span className="font-semibold">also</span>{' '}
            PATCH the gateway. Existing invoices keep their snapshotted values;
            only new invoices pick up the change.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
            />
          </Field>
          <Field label="Webhook URL">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://merchant.example.com/hooks/gateway"
              type="url"
              className="font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Under-payment tolerance (bps)"
              hint={
                disabledTolerances
                  ? 'Gateway PATCH disabled for imported merchants.'
                  : 'Leave blank to keep current.'
              }
            >
              <Input
                value={under}
                onChange={(e) => setUnder(e.target.value)}
                placeholder="e.g. 100"
                inputMode="numeric"
                className="font-mono"
                disabled={disabledTolerances}
              />
            </Field>
            <Field label="Over-payment tolerance (bps)">
              <Input
                value={over}
                onChange={(e) => setOver(e.target.value)}
                placeholder="e.g. 100"
                inputMode="numeric"
                className="font-mono"
                disabled={disabledTolerances}
              />
            </Field>
          </div>
          <Field label="Address cooldown (seconds)">
            <Input
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              placeholder="0 – 604800"
              inputMode="numeric"
              className="font-mono"
              disabled={disabledTolerances}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateMerchantDialog() {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api<{ merchant: Merchant }>('/api/merchants', {
        method: 'POST',
        body: JSON.stringify({
          name,
          ...(webhookUrl ? { webhookUrl } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success('Merchant created')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      setOpen(false)
      setName('')
      setWebhookUrl('')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not create'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" /> Create merchant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create merchant</DialogTitle>
          <DialogDescription>
            Calls <span className="font-mono">POST /admin/merchants</span> on the
            gateway. The returned plaintext API key is sealed and stored here for
            future invoice / payout calls.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Name" hint="1–128 characters. Visible in reports.">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              maxLength={128}
              required
            />
          </Field>
          <Field
            label="Webhook URL (optional)"
            hint="The gateway will POST status updates for this merchant here."
          >
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://merchant.example.com/hooks/gateway"
              type="url"
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.length === 0}>
              {create.isPending ? 'Creating…' : 'Create merchant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportMerchantDialog() {
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState('')
  const [name, setName] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const qc = useQueryClient()

  const importIt = useMutation({
    mutationFn: () =>
      api<{ merchant: Merchant }>('/api/merchants/import', {
        method: 'POST',
        body: JSON.stringify({
          id: id || undefined,
          name,
          apiKey,
          ...(webhookUrl ? { webhookUrl } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success('Merchant imported')
      qc.invalidateQueries({ queryKey: merchantsQuery.queryKey })
      setOpen(false)
      setId('')
      setName('')
      setApiKey('')
      setWebhookUrl('')
    },
    onError: (e: ApiError) => toast.error(e.message || 'Could not import'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="size-3.5" /> Import key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import existing merchant</DialogTitle>
          <DialogDescription>
            For merchants created via the gateway directly (not this dashboard).
            The plaintext key is AES-GCM sealed before writing to KV.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            importIt.mutate()
          }}
        >
          <Field label="Merchant id" hint="Leave blank to generate a local id.">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="uuid-or-slug"
              className="font-mono"
            />
          </Field>
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              maxLength={128}
              required
            />
          </Field>
          <Field label="API key" hint="Shown once by the gateway on create. Store it here to use it for invoice/payout calls.">
            <PasswordField
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_…"
            />
          </Field>
          <Field label="Webhook URL (optional)">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://merchant.example.com/hooks/gateway"
              type="url"
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={importIt.isPending || !name || apiKey.length < 8}
            >
              {importIt.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

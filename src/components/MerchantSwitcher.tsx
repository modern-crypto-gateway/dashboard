import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useActiveMerchant } from '@/lib/merchants'

export function MerchantSwitcher() {
  const { merchants, active, setActiveId } = useActiveMerchant()

  // Merchant-scoped actions need a sealed key locally, so only switch across
  // "usable" merchants. Gateway-only ones surface on /merchants for rotate-key.
  const usable = merchants.filter((m) => m.source !== 'gateway-only')
  if (usable.length === 0) return null
  if (usable.length === 1) {
    return (
      <div className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-[var(--bg-2)] px-2.5 text-xs">
        <span className="shrink-0 text-[var(--fg-2)]">Store</span>
        <span className="truncate font-mono text-foreground">{usable[0].name}</span>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs text-[var(--fg-2)]">Store</span>
      <Select
        value={active?.id}
        onValueChange={(v) => setActiveId(v)}
      >
        <SelectTrigger className="h-8 w-56 max-w-full min-w-0 text-sm">
          <SelectValue placeholder="Pick a store" />
        </SelectTrigger>
        <SelectContent>
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
    </div>
  )
}

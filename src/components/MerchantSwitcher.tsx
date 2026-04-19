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
      <div className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs">
        <span className="text-[var(--fg-2)]">merchant </span>
        <span className="font-mono">{usable[0].name}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">Merchant</span>
      <Select
        value={active?.id}
        onValueChange={(v) => setActiveId(v)}
      >
        <SelectTrigger className="h-8 w-56 text-sm">
          <SelectValue placeholder="Pick a merchant" />
        </SelectTrigger>
        <SelectContent>
          {usable.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="truncate">{m.name}</span>
              {m.apiKeyFingerprint && (
                <span className="ml-auto text-[11px] text-[var(--fg-3)]">
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

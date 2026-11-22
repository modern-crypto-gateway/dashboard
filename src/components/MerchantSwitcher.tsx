import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useActiveMerchant } from '@/lib/merchants'
import { Store } from '@/components/icons'

export function MerchantSwitcher() {
  const { merchants, active, setActiveId } = useActiveMerchant()

  // Merchant-scoped actions need a sealed key locally, so only switch across
  // "usable" merchants. Gateway-only ones surface on /merchants for rotate-key.
  const usable = merchants.filter((m) => m.source !== 'gateway-only')
  if (usable.length === 0) return null
  if (usable.length === 1) {
    return (
      <div className="inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-sm shadow-[var(--shadow-sm)]">
        <Store className="size-4 shrink-0 text-[var(--fg-2)]" />
        <span className="truncate text-foreground">{usable[0].name}</span>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 items-center">
      <Select
        value={active?.id}
        onValueChange={(v) => setActiveId(v)}
      >
        <SelectTrigger aria-label="Store" className="h-8 w-52 max-w-full min-w-0 rounded-[10px] text-sm">
          <Store className="size-4 shrink-0 text-[var(--fg-2)]" />
          <SelectValue placeholder="Pick a store" />
        </SelectTrigger>
        <SelectContent>
          {usable.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="truncate">{m.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

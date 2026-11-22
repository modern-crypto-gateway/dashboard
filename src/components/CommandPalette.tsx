import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  CalendarClock,
  CandlestickChart,
  CircleDollarSign,
  FileText,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LogOut,
  Moon,
  Radio,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  Wallet,
  Waypoints,
  Webhook,
} from '@/components/icons'

import { useTheme } from '@/lib/theme'
import { Kbd } from '@/components/ui/kbd'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { sessionQuery } from '@/lib/session'

interface Nav {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  group: 'Overview' | 'Payments' | 'Treasury' | 'Stores' | 'Infrastructure' | 'System'
}

const NAV: Nav[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, group: 'Overview' },
  { label: 'Activity', to: '/activity', icon: Activity, group: 'Overview' },
  { label: 'Invoices', to: '/invoices', icon: FileText, group: 'Payments' },
  { label: 'Payouts', to: '/payouts', icon: ArrowUpDown, group: 'Payments' },
  { label: 'Held payouts', to: '/held-payouts', icon: LifeBuoy, group: 'Payments' },
  { label: 'Orphan txs', to: '/orphans', icon: AlertTriangle, group: 'Payments' },
  { label: 'Balances', to: '/balances', icon: CircleDollarSign, group: 'Treasury' },
  { label: 'Treasury', to: '/treasury', icon: Landmark, group: 'Treasury' },
  { label: 'Exchange', to: '/exchange', icon: CandlestickChart, group: 'Treasury' },
  { label: 'Auto-consolidation', to: '/consolidation-schedules', icon: CalendarClock, group: 'Treasury' },
  { label: 'Address pool', to: '/pool', icon: Waypoints, group: 'Treasury' },
  { label: 'Pool addresses', to: '/pool/addresses', icon: Waypoints, group: 'Treasury' },
  { label: 'Stores', to: '/stores', icon: Store, group: 'Stores' },
  { label: 'Webhooks', to: '/webhooks', icon: Webhook, group: 'Stores' },
  { label: 'Chains', to: '/chains', icon: Link2, group: 'Infrastructure' },
  { label: 'Fee wallets', to: '/fee-wallets', icon: Wallet, group: 'Infrastructure' },
  { label: 'Alchemy webhooks', to: '/alchemy', icon: Radio, group: 'Infrastructure' },
  { label: 'Audit address', to: '/audit-address', icon: ShieldCheck, group: 'Infrastructure' },
  { label: 'Settings', to: '/settings', icon: Settings, group: 'System' },
]

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (o: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { mode, setMode, resolvedTheme } = useTheme()
  const qc = useQueryClient()

  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionQuery.queryKey })
      qc.clear()
      onOpenChange(false)
      navigate('/login', { replace: true })
    },
  })

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  const groups = NAV.reduce<Record<string, Nav[]>>((acc, n) => {
    ;(acc[n.group] ??= []).push(n)
    return acc
  }, {})

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {Object.entries(groups).map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map(({ label, to, icon: Icon }) => (
              <CommandItem
                key={to}
                value={`${group} ${label}`}
                onSelect={() => go(to)}
              >
                <Icon />
                <span>{label}</span>
                <ArrowRight className="go ml-auto !size-3.5" />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem
            value="theme toggle"
            onSelect={() => {
              setMode(resolvedTheme === 'dark' ? 'light' : 'dark')
              onOpenChange(false)
            }}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            <span>
              Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} theme
            </span>
          </CommandItem>
          <CommandItem
            value="theme system"
            onSelect={() => {
              setMode('system')
              onOpenChange(false)
            }}
          >
            <Moon />
            <span>Use system theme</span>
            {mode === 'system' && <CommandShortcut>On</CommandShortcut>}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="sign out logout"
            onSelect={() => logout.mutate()}
          >
            <LogOut />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-4 border-t border-border bg-[var(--bg-2)] px-5 py-2.5 text-xs text-[var(--fg-3)]">
        <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>esc</Kbd> close</span>
      </div>
    </CommandDialog>
  )
}

/** Hook to bind ⌘K / Ctrl+K from anywhere in the tree. */
export function useCommandPaletteShortcut(onToggle: () => void) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle])
}


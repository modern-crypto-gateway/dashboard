import { NavLink } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  Radio,
  Settings,
  ShieldCheck,
  Store,
  Wallet,
  Waypoints,
  Webhook,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { StatusDot } from './StatusDot'
import { Badge } from './ui/badge'

type Item = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  count?: number
  countVariant?: 'default' | 'warn' | 'accent'
  end?: boolean
}

type Section = { group: string; items: Item[] }

const sections: Section[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
      { to: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/balances', label: 'Balances', icon: CircleDollarSign },
      { to: '/pool', label: 'Address pool', icon: Waypoints },
      { to: '/invoices', label: 'Invoices', icon: FileText },
      { to: '/payouts', label: 'Payouts', icon: ArrowUpDown },
    ],
  },
  {
    group: 'Operations',
    items: [
      {
        to: '/orphans',
        label: 'Orphan txs',
        icon: AlertTriangle,
        countVariant: 'warn',
      },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/merchants', label: 'Merchants', icon: Store },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/audit-address', label: 'Audit address', icon: ShieldCheck },
      { to: '/fee-wallets', label: 'Fee wallets', icon: Wallet },
      { to: '/alchemy', label: 'Alchemy webhooks', icon: Radio },
    ],
  },
  {
    group: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
      <div className="mb-2.5 border-b border-border px-1.5 pb-3.5 pt-1">
        <Logo />
      </div>
      <nav className="flex flex-col gap-0.5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.group}>
            <div className="mt-3.5 px-2.5 pb-1.5 pt-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-2)]">
              {section.group}
            </div>
            {section.items.map((it) => {
              const Icon = it.icon
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-[var(--fg-1)] transition-colors outline-none',
                      'hover:bg-[var(--bg-hover)] hover:text-foreground',
                      isActive &&
                        'bg-secondary font-medium text-foreground [&_svg]:text-primary',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0 text-[var(--fg-2)]" />
                  <span className="truncate">{it.label}</span>
                  {it.count != null && (
                    <Badge
                      variant={it.countVariant === 'warn' ? 'warn' : 'default'}
                      className="ml-auto h-5 px-1.5 text-[10.5px]"
                    >
                      {it.count}
                    </Badge>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex flex-col gap-1.5 border-t border-border px-2 py-2.5 text-xs text-[var(--fg-2)]">
        <div className="flex items-center justify-between">
          <span>API</span>
          <span className="flex items-center gap-1.5 text-success">
            <StatusDot tone="success" pulse />
            operational
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Runtime</span>
          <span className="font-mono">CF Workers</span>
        </div>
      </div>
    </aside>
  )
}


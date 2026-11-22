import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  CandlestickChart,
  CircleDollarSign,
  FileText,
  Fuel,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  Radio,
  ShieldCheck,
  Store,
  Waypoints,
  Webhook,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
}

export type NavSection = { group: string; items: NavItem[] }

/**
 * Primary navigation, grouped by the job an operator is doing.
 * Settings lives in the sidebar footer, not here.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
      { to: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    group: 'Payments',
    items: [
      { to: '/invoices', label: 'Invoices', icon: FileText },
      { to: '/payouts', label: 'Payouts', icon: ArrowUpDown },
      { to: '/held-payouts', label: 'Held payouts', icon: LifeBuoy },
      { to: '/orphans', label: 'Orphan txs', icon: AlertTriangle },
    ],
  },
  {
    group: 'Treasury',
    items: [
      { to: '/balances', label: 'Balances', icon: CircleDollarSign },
      { to: '/treasury', label: 'Treasury', icon: Landmark },
      { to: '/exchange', label: 'Exchange', icon: CandlestickChart },
      { to: '/consolidation-schedules', label: 'Auto-consolidation', icon: CalendarClock },
      { to: '/pool', label: 'Address pool', icon: Waypoints },
    ],
  },
  {
    group: 'Stores',
    items: [
      { to: '/stores', label: 'Stores', icon: Store },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    group: 'Infrastructure',
    items: [
      { to: '/chains', label: 'Chains', icon: Link2 },
      { to: '/fee-wallets', label: 'Fee wallets', icon: Fuel },
      { to: '/alchemy', label: 'Alchemy webhooks', icon: Radio },
      { to: '/audit-address', label: 'Audit address', icon: ShieldCheck },
    ],
  },
]

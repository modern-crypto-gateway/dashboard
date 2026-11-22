import { NavLink, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, Settings } from 'lucide-react'

import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { sessionQuery } from '@/lib/session'
import { useHeldQueue } from '@/lib/held'
import { useTheme, type Accent } from '@/lib/theme'
import { NAV_SECTIONS, type NavItem } from '@/lib/nav'
import { Logo, LogoMark } from './Logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * Sidebar in two densities:
 *  - full (xl+, and the mobile drawer): icon + label, grouped.
 *  - rail (tablet, md–xl): icons only, labels in tooltips.
 */
export function Sidebar({
  onNavigate,
  rail = false,
  username,
}: {
  onNavigate?: () => void
  rail?: boolean
  username: string
}) {
  // Live recovery-queue badge — shared cache with the Held payouts page.
  const held = useHeldQueue({ refetchInterval: 30_000 })
  const heldCount = held.data?.count ?? 0
  const countFor = (to: string): number | undefined =>
    to === '/held-payouts' && heldCount > 0 ? heldCount : undefined

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col border-r border-border bg-[var(--bg-sidebar)]',
        rail ? 'w-[60px]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center',
          rail ? 'justify-center' : 'px-4',
        )}
      >
        {rail ? <LogoMark size={28} /> : <Logo />}
      </div>

      <nav
        aria-label="Primary"
        className={cn(
          'flex flex-1 flex-col overflow-y-auto pb-3',
          rail ? 'items-center px-2' : 'px-3',
        )}
      >
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.group} className={cn('flex flex-col gap-px', rail && 'items-center')}>
            {rail ? (
              i > 0 && <div className="my-2 h-px w-6 bg-border" aria-hidden />
            ) : (
              <div className="px-2.5 pt-4 pb-1 text-2xs font-medium text-[var(--fg-3)]">
                {section.group}
              </div>
            )}
            {section.items.map((it) => (
              <SidebarLink
                key={it.to}
                item={it}
                rail={rail}
                count={countFor(it.to)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div
        className={cn(
          'flex shrink-0 flex-col gap-px border-t border-border py-2',
          rail ? 'items-center px-2' : 'px-3',
        )}
      >
        <SidebarLink
          item={{ to: '/settings', label: 'Settings', icon: Settings }}
          rail={rail}
          onNavigate={onNavigate}
        />
        <AccountMenu username={username} rail={rail} />
      </div>
    </aside>
  )
}

function SidebarLink({
  item,
  rail,
  count,
  onNavigate,
}: {
  item: NavItem
  rail: boolean
  count?: number
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={rail ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center rounded-md text-sm text-[var(--fg-1)] outline-none transition-colors duration-150',
          'hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          rail ? 'w-10 justify-center' : 'gap-2.5 px-2.5',
          isActive &&
            'bg-[var(--bg-active)] font-medium text-foreground [&_svg]:text-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !rail && (
            <span
              aria-hidden
              className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full bg-primary"
            />
          )}
          <Icon className="size-4 shrink-0 text-[var(--fg-2)] transition-colors group-hover:text-foreground" />
          {!rail && <span className="truncate">{item.label}</span>}
          {count != null &&
            (rail ? (
              <span
                aria-label={`${count} waiting`}
                className="absolute top-1 right-1 size-2 rounded-full bg-warn ring-2 ring-[var(--bg-sidebar)]"
              />
            ) : (
              <span className="ml-auto rounded-sm bg-[var(--warn-bg)] px-1.5 font-mono text-2xs font-medium text-warn tabular-nums">
                {count}
              </span>
            ))}
        </>
      )}
    </NavLink>
  )

  if (!rail) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {count != null && <span className="ml-1.5 opacity-70">{count}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const ACCENT_AVATAR_BG: Record<Accent, string> = {
  blue: 'd0e1ff,bfd3ff',
  violet: 'e6d4ff,d3baff',
  mint: 'c8f2e0,b0ecd3',
}

function AccountMenu({ username, rail }: { username: string; rail: boolean }) {
  const { accent } = useTheme()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: sessionQuery.queryKey })
      qc.clear()
      navigate('/login', { replace: true })
    },
  })

  const avatarUrl = `/api/avatar?seed=${encodeURIComponent(username)}&bg=${encodeURIComponent(ACCENT_AVATAR_BG[accent])}`
  const avatar = (
    <img
      src={avatarUrl}
      alt=""
      width={24}
      height={24}
      className="size-6 shrink-0 rounded-full border border-border bg-[var(--bg-2)]"
      loading="lazy"
    />
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${username}`}
          className={cn(
            'flex h-10 cursor-pointer items-center rounded-md text-left text-sm outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-[var(--bg-hover)]',
            rail ? 'w-10 justify-center' : 'gap-2.5 px-2',
          )}
        >
          {avatar}
          {!rail && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{username}</span>
                <span className="block text-2xs text-[var(--fg-2)]">Operator</span>
              </span>
              <ChevronsUpDown className="size-3.5 text-[var(--fg-3)]" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={rail ? 'right' : 'top'} align="start" className="w-56">
        <DropdownMenuLabel>Signed in as {username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings /> Settings &amp; security
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOut /> {logout.isPending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

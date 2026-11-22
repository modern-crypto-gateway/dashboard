import { NavLink, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { sessionQuery } from '@/lib/session'
import { useHeldQueue } from '@/lib/held'
import { useTheme, type Accent } from '@/lib/theme'
import { NAV_SECTIONS, type NavItem } from '@/lib/nav'
import { ChevronsUpDown, LogOut, Search, Settings } from './icons'
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
import { ModKey } from './ui/kbd'

type NavIcon = React.ComponentType<{
  className?: string
  weight?: 'regular' | 'duotone' | 'fill' | 'bold'
}>

/**
 * Sidebar sits directly on the canvas (no border); the page content
 * floats beside it in its own panel. Two densities:
 *  - full (xl+, and the phone drawer): icon + label, grouped.
 *  - rail (tablet, md–xl): icons only, labels in tooltips.
 */
export function Sidebar({
  onNavigate,
  onSearch,
  rail = false,
  username,
}: {
  onNavigate?: () => void
  onSearch?: () => void
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
        'sticky top-0 flex h-dvh shrink-0 flex-col bg-[var(--bg-sidebar)]',
        rail ? 'w-[64px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-16 shrink-0 items-center', rail ? 'justify-center' : 'px-6')}>
        {rail ? <LogoMark size={30} /> : <Logo />}
      </div>

      {onSearch && !rail && (
        <div className="px-3 pb-1">
          <button
            type="button"
            onClick={onSearch}
            className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-[10px] bg-[var(--bg-1)] px-3 text-left text-sm text-[var(--fg-2)] shadow-[var(--shadow-sm)] ring-1 ring-border transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Search className="size-4" />
            <span className="flex-1">Search</span>
            <ModKey k="K" />
          </button>
        </div>
      )}

      <nav
        aria-label="Primary"
        className={cn(
          'flex flex-1 flex-col overflow-y-auto pb-3',
          rail ? 'items-center px-2' : 'px-3',
        )}
      >
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.group} className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
            {rail ? (
              i > 0 && <div className="my-2 h-px w-6 bg-[var(--border-strong)]" aria-hidden />
            ) : (
              <div className="px-3 pt-6 pb-2 text-xs font-medium text-[var(--fg-3)]">
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
          'flex shrink-0 flex-col gap-0.5 py-3',
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
  const Icon = item.icon as NavIcon
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={rail ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center rounded-[10px] text-base text-[var(--fg-1)] outline-none transition-[background-color,color,box-shadow] duration-150',
          'hover:bg-[var(--bg-active)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          rail ? 'w-10 justify-center' : 'gap-3 px-3',
          isActive &&
            'bg-[var(--bg-1)] font-medium text-foreground shadow-[var(--shadow-sm)] ring-1 ring-border hover:bg-[var(--bg-1)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            weight={isActive ? 'fill' : 'regular'}
            className={cn(
              'size-[18px] shrink-0 transition-colors',
              isActive
                ? 'text-[var(--accent-ink)]'
                : 'text-[var(--fg-2)] group-hover:text-foreground',
            )}
          />
          {!rail && <span className="truncate">{item.label}</span>}
          {count != null &&
            (rail ? (
              <span
                aria-label={`${count} waiting`}
                className="absolute top-1 right-1 size-2 rounded-full bg-warn ring-2 ring-[var(--bg-sidebar)]"
              />
            ) : (
              <span className="figure ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[var(--warn-bg)] px-1.5 text-2xs font-semibold text-warn ring-1 ring-[var(--warn-border)]">
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
  lime: 'e4f7a6,c8f04f',
  iris: 'e6dcff,c4b5fd',
  blue: 'd6e4ff,a9c4ff',
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${username}`}
          className={cn(
            'flex h-11 cursor-pointer items-center rounded-[10px] text-left text-sm outline-none transition-colors hover:bg-[var(--bg-active)] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-[var(--bg-active)]',
            rail ? 'w-10 justify-center' : 'gap-2.5 px-3',
          )}
        >
          <img
            src={avatarUrl}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-full bg-[var(--bg-2)] ring-1 ring-border"
            loading="lazy"
          />
          {!rail && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{username}</span>
                <span className="block text-xs text-[var(--fg-2)]">Operator</span>
              </span>
              <ChevronsUpDown className="size-4 text-[var(--fg-3)]" />
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

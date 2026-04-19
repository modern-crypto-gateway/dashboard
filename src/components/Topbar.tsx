import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Paintbrush,
  RefreshCw,
  Search,
  Sun,
  Monitor,
} from 'lucide-react'

import { useTheme, type Accent, type ThemeMode } from '@/lib/theme'
import { api } from '@/lib/api'
import { sessionQuery } from '@/lib/session'

import { Button } from './ui/button'
import { StatusDot } from './StatusDot'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface TopbarProps {
  username: string
  onMobileMenu?: () => void
  onOpenCommandPalette?: () => void
}

export function Topbar({ username, onMobileMenu, onOpenCommandPalette }: TopbarProps) {
  const { mode, accent, resolvedTheme, setMode, setAccent } = useTheme()
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

  const refresh = () => {
    qc.invalidateQueries()
  }

  const initials = username.slice(0, 2).toUpperCase()
  const accentBg = ACCENT_AVATAR_BG[accent]
  const avatarUrl =
    `/api/avatar?seed=${encodeURIComponent(username)}&bg=${encodeURIComponent(accentBg)}`

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
      <Button
        size="icon-sm"
        variant="ghost"
        className="md:hidden"
        onClick={onMobileMenu}
        aria-label="Open menu"
      >
        <Menu className="size-4" />
      </Button>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="relative hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-[var(--fg-2)] shadow-xs transition-colors hover:bg-[var(--bg-hover)] md:flex cursor-pointer"
      >
        <Search className="size-3.5 text-[var(--fg-3)]" />
        <span>Search, navigate…</span>
        <span className="flex-1" />
        <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--fg-2)]">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-[11.5px] font-medium text-success md:inline-flex">
          <StatusDot tone="success" />
          production
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={refresh}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label="Notifications" title="Notifications">
          <Bell className="size-3.5" />
        </Button>

        {/* Theme */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="outline" aria-label="Theme">
              {resolvedTheme === 'dark' ? (
                <Sun className="size-3.5" />
              ) : (
                <Moon className="size-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as ThemeMode)}
            >
              <DropdownMenuRadioItem value="light">
                <Sun className="mr-1.5 size-3.5" /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="mr-1.5 size-3.5" /> Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor className="mr-1.5 size-3.5" /> System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Accent</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={accent}
              onValueChange={(v) => setAccent(v as Accent)}
            >
              <DropdownMenuRadioItem value="blue">
                <AccentSwatch color="oklch(0.58 0.18 255)" /> Blue
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="violet">
                <AccentSwatch color="oklch(0.56 0.2 295)" /> Violet
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mint">
                <AccentSwatch color="oklch(0.62 0.14 170)" /> Mint
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-1 hidden h-5 w-px bg-border md:block" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <img
                src={avatarUrl}
                alt=""
                width={22}
                height={22}
                className="size-[22px] rounded-full border border-border bg-[var(--bg-2)]"
                loading="lazy"
              />
              <span className="sr-only">{initials}</span>
              <span className="hidden md:inline">{username}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Signed in as {username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Paintbrush className="size-3.5" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut className="size-3.5" /> {logout.isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

const ACCENT_AVATAR_BG: Record<Accent, string> = {
  blue: 'd0e1ff,bfd3ff',
  violet: 'e6d4ff,d3baff',
  mint: 'c8f2e0,b0ecd3',
}

function AccentSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mr-1.5 inline-block size-3.5 rounded-sm border border-border"
      style={{ background: color }}
    />
  )
}

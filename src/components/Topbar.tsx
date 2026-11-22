import { useLocation } from 'react-router-dom'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'

import { NAV_SECTIONS } from '@/lib/nav'
import { useTheme, type Accent, type ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { ChevronRight, Menu, Monitor, Moon, RefreshCw, Search, Sun } from './icons'
import { Button } from './ui/button'
import { LogoMark } from './Logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface TopbarProps {
  onMobileMenu?: () => void
  onOpenCommandPalette?: () => void
}

const ACCENTS: Array<{ value: Accent; label: string; color: string }> = [
  { value: 'lime', label: 'Lime', color: '#c8f04f' },
  { value: 'iris', label: 'Iris', color: '#6e56cf' },
  { value: 'blue', label: 'Blue', color: '#2f6df6' },
]

const EXTRA_CRUMBS: Record<string, [string, string]> = {
  '/pool/addresses': ['Treasury', 'Pool addresses'],
  '/payouts/batch': ['Payments', 'Batch payouts'],
  '/settings': ['System', 'Settings'],
}

function useCrumbs(): [string, string] | null {
  const { pathname } = useLocation()
  if (EXTRA_CRUMBS[pathname]) return EXTRA_CRUMBS[pathname]
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      if (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + '/'))
        return [s.group, it.label]
    }
  }
  return null
}

export function Topbar({ onMobileMenu, onOpenCommandPalette }: TopbarProps) {
  const { mode, accent, resolvedTheme, setMode, setAccent } = useTheme()
  const qc = useQueryClient()
  const fetching = useIsFetching() > 0
  const crumbs = useCrumbs()

  return (
    <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-[var(--bg-0)]/85 px-5 backdrop-blur-md md:px-8 lg:px-10">
      <Button
        size="icon-sm"
        variant="ghost"
        className="-ml-1.5 md:hidden"
        onClick={onMobileMenu}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </Button>
      <LogoMark size={26} className="md:hidden" />

      {crumbs && (
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-base md:flex">
          <span className="text-[var(--fg-2)]">{crumbs[0]}</span>
          <ChevronRight className="size-3.5 text-[var(--fg-3)]" />
          <span className="truncate font-medium">{crumbs[1]}</span>
        </nav>
      )}

      <div className="flex-1" />

      <Button
        size="icon-sm"
        variant="ghost"
        className="xl:hidden"
        onClick={onOpenCommandPalette}
        aria-label="Search"
      >
        <Search className="size-[18px]" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => qc.invalidateQueries()}
        aria-label="Refresh all data"
        title="Refresh all data"
      >
        <RefreshCw className={cn('size-[18px]', fetching && 'animate-spin')} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Theme" title="Theme">
            {resolvedTheme === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun className="mr-2 size-4" /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="mr-2 size-4" /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="mr-2 size-4" /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Signal colour</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={accent}
            onValueChange={(v) => setAccent(v as Accent)}
          >
            {ACCENTS.map((a) => (
              <DropdownMenuRadioItem key={a.value} value={a.value}>
                <span
                  aria-hidden
                  className="mr-2 inline-block size-3 rounded-full ring-1 ring-black/10"
                  style={{ background: a.color }}
                />
                {a.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

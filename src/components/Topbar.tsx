import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Menu, Monitor, Moon, RefreshCw, Search, Sun } from 'lucide-react'

import { useTheme, type Accent, type ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

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
  { value: 'blue', label: 'Blue', color: 'oklch(0.53 0.19 262)' },
  { value: 'violet', label: 'Violet', color: 'oklch(0.52 0.21 293)' },
  { value: 'mint', label: 'Mint', color: 'oklch(0.52 0.11 172)' },
]

export function Topbar({ onMobileMenu, onOpenCommandPalette }: TopbarProps) {
  const { mode, accent, resolvedTheme, setMode, setAccent } = useTheme()
  const qc = useQueryClient()
  const fetching = useIsFetching() > 0

  return (
    <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6 xl:px-8">
      <Button
        size="icon-sm"
        variant="ghost"
        className="-ml-1.5 md:hidden"
        onClick={onMobileMenu}
        aria-label="Open menu"
      >
        <Menu />
      </Button>
      <LogoMark size={24} className="md:hidden" />

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="hidden h-8 w-full max-w-sm cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm text-[var(--fg-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg-1)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:flex"
      >
        <Search className="size-3.5" />
        <span>Jump to…</span>
        <span className="flex-1" />
        <kbd className="rounded-sm border border-border bg-[var(--bg-2)] px-1.5 font-mono text-2xs text-[var(--fg-2)]">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      <Button
        size="icon-sm"
        variant="ghost"
        className="md:hidden"
        onClick={onOpenCommandPalette}
        aria-label="Search"
      >
        <Search />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => qc.invalidateQueries()}
        aria-label="Refresh all data"
        title="Refresh all data"
      >
        <RefreshCw className={cn('size-4', fetching && 'animate-spin')} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Theme" title="Theme">
            {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun className="mr-2 size-3.5" /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="mr-2 size-3.5" /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="mr-2 size-3.5" /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Accent</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={accent}
            onValueChange={(v) => setAccent(v as Accent)}
          >
            {ACCENTS.map((a) => (
              <DropdownMenuRadioItem key={a.value} value={a.value}>
                <span
                  aria-hidden
                  className="mr-2 inline-block size-3 rounded-full"
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

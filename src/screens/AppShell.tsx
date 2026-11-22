import * as React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from '@/components/CommandPalette'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSession } from '@/lib/session'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

export function AppShell() {
  const session = useSession()
  const username = session.data?.user?.username ?? 'admin'
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  useCommandPaletteShortcut(() => setPaletteOpen((o) => !o))
  // Tablet: icon rail. Desktop: full sidebar. Phone: drawer.
  const wide = useMediaQuery('(min-width: 1280px)')

  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  React.useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-[var(--canvas)]">
        {/* Desktop / tablet sidebar */}
        <div className="hidden md:block">
          <Sidebar rail={!wide} username={username} onSearch={() => setPaletteOpen(true)} />
        </div>

        {/* Phone drawer */}
        <div
          className={cn(
            'fixed inset-0 z-40 md:hidden',
            mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          aria-hidden={!mobileOpen}
        >
          <div
            className={cn(
              'absolute inset-0 bg-black/40 transition-opacity duration-200',
              mobileOpen ? 'opacity-100' : 'opacity-0',
            )}
            onClick={() => setMobileOpen(false)}
          />
          <div
            className={cn(
              'absolute inset-y-0 left-0 shadow-lg transition-transform duration-200 ease-out',
              mobileOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <Sidebar username={username} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--bg-0)] md:my-2 md:mr-2 md:rounded-[18px] md:shadow-[var(--shadow-panel)] md:overflow-clip">
          <Topbar
            onMobileMenu={() => setMobileOpen(true)}
            onOpenCommandPalette={() => setPaletteOpen(true)}
          />
          <div
            className="mx-auto w-full max-w-[1360px] flex-1 px-5 pt-8 pb-20 md:px-8 lg:px-10"
          >
            <Outlet />
          </div>
        </main>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </TooltipProvider>
  )
}

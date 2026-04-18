import * as React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from '@/components/CommandPalette'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

export function AppShell() {
  const session = useSession()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  useCommandPaletteShortcut(() => setPaletteOpen((o) => !o))

  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 md:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/40 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-transform',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar
          username={session.data?.user?.username ?? 'admin'}
          onMobileMenu={() => setMobileOpen(true)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
        />
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

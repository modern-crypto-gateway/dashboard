import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'

import { ThemeProvider } from '@/lib/theme'
import { useSession, useSetupStatus } from '@/lib/session'
import { Toaster } from '@/components/ui/sonner'

// Auth screens — always needed on first paint, keep in-bundle.
import { LoginScreen } from '@/screens/Login'
import { SetupScreen } from '@/screens/Setup'
import { AppShell } from '@/screens/AppShell'
import { DashboardPage } from '@/screens/Dashboard'

// Everything else — code-split on first visit.
const SettingsPage = lazy(() =>
  import('@/screens/Settings').then((m) => ({ default: m.SettingsPage })),
)
const MerchantsPage = lazy(() =>
  import('@/screens/Merchants').then((m) => ({ default: m.MerchantsPage })),
)
const InvoicesPage = lazy(() =>
  import('@/screens/Invoices').then((m) => ({ default: m.InvoicesPage })),
)
const PayoutsPage = lazy(() =>
  import('@/screens/Payouts').then((m) => ({ default: m.PayoutsPage })),
)
const WebhooksPage = lazy(() =>
  import('@/screens/Webhooks').then((m) => ({ default: m.WebhooksPage })),
)
const OrphansPage = lazy(() =>
  import('@/screens/Orphans').then((m) => ({ default: m.OrphansPage })),
)
const BalancesPage = lazy(() =>
  import('@/screens/Balances').then((m) => ({ default: m.BalancesPage })),
)
const PoolPage = lazy(() =>
  import('@/screens/Pool').then((m) => ({ default: m.PoolPage })),
)
const ActivityPage = lazy(() =>
  import('@/screens/Activity').then((m) => ({ default: m.ActivityPage })),
)
const AuditAddressPage = lazy(() =>
  import('@/screens/AuditAddress').then((m) => ({ default: m.AuditAddressPage })),
)
const FeeWalletsPage = lazy(() =>
  import('@/screens/FeeWallets').then((m) => ({ default: m.FeeWalletsPage })),
)
const AlchemyWebhooksPage = lazy(() =>
  import('@/screens/AlchemyWebhooks').then((m) => ({ default: m.AlchemyWebhooksPage })),
)

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function Spinner() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-[var(--fg-2)]">
      <div className="flex items-center gap-2">
        <div className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading…
      </div>
    </div>
  )
}

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-[var(--fg-2)] text-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading…
      </div>
    </div>
  )
}

function Bootstrap() {
  const setup = useSetupStatus()
  const session = useSession()
  const loc = useLocation()

  if (setup.isLoading || session.isLoading) return <FullPageSpinner />

  if (!setup.data?.setupComplete) {
    if (loc.pathname !== '/setup') return <Navigate to="/setup" replace />
    return <Outlet />
  }

  if (!session.data?.authenticated) {
    const onAuth = loc.pathname === '/login' || loc.pathname === '/setup'
    if (!onAuth) return <Navigate to="/login" replace />
    return <Outlet />
  }

  if (loc.pathname === '/login' || loc.pathname === '/setup') {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route element={<Bootstrap />}>
                <Route path="/login" element={<LoginScreen />} />
                <Route path="/setup" element={<SetupScreen />} />
                <Route element={<AppShell />}>
                  <Route
                    index
                    element={
                      <Suspense fallback={<Spinner />}>
                        <DashboardPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/activity"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <ActivityPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/balances"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <BalancesPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/pool"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <PoolPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/invoices"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <InvoicesPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/payouts"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <PayoutsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/orphans"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <OrphansPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/webhooks"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <WebhooksPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/merchants"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <MerchantsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/audit-address"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <AuditAddressPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/fee-wallets"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <FeeWalletsPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/alchemy"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <AlchemyWebhooksPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <Suspense fallback={<Spinner />}>
                        <SettingsPage />
                      </Suspense>
                    }
                  />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

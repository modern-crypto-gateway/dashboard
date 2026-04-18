import * as React from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type Accent = 'blue' | 'violet' | 'mint'

interface ThemeState {
  mode: ThemeMode
  accent: Accent
  resolvedTheme: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
  setAccent: (a: Accent) => void
}

const ThemeContext = React.createContext<ThemeState | null>(null)

const STORAGE_MODE = 'gw:theme'
const STORAGE_ACCENT = 'gw:accent'

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return mode
}

function applyTheme(mode: ThemeMode, accent: Accent) {
  const resolved = resolve(mode)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.setAttribute('data-accent', accent)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    return (localStorage.getItem(STORAGE_MODE) as ThemeMode) || 'system'
  })
  const [accent, setAccentState] = React.useState<Accent>(() => {
    if (typeof window === 'undefined') return 'blue'
    return (localStorage.getItem(STORAGE_ACCENT) as Accent) || 'blue'
  })
  const [resolvedTheme, setResolved] = React.useState<'light' | 'dark'>(() =>
    typeof window === 'undefined' ? 'light' : resolve(mode),
  )

  const setMode = React.useCallback((m: ThemeMode) => {
    setModeState(m)
    localStorage.setItem(STORAGE_MODE, m)
    applyTheme(m, (localStorage.getItem(STORAGE_ACCENT) as Accent) || 'blue')
    setResolved(resolve(m))
  }, [])

  const setAccent = React.useCallback(
    (a: Accent) => {
      setAccentState(a)
      localStorage.setItem(STORAGE_ACCENT, a)
      applyTheme(mode, a)
    },
    [mode],
  )

  React.useEffect(() => {
    applyTheme(mode, accent)
    setResolved(resolve(mode))
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => {
      applyTheme(mode, accent)
      setResolved(resolve(mode))
    }
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [mode, accent])

  return (
    <ThemeContext.Provider value={{ mode, accent, resolvedTheme, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeState {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

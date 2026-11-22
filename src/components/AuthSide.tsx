import { ShieldCheck } from '@/components/icons'
import { Logo } from './Logo'

/**
 * Header strip for the sign-in and first-time-setup screens. The form
 * itself sits in a single centred card on the quiet canvas below.
 */
export function AuthSide({ mode }: { mode: 'login' | 'setup' }) {
  return (
    <header className="relative flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
      <Logo />
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-2)]">
        <ShieldCheck className="size-3.5" />
        {mode === 'setup' ? 'First-time setup' : 'Password + authenticator'}
      </span>
    </header>
  )
}

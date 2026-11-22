import * as React from 'react'
import { cn } from '@/lib/utils'

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/** A single key cap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded-[6px] border border-border bg-[var(--bg-2)] px-1 font-sans text-2xs leading-none font-medium text-[var(--fg-2)] shadow-[inset_0_-1px_0_var(--border)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** "⌘ K" on Apple devices, "Ctrl K" elsewhere. */
export function ModKey({ k, className }: { k: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${isMac ? 'Command' : 'Control'} ${k}`}>
      <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
      <Kbd>{k}</Kbd>
    </span>
  )
}

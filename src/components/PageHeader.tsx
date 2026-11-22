import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Page title block used by every screen: small group label, title,
 * one-line description, actions on the right (wrap under on narrow).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  /** Kept for call sites; the group now shows as a breadcrumb in the top bar. */
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1',
        className,
      )}
    >
      <div className="min-w-0 max-w-2xl">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-pretty text-[var(--fg-2)]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

/* eslint-disable react-refresh/only-export-components -- Radix re-exports */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from '@/components/icons'
import { cn } from '@/lib/utils'

/*
 * Side panel ("sheet"). Floats inside the viewport with a margin on
 * desktop (rounded, soft shadow), full-bleed on phones. Slides in on a
 * decelerating curve; the backdrop dims without blur so the list the
 * operator came from stays readable.
 *
 * Anatomy:  SheetHeader (icon · title · meta · actions) → optional
 * SheetTabs → SheetBody (scrolls) → SheetFooter (sticky actions).
 */

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-[rgb(10_10_11/0.28)] dark:bg-black/55',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-300',
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'right' | 'left'
  /** Hide the built-in close button (when the header renders its own). */
  hideClose?: boolean
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = 'right', hideClose, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-50 flex w-full max-w-[600px] flex-col overflow-hidden bg-card shadow-lg outline-none',
        'sm:inset-y-2 sm:rounded-[20px] sm:border sm:border-border',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:duration-[420ms] data-[state=closed]:duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
        side === 'right' &&
          'right-0 sm:right-2 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        side === 'left' &&
          'left-0 sm:left-2 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute top-4 right-4 z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Close"
        >
          <X className="size-[18px]" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = 'SheetContent'

export const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('shrink-0 px-6 pt-6 pb-4', className)} {...props} />
)

/**
 * Standard header layout: icon tile, title, a one-line meta row and
 * optional right-hand actions (kept clear of the close button).
 */
export function SheetHero({
  icon: Icon,
  iconClassName,
  title,
  meta,
  actions,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; weight?: 'regular' | 'fill' | 'duotone' }>
  iconClassName?: string
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SheetHeader>
      <div className="flex items-start gap-3.5 pr-10">
        {Icon && (
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--bg-2)] text-foreground ring-1 ring-border',
              iconClassName,
            )}
          >
            <Icon weight="duotone" className="size-[22px]" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-lg font-semibold tracking-[-0.01em]">
            {title}
          </DialogPrimitive.Title>
          {meta && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--fg-2)]">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </SheetHeader>
  )
}

/** Underline tab strip that sits on the header's bottom edge. */
export function SheetTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (v: T) => void
  tabs: Array<{ value: T; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; count?: number }>
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex shrink-0 gap-5 overflow-x-auto border-b border-border px-6 [scrollbar-width:none]',
        className,
      )}
    >
      {tabs.map((t) => {
        const Icon = t.icon
        const on = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative -mb-px flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:text-foreground',
              on
                ? 'border-foreground text-foreground'
                : 'border-transparent text-[var(--fg-2)] hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {t.label}
            {t.count != null && (
              <span className="figure rounded-full bg-[var(--bg-active)] px-1.5 text-2xs text-[var(--fg-1)]">
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex-1 overflow-y-auto overscroll-contain px-6 py-5', className)}
    {...props}
  />
)

export const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex shrink-0 flex-row items-center justify-end gap-2 border-t border-border bg-[var(--bg-2)]/60 px-6 py-4',
      className,
    )}
    {...props}
  />
)

/** Section inside a sheet body: small heading + content. */
export function SheetSection({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="size-4 text-[var(--fg-2)]" />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold tracking-[-0.01em] pr-8', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-1 text-sm text-[var(--fg-2)]', className)}
    {...props}
  />
))
SheetDescription.displayName = 'SheetDescription'

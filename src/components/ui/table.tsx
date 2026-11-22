import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Data table primitives. One look for every list in the console:
 * quiet uppercase header on an inset band, hairline row dividers,
 * hover tint, numbers right-aligned in tabular figures (`align="right"`
 * on Th/Td also switches Td to the mono face).
 */

export function TableWrap({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-separate border-spacing-0 text-sm', className)}
      {...props}
    />
  )
}

export function THead({
  className,
  sticky,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(sticky && 'sticky top-0 z-[1]', className)}
      {...props}
    />
  )
}

export const TBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...props} />
)

export function Tr({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'group/row transition-colors [&:last-child>td]:border-b-0',
        interactive
          ? 'cursor-pointer hover:bg-[var(--bg-hover)]'
          : 'hover:bg-[var(--bg-2)]',
        className,
      )}
      {...props}
    />
  )
}

type Align = 'left' | 'right' | 'center'

export function Th({
  className,
  align = 'left',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap border-b border-border px-4 text-xs font-medium text-[var(--fg-2)]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    />
  )
}

export function Td({
  className,
  align = 'left',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td
      className={cn(
        'h-12 border-b border-border px-4 py-2 align-middle',
        align === 'right' && 'figure text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  )
}

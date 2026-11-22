/* eslint-disable react-refresh/only-export-components -- hook + components */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, MagnifyingGlass } from './icons'
import { Button } from './ui/button'

/*
 * Table building blocks shared by every list:
 *  - TableCard: rounded card with an optional toolbar row and a footer.
 *  - TableToolbar / TableSearch: title + count, search, filters, actions.
 *  - usePaged: client-side paging for lists the API returns whole.
 *  - Pager: "1–25 of 140" + prev/next (+ page numbers when total is known).
 * Pair with ui/table (Table, THead, Th, Tr, Td).
 */

export function TableCard({
  toolbar,
  footer,
  children,
  className,
}: {
  toolbar?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {toolbar && <div className="border-b border-border px-6 py-3.5">{toolbar}</div>}
      {children}
      {footer && <div className="border-t border-border px-6 py-3">{footer}</div>}
    </div>
  )
}

export function TableToolbar({
  title,
  count,
  children,
}: {
  title?: React.ReactNode
  count?: number
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {title && (
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {count != null && (
            <span className="figure rounded-full bg-[var(--bg-active)] px-2 py-0.5 text-xs font-medium text-[var(--fg-1)]">
              {count}
            </span>
          )}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function TableSearch({
  value,
  onChange,
  placeholder = 'Search',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex h-8 w-56 max-w-full items-center gap-2 rounded-[10px] border border-border bg-card px-2.5 text-sm shadow-[var(--shadow-sm)] focus-within:border-[var(--fg-3)] focus-within:ring-2 focus-within:ring-ring/15',
        className,
      )}
    >
      <MagnifyingGlass className="size-4 shrink-0 text-[var(--fg-3)]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--fg-3)]"
      />
    </label>
  )
}

/** Client-side paging. Resets to page 1 when the row set changes size. */
export function usePaged<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const [lastLen, setLastLen] = React.useState(rows.length)
  if (lastLen !== rows.length) {
    setLastLen(rows.length)
    setPage(0)
  }
  const start = safePage * pageSize
  return {
    page: safePage,
    setPage,
    pageCount,
    pageSize,
    total: rows.length,
    rows: rows.slice(start, start + pageSize),
  }
}

export function Pager({
  page,
  pageSize,
  total,
  shown,
  hasNext,
  onPage,
  loading,
  noun = 'rows',
}: {
  /** 0-based */
  page: number
  pageSize: number
  /** Known total (client paging). Omit for server lists. */
  total?: number
  /** Rows on this page (server lists, where total is unknown). */
  shown?: number
  hasNext: boolean
  onPage: (p: number) => void
  loading?: boolean
  noun?: string
}) {
  const from = page * pageSize + 1
  const count = total != null ? Math.min(pageSize, total - page * pageSize) : (shown ?? 0)
  const to = page * pageSize + count
  const pageCount = total != null ? Math.max(1, Math.ceil(total / pageSize)) : undefined
  if (total === 0 || (total == null && page === 0 && !hasNext && count === 0)) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="figure text-[var(--fg-2)]">
        {count > 0 ? (
          <>
            <span className="font-medium text-foreground">
              {from}–{to}
            </span>
            {total != null ? ` of ${total}` : ''} {noun}
          </>
        ) : (
          `No ${noun}`
        )}
      </div>
      <div className="flex items-center gap-1">
        {pageCount != null && pageCount > 1 && (
          <PageNumbers page={page} pageCount={pageCount} onPage={onPage} />
        )}
        {pageCount == null && (
          <span className="figure px-2 text-[var(--fg-2)]">Page {page + 1}</span>
        )}
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Previous page"
          disabled={page === 0 || loading}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Next page"
          disabled={!hasNext || loading}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function PageNumbers({
  page,
  pageCount,
  onPage,
}: {
  page: number
  pageCount: number
  onPage: (p: number) => void
}) {
  const pages: Array<number | '…'> = []
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) pages.push(i)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }
  return (
    <div className="mr-1 hidden items-center gap-0.5 sm:flex">
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1.5 text-[var(--fg-3)]">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              'figure h-8 min-w-8 cursor-pointer rounded-[10px] px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              p === page
                ? 'bg-foreground font-medium text-background'
                : 'text-[var(--fg-1)] hover:bg-[var(--bg-hover)]',
            )}
          >
            {p + 1}
          </button>
        ),
      )}
    </div>
  )
}

/** Leading cell visual: round tile with an icon or 1–2 letters. */
export function RowAvatar({
  icon: Icon,
  text,
  color,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  text?: string
  color?: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-2xs font-semibold',
        color ? 'text-white' : 'bg-[var(--bg-2)] text-[var(--fg-1)] ring-1 ring-border',
        className,
      )}
      style={color ? { background: color } : undefined}
    >
      {Icon ? <Icon className="size-4" /> : text}
    </span>
  )
}

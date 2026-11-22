/* eslint-disable react-refresh/only-export-components -- formatRange is shared with the filter chips */
import * as React from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Calendar, ChevronLeft, ChevronRight, X } from './icons'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/*
 * Date-range picker: one trigger showing the chosen range, a popover with
 * quick presets, a two-month range calendar and optional start/end times.
 * Values are unix-ms (what the list filters send); `undefined` = open end.
 */

const DAY = 86_400_000

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function withTime(d: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  const x = new Date(d)
  x.setHours(isFinite(h) ? h : 0, isFinite(m) ? m : 0, 0, 0)
  return x
}
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function fmtDay(ms: number, withYear: boolean) {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}
function fmtTimeIfSet(ms: number, edge: 'start' | 'end') {
  const d = new Date(ms)
  const isEdge =
    edge === 'start'
      ? d.getHours() === 0 && d.getMinutes() === 0
      : d.getHours() === 23 && d.getMinutes() === 59
  return isEdge ? '' : ` ${hhmm(d)}`
}

export function formatRange(from?: number, to?: number): string | null {
  if (from == null && to == null) return null
  const thisYear = new Date().getFullYear()
  const yr = (ms: number) => new Date(ms).getFullYear() !== thisYear
  if (from != null && to != null) {
    return `${fmtDay(from, yr(from))}${fmtTimeIfSet(from, 'start')} – ${fmtDay(to, yr(to))}${fmtTimeIfSet(to, 'end')}`
  }
  if (from != null) return `Since ${fmtDay(from, yr(from))}${fmtTimeIfSet(from, 'start')}`
  return `Until ${fmtDay(to!, yr(to!))}${fmtTimeIfSet(to!, 'end')}`
}

type Preset = { label: string; range: () => [number, number] }

const PRESETS: Preset[] = [
  { label: 'Last hour', range: () => [Date.now() - 3_600_000, Date.now()] },
  { label: 'Last 24 hours', range: () => [Date.now() - DAY, Date.now()] },
  { label: 'Today', range: () => [startOfDay(new Date()).getTime(), endOfDay(new Date()).getTime()] },
  {
    label: 'Yesterday',
    range: () => {
      const y = new Date(Date.now() - DAY)
      return [startOfDay(y).getTime(), endOfDay(y).getTime()]
    },
  },
  { label: 'Last 7 days', range: () => [startOfDay(new Date(Date.now() - 6 * DAY)).getTime(), endOfDay(new Date()).getTime()] },
  { label: 'Last 30 days', range: () => [startOfDay(new Date(Date.now() - 29 * DAY)).getTime(), endOfDay(new Date()).getTime()] },
  {
    label: 'This month',
    range: () => {
      const n = new Date()
      return [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), endOfDay(n).getTime()]
    },
  },
  {
    label: 'Last month',
    range: () => {
      const n = new Date()
      const s = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      const e = new Date(n.getFullYear(), n.getMonth(), 0)
      return [s.getTime(), endOfDay(e).getTime()]
    },
  },
]

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Any time',
  className,
  ariaLabel,
}: {
  from?: number
  to?: number
  onChange: (from?: number, to?: number) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [now] = React.useState(() => new Date())
  const [range, setRange] = React.useState<DateRange | undefined>()
  const [fromTime, setFromTime] = React.useState('00:00')
  const [toTime, setToTime] = React.useState('23:59')

  // Seed the editor from the current value whenever it opens.
  const onOpenChange = (v: boolean) => {
    if (v) {
      setRange({
        from: from != null ? new Date(from) : undefined,
        to: to != null ? new Date(to) : undefined,
      })
      setFromTime(from != null ? hhmm(new Date(from)) : '00:00')
      setToTime(to != null ? hhmm(new Date(to)) : '23:59')
    }
    setOpen(v)
  }

  const apply = () => {
    const f = range?.from ? withTime(range.from, fromTime).getTime() : undefined
    const tDay = range?.to ?? range?.from
    const t = tDay ? withTime(tDay, toTime).getTime() + 59_999 : undefined
    onChange(f, t)
    setOpen(false)
  }

  const label = formatRange(from, to)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              'flex h-9 w-full cursor-pointer items-center gap-2 rounded-[10px] border border-input bg-card pr-9 pl-3 text-left text-sm shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--fg-3)] focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none data-[state=open]:border-[var(--fg-3)]',
              !label && 'text-[var(--fg-3)]',
            )}
          >
            <Calendar className="size-4 shrink-0 text-[var(--fg-2)]" />
            <span className="figure truncate">{label ?? placeholder}</span>
          </button>
        </PopoverTrigger>
        {label && (
          <button
            type="button"
            aria-label="Clear dates"
            onClick={() => onChange(undefined, undefined)}
            className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-[var(--fg-3)] hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto max-w-[calc(100vw-24px)] p-0">
        <div className="flex flex-col sm:flex-row">
          <ul className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
            {PRESETS.map((p) => (
              <li key={p.label}>
                <button
                  type="button"
                  onClick={() => {
                    const [f, t] = p.range()
                    onChange(f, t)
                    setOpen(false)
                  }}
                  className="w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap text-[var(--fg-1)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-3">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={2}
              defaultMonth={range?.from ?? new Date(now.getFullYear(), now.getMonth() - 1, 1)}
              disabled={{ after: now }}
              weekStartsOn={1}
              showOutsideDays={false}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === 'left' ? (
                    <ChevronLeft className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  ),
              }}
              classNames={{
                root: 'relative',
                months: 'flex flex-col gap-4 sm:flex-row sm:gap-6',
                month: 'space-y-2',
                month_caption: 'flex h-8 items-center justify-center',
                caption_label: 'text-sm font-semibold',
                nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
                button_previous:
                  'grid size-8 cursor-pointer place-items-center rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-30',
                button_next:
                  'grid size-8 cursor-pointer place-items-center rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-30',
                month_grid: 'border-collapse',
                weekdays: 'flex',
                weekday: 'grid size-9 place-items-center text-xs font-medium text-[var(--fg-3)]',
                week: 'flex',
                day: 'relative size-9 p-0 text-center text-sm',
                day_button:
                  'figure grid size-9 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                today: 'font-semibold [&>button]:underline [&>button]:decoration-[var(--accent-ink)] [&>button]:decoration-2 [&>button]:underline-offset-4',
                selected: '',
                range_start: 'rounded-l-lg bg-[var(--bg-active)] [&>button]:bg-foreground [&>button]:text-background [&>button]:hover:bg-foreground',
                range_end: 'rounded-r-lg bg-[var(--bg-active)] [&>button]:bg-foreground [&>button]:text-background [&>button]:hover:bg-foreground',
                range_middle: 'bg-[var(--bg-active)] [&>button]:rounded-none',
                outside: 'text-[var(--fg-3)] opacity-50',
                disabled: 'text-[var(--fg-3)] opacity-35 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent',
                hidden: 'invisible',
              }}
            />
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <TimeField label="From" value={fromTime} onChange={setFromTime} disabled={!range?.from} />
              <TimeField label="To" value={toTime} onChange={setToTime} disabled={!range?.from} />
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setRange(undefined)}>
                  Reset
                </Button>
                <Button size="sm" onClick={apply} disabled={!range?.from}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--fg-2)]">
      {label}
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="figure h-8 w-[124px] rounded-lg border border-input bg-card px-2 text-sm text-foreground disabled:opacity-50 [&::-webkit-calendar-picker-indicator]:opacity-50"
      />
    </label>
  )
}

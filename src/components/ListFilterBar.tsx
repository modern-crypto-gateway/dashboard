import * as React from 'react'
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Check,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  X,
} from '@/components/icons'

import { cn } from '@/lib/utils'
import {
  countActiveAdvanced,
  fieldKeys,
  type FilterField,
  type FilterSection,
  type FilterValues,
  type SortConfig,
} from '@/lib/listFilters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetSection,
} from '@/components/ui/sheet'

/* ── csv + date helpers ──────────────────────────────────── */

const parseCsv = (s?: string): string[] =>
  s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []
const toCsv = (a: string[]): string => a.join(',')

function msToLocalInput(ms: string): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  if (isNaN(+d)) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localInputToMs(s: string): string {
  if (!s) return ''
  const t = Date.parse(s)
  return Number.isFinite(t) ? String(t) : ''
}
function shortDate(ms: string): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '…'
  const d = new Date(n)
  if (isNaN(+d)) return '…'
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const CHAIN_ANY = '__any'

/* ── active-filter chips ─────────────────────────────────── */

type Chip = { id: string; field: string; value: string; clearKeys: string[] }

function chipsFor(
  sections: FilterSection[],
  values: FilterValues,
): Chip[] {
  const chips: Chip[] = []
  const labelEnum = (
    f: Extract<FilterField, { kind: 'enumSet' }>,
    raw: string,
  ) =>
    parseCsv(raw)
      .map((v) => f.options.find((o) => o.value === v)?.label ?? v)
      .join(', ')

  for (const sec of sections) {
    for (const f of sec.fields) {
      if (f.kind === 'dateRange') {
        const from = values[f.keyFrom] ?? ''
        const to = values[f.keyTo] ?? ''
        if (from || to) {
          chips.push({
            id: f.keyFrom,
            field: f.label,
            value: `${from ? shortDate(from) : '…'} → ${to ? shortDate(to) : '…'}`,
            clearKeys: [f.keyFrom, f.keyTo],
          })
        }
        continue
      }
      if (f.kind === 'numberRange') {
        const min = values[f.keyMin] ?? ''
        const max = values[f.keyMax] ?? ''
        if (min || max) {
          chips.push({
            id: f.keyMin,
            field: f.label,
            value: `${min || '…'} – ${max || '…'}`,
            clearKeys: [f.keyMin, f.keyMax],
          })
        }
        continue
      }
      const raw = values[f.key] ?? ''
      if (raw === '') continue
      let text: string
      if (f.kind === 'enumSet') text = labelEnum(f, raw)
      else if (f.kind === 'tri') text = raw === 'true' ? f.yes : f.no
      else text = raw
      chips.push({ id: f.key, field: f.label, value: text, clearKeys: [f.key] })
    }
  }
  return chips
}

/* ── field primitives ────────────────────────────────────── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-[var(--fg-2)]">{children}</div>
}

/** Multi-select pill: tick + label when on. */
function ChipToggle({
  on,
  onClick,
  children,
  mono,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        mono && 'font-mono text-xs',
        on
          ? 'border-foreground bg-foreground pl-2 text-background'
          : 'border-border bg-card text-[var(--fg-1)] hover:border-[var(--fg-3)] hover:bg-[var(--bg-hover)]',
      )}
    >
      {on && <Check weight="bold" className="size-3.5" />}
      {children}
    </button>
  )
}

/** Single-select segmented control (Any / yes / no). */
function SegmentedToggle({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ v: string; label: string }>
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex h-9 w-full items-center rounded-[10px] bg-[var(--bg-active)] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.v || 'any'}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'h-8 flex-1 cursor-pointer truncate rounded-lg px-2.5 text-sm font-medium text-[var(--fg-2)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            value === o.v && 'bg-[var(--bg-1)] text-foreground shadow-[var(--shadow-sm)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function EnumSetField({
  field,
  value,
  onChange,
}: {
  field: Extract<FilterField, { kind: 'enumSet' }>
  value: string
  onChange: (v: string) => void
}) {
  const picked = new Set(parseCsv(value))
  const toggle = (v: string) => {
    const next = new Set(picked)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(toCsv(field.options.filter((o) => next.has(o.value)).map((o) => o.value)))
  }
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {field.options.map((o) => (
          <ChipToggle key={o.value} on={picked.has(o.value)} onClick={() => toggle(o.value)}>
            {o.label}
          </ChipToggle>
        ))}
      </div>
    </div>
  )
}

function TokensField({
  field,
  value,
  onChange,
  tokenOptions,
}: {
  field: Extract<FilterField, { kind: 'tokens' }>
  value: string
  onChange: (v: string) => void
  tokenOptions: string[]
}) {
  const picked = new Set(parseCsv(value))
  const toggle = (t: string) => {
    const next = new Set(picked)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    onChange(toCsv(tokenOptions.filter((o) => next.has(o))))
  }
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      {tokenOptions.length === 0 ? (
        <div className="text-sm text-[var(--fg-3)]">No tokens found</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tokenOptions.map((t) => (
            <ChipToggle key={t} mono on={picked.has(t)} onClick={() => toggle(t)}>
              {t}
            </ChipToggle>
          ))}
        </div>
      )}
    </div>
  )
}

function TriField({
  field,
  value,
  onChange,
}: {
  field: Extract<FilterField, { kind: 'tri' }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      <SegmentedToggle
        ariaLabel={field.label}
        value={value}
        onChange={onChange}
        options={[
          { v: '', label: 'Any' },
          { v: 'true', label: field.yes },
          { v: 'false', label: field.no },
        ]}
      />
    </div>
  )
}

function ChainField({
  field,
  value,
  onChange,
  chainOptions,
}: {
  field: Extract<FilterField, { kind: 'chain' }>
  value: string
  onChange: (v: string) => void
  chainOptions: Array<{ chainId: number; name: string }>
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      <Select
        value={value === '' ? CHAIN_ANY : value}
        onValueChange={(v) => onChange(v === CHAIN_ANY ? '' : v)}
      >
        <SelectTrigger className="h-9 rounded-[10px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CHAIN_ANY}>Any chain</SelectItem>
          {chainOptions.map((c) => (
            <SelectItem key={c.chainId} value={String(c.chainId)}>
              <span className="flex items-center gap-2">
                <span>{c.name}</span>
                <span className="font-mono text-xs text-[var(--fg-3)]">
                  {c.chainId}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Two inputs joined into one control with a separator between them. */
function RangeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
      {children}
    </div>
  )
}

function RangeDash() {
  return (
    <span aria-hidden className="hidden text-sm text-[var(--fg-3)] sm:block">
      –
    </span>
  )
}

function DateRangeField({
  field,
  values,
  setValue,
}: {
  field: Extract<FilterField, { kind: 'dateRange' }>
  values: FilterValues
  setValue: (key: string, v: string) => void
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      <RangeShell>
        <Input
          type="datetime-local"
          aria-label={`${field.label} from`}
          value={msToLocalInput(values[field.keyFrom] ?? '')}
          onChange={(e) => setValue(field.keyFrom, localInputToMs(e.target.value))}
          className="h-9 rounded-[10px] text-sm"
        />
        <RangeDash />
        <Input
          type="datetime-local"
          aria-label={`${field.label} to`}
          value={msToLocalInput(values[field.keyTo] ?? '')}
          onChange={(e) => setValue(field.keyTo, localInputToMs(e.target.value))}
          className="h-9 rounded-[10px] text-sm"
        />
      </RangeShell>
    </div>
  )
}

function NumberRangeField({
  field,
  values,
  setValue,
}: {
  field: Extract<FilterField, { kind: 'numberRange' }>
  values: FilterValues
  setValue: (key: string, v: string) => void
}) {
  const cell = (key: string, placeholder: string) => (
    <div className="relative">
      {field.prefix && (
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--fg-3)]">
          {field.prefix}
        </span>
      )}
      <Input
        inputMode="decimal"
        placeholder={placeholder}
        aria-label={`${field.label} ${placeholder}`}
        value={values[key] ?? ''}
        onChange={(e) => setValue(key, e.target.value)}
        className={cn('figure h-9 rounded-[10px] text-sm', field.prefix && 'pl-7')}
      />
    </div>
  )
  return (
    <div className="space-y-2">
      <FieldLabel>{field.label}</FieldLabel>
      <RangeShell>
        {cell(field.keyMin, 'Min')}
        <RangeDash />
        {cell(field.keyMax, 'Max')}
      </RangeShell>
    </div>
  )
}

function FieldRenderer({
  field,
  values,
  setValue,
  tokenOptions,
  chainOptions,
}: {
  field: FilterField
  values: FilterValues
  setValue: (key: string, v: string) => void
  tokenOptions: string[]
  chainOptions: Array<{ chainId: number; name: string }>
}) {
  switch (field.kind) {
    case 'text':
      return (
        <div className="space-y-2">
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setValue(field.key, e.target.value)}
            className="h-9 rounded-[10px] font-mono text-sm"
          />
        </div>
      )
    case 'number':
      return (
        <div className="space-y-2">
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            inputMode="decimal"
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setValue(field.key, e.target.value)}
            className="figure h-9 rounded-[10px] text-sm"
          />
        </div>
      )
    case 'chain':
      return (
        <ChainField
          field={field}
          value={values[field.key] ?? ''}
          onChange={(v) => setValue(field.key, v)}
          chainOptions={chainOptions}
        />
      )
    case 'tokens':
      return (
        <TokensField
          field={field}
          value={values[field.key] ?? ''}
          onChange={(v) => setValue(field.key, v)}
          tokenOptions={tokenOptions}
        />
      )
    case 'tri':
      return (
        <TriField
          field={field}
          value={values[field.key] ?? ''}
          onChange={(v) => setValue(field.key, v)}
        />
      )
    case 'enumSet':
      return (
        <EnumSetField
          field={field}
          value={values[field.key] ?? ''}
          onChange={(v) => setValue(field.key, v)}
        />
      )
    case 'dateRange':
      return <DateRangeField field={field} values={values} setValue={setValue} />
    case 'numberRange':
      return (
        <NumberRangeField field={field} values={values} setValue={setValue} />
      )
  }
}

/** Compact fields sit two-per-row; wide fields span the whole sheet width. */
function isWideField(f: FilterField): boolean {
  return (
    f.kind === 'enumSet' ||
    f.kind === 'tokens' ||
    f.kind === 'dateRange' ||
    f.kind === 'numberRange'
  )
}

/** Active fields in one section, for the section's counter. */
function sectionActive(sec: FilterSection, values: FilterValues): number {
  return sec.fields.filter((f) =>
    fieldKeys(f).some((k) => (values[k] ?? '') !== ''),
  ).length
}

/* ── the bar ─────────────────────────────────────────────── */

type Props = {
  values: FilterValues
  onChange: (next: FilterValues) => void
  sections: FilterSection[]
  sort: SortConfig
  tokenOptions: string[]
  chainOptions: Array<{ chainId: number; name: string }>
  /** Count of rows currently loaded, shown on the right. */
  resultCount?: number
  loading?: boolean
}

export function ListFilterBar({
  values,
  onChange,
  sections,
  sort,
  tokenOptions,
  chainOptions,
  resultCount,
  loading,
}: Props) {
  const [open, setOpen] = React.useState(false)
  // The sheet edits a private draft; nothing hits the query until Apply.
  const [draft, setDraft] = React.useState<FilterValues>(values)

  const openSheet = () => {
    setDraft(values)
    setOpen(true)
  }
  const applyDraft = () => {
    onChange(draft)
    setOpen(false)
  }

  const clearKeys = React.useCallback(
    (keys: string[]) => {
      const next = { ...values }
      for (const k of keys) delete next[k]
      onChange(next)
    },
    [values, onChange],
  )

  const advancedCount = countActiveAdvanced(sections, values)
  const chips = chipsFor(sections, values)

  const sortBy = values[sort.byKey] || sort.defaultBy
  const sortDir = (values[sort.dirKey] || sort.defaultDir) as 'asc' | 'desc'
  const sortDirty = sortBy !== sort.defaultBy || sortDir !== sort.defaultDir

  const draftCount = countActiveAdvanced(sections, draft)

  const clearAll = () => onChange({})

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openSheet}
        className={cn(advancedCount > 0 && 'border-[var(--fg-3)]')}
      >
        <SlidersHorizontal className="size-4" />
        Filters
        {advancedCount > 0 && (
          <span className="figure grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-2xs font-semibold text-background">
            {advancedCount}
          </span>
        )}
      </Button>

      {chips.map((c) => (
        <span
          key={c.id}
          className="fade-in inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-card pr-1 pl-3 text-sm shadow-[var(--shadow-sm)]"
        >
          <span className="shrink-0 text-[var(--fg-2)]">{c.field}</span>
          <span className="max-w-[220px] truncate font-medium text-foreground">
            {c.value}
          </span>
          <button
            type="button"
            onClick={() => clearKeys(c.clearKeys)}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Remove ${c.field} filter`}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {(loading || resultCount != null) && (
          <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-[var(--fg-2)]">
            {loading && <Loader2 className="size-4 animate-spin" />}
            {resultCount != null && (
              <>
                <span className="figure font-medium text-foreground">{resultCount}</span>
                shown
              </>
            )}
          </span>
        )}
        <SortControl
          sort={sort}
          sortBy={sortBy}
          sortDir={sortDir}
          dirty={sortDirty}
          onChangeBy={(v) => onChange({ ...values, [sort.byKey]: v })}
          onChangeDir={(v) => onChange({ ...values, [sort.dirKey]: v })}
        />
      </div>

      {/* filter sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-[480px]">
          <SheetHero
            icon={SlidersHorizontal}
            title="Filters"
            meta={
              draftCount > 0 ? (
                <span>
                  <span className="figure font-medium text-foreground">{draftCount}</span>{' '}
                  selected
                </span>
              ) : (
                <span>None selected</span>
              )
            }
          />

          <SheetBody className="space-y-8 border-t border-border py-6">
            {sections.map((sec) => {
              const n = sectionActive(sec, draft)
              return (
                <SheetSection
                  key={sec.title}
                  title={sec.title}
                  icon={sec.icon}
                  action={
                    n > 0 ? (
                      <span className="figure rounded-full bg-[var(--bg-active)] px-2 py-0.5 text-xs font-medium text-[var(--fg-1)]">
                        {n}
                      </span>
                    ) : undefined
                  }
                >
                  <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
                    {sec.fields.map((f) => (
                      <div
                        key={fieldKeys(f).join('|')}
                        className={isWideField(f) ? 'sm:col-span-2' : ''}
                      >
                        <FieldRenderer
                          field={f}
                          values={draft}
                          setValue={(k, v) =>
                            setDraft((prev) => ({ ...prev, [k]: v }))
                          }
                          tokenOptions={tokenOptions}
                          chainOptions={chainOptions}
                        />
                      </div>
                    ))}
                  </div>
                </SheetSection>
              )
            })}
          </SheetBody>

          <SheetFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft({})}
              disabled={draftCount === 0}
            >
              <RotateCcw className="size-4" /> Reset
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={applyDraft}>
                <Check className="size-4" />
                Apply{draftCount > 0 ? ` (${draftCount})` : ''}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/* ── sort control ────────────────────────────────────────── */

function SortControl({
  sort,
  sortBy,
  sortDir,
  dirty,
  onChangeBy,
  onChangeDir,
}: {
  sort: SortConfig
  sortBy: string
  sortDir: 'asc' | 'desc'
  dirty: boolean
  onChangeBy: (v: string) => void
  onChangeDir: (v: string) => void
}) {
  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-[10px] border bg-card shadow-[var(--shadow-sm)]',
        dirty ? 'border-[var(--fg-3)]' : 'border-border',
      )}
    >
      <Select value={sortBy} onValueChange={onChangeBy}>
        <SelectTrigger
          aria-label="Sort by"
          className="h-full w-auto gap-1.5 rounded-l-[10px] rounded-r-none border-0 bg-transparent pr-2 pl-3 text-sm shadow-none hover:border-0 focus-visible:ring-0"
        >
          <span className="text-[var(--fg-2)]">Sort</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {sort.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={() => onChangeDir(sortDir === 'asc' ? 'desc' : 'asc')}
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
        className="flex h-full cursor-pointer items-center rounded-r-[10px] px-2.5 text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {sortDir === 'asc' ? (
          <ArrowUpWideNarrow className="size-4" />
        ) : (
          <ArrowDownWideNarrow className="size-4" />
        )}
      </button>
    </div>
  )
}

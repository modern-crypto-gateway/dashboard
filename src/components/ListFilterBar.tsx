import * as React from 'react'
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Check,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  countActiveAdvanced,
  fieldKeys,
  type FilterField,
  type FilterSection,
  type FilterValues,
  type SortConfig,
} from '@/lib/listFilters'
import { Badge } from '@/components/ui/badge'
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
  SheetHeader,
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

type Chip = { id: string; label: string; clearKeys: string[] }

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
            label: `${f.label}: ${from ? shortDate(from) : '…'} → ${to ? shortDate(to) : '…'}`,
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
            label: `${f.label}: ${min || '…'} – ${max || '…'}`,
            clearKeys: [f.keyMin, f.keyMax],
          })
        }
        continue
      }
      const raw = values[f.key] ?? ''
      if (raw === '') continue
      let text: string
      if (f.kind === 'enumSet') text = `${f.label}: ${labelEnum(f, raw)}`
      else if (f.kind === 'tri')
        text = `${f.label}: ${raw === 'true' ? f.yes : f.no}`
      else text = `${f.label}: ${raw}`
      chips.push({ id: f.key, label: text, clearKeys: [f.key] })
    }
  }
  return chips
}

/* ── field primitives ────────────────────────────────────── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--fg-2)]">
      {children}
    </div>
  )
}

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
      className={cn(
        'cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        mono && 'font-mono',
        on
          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-primary'
          : 'border-border text-[var(--fg-2)] hover:border-[var(--fg-3)] hover:bg-[var(--bg-hover)]',
      )}
    >
      {children}
    </button>
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
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
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
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      {tokenOptions.length === 0 ? (
        <div className="text-xs text-[var(--fg-3)]">No tokens discovered.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
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
  const opts = [
    { v: '', label: 'Any' },
    { v: 'true', label: field.yes },
    { v: 'false', label: field.no },
  ]
  return (
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      <div className="inline-flex w-full rounded-md border border-border bg-[var(--bg-2)] p-0.5">
        {opts.map((o) => (
          <button
            key={o.v || 'any'}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              'flex-1 cursor-pointer rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
              value === o.v
                ? 'bg-card text-foreground shadow-xs'
                : 'text-[var(--fg-2)] hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
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
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      <Select
        value={value === '' ? CHAIN_ANY : value}
        onValueChange={(v) => onChange(v === CHAIN_ANY ? '' : v)}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CHAIN_ANY}>Any chain</SelectItem>
          {chainOptions.map((c) => (
            <SelectItem key={c.chainId} value={String(c.chainId)}>
              <span className="flex items-center gap-2">
                <span>{c.name}</span>
                <span className="font-mono text-[10.5px] text-[var(--fg-3)]">
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
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="datetime-local"
          value={msToLocalInput(values[field.keyFrom] ?? '')}
          onChange={(e) => setValue(field.keyFrom, localInputToMs(e.target.value))}
          className="h-9 text-xs"
        />
        <Input
          type="datetime-local"
          value={msToLocalInput(values[field.keyTo] ?? '')}
          onChange={(e) => setValue(field.keyTo, localInputToMs(e.target.value))}
          className="h-9 text-xs"
        />
      </div>
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
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-[var(--fg-3)]">
          {field.prefix}
        </span>
      )}
      <Input
        inputMode="decimal"
        placeholder={placeholder}
        value={values[key] ?? ''}
        onChange={(e) => setValue(key, e.target.value)}
        className={cn('h-9 font-mono text-xs', field.prefix && 'pl-6')}
      />
    </div>
  )
  return (
    <div className="space-y-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {cell(field.keyMin, 'min')}
        {cell(field.keyMax, 'max')}
      </div>
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
        <div className="space-y-1.5">
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setValue(field.key, e.target.value)}
            className="h-9 font-mono text-xs"
          />
        </div>
      )
    case 'number':
      return (
        <div className="space-y-1.5">
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            inputMode="decimal"
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setValue(field.key, e.target.value)}
            className="h-9 font-mono text-xs"
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
    <div className="space-y-2.5">
      {/* primary row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={advancedCount > 0 ? 'secondary' : 'outline'}
          size="sm"
          onClick={openSheet}
          className={cn(advancedCount > 0 && 'border-[var(--accent-border)]')}
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {advancedCount > 0 && (
            <Badge variant="accent" className="h-4 min-w-4 px-1 text-[10px]">
              {advancedCount}
            </Badge>
          )}
        </Button>

        <SortControl
          sort={sort}
          sortBy={sortBy}
          sortDir={sortDir}
          dirty={sortDirty}
          onChangeBy={(v) => onChange({ ...values, [sort.byKey]: v })}
          onChangeDir={(v) => onChange({ ...values, [sort.dirKey]: v })}
        />

        <div className="ml-auto flex items-center gap-2 text-xs text-[var(--fg-3)]">
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {resultCount != null && (
            <span className="whitespace-nowrap tabular-nums">
              {resultCount} loaded
            </span>
          )}
        </div>
      </div>

      {/* applied-filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--fg-3)]">
            Applied
          </span>
          {chips.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-1 pl-2.5 text-[11px] text-[var(--fg-1)] shadow-xs"
            >
              <span className="max-w-[300px] truncate">{c.label}</span>
              <button
                type="button"
                onClick={() => clearKeys(c.clearKeys)}
                className="rounded-full p-0.5 text-[var(--fg-3)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
                aria-label={`Remove ${c.label}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--fg-2)] hover:text-foreground"
          >
            <RotateCcw className="size-3" /> Clear all
          </button>
        </div>
      )}

      {/* filter sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-[460px]">
          <SheetHeader>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md bg-[var(--accent-bg)] text-primary">
                <SlidersHorizontal className="size-4" />
              </span>
              <div>
                <div className="text-base font-semibold tracking-tight">
                  Filters
                </div>
                <div className="text-xs text-[var(--fg-3)]">
                  Changes apply when you hit Apply.
                </div>
              </div>
            </div>
          </SheetHeader>

          <SheetBody className="space-y-6">
            {sections.map((sec) => {
              const Icon = sec.icon
              return (
                <section key={sec.title} className="space-y-3.5">
                  <div className="flex items-center gap-2">
                    {Icon && (
                      <Icon className="size-3.5 text-[var(--fg-3)]" />
                    )}
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--fg-2)]">
                      {sec.title}
                    </h3>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {sec.fields.map((f) => (
                      <div
                        key={fieldKeys(f).join('|')}
                        className={isWideField(f) ? 'col-span-2' : ''}
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
                </section>
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
              <RotateCcw className="size-3.5" /> Reset
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
                <Check className="size-3.5" />
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
        'flex h-9 items-center rounded-md border bg-card',
        dirty ? 'border-[var(--accent-border)]' : 'border-border',
      )}
    >
      <Select value={sortBy} onValueChange={onChangeBy}>
        <SelectTrigger className="h-full gap-1.5 border-0 bg-transparent px-2.5 text-xs shadow-none focus-visible:ring-0">
          <span className="text-[var(--fg-3)]">Sort</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sort.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="h-5 w-px bg-border" />
      <button
        type="button"
        onClick={() => onChangeDir(sortDir === 'asc' ? 'desc' : 'asc')}
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        className="flex h-full cursor-pointer items-center px-2 text-[var(--fg-2)] transition-colors hover:text-foreground"
      >
        {sortDir === 'asc' ? (
          <ArrowUpWideNarrow className="size-3.5" />
        ) : (
          <ArrowDownWideNarrow className="size-3.5" />
        )}
      </button>
    </div>
  )
}

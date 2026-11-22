import * as React from 'react'
import { Braces, ListBullets, Plus, X } from '@/components/icons'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Row = { key: string; value: string }

function rowsToJson(rows: Row[]): string {
  const obj: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    obj[k] = r.value
  }
  return Object.keys(obj).length === 0 ? '' : JSON.stringify(obj)
}

function jsonToRows(s: string): Row[] | null {
  const trimmed = s.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    )
      return null
    return Object.entries(parsed).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
  } catch {
    return null
  }
}

type Props = {
  value: string
  onChange: (next: string) => void
}

export function MetadataEditor({ value, onChange }: Props) {
  const [mode, setMode] = React.useState<'rows' | 'raw'>(() =>
    jsonToRows(value) === null && value.trim() !== '' ? 'raw' : 'rows',
  )
  const [rows, setRows] = React.useState<Row[]>(
    () => jsonToRows(value) ?? [],
  )
  const [raw, setRaw] = React.useState(value)
  const [rawError, setRawError] = React.useState<string | null>(null)

  // Keep external value in sync with whichever mode is active.
  React.useEffect(() => {
    if (mode === 'rows') onChange(rowsToJson(rows))
  }, [rows, mode, onChange])

  React.useEffect(() => {
    if (mode === 'raw') onChange(raw)
  }, [raw, mode, onChange])

  const switchToRaw = () => {
    setRaw(rowsToJson(rows) || '')
    setRawError(null)
    setMode('raw')
  }

  const switchToRows = () => {
    const parsed = jsonToRows(raw)
    if (parsed === null) {
      setRawError('Not a valid JSON object. Keep in Raw mode or fix first.')
      return
    }
    setRows(parsed)
    setMode('rows')
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[var(--bg-2)] px-2.5 py-2">
        <div
          role="radiogroup"
          aria-label="Metadata editor mode"
          className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-active)] p-0.5"
        >
          {(
            [
              { k: 'rows', label: 'Fields', Icon: ListBullets },
              { k: 'raw', label: 'JSON', Icon: Braces },
            ] as const
          ).map((opt) => {
            const active = mode === opt.k
            return (
              <button
                key={opt.k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => (opt.k === 'raw' ? switchToRaw() : switchToRows())}
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'bg-[var(--bg-1)] text-foreground shadow-[var(--shadow-sm)]',
                )}
              >
                <opt.Icon className="size-3.5" />
                {opt.label}
              </button>
            )
          })}
        </div>
        {mode === 'rows' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRows((r) => [...r, { key: '', value: '' }])}
          >
            <Plus className="size-4" /> Field
          </Button>
        )}
      </div>

      {mode === 'rows' ? (
        <div className="space-y-2 p-2.5">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-4 text-center">
              <Braces className="size-5 text-[var(--fg-3)]" />
              <div className="text-sm text-[var(--fg-2)]">No fields</div>
            </div>
          ) : (
            rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.key}
                  placeholder="key"
                  aria-label="Key"
                  onChange={(e) =>
                    setRows((cur) => {
                      const next = cur.slice()
                      next[i] = { ...next[i], key: e.target.value }
                      return next
                    })
                  }
                  className="h-9 min-w-0 flex-1 font-mono text-sm"
                  maxLength={128}
                />
                <Input
                  value={r.value}
                  placeholder="value"
                  aria-label="Value"
                  onChange={(e) =>
                    setRows((cur) => {
                      const next = cur.slice()
                      next[i] = { ...next[i], value: e.target.value }
                      return next
                    })
                  }
                  className="h-9 min-w-0 flex-[2] font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((cur) => cur.filter((_, j) => j !== i))
                  }
                  title="Remove field"
                  className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-[var(--fg-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-destructive"
                  aria-label="Remove field"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="p-2.5">
          <Textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setRawError(null)
            }}
            placeholder='{"orderId":"42"}'
            rows={4}
            className="font-mono text-sm"
          />
          {rawError && (
            <div className="mt-2 text-xs text-destructive">{rawError}</div>
          )}
        </div>
      )}
    </div>
  )
}

import * as React from 'react'
import { Plus, X } from 'lucide-react'

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
    <div className="rounded-md border border-border bg-[var(--bg-2)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(
            [
              { k: 'rows', label: 'Fields' },
              { k: 'raw', label: 'Raw JSON' },
            ] as const
          ).map((opt) => {
            const active = mode === opt.k
            return (
              <button
                key={opt.k}
                type="button"
                onClick={() => (opt.k === 'raw' ? switchToRaw() : switchToRows())}
                className={
                  'rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ' +
                  (active
                    ? 'bg-[var(--bg-2)] text-[var(--fg-1)]'
                    : 'text-[var(--fg-2)] hover:text-[var(--fg-1)]')
                }
              >
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
            <Plus className="size-3.5" /> Field
          </Button>
        )}
      </div>

      {mode === 'rows' ? (
        <div className="space-y-1.5 p-2">
          {rows.length === 0 ? (
            <div className="px-1 py-3 text-center text-[11.5px] text-[var(--fg-3)]">
              No fields. Click <span className="font-medium">+ Field</span> to
              add key/value pairs, or switch to Raw JSON.
            </div>
          ) : (
            rows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={r.key}
                  placeholder="key"
                  onChange={(e) =>
                    setRows((cur) => {
                      const next = cur.slice()
                      next[i] = { ...next[i], key: e.target.value }
                      return next
                    })
                  }
                  className="h-8 flex-1 font-mono text-xs"
                  maxLength={128}
                />
                <Input
                  value={r.value}
                  placeholder="value"
                  onChange={(e) =>
                    setRows((cur) => {
                      const next = cur.slice()
                      next[i] = { ...next[i], value: e.target.value }
                      return next
                    })
                  }
                  className="h-8 flex-[2] font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((cur) => cur.filter((_, j) => j !== i))
                  }
                  className="rounded p-1 text-[var(--fg-3)] transition-colors hover:bg-[var(--bg-hover)] hover:text-destructive"
                  aria-label="Remove field"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="p-2">
          <Textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setRawError(null)
            }}
            placeholder='{"orderId":"42"}'
            rows={3}
            className="font-mono text-xs"
          />
          {rawError && (
            <div className="mt-1 text-[11px] text-destructive">{rawError}</div>
          )}
        </div>
      )}
    </div>
  )
}

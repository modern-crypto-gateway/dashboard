import * as React from 'react'

import type { ChainInventoryEntry } from '@/lib/types'

/* ── filter spec types ───────────────────────────────────── */

/** Filter state is a flat string map keyed by the server's query-param
 * names. An empty / absent value means the filter is off. Date keys hold
 * unix-ms strings; the date-range field converts to/from datetime-local. */
export type FilterValues = Record<string, string>

export type FilterField =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'number'; key: string; label: string; placeholder?: string }
  | { kind: 'chain'; key: string; label: string }
  | { kind: 'tokens'; key: string; label: string }
  | { kind: 'tri'; key: string; label: string; yes: string; no: string }
  | {
      kind: 'enumSet'
      key: string
      label: string
      options: ReadonlyArray<{ value: string; label: string }>
    }
  | { kind: 'dateRange'; keyFrom: string; keyTo: string; label: string }
  | {
      kind: 'numberRange'
      keyMin: string
      keyMax: string
      label: string
      prefix?: string
    }

export type FilterSection = {
  title: string
  /** Optional lucide icon component rendered beside the section title. */
  icon?: React.ComponentType<{ className?: string }>
  fields: FilterField[]
}

export type SortConfig = {
  byKey: string
  dirKey: string
  options: ReadonlyArray<{ value: string; label: string }>
  defaultBy: string
  defaultDir: 'asc' | 'desc'
}

/* ── helpers ─────────────────────────────────────────────── */

/** Every query-param key a field owns (range fields own two). */
export function fieldKeys(f: FilterField): string[] {
  if (f.kind === 'dateRange') return [f.keyFrom, f.keyTo]
  if (f.kind === 'numberRange') return [f.keyMin, f.keyMax]
  return [f.key]
}

/** Count of advanced (panel) filters that are currently set. dateRange /
 * numberRange count once even when both bounds are filled. */
export function countActiveAdvanced(
  sections: FilterSection[],
  values: FilterValues,
): number {
  let n = 0
  for (const sec of sections) {
    for (const f of sec.fields) {
      if (fieldKeys(f).some((k) => (values[k] ?? '') !== '')) n += 1
    }
  }
  return n
}

/** Strip empty entries — what actually gets serialized into the request. */
export function cleanFilterValues(values: FilterValues): FilterValues {
  const out: FilterValues = {}
  for (const [k, v] of Object.entries(values)) {
    if (v !== '' && v != null) out[k] = v
  }
  return out
}

/** Debounce a value so fast typing in filter inputs doesn't fire a request
 * per keystroke. The screen feeds the debounced copy to its list query. */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

/**
 * Flatten the chain inventory into the `{chainId,name}` + unique-token-symbol
 * lists the filter bar's chain / token pickers expect.
 */
export function useFilterOptions(chains: ChainInventoryEntry[] | undefined): {
  chainOptions: Array<{ chainId: number; name: string }>
  tokenOptions: string[]
} {
  return React.useMemo(() => {
    const list = chains ?? []
    const chainOptions = list
      .map((c) => ({ chainId: c.chainId, name: c.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const tokens = new Set<string>()
    for (const c of list) for (const t of c.tokens) tokens.add(t.symbol)
    return { chainOptions, tokenOptions: [...tokens].sort() }
  }, [chains])
}

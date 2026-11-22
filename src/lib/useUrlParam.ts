import * as React from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A string state stored in the URL query (e.g. `?invoice=inv_123`), so a
 * detail sheet survives refresh and can be shared as a link. Opening
 * pushes a history entry (Back closes the sheet); closing replaces it.
 * Other query params are preserved.
 */
export function useUrlParam(key: string): [string | null, (v: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key)
  const set = React.useCallback(
    (v: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v == null || v === '') next.delete(key)
          else next.set(key, v)
          return next
        },
        { replace: v == null },
      )
    },
    [key, setParams],
  )
  return [value, set]
}

/**
 * Sheet state backed by the URL. `id` stays set after closing so the
 * sheet can keep its content while it animates out.
 */
export function useUrlSheet(key: string) {
  const [value, setValue] = useUrlParam(key)
  const [last, setLast] = React.useState<string | null>(value)
  if (value != null && value !== last) setLast(value)
  return {
    id: value ?? last,
    open: value != null,
    show: (id: string) => setValue(id),
    close: () => setValue(null),
  }
}

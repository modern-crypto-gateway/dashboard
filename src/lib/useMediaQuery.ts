import { useSyncExternalStore } from 'react'

/** Subscribe to a CSS media query. SSR-safe (returns false off-browser). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

import * as React from 'react'

/**
 * Cloudflare Turnstile widget (explicit rendering).
 *
 * The script is loaded once, only on screens that render this component. A
 * token is single-use: call `reset()` through the ref after every submit so
 * the next attempt gets a fresh one.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')))
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load Turnstile'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileHandle {
  reset: () => void
}

interface Props {
  siteKey: string
  action: string
  onToken: (token: string) => void
  onError?: (msg: string) => void
}

export const Turnstile = React.forwardRef<TurnstileHandle, Props>(function Turnstile(
  { siteKey, action, onToken, onError },
  ref,
) {
  const elRef = React.useRef<HTMLDivElement>(null)
  const idRef = React.useRef<string | null>(null)
  const onTokenRef = React.useRef(onToken)
  const onErrorRef = React.useRef(onError)
  React.useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  })

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenRef.current('')
      if (idRef.current && window.turnstile) window.turnstile.reset(idRef.current)
    },
  }))

  React.useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !elRef.current) return
        idRef.current = ts.render(elRef.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          size: 'flexible',
          callback: (t: string) => onTokenRef.current(t),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => {
            onTokenRef.current('')
            onErrorRef.current?.('Human check failed to load. Refresh the page.')
          },
        })
      })
      .catch(() => onErrorRef.current?.('Human check failed to load. Refresh the page.'))
    return () => {
      cancelled = true
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current)
      idRef.current = null
    }
  }, [siteKey, action])

  return <div ref={elRef} className="min-h-[65px] w-full" />
})

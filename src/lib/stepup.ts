/**
 * Asking the operator for a fresh authenticator code before a money move.
 *
 * `api()` calls `requestStepUpCode()` for every request that
 * `moneyActionFor()` (shared/moneyRoutes.ts) marks as a money move; the one
 * <StepUpDialog/> mounted at the app root shows the prompt. Requests that
 * need a code at the same time are asked one after another, since each code
 * can be used only once.
 */

export type StepUpPrompt = {
  /** What the request does, e.g. "Send a payout". */
  action: string
  /** Why the previous code was refused, if it was. */
  error?: string
  resolve: (code: string | null) => void
}

type Listener = (current: StepUpPrompt | null) => void

const queue: StepUpPrompt[] = []
const listeners = new Set<Listener>()

function emit() {
  const current = queue[0] ?? null
  for (const l of listeners) l(current)
}

export function subscribeStepUp(l: Listener): () => void {
  listeners.add(l)
  l(queue[0] ?? null)
  return () => {
    listeners.delete(l)
  }
}

/** Resolves with the 6-digit code, or null if the operator cancelled. */
export function requestStepUpCode(action: string, error?: string): Promise<string | null> {
  // No dialog mounted (shouldn't happen inside the app): fail as cancelled
  // rather than hang the request forever.
  if (listeners.size === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const prompt: StepUpPrompt = {
      action,
      error,
      resolve: (code) => {
        if (done) return
        done = true
        const i = queue.indexOf(prompt)
        if (i >= 0) queue.splice(i, 1)
        resolve(code)
        emit()
      },
    }
    queue.push(prompt)
    emit()
  })
}

/** Error codes from the Worker that mean "ask for a (new) code and retry". */
export const STEPUP_RETRY_CODES = new Set(['TOTP_REQUIRED', 'BAD_TOTP', 'TOTP_REUSED'])

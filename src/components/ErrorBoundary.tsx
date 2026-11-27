import * as React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from '@/components/icons'

/**
 * Keeps one broken screen from blanking the whole dashboard: shows what
 * failed and a way back, while the sidebar and the rest stay usable. Give it
 * a `key` (e.g. the route) so moving elsewhere clears the error.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string; compact?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ui] ${this.props.label ?? 'screen'} crashed`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className={
          this.props.compact
            ? 'm-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm'
            : 'mx-auto mt-16 max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-6 text-sm'
        }
      >
        <div className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="size-4" /> This {this.props.label ?? 'screen'} hit an error
        </div>
        <p className="mt-1.5 text-[var(--fg-2)]">
          Nothing was sent. Try again; if it keeps happening, the message below helps find the cause.
        </p>
        <code className="mt-3 block rounded-md bg-card px-2 py-1.5 font-mono text-[11.5px] break-all text-[var(--fg-1)]">
          {error.message || String(error)}
        </code>
        <Button className="mt-4" size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      </div>
    )
  }
}

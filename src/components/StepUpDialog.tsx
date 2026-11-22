import * as React from 'react'
import { OtpInput } from '@/components/OtpInput'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ShieldCheck } from '@/components/icons'
import { subscribeStepUp, type StepUpPrompt } from '@/lib/stepup'

/**
 * The one "confirm with your authenticator" prompt for money moves. Mounted
 * once at the app root; `api()` opens it (via lib/stepup) before sending any
 * request the Worker requires a fresh code for.
 */
export function StepUpDialog() {
  const [prompt, setPrompt] = React.useState<StepUpPrompt | null>(null)
  const [code, setCode] = React.useState('')

  React.useEffect(
    () =>
      subscribeStepUp((p) => {
        setPrompt(p)
        setCode('')
      }),
    [],
  )

  const submit = () => {
    if (prompt && code.length === 6) prompt.resolve(code)
  }

  return (
    <Dialog
      open={!!prompt}
      onOpenChange={(open) => {
        if (!open) prompt?.resolve(null)
      }}
    >
      <DialogContent className="max-w-md" aria-describedby="stepup-desc">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-[var(--bg-hover)]">
              <ShieldCheck className="size-4.5" />
            </div>
            <DialogTitle>Confirm with your authenticator</DialogTitle>
            <DialogDescription id="stepup-desc">
              <span className="font-medium text-foreground">{prompt?.action}</span> is protected
              by two-factor confirmation. Enter the current 6-digit code from your authenticator
              app.
            </DialogDescription>
          </DialogHeader>

          {/* Re-keyed per prompt so the first box gets focus every time. */}
          <OtpInput
            key={prompt ? `${prompt.action}:${prompt.error ?? ''}` : 'none'}
            value={code}
            onChange={setCode}
            className="justify-center"
          />

          {prompt?.error ? (
            <p role="alert" className="text-center text-sm text-destructive">
              {prompt.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => prompt?.resolve(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={code.length !== 6}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

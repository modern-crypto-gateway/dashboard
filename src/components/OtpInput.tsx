import * as React from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  value: string
  onChange: (v: string) => void
  length?: number
  autoFocus?: boolean
  disabled?: boolean
  className?: string
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus = true,
  disabled,
  className,
}: OtpInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([])
  const chars = value.padEnd(length, ' ').split('').slice(0, length)

  const setAt = (i: number, c: string) => {
    const clean = c.replace(/\D/g, '').slice(0, 1)
    const next = chars.slice()
    next[i] = clean || ' '
    const joined = next.join('').trimEnd()
    onChange(joined)
    if (clean && i < length - 1) refs.current[i + 1]?.focus()
  }

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !chars[i].trim() && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus()
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const p = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, length)
    if (p) {
      e.preventDefault()
      onChange(p)
      refs.current[Math.min(p.length, length - 1)]?.focus()
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)} onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={chars[i].trim()}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          autoFocus={autoFocus && i === 0}
          className={cn(
            'h-13 w-11 rounded-md border border-border bg-card text-center font-mono text-xl font-semibold shadow-xs',
            'focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] focus-visible:outline-none',
            'disabled:opacity-50',
          )}
        />
      ))}
    </div>
  )
}

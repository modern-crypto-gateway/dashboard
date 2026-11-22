import * as React from 'react'
import { Check, Copy } from '@/components/icons'
import { cn } from '@/lib/utils'

interface CopyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  label?: string
}

export function CopyButton({ value, label, className, ...props }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? 'Copied' : 'Copy'}
      aria-label="Copy"
      className={cn(
        label != null
          ? 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground cursor-pointer'
          : 'inline-grid size-6 shrink-0 place-items-center rounded-md text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        copied && 'text-[var(--st-ok)] hover:text-[var(--st-ok)]',
        className,
      )}
      {...props}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label != null && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

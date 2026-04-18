import * as React from 'react'
import { Check, Copy } from 'lucide-react'
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
      title="Copy"
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground cursor-pointer',
        copied && 'text-success hover:text-success',
        className,
      )}
      {...props}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label != null && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

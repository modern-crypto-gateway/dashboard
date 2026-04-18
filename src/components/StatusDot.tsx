import { cn } from '@/lib/utils'

type Tone = 'success' | 'warn' | 'danger' | 'muted' | 'accent'

const toneClass: Record<Tone, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-destructive',
  muted: 'bg-[var(--fg-3)]',
  accent: 'bg-primary',
}

export function StatusDot({
  tone = 'success',
  pulse = false,
  className,
}: {
  tone?: Tone
  pulse?: boolean
  className?: string
}) {
  return (
    <span className={cn('relative inline-block size-[7px] rounded-full', toneClass[tone], className)}>
      {pulse && (
        <span
          aria-hidden
          className={cn(
            'absolute -inset-1 rounded-full opacity-40',
            toneClass[tone],
          )}
          style={{ animation: 'pulse-dot 1.8s ease-out infinite' }}
        />
      )}
    </span>
  )
}

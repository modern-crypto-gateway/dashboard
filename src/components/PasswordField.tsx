import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

interface PasswordFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
}

export function PasswordField({ className, value, onChange, ...props }: PasswordFieldProps) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-sm text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-foreground cursor-pointer"
        title={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}

export function scorePassword(p: string): number {
  if (!p) return 0
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/[0-9]/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.min(s, 4)
}

export function PasswordMeter({ score }: { score: number }) {
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const tones = [
    'bg-border',
    'bg-destructive',
    'bg-warn',
    'bg-primary',
    'bg-success',
  ] as const
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-[background-color]',
              i < score ? tones[score] : 'bg-[var(--bg-2)]',
            )}
          />
        ))}
      </div>
      {score > 0 && (
        <div
          className={cn(
            'mt-1.5 text-xs',
            score === 1 && 'text-destructive',
            score === 2 && 'text-warn',
            score === 3 && 'text-primary',
            score === 4 && 'text-success',
          )}
        >
          {labels[score]} password
        </div>
      )}
    </div>
  )
}

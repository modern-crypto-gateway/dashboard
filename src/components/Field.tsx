import * as React from 'react'
import { Label } from './ui/label'

interface FieldProps {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
}

export function Field({ label, htmlFor, hint, error, right, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {right}
      </div>
      {children}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {hint && !error && <div className="text-xs text-[var(--fg-2)]">{hint}</div>}
    </div>
  )
}

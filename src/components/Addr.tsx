import { CopyButton } from './CopyButton'

const truncate = (s: string, a = 6, b = 4) =>
  s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s

export function Addr({ value, truncated = true }: { value: string; truncated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[12.5px]">{truncated ? truncate(value) : value}</span>
      <CopyButton value={value} />
    </span>
  )
}

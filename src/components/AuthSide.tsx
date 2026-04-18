import { Logo } from './Logo'

export function AuthSide({
  mode,
}: {
  mode: 'login' | 'setup'
}) {
  return (
    <div className="relative hidden overflow-hidden border-r border-border bg-card md:flex md:flex-col md:justify-between md:p-10">
      {/* grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          WebkitMaskImage:
            'radial-gradient(ellipse at 70% 30%, #000 0%, transparent 65%)',
          maskImage:
            'radial-gradient(ellipse at 70% 30%, #000 0%, transparent 65%)',
        }}
      />
      <div className="relative z-10">
        <Logo />
      </div>
      <div className="relative z-10 max-w-md">
        <div className="eyebrow mb-3.5">
          {mode === 'setup' ? 'First-time setup' : 'Operator console'}
        </div>
        <h2 className="text-[28px] leading-tight font-semibold tracking-tight">
          {mode === 'setup'
            ? 'Bring your gateway online.'
            : 'Monitor pools, balances, and every tx across chains.'}
        </h2>
        <p className="mt-3 max-w-sm text-sm text-[var(--fg-2)]">
          {mode === 'setup'
            ? 'Four quick steps — point at the gateway, verify the admin key, create the operator account, and bind an authenticator.'
            : 'Runtime-agnostic crypto payment gateway with pluggable EVM, Tron and Solana adapters.'}
        </p>
        <div className="mt-8 grid grid-cols-3 gap-2.5">
          {(['EVM', 'Tron', 'Solana'] as const).map((f) => (
            <div
              key={f}
              className="rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="font-mono text-[11px] text-[var(--fg-2)]">family</div>
              <div className="mt-0.5 text-[13px] font-semibold">{f}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-10 flex gap-4 text-xs text-[var(--fg-2)]">
        <span className="font-mono">v1.0.0</span>
        <span>·</span>
        <span>secure by default</span>
        <span>·</span>
        <span className="font-mono">cloudflare</span>
      </div>
    </div>
  )
}

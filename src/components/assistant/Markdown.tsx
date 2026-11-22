import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { parseEntityHref, type EntityRef } from '@/lib/assistant'
import { EntityContext } from '@/lib/assistantUi'
import { cn } from '@/lib/utils'
import { Check, Copy, ExternalLink, LayoutDashboard, Receipt, Send, Storefront } from '@/components/icons'

/**
 * The assistant's Markdown. react-markdown never renders raw HTML, and links
 * are limited to `gw:` record links (opened inside the dashboard) and plain
 * http(s) links (shown with their domain, opened in a new tab). Anything else
 * the model writes as a link renders as text.
 */


function safeUrl(url: string): string {
  if (url.startsWith('gw:')) return url
  if (/^https?:\/\//i.test(url)) return url
  return ''
}

function EntityChip({ entity, children }: { entity: EntityRef; children: React.ReactNode }) {
  const open = React.useContext(EntityContext)
  const Icon =
    entity.type === 'invoice' ? Receipt : entity.type === 'payout' ? Send : entity.type === 'store' ? Storefront : LayoutDashboard
  const kind =
    entity.type === 'invoice' ? 'Open invoice' : entity.type === 'payout' ? 'Open payout' : entity.type === 'store' ? 'Open store' : 'Go to page'
  return (
    <button
      type="button"
      onClick={() => open(entity)}
      title={kind}
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-1.5 py-px align-baseline text-[0.92em] font-medium text-[var(--accent-ink)] transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="size-3 shrink-0" weight="bold" />
      <span className="truncate">{children}</span>
    </button>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLPreElement>(null)
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="group/code relative">
      <pre
        ref={ref}
        className="overflow-x-auto rounded-lg border border-border bg-[var(--bg-0)] p-3 font-mono text-[12px] leading-relaxed"
      >
        {children}
      </pre>
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          void navigator.clipboard?.writeText(ref.current?.innerText ?? '')
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }}
        className="absolute top-1.5 right-1.5 rounded-md border border-border bg-card p-1 text-[var(--fg-2)] opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="pt-1 text-[15px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h2: ({ children }) => <h3 className="pt-1 text-[14px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h3: ({ children }) => <h4 className="pt-1 text-[13px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="pt-1 text-[13px] font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-[var(--fg-3)]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-[var(--fg-3)]">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 text-[var(--fg-2)]">{children}</blockquote>
  ),
  hr: () => <hr className="my-1 border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12.5px] tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--bg-0)] text-left">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-[11px] font-medium tracking-wide whitespace-nowrap text-[var(--fg-2)] uppercase">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-t border-border px-3 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-[var(--muted-bg)] px-1 py-px font-mono text-[0.86em] break-all">{children}</code>
    ),
  a: ({ href, children }) => {
    const url = href ?? ''
    const entity = parseEntityHref(url)
    if (entity) return <EntityChip entity={entity}>{children}</EntityChip>
    if (/^https?:\/\//i.test(url)) {
      let host = url
      try {
        host = new URL(url).host
      } catch {
        /* keep raw */
      }
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={url}
          className="inline-flex items-baseline gap-0.5 text-[var(--accent-ink)] underline decoration-[var(--accent-border)] underline-offset-2 hover:decoration-current"
        >
          {children}
          <span className="text-[0.8em] text-[var(--fg-3)] no-underline">({host})</span>
          <ExternalLink className="size-3 self-center" />
        </a>
      )
    }
    return <span>{children}</span>
  },
  img: ({ alt }) => <span className="text-[var(--fg-3)]">[{alt || 'image'}]</span>,
}

export function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-2.5 text-[13.5px] break-words text-[var(--fg-1)]',
        streaming && 'ai-streaming',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

import * as React from 'react'

import type { AssistantImage } from '@/lib/assistant'
import type { Attachment } from '@/lib/imageAttach'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Loader2, X } from '@/components/icons'

function srcOf(img: AssistantImage, conversationId: string | null): string | null {
  if (img.src) return img.src
  return conversationId
    ? `/api/assistant/conversations/${encodeURIComponent(conversationId)}/images/${encodeURIComponent(img.id)}`
    : null
}

/** Images in the operator's message; click one to see it full size. */
export function UserImages({ images, conversationId }: { images: AssistantImage[]; conversationId: string | null }) {
  const [open, setOpen] = React.useState<string | null>(null)
  const single = images.length === 1
  return (
    <>
      <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
        {images.map((img) => {
          const src = srcOf(img, conversationId)
          if (!src) return null
          return (
            <button
              key={img.id}
              type="button"
              onClick={() => setOpen(src)}
              aria-label="View image"
              className="overflow-hidden rounded-xl border border-border bg-[var(--bg-0)] shadow-[var(--shadow-sm)] transition-opacity hover:opacity-90"
            >
              <img
                src={src}
                alt="Attached image"
                loading="lazy"
                width={img.width}
                height={img.height}
                className={cn('block object-cover', single ? 'h-auto max-h-56 w-auto max-w-[260px]' : 'size-24')}
              />
            </button>
          )
        })}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="w-auto max-w-[min(94vw,1200px)] p-2 sm:max-w-[min(94vw,1200px)]">
          <DialogTitle className="sr-only">Attached image</DialogTitle>
          {open && <img src={open} alt="Attached image" className="mx-auto block max-h-[85vh] w-auto rounded-lg" />}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Images waiting to be sent, above the message box. */
export function AttachmentTray({
  attachments,
  preparing,
  onRemove,
}: {
  attachments: Attachment[]
  preparing: number
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0 && preparing === 0) return null
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.map((a) => (
        <div key={a.id} className="group relative animate-in duration-200 fade-in-0 zoom-in-95">
          <img
            src={a.dataUrl}
            alt={a.name}
            title={`${a.name} · ${a.width}×${a.height}`}
            className="size-14 rounded-lg border border-border object-cover shadow-[var(--shadow-sm)]"
          />
          <button
            type="button"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
            className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-border bg-card text-[var(--fg-2)] shadow-[var(--shadow-sm)] hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {Array.from({ length: preparing }, (_, i) => (
        <div key={`p${i}`} className="grid size-14 place-items-center rounded-lg border border-dashed border-border bg-[var(--bg-0)]">
          <Loader2 className="size-4 animate-spin text-[var(--fg-2)]" />
        </div>
      ))}
    </div>
  )
}

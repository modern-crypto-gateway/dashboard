import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/lib/theme'
import { CheckCircle2, Info, Loader2, OctagonAlert, AlertTriangle } from '@/components/icons'

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      gap={10}
      icons={{
        success: <CheckCircle2 weight="fill" className="size-5 text-[var(--st-ok-dot)]" />,
        error: <OctagonAlert weight="fill" className="size-5 text-[var(--st-bad-dot)]" />,
        warning: <AlertTriangle weight="fill" className="size-5 text-[var(--st-warn-dot)]" />,
        info: <Info weight="fill" className="size-5 text-[var(--st-info-dot)]" />,
        loading: <Loader2 className="size-5 animate-spin text-[var(--fg-2)]" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            '!rounded-2xl !border-border !bg-[var(--bg-1)] !text-foreground !shadow-[var(--shadow-md)] !px-4 !py-3.5 !gap-3 font-sans',
          title: '!text-sm !font-semibold',
          description: '!text-sm !text-[var(--fg-2)]',
          actionButton: '!rounded-lg !bg-primary !text-primary-foreground',
          cancelButton: '!rounded-lg',
        },
      }}
      {...props}
    />
  )
}

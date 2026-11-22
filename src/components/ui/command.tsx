import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from './dialog'

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md',
      className,
    )}
    {...props}
  />
))
Command.displayName = 'Command'

export function CommandDialog({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18vh] max-w-[580px] translate-y-0 gap-0 overflow-hidden rounded-[20px] p-0 shadow-lg [&>button[aria-label=Close]]:hidden">
        <Command className="[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:normal-case [&_[cmdk-group-heading]]:tracking-normal [&_[cmdk-group-heading]]:text-[var(--fg-3)] [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[var(--fg-2)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-3 border-b border-border px-5" cmdk-input-wrapper="">
    <Search className="size-5 shrink-0 text-[var(--fg-3)]" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-14 w-full bg-transparent py-3 text-base outline-none focus-visible:outline-none placeholder:text-[var(--fg-3)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
))
CommandInput.displayName = 'CommandInput'

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-[min(420px,60vh)] overflow-y-auto overflow-x-hidden px-2 pb-2 scroll-py-2', className)}
    {...props}
  />
))
CommandList.displayName = 'CommandList'

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm text-[var(--fg-2)]" {...props} />
))
CommandEmpty.displayName = 'CommandEmpty'

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn('overflow-hidden p-1 text-foreground', className)}
    {...props}
  />
))
CommandGroup.displayName = 'CommandGroup'

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-sm outline-none transition-colors',
      'data-[selected=true]:bg-[var(--bg-hover)] data-[selected=true]:text-foreground',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      '[&_.go]:opacity-0 data-[selected=true]:[&_.go]:opacity-70',
      '[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-[var(--fg-2)] data-[selected=true]:[&_svg]:text-foreground',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = 'CommandItem'

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('bg-border -mx-1 h-px', className)}
    {...props}
  />
))
CommandSeparator.displayName = 'CommandSeparator'

export const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn('ml-auto text-2xs tracking-widest text-[var(--fg-3)]', className)}
    {...props}
  />
)

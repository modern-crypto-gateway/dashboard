import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import {
  applyEvent,
  assistantStateQuery,
  conversationKey,
  postAssistant,
  streamAssistant,
  type AssistantConversation,
  type AssistantState,
} from '@/lib/assistant'
import { CHECKIN_AUTO_GRACE_MS, type CheckinApi } from '@/lib/assistantUi'

const BUSY_RETRY_MS = 15_000

/**
 * Runs the check-ins the assistant scheduled (schedule_check) when they are
 * due, from this browser tab, through the same signed-in, CSRF-checked
 * endpoint as any message. Lives in <Assistant>, which is mounted on every
 * signed-in page, so a check-in runs whether or not the panel is open. A
 * check-in missed while no tab was open is not run on its own once it is more
 * than half an hour late: the chat offers "Check now" instead.
 */
export function useCheckins({
  visibleChat,
  panelOpen,
  onOpenChat,
}: {
  /** The chat on screen, if the panel is open. */
  visibleChat: string | null
  panelOpen: boolean
  onOpenChat: (id: string) => void
}) {
  const qc = useQueryClient()
  const state = useQuery({
    ...assistantStateQuery,
    // Pick up check-ins scheduled from another tab.
    refetchInterval: (q) => (q.state.data?.conversations.some((c) => c.wakeAt) ? 30_000 : false),
  })
  const [running, setRunning] = React.useState<string[]>([])
  const [unseen, setUnseen] = React.useState(false)
  const [tick, setTick] = React.useState(0)
  const inFlight = React.useRef(new Set<string>())
  const seen = React.useRef({ visibleChat, panelOpen, onOpenChat })
  React.useEffect(() => {
    seen.current = { visibleChat, panelOpen, onOpenChat }
  }, [visibleChat, panelOpen, onOpenChat])

  const run = React.useCallback(
    async (cid: string, wid: string, auto: boolean) => {
      if (inFlight.current.has(wid)) return
      inFlight.current.add(wid)
      setRunning((r) => [...r, cid])
      try {
        await streamAssistant('wake', { conversationId: cid, wakeupId: wid }, (ev) => {
          if (ev.t === 'start') return
          if (ev.t === 'error') {
            toast.error(ev.message)
            return
          }
          qc.setQueryData<AssistantConversation>(conversationKey(cid), (old) =>
            ev.t === 'done' ? ev.conversation : old ? applyEvent(old, ev) : old,
          )
        })
        const v = seen.current
        if (!v.panelOpen) setUnseen(true)
        if (v.visibleChat !== cid) {
          const title = qc
            .getQueryData<AssistantState>(assistantStateQuery.queryKey)
            ?.conversations.find((c) => c.id === cid)?.title
          toast('The assistant checked back in', {
            description: title,
            action: { label: 'Open', onClick: () => seen.current.onOpenChat(cid) },
          })
        }
      } catch (e) {
        const code = e instanceof ApiError ? e.code : undefined
        if (code === 'AI_BUSY') {
          // A turn is running in that chat: try again shortly.
          window.setTimeout(() => setTick((t) => t + 1), BUSY_RETRY_MS)
          if (!auto) toast('The assistant is busy; the check-in will run right after.')
        } else if (code === 'AI_PENDING' || code === 'AI_NO_WAKEUP') {
          if (!auto) toast(e instanceof ApiError ? e.message : 'The check-in cannot run now')
        } else if (!auto || code !== 'AI_NOT_CONFIGURED') {
          toast.error(e instanceof ApiError ? e.message : 'The check-in could not run')
        }
      } finally {
        inFlight.current.delete(wid)
        setRunning((r) => {
          const i = r.indexOf(cid)
          return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)]
        })
        void qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
        void qc.invalidateQueries({ queryKey: conversationKey(cid) })
      }
    },
    [qc],
  )

  // One timer per due check-in. Chats waiting for an approval or an answer
  // are skipped; they are picked up again once that is settled.
  const configured = state.data?.config.configured ?? false
  const key = configured
    ? (state.data?.conversations ?? [])
        .filter((c) => c.wakeAt && c.wakeId && !c.pending)
        .map((c) => `${c.id}|${c.wakeId}|${c.wakeAt}`)
        .join(',')
    : ''
  React.useEffect(() => {
    if (!key) return
    const timers = key.split(',').flatMap((entry) => {
      const [cid, wid, at] = entry.split('|')
      const delay = Number(at) - Date.now()
      if (delay < -CHECKIN_AUTO_GRACE_MS) return []
      return [window.setTimeout(() => void run(cid, wid, true), Math.max(0, delay) + 400)]
    })
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [key, tick, run])

  const api = React.useMemo<CheckinApi>(
    () => ({
      run: (cid, wid) => run(cid, wid, false),
      cancel: async (cid, wid) => {
        try {
          const r = await postAssistant<{ conversation: AssistantConversation }>('wake/cancel', {
            conversationId: cid,
            wakeupId: wid,
          })
          qc.setQueryData(conversationKey(cid), r.conversation)
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : 'Could not cancel the check-in')
        } finally {
          void qc.invalidateQueries({ queryKey: assistantStateQuery.queryKey })
        }
      },
    }),
    [qc, run],
  )

  return { api, running, unseen, clearUnseen: () => setUnseen(false) }
}

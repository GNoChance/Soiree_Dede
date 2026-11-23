import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Réactions emoji en direct : broadcast Realtime éphémère `reactions:<matchId>` (aucune BDD). */
export const REACTION_EMOJIS = ['👏', '😂', '😱', '🔥', '😍', '💀'] as const

export interface ReactionPayload {
  e: string
  p: string
}

type Listener = (r: ReactionPayload) => void

interface Entry {
  channel: RealtimeChannel
  listeners: Set<Listener>
  refs: number
  joined: boolean
  removeTimer: number | null
}

const entries = new Map<string, Entry>()

function acquire(matchId: string): Entry {
  const e = entries.get(matchId)
  if (e) {
    e.refs++
    if (e.removeTimer != null) {
      clearTimeout(e.removeTimer)
      e.removeTimer = null
    }
    return e
  }
  const channel = supabase.channel(`reactions:${matchId}`, { config: { broadcast: { self: false, ack: false } } })
  const entry: Entry = { channel, listeners: new Set(), refs: 1, joined: false, removeTimer: null }
  channel.on('broadcast', { event: 'r' }, (msg: { payload?: unknown }) => {
    const p = msg.payload as Partial<ReactionPayload> | undefined
    if (!p || typeof p.e !== 'string' || typeof p.p !== 'string') return
    if (!(REACTION_EMOJIS as readonly string[]).includes(p.e)) return
    const r = { e: p.e, p: p.p.slice(0, 64) }
    entry.listeners.forEach((l) => l(r))
  })
  channel.subscribe((status) => {
    entry.joined = status === 'SUBSCRIBED'
  })
  entries.set(matchId, entry)
  return entry
}

function release(matchId: string) {
  const e = entries.get(matchId)
  if (!e) return
  e.refs--
  if (e.refs > 0) return
  e.removeTimer = window.setTimeout(() => {
    entries.delete(matchId)
    void supabase.removeChannel(e.channel)
  }, 1500)
}

/** Écoute les réactions des autres ; renvoie `send` (émission seule, sans écho local). */
export function useReactionChannel(matchId: string, onReaction: Listener) {
  const ref = useRef(onReaction)
  useEffect(() => {
    ref.current = onReaction
  })
  useEffect(() => {
    const e = acquire(matchId)
    const l: Listener = (r) => ref.current(r)
    e.listeners.add(l)
    return () => {
      e.listeners.delete(l)
      release(matchId)
    }
  }, [matchId])
  return useCallback(
    (r: ReactionPayload) => {
      const e = entries.get(matchId)
      if (e?.joined) void e.channel.send({ type: 'broadcast', event: 'r', payload: r })
    },
    [matchId],
  )
}

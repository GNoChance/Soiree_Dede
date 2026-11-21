import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { GolfMsg } from './types'

/**
 * Canal broadcast `golf:<matchId>` (éphémère, aucune BDD) : chaque téléphone y publie la position
 * de SA balle (~8 fois par seconde quand elle roule, puis à l'arrêt et à l'entrée dans le trou).
 * Compteur de références + suppression différée : `supabase.channel(topic)` renvoie le canal
 * existant pour un même topic (démontage/remontage rapide en StrictMode).
 */
type Listener = (m: GolfMsg) => void

interface Entry {
  channel: RealtimeChannel
  listeners: Set<Listener>
  refs: number
  joined: boolean
  timer: number | null
}

const entries = new Map<string, Entry>()

const isMsg = (x: unknown): x is GolfMsg => {
  const m = x as GolfMsg | null
  return !!m && typeof m.id === 'string' && typeof m.h === 'number' && typeof m.x === 'number' && typeof m.z === 'number'
}

function acquire(matchId: string): Entry {
  const found = entries.get(matchId)
  if (found) {
    found.refs++
    if (found.timer != null) {
      clearTimeout(found.timer)
      found.timer = null
    }
    return found
  }
  const channel = supabase.channel(`golf:${matchId}`, { config: { broadcast: { self: false, ack: false } } })
  const e: Entry = { channel, listeners: new Set(), refs: 1, joined: false, timer: null }
  channel.on('broadcast', { event: 'b' }, (msg: { payload: unknown }) => {
    if (isMsg(msg.payload)) e.listeners.forEach((l) => l(msg.payload as GolfMsg))
  })
  channel.subscribe((status) => {
    e.joined = status === 'SUBSCRIBED'
  })
  entries.set(matchId, e)
  return e
}

function release(matchId: string) {
  const e = entries.get(matchId)
  if (!e) return
  if (--e.refs > 0) return
  e.timer = window.setTimeout(() => {
    entries.delete(matchId)
    void supabase.removeChannel(e.channel)
  }, 1500)
}

/** Branche le canal : `onMsg` reçoit les balles des autres ; renvoie `send(msg)`. */
export function useGolfNet(matchId: string, onMsg: Listener) {
  const on = useRef(onMsg)
  const entry = useRef<Entry | null>(null)
  useEffect(() => {
    on.current = onMsg
  })
  useEffect(() => {
    // Entraînement (« solo:… ») : aucun canal, rien n'est diffusé.
    if (matchId.startsWith('solo:')) return
    const e = acquire(matchId)
    entry.current = e
    const l: Listener = (m) => on.current(m)
    e.listeners.add(l)
    return () => {
      e.listeners.delete(l)
      entry.current = null
      release(matchId)
    }
  }, [matchId])
  return useCallback((m: GolfMsg) => {
    const e = entry.current
    if (e?.joined) void e.channel.send({ type: 'broadcast', event: 'b', payload: m })
  }, [])
}

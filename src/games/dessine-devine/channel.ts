import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { DrawEvent, DrawMessage } from './types'

/**
 * Canal Realtime **broadcast** `match:<matchId>` (éphémère, aucune BDD) partagé
 * par tous les composants de la partie. Compteur de références + suppression
 * différée : `supabase.channel(topic)` renvoie le canal existant pour un même
 * topic, ce qui casserait un démontage/remontage rapide (StrictMode, Suspense).
 *
 * Évènements : voir `DrawMessage` dans ./types.ts.
 */

const EVENTS: DrawEvent[] = ['pts', 'undo', 'clear', 'sync_request', 'sync', 'snapshot']

type Listener = (msg: DrawMessage) => void

interface Entry {
  channel: RealtimeChannel
  listeners: Set<Listener>
  onJoin: Set<() => void>
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
  const channel = supabase.channel(`match:${matchId}`, { config: { broadcast: { self: false, ack: false } } })
  const entry: Entry = { channel, listeners: new Set(), onJoin: new Set(), refs: 1, joined: false, removeTimer: null }
  for (const ev of EVENTS) {
    channel.on('broadcast', { event: ev }, (msg: { event: string; payload: unknown }) => {
      const m = { event: ev, payload: msg.payload } as DrawMessage
      entry.listeners.forEach((l) => l(m))
    })
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      entry.joined = true
      entry.onJoin.forEach((f) => f())
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      entry.joined = false
    }
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

export function sendDraw(matchId: string, msg: DrawMessage) {
  const e = entries.get(matchId)
  if (!e) return
  void e.channel.send({ type: 'broadcast', event: msg.event, payload: msg.payload })
}

/**
 * S'abonne au canal de dessin. `onMessage` reçoit chaque message ; `onJoin` est
 * rappelé à chaque (re)connexion (pour envoyer un `sync_request`).
 * Renvoie `send` et l'état de connexion.
 */
export function useDrawChannel(matchId: string, onMessage: Listener, onJoin?: () => void) {
  const msgRef = useRef(onMessage)
  const joinRef = useRef(onJoin)
  const [joined, setJoined] = useState(false)
  useEffect(() => {
    msgRef.current = onMessage
    joinRef.current = onJoin
  })
  useEffect(() => {
    const e = acquire(matchId)
    const l: Listener = (m) => msgRef.current(m)
    const j = () => {
      setJoined(true)
      joinRef.current?.()
    }
    e.listeners.add(l)
    e.onJoin.add(j)
    if (e.joined) queueMicrotask(j)
    return () => {
      e.listeners.delete(l)
      e.onJoin.delete(j)
      release(matchId)
    }
  }, [matchId])
  const send = useCallback((msg: DrawMessage) => sendDraw(matchId, msg), [matchId])
  return { joined, send }
}

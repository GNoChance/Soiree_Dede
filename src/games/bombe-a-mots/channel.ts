import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { BamBroadcast } from './types'

/**
 * Canal Realtime **broadcast** `match:<matchId>` (éphémère, aucune BDD) : saisie en
 * direct du joueur actif (`typing`, throttlée ~150 ms) et refus locaux (`reject`).
 * Compteur de références + suppression différée (StrictMode / Suspense : un même
 * topic renvoie le canal existant).
 */

type Listener = (msg: BamBroadcast) => void

interface Entry {
  channel: RealtimeChannel
  listeners: Set<Listener>
  refs: number
  removeTimer: number | null
}

const entries = new Map<string, Entry>()
const EVENTS: BamBroadcast['event'][] = ['typing', 'reject']

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
  const entry: Entry = { channel, listeners: new Set(), refs: 1, removeTimer: null }
  for (const ev of EVENTS) {
    channel.on('broadcast', { event: ev }, (msg: { event: string; payload: unknown }) => {
      const m = { event: ev, payload: msg.payload } as BamBroadcast
      entry.listeners.forEach((l) => l(m))
    })
  }
  channel.subscribe()
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

/** S'abonne au canal de la partie ; renvoie `send`. */
export function useBombeChannel(matchId: string, onMessage: Listener) {
  const msgRef = useRef(onMessage)
  useEffect(() => {
    msgRef.current = onMessage
  })
  useEffect(() => {
    const e = acquire(matchId)
    const l: Listener = (m) => msgRef.current(m)
    e.listeners.add(l)
    return () => {
      e.listeners.delete(l)
      release(matchId)
    }
  }, [matchId])
  return useCallback((msg: BamBroadcast) => {
    const e = entries.get(matchId)
    if (e) void e.channel.send({ type: 'broadcast', event: msg.event, payload: msg.payload })
  }, [matchId])
}

/** Envoi throttlé (premier envoi immédiat, puis au plus un toutes les `ms`, dernier état garanti). */
export function useThrottled<T>(fn: (v: T) => void, ms = 150) {
  const last = useRef(0)
  const timer = useRef<number | null>(null)
  const pending = useRef<{ v: T } | null>(null)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => () => {
    if (timer.current != null) clearTimeout(timer.current)
  }, [])
  return useCallback(
    (v: T) => {
      const now = Date.now()
      const wait = last.current + ms - now
      if (wait <= 0) {
        last.current = now
        fnRef.current(v)
        return
      }
      pending.current = { v }
      if (timer.current == null) {
        timer.current = window.setTimeout(() => {
          timer.current = null
          last.current = Date.now()
          if (pending.current) fnRef.current(pending.current.v)
          pending.current = null
        }, wait)
      }
    },
    [ms],
  )
}

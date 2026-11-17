import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { KartSnap } from './engine/Game'

/**
 * Canal broadcast `kart:<matchId>` (éphémère, aucune BDD) : chaque téléphone y publie
 * l'état de ses karts (le sien + les bots pour l'hôte), environ 8 fois par seconde.
 * Compteur de références + suppression différée : `supabase.channel(topic)` renvoie le
 * canal existant pour un même topic (démontage/remontage rapide en StrictMode).
 */
type Listener = (snaps: KartSnap[]) => void

interface Entry {
  channel: RealtimeChannel
  listeners: Set<Listener>
  refs: number
  joined: boolean
  timer: number | null
}

const entries = new Map<string, Entry>()

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
  const channel = supabase.channel(`kart:${matchId}`, { config: { broadcast: { self: false, ack: false } } })
  const e: Entry = { channel, listeners: new Set(), refs: 1, joined: false, timer: null }
  channel.on('broadcast', { event: 'k' }, (msg: { payload: unknown }) => {
    const snaps = (msg.payload as { k?: KartSnap[] } | null)?.k
    if (Array.isArray(snaps)) e.listeners.forEach((l) => l(snaps))
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

/**
 * Branche le réseau : reçoit les karts des autres (`onSnaps`) et publie `getSnaps()`
 * toutes les `periodMs` (rien n'est envoyé si `getSnaps` renvoie une liste vide).
 */
export function useKartNet(matchId: string, periodMs: number, getSnaps: () => KartSnap[], onSnaps: Listener) {
  const get = useRef(getSnaps)
  const on = useRef(onSnaps)
  useEffect(() => {
    get.current = getSnaps
    on.current = onSnaps
  })
  useEffect(() => {
    const e = acquire(matchId)
    const l: Listener = (s) => on.current(s)
    e.listeners.add(l)
    const id = window.setInterval(() => {
      if (!e.joined) return
      const k = get.current()
      if (k.length) void e.channel.send({ type: 'broadcast', event: 'k', payload: { k } })
    }, periodMs)
    return () => {
      clearInterval(id)
      e.listeners.delete(l)
      release(matchId)
    }
  }, [matchId, periodMs])
}

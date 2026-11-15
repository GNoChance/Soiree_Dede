import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Décalage (ms) entre l'horloge serveur et celle du téléphone, mesuré une fois
 * par session via rpc('server_now') (compensé de la moitié du temps aller-retour).
 * serverNow() = Date.now() + offset. À utiliser pour tous les comptes à rebours
 * basés sur une échéance ISO du state ("deadline").
 */
let offsetMs = 0
let measured: Promise<number> | null = null

function measure(): Promise<number> {
  if (!measured) {
    measured = (async () => {
      const t0 = Date.now()
      const { data, error } = await supabase.rpc('server_now' as never)
      const t1 = Date.now()
      if (!error && typeof data === 'string') {
        offsetMs = new Date(data).getTime() - (t0 + t1) / 2
      }
      return offsetMs
    })().catch(() => offsetMs)
  }
  return measured
}

export const serverNow = (): number => Date.now() + offsetMs

/** Millisecondes restantes avant `deadline` (ISO), rafraîchi toutes les `intervalMs`. */
export function useCountdown(deadline: string | null | undefined, intervalMs = 250): number {
  const [left, setLeft] = useState(() => (deadline ? new Date(deadline).getTime() - serverNow() : 0))
  useEffect(() => {
    void measure()
    if (!deadline) return
    const end = new Date(deadline).getTime()
    const tick = () => setLeft(Math.max(0, end - serverNow()))
    tick()
    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }, [deadline, intervalMs])
  return Math.max(0, left)
}

export function useServerClock(): () => number {
  useEffect(() => { void measure() }, [])
  return serverNow
}

import { useEffect, useState } from 'react'
import { isGuestProfile } from '@/features/guest/api'
import { loose } from '@/features/soiree/hostTools'
import { useSession } from '@/store/session'

/** Gros Lot de la Grande Hotte, dernière édition (noel_gros_lot, supabase/features/noel.sql). */
export interface GrosLot {
  key: string
  year: number
  /** La bande a atteint le palier 5. */
  reached: boolean
  /** J'ai reçu le Gros Lot (au moins 400 ❄️ apportés) : thème secret du Réveillon. */
  mine: boolean
  total: number
  contributors: { profile_id: string; flakes: number }[]
}

let cache: { at: number; data: GrosLot } | null = null

/** Lu une fois par minute au plus (le calcul parcourt toute la bande). Invités : null. */
export function useGrosLot(enabled = true): GrosLot | null {
  const member = useSession((s) => Boolean(s.profile) && !isGuestProfile(s.profile))
  const [data, setData] = useState<GrosLot | null>(cache?.data ?? null)
  useEffect(() => {
    if (!enabled || !member) return
    if (cache && Date.now() - cache.at < 60_000) return
    let live = true
    void (async () => {
      const { data: d, error } = await loose.rpc('noel_gros_lot', {})
      if (error || !d || !live) return
      cache = { at: Date.now(), data: d as GrosLot }
      setData(cache.data)
    })()
    return () => {
      live = false
    }
  }, [enabled, member])
  return member ? data : null
}

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TrophyProgress } from '@/types/db'

/**
 * Le sticker de rang `slot` de la planche de la tenue portée (donc débloquée) est-il utilisable ?
 * Slot 1 (joie) et stickers bonus (slot > 12) : offerts avec la tenue ; slots 2..12 : trophée de ce slot obtenu
 * (`trophyId` = trophyForSlot(tenue, slot)?.id). Miroir de `_tenue_slot_ok` (supabase/features/trophees.sql),
 * qui reste l'autorité côté serveur.
 */
export function slotUnlocked(slot: number, trophyUnlocks: Record<string, string>, trophyId: string | undefined): boolean {
  if (slot < 1) return false
  if (slot === 1 || slot > 12) return true
  return Boolean(trophyId && trophyUnlocks[trophyId])
}

/** Progression (« x/y ») des trophées actifs d'une tenue, calculée côté serveur à la demande. */
export function useTrophyProgress(tenue: string | undefined, refreshKey = 0): TrophyProgress {
  const [state, setState] = useState<{ tenue: string; data: TrophyProgress } | null>(null)
  useEffect(() => {
    if (!tenue) return
    let off = false
    void supabase.rpc('my_trophy_progress', { p_tenue: tenue }).then(({ data, error }) => {
      if (!off && !error && data) setState({ tenue, data })
    })
    return () => {
      off = true
    }
  }, [tenue, refreshKey])
  return tenue && state?.tenue === tenue ? state.data : {}
}

/** Trophées obtenus par un joueur (lecture publique, RLS) : {trophy_id: date ISO}. */
export function useProfileTrophies(profileId: string | undefined): Record<string, string> {
  const [state, setState] = useState<{ id: string; data: Record<string, string> } | null>(null)
  useEffect(() => {
    if (!profileId) return
    let off = false
    void supabase
      .from('trophy_unlocks')
      .select('trophy_id, unlocked_at')
      .eq('profile_id', profileId)
      .then(({ data, error }) => {
        if (off || error) return
        const map: Record<string, string> = {}
        for (const r of data ?? []) map[r.trophy_id] = r.unlocked_at
        setState({ id: profileId, data: map })
      })
    return () => {
      off = true
    }
  }, [profileId])
  return profileId && state?.id === profileId ? state.data : {}
}

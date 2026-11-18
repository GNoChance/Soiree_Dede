import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Outils de l'hôte (supabase/features/soiree-hote.sql) : exclusion / ré-invitation
 * et roue des jeux. Ces RPC / tables ne sont pas (encore) dans src/types/db.ts :
 * on passe par un client non typé.
 */
interface LooseError {
  message: string
  code?: string
  details?: string
}
interface LooseClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: LooseError | null }>
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => PromiseLike<{ data: unknown; error: LooseError | null }>
    }
  }
  channel: typeof supabase.channel
  removeChannel: typeof supabase.removeChannel
}
export const loose = supabase as unknown as LooseClient

export const kickPlayer = (soireeId: string, profileId: string) =>
  loose.rpc('kick_soiree_player', { p_soiree_id: soireeId, p_profile_id: profileId })

export const invitePlayer = (soireeId: string, profileId: string) =>
  loose.rpc('invite_to_soiree', { p_soiree_id: soireeId, p_profile_id: profileId })

/** Joueurs exclus de la soirée (visible par l'hôte seulement, RLS). */
export function useBannedPlayers(soireeId: string, enabled: boolean) {
  const [ids, setIds] = useState<string[]>([])
  const refetch = useCallback(async () => {
    if (!enabled) return
    const { data, error } = await loose.from('soiree_bans').select('profile_id').eq('soiree_id', soireeId)
    if (error || !Array.isArray(data)) return // table absente (serveur pas à jour) : liste vide
    setIds((data as Array<{ profile_id: string }>).map((r) => r.profile_id))
  }, [soireeId, enabled])
  useEffect(() => {
    void refetch()
  }, [refetch])
  return { bannedIds: enabled ? ids : [], refetchBans: refetch }
}

/* ------------------------------ Roue des jeux ------------------------------ */

export interface WheelSpin {
  id: number
  game_ids: string[]
  result: string
}

export const spinWheel = async (soireeId: string, gameIds: string[]) => {
  const { data, error } = await loose.rpc('spin_game_wheel', { p_soiree_id: soireeId, p_game_ids: gameIds })
  return { spin: error ? null : (data as WheelSpin), error }
}

let seq = 0
/** Reçoit en direct chaque tirage de la roue de la soirée (INSERT Realtime). */
export function useWheelSpins(soireeId: string, onSpin: (s: WheelSpin) => void) {
  const cb = useRef(onSpin)
  useEffect(() => {
    cb.current = onSpin
  })
  useEffect(() => {
    const ch = loose
      .channel(`wheel:${soireeId}:${Date.now().toString(36)}:${++seq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soiree_wheel_spins', filter: `soiree_id=eq.${soireeId}` }, (p) => {
        const r = p.new as { id?: number; game_ids?: string[]; result?: string }
        if (typeof r.id === 'number' && Array.isArray(r.game_ids) && r.result) cb.current({ id: r.id, game_ids: r.game_ids, result: r.result })
      })
    ch.subscribe()
    return () => {
      void loose.removeChannel(ch)
    }
  }, [soireeId])
}

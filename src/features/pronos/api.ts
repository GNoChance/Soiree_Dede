import { useCallback, useEffect, useRef, useState } from 'react'
import { toastError } from '@/features/soiree/errors'
import { useResync } from '@/features/soiree/hooks'
import { loose } from '@/features/soiree/hostTools'
import type { DevinRow, MatchPronos, PronosState } from './types'

/* Appels RPC (supabase/features/pronos.sql). Chacun renvoie { error } comme spinWheel. */

export const openPronos = (soireeId: string, gameId: string, playerIds: string[]) =>
  loose.rpc('open_pronos', { p_soiree_id: soireeId, p_game_id: gameId, p_player_ids: playerIds })

export const closePronos = (soireeId: string) => loose.rpc('close_pronos', { p_soiree_id: soireeId })

export const setProno = (soireeId: string, pick: string) => loose.rpc('set_prono', { p_soiree_id: soireeId, p_pick: pick })

export async function fetchMatchPronos(matchId: string): Promise<MatchPronos | null> {
  const { data, error } = await loose.rpc('match_pronos', { p_match_id: matchId })
  return error ? null : ((data as MatchPronos | null) ?? null)
}

let seq = 0
const EMPTY: PronosState = { round: null, my_pick: null }

/**
 * Manche de pronostics de la soirée + mon pari, en temps réel (UPDATE/INSERT/DELETE de
 * soiree_prono_rounds : `bets` change à chaque pari). `pick` est optimiste ; les appels sont
 * sérialisés pour que, sur deux taps rapides, le dernier gagne.
 */
export function usePronos(soireeId: string | undefined) {
  const [state, setState] = useState<PronosState>(EMPTY)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const refetch = useCallback(async () => {
    if (!soireeId) return
    const { data, error } = await loose.rpc('get_pronos', { p_soiree_id: soireeId })
    if (!error && data) setState(data as PronosState)
  }, [soireeId])

  useEffect(() => {
    setState(EMPTY)
    void refetch()
  }, [refetch])
  useResync(() => void refetch())

  useEffect(() => {
    if (!soireeId) return
    const ch = loose
      .channel(`pronos:${soireeId}:${Date.now().toString(36)}:${++seq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soiree_prono_rounds', filter: `soiree_id=eq.${soireeId}` }, () => void refetch())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'soiree_prono_rounds', filter: `soiree_id=eq.${soireeId}` }, () => void refetch())
      // Les DELETE ne sont pas filtrables côté Realtime (fermeture / lancement) : on relit à chaque suppression.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'soiree_prono_rounds' }, () => void refetch())
    ch.subscribe()
    return () => {
      void loose.removeChannel(ch)
    }
  }, [soireeId, refetch])

  const pick = useCallback(
    async (id: string) => {
      if (!soireeId) return
      const prev = stateRef.current.my_pick
      setState((s) => ({ ...s, my_pick: id }))
      chain.current = chain.current.then(async () => {
        const { error } = await setProno(soireeId, id)
        if (error) {
          setState((s) => ({ ...s, my_pick: prev }))
          toastError(error)
          void refetch()
        }
      })
      await chain.current
    },
    [soireeId, refetch],
  )

  return { state, pick, refetch }
}

/** Classement « Meilleur devin » de la soirée, relu quand une partie se termine. */
export function useDevinBoard(soireeId: string | undefined): DevinRow[] {
  const [rows, setRows] = useState<DevinRow[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!soireeId) return
    const ch = loose
      .channel(`devin:${soireeId}:${Date.now().toString(36)}:${++seq}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `soiree_id=eq.${soireeId}` }, (p) => {
        if ((p.new as { status?: string })?.status === 'finished') setTick((t) => t + 1)
      })
    ch.subscribe()
    return () => {
      void loose.removeChannel(ch)
    }
  }, [soireeId])
  useEffect(() => {
    if (!soireeId) return
    let alive = true
    void (async () => {
      const { data, error } = await loose.rpc('soiree_prono_board', { p_soiree_id: soireeId })
      if (alive && !error && Array.isArray(data)) setRows(data as DevinRow[])
    })()
    return () => {
      alive = false
    }
  }, [soireeId, tick])
  return rows
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'

/** Miroirs TS des RPC de `supabase/features/stats.sql` (non typées dans db.ts). */
export interface MiniProfile {
  profile_id: string
  slug: string
  nickname: string
  equipped_tenue: string
}
export interface StandingRow extends MiniProfile {
  points: number
  wins: number
  games: number
  rank: number
}
export interface SoireeStandings {
  soiree_id: string
  status: 'lobby' | 'active' | 'ended'
  games_played: number
  standings: StandingRow[]
  winner_ids: string[]
}
export interface HistoryItem {
  id: string
  host: { id: string; slug: string; nickname: string; equipped_tenue: string } | null
  started_at: string
  ended_at: string | null
  duration_min: number
  games_played: number
  players: MiniProfile[]
  winner: (MiniProfile & { points: number }) | null
}
export interface HistoryDetail {
  soiree_id: string
  status: string
  host: HistoryItem['host']
  started_at: string
  ended_at: string | null
  duration_min: number
  matches: Array<{ id: string; game_id: string; finished_at: string | null; players: number; winners: MiniProfile[] }>
  standings: StandingRow[]
  winner_ids: string[]
}
export interface ProfileStats {
  profile: { id: string; slug: string; nickname: string; equipped_tenue: string; xp: number; level: number }
  games_played: number
  wins: number
  win_rate: number
  soirees: number
  favorite_game: { game_id: string; played: number } | null
  best_game: { game_id: string; played: number; wins: number; win_rate: number } | null
  rival: (MiniProfile & { losses: number }) | null
  per_game: Array<{ game_id: string; played: number; wins: number }>
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export const fetchStandings = async (soireeId: string) => {
  const { data, error } = await rpc('soiree_standings', { p_soiree_id: soireeId })
  if (error) throw error
  return data as SoireeStandings
}

/** Charge une RPC, la rejoue au retour au premier plan et sur `deps`. `error` = erreur brute. */
function useRpc<T>(fn: string, args: Record<string, unknown> | null, extraRefresh?: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(args)
  const argsRef = useRef(args)
  argsRef.current = args
  const load = useCallback(async () => {
    const a = argsRef.current
    if (!a) return
    const { data: d, error: e } = await rpc(fn, a)
    if (e) setError(e)
    else {
      setError(null)
      setData(d as T)
    }
    setLoading(false)
  }, [fn])
  useEffect(() => {
    void load()
  }, [load, key, extraRefresh])
  useRefetchOnFocus(() => void load())
  return { data, error, loading, reload: load }
}

export const useMyHistory = () => useRpc<HistoryItem[]>('my_soirees_history', {})
export const useHistoryDetail = (id: string | undefined) => useRpc<HistoryDetail>('soiree_history_detail', id ? { p_soiree_id: id } : null)
export const useProfileStats = (id: string | undefined) => useRpc<ProfileStats>('profile_stats', id ? { p_profile_id: id } : null)

/**
 * Classement d'une soirée, rafraîchi en temps réel : une partie de la soirée
 * passe à `finished` (UPDATE matches filtré côté serveur) -> on relit.
 */
export function useSoireeStandings(soireeId: string | undefined) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!soireeId) return
    const ch = supabase
      .channel(`standings:${soireeId}:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `soiree_id=eq.${soireeId}` }, (p) => {
        if ((p.new as { status?: string })?.status === 'finished') setTick((t) => t + 1)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [soireeId])
  return useRpc<SoireeStandings>('soiree_standings', soireeId ? { p_soiree_id: soireeId } : null, tick)
}

export function gameLabel(id: string, getGame: (id: string) => { name: string; emoji: string } | undefined) {
  const g = getGame(id)
  return g ? `${g.emoji} ${g.name}` : id
}

export function fmtDuration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

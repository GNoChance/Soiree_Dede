import { supabase } from '@/lib/supabase'
import type { MiniProfile, StandingRow } from '@/features/stats/api'

/** Miroir TS de `soiree_recap` (supabase/features/recap.sql, non typée dans db.ts). */
export type AwardId = 'serie' | 'bluff' | 'deuxieme' | 'pasdebol' | 'bavard' | 'sticker'
export interface RecapAward {
  id: AwardId
  profile_id: string
  value: number
  extra: { as_undercover?: number; as_wolf?: number; expression?: string; total?: number; tenue?: string }
}
export interface SoireeRecap {
  version: number
  soiree_id: string
  has_chat: boolean
  started_at: string
  ended_at: string | null
  duration_min: number
  games_played: number
  distinct_games: number
  players_count: number
  players: MiniProfile[]
  games: Array<{ game_id: string; played: number }>
  top_game: { game_id: string; played: number } | null
  awards: RecapAward[]
  standings: StandingRow[]
  winner_ids: string[]
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function fetchRecap(soireeId: string): Promise<SoireeRecap> {
  const { data, error } = await rpc('soiree_recap', { p_soiree_id: soireeId })
  if (error) throw error
  return data as SoireeRecap
}

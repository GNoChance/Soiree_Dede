import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { MiniProfile, StandingRow } from '@/features/stats/api'
import type { RecapAward } from '@/features/recap/api'

/** Miroir TS de `album_year` (supabase/features/album.sql, non typée dans db.ts). */
export interface AlbumSoiree {
  soiree_id: string
  started_at: string
  ended_at: string | null
  duration_min: number
  host: (MiniProfile & { id: string }) | null
  games_played: number
  distinct_games: number
  players: MiniProfile[]
  games: Array<{ game_id: string; played: number }>
  awards: RecapAward[]
  matches: Array<{ game_id: string; finished_at: string | null; winners: MiniProfile[] }>
  standings: StandingRow[]
  winner_ids: string[]
  highlights: {
    margin: { profile_id: string; points: number; lead: number } | null
    trophies: Array<{ profile_id: string; name: string }>
    words: Array<{ profile_id: string; text: string; category: string; letter: string | null }>
    dilemma: { a: string; b: string; count_a: number; count_b: number } | null
  }
}
export interface AlbumYear {
  year: number
  soirees: AlbumSoiree[]
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function fetchAlbum(year: number): Promise<AlbumYear> {
  const { data, error } = await rpc('album_year', { p_year: year })
  if (error) throw error
  return data as AlbumYear
}

/** Année affichée : `?annee=AAAA` sinon l'année en cours (Paris). */
export function albumYearFrom(search: string): number {
  const q = new URLSearchParams(search).get('annee')
  if (q && /^\d{4}$/.test(q)) return Number(q)
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()))
}

export function useAlbum(year: number) {
  const [state, setState] = useState<{ year: number; data: AlbumYear | null; error: unknown }>({ year, data: null, error: null })
  useEffect(() => {
    let alive = true
    fetchAlbum(year).then(
      (data) => alive && setState({ year, data, error: null }),
      (error) => alive && setState({ year, data: null, error }),
    )
    return () => {
      alive = false
    }
  }, [year])
  const loading = state.year !== year || (state.data === null && state.error === null)
  return { data: state.year === year ? state.data : null, error: state.year === year ? state.error : null, loading }
}

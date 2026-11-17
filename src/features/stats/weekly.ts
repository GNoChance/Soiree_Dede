import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'

/** Miroirs TS des RPC de `supabase/features/weekly.sql` (non typées dans db.ts). */
export interface WeekRow {
  profile_id: string
  slug: string
  nickname: string
  equipped_expression: string
  equipped_tenue: string
  level: number
  wins: number
  games_played: number
  points: number
  rank: number
}
export interface WeekChampion {
  profile_id: string
  slug: string
  nickname: string
  equipped_tenue: string
}
export interface LeaderboardWeek {
  week_start: string
  week_end: string
  ends_at: string
  rows: WeekRow[]
  last_week: { week_start: string; week_end: string; wins: number; champions: WeekChampion[] } | null
}
export interface WeeklyWin extends WeekChampion {
  week_start: string
  week_end: string
  wins: number
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function fetchLeaderboardWeek(game: string | null) {
  const { data, error } = await rpc('leaderboard_week', { p_game: game })
  if (error) throw error
  return data as LeaderboardWeek
}

/** Semaines gagnées par un joueur (« Victorieux de la semaine »), récentes d'abord. */
export function useWeeklyWins(profileId: string | undefined) {
  const [data, setData] = useState<WeeklyWin[] | null>(null)
  const load = useCallback(async () => {
    if (!profileId) return
    const { data: d, error } = await rpc('weekly_champions', { p_profile: profileId })
    if (!error) setData(d as WeeklyWin[])
  }, [profileId])
  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())
  return data
}

const parse = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** « du 10 au 16 novembre 2026 » (ou « du 30 novembre au 6 décembre 2026 »). */
export function fmtWeek(start: string, end: string, withYear = true) {
  const a = parse(start)
  const b = parse(end)
  const month = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long' })
  const year = withYear ? ` ${b.getFullYear()}` : ''
  if (a.getMonth() === b.getMonth()) return `du ${a.getDate()} au ${b.getDate()} ${month(b)}${year}`
  return `du ${a.getDate()} ${month(a)} au ${b.getDate()} ${month(b)}${year}`
}

/** « 3 j 4 h » / « 5 h 12 » / « 12 min » avant la fin de semaine. */
export function fmtTimeLeft(endsAt: string, now = Date.now()) {
  const min = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${String(min % 60).padStart(2, '0')}`
  return `${min} min`
}

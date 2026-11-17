import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'

/** Miroirs TS des RPC de supabase/features/daily.sql (non typées dans db.ts). */
export type DailyStatus = 'todo' | 'running' | 'done' | 'missed'
export interface DailyToday {
  day: string
  status: DailyStatus
  score: number | null
  rank: number | null
  players: number
  streak: number
  secs_left: number | null
}
export interface DailySubmitResult {
  score: number
  xp: number
  rank?: number
  players?: number
  streak?: number
  expired?: boolean
}
export interface DailyRow {
  profile_id: string
  slug: string
  nickname: string
  equipped_tenue: string
  score: number
  rank: number
  streak: number
  days?: number
}
export interface DailyBoard { day: string; rows: DailyRow[] }
export interface DailyWeekBoard { week_start: string; rows: DailyRow[] }

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function startDaily() {
  const { data, error } = await rpc('start_daily')
  if (error) throw error
  return data as { day: string }
}
export async function submitDaily(answers: Array<{ points: number; ms: number }>) {
  const { data, error } = await rpc('submit_daily', { p_answers: answers })
  if (error) throw error
  return data as DailySubmitResult
}

export function useDailyRpc<T>(fn: string, version = 0) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const { data: d, error } = await rpc(fn)
    if (!error) setData(d as T)
    setLoading(false)
  }, [fn])
  useEffect(() => {
    void load()
  }, [load, version])
  useRefetchOnFocus(() => void load())
  return { data, loading, reload: load }
}
export const useDailyToday = (version = 0) => useDailyRpc<DailyToday>('daily_today', version)

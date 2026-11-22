import { supabase } from '@/lib/supabase'
import { useDailyRpc } from '@/features/daily/api'

/** Miroirs TS des RPC advent_* de supabase/features/daily.sql. */
export interface AdventState {
  today: string
  year: number
  /** Dates (YYYY-MM-DD) des cases ouvertes. */
  opened: string[]
  /** Dates (YYYY-MM-DD) des défis terminés du 1er au 24 décembre. */
  done: string[]
}
export interface AdventOpenResult {
  day: string
  xp: number
  new: boolean
  count: number
  trophy: boolean
  /** Cadeaux déco nouvellement obtenus (ids de src/data/cadeaux.ts). */
  gifts?: string[]
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function openAdventDay(day: string) {
  const { data, error } = await rpc('advent_open', { p_day: day })
  if (error) throw error
  return data as AdventOpenResult
}

export const useAdventState = (version = 0) => useDailyRpc<AdventState>('advent_state', version)

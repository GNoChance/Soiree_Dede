import { supabase } from '@/lib/supabase'
import type { MiniProfile } from '@/features/stats/api'

/** Miroir TS de `year_wrapped` (supabase/features/wrapped.sql, non typée dans db.ts). */
export type PersonalityId = 'noctambule' | 'champion' | 'assidu' | 'collectionneur' | 'sociable' | 'touche_a_tout' | 'fidele' | 'bon_joueur' | 'curieux'
export interface YearWrapped {
  year: number
  profile: MiniProfile & { id: string }
  games_played: number
  wins: number
  win_rate: number
  soirees: number
  distinct_games: number
  favorite_game: { game_id: string; played: number } | null
  best_game: { game_id: string; played: number; wins: number; win_rate: number } | null
  longest_soiree: { soiree_id: string; minutes: number; started_at: string; games: number } | null
  latest_match: { at: string; hour: number; game_id: string; day: string } | null
  night_games: number
  rival: (MiniProfile & { losses: number }) | null
  buddy: (MiniProfile & { together: number }) | null
  distinct_mates: number
  trophies: { count: number; recent: Array<{ id: string; name: string }> }
  tenues: { count: number; recent: Array<{ id: string; label: string; emoji: string }> }
  daily: { days: number; best_streak: number }
  personality: { id: PersonalityId }
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export async function fetchWrapped(year: number): Promise<YearWrapped> {
  const { data, error } = await rpc('year_wrapped', { p_year: year })
  if (error) throw error
  return data as YearWrapped
}

const FORCE_KEY = 'wrapped_force'

/** Date du jour à Paris (année, mois 1-12, jour). */
function parisDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** Forçage pour tester : ouvrir l'app avec `?wrapped=2026` (mémorisé), `?wrapped=off` pour l'enlever. */
function forcedYear(): number | null {
  try {
    const q = new URLSearchParams(window.location.search).get('wrapped')
    if (q === 'off' || q === '0') localStorage.removeItem(FORCE_KEY)
    else if (q && /^\d{4}$/.test(q)) localStorage.setItem(FORCE_KEY, q)
    const v = localStorage.getItem(FORCE_KEY)
    return v && /^\d{4}$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

/** Année à fêter si la bannière doit s'afficher (du 15 décembre au 31 janvier, heure de Paris), sinon null. */
export function wrappedBannerYear(now = new Date()): number | null {
  const forced = forcedYear()
  if (forced) return forced
  const { y, m, d } = parisDate(now)
  if (m === 12 && d >= 15) return y
  if (m === 1) return y - 1
  return null
}

/** Année du bouton permanent : celle de la bannière, sinon l'année en cours. */
export const wrappedButtonYear = (now = new Date()) => wrappedBannerYear(now) ?? parisDate(now).y

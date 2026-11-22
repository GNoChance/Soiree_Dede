import { supabase } from '@/lib/supabase'
import { GAMES } from '@/games/registry'
import type { ThemeId } from './themes'

/** Miroirs TS de supabase/features/reveillon.sql (colonne soirees.scenario + RPC, non typés dans db.ts). */
export type ScenarioPhase = 'draw' | 'playing' | 'challenge' | 'finished'

export interface ScenarioChallenge {
  id: string
  winner_id: string | null
  loser_id: string | null
  random_id: string | null
}

export interface ScenarioRound {
  round: number
  game_id: string
  match_id: string
  /** Points de la manche (barème de soirée, x2 à la dernière). */
  points: Record<string, number>
  wins: string[]
  double: boolean
  challenge: string | null
  /** Joueurs qui ont relevé le défi (+1 point chacun). */
  bravo: string[]
}

export interface Scenario {
  v: number
  theme: ThemeId
  rounds: number
  round: number
  phase: ScenarioPhase
  game_id: string
  /** Parts de la roue du dernier tirage. */
  pool?: string[]
  /** Compteur de tirages (anime la roue). */
  draw: number
  drawn_at?: string
  match_id: string | null
  challenge: ScenarioChallenge | null
  history: ScenarioRound[]
  started_at: string
  finished_at: string | null
  /** Refermé par l'hôte : salon normal (gardé pour le récap). */
  closed?: boolean
}

export const ROUND_CHOICES = [4, 6, 8] as const

/** Scénario EN COURS d'une ligne soirees (ou d'un SoireeJson) ; null si absent ou refermé. */
export function readScenario(row: unknown): Scenario | null {
  const sc = (row as { scenario?: unknown } | null | undefined)?.scenario as Scenario | null | undefined
  if (!sc || typeof sc !== 'object' || sc.closed || !Array.isArray(sc.history)) return null
  return sc
}

/** Jeux multijoueurs compatibles avec le nombre de joueurs du salon. */
export function compatibleGameIds(playerCount: number): string[] {
  if (playerCount < 2) return []
  return GAMES.filter((g) => playerCount >= Math.max(2, g.minPlayers) && playerCount <= g.maxPlayers).map((g) => g.id)
}

export interface ReveillonStanding {
  profile_id: string
  /** Points des manches + défis relevés. */
  total: number
  points: number
  wins: number
  stars: number
  rank: number
}

/** Classement spécial du scénario : points des manches + 1 par défi relevé ; puis victoires. */
export function reveillonStandings(sc: Pick<Scenario, 'history'>, extraIds: string[] = []): ReveillonStanding[] {
  const m = new Map<string, ReveillonStanding>()
  const get = (id: string) => {
    let r = m.get(id)
    if (!r) m.set(id, (r = { profile_id: id, total: 0, points: 0, wins: 0, stars: 0, rank: 0 }))
    return r
  }
  extraIds.forEach(get)
  for (const h of sc.history) {
    for (const [id, pts] of Object.entries(h.points ?? {})) get(id).points += Number(pts) || 0
    for (const id of h.wins ?? []) get(id).wins++
    for (const id of h.bravo ?? []) get(id).stars++
  }
  const rows = [...m.values()].map((r) => ({ ...r, total: r.points + r.stars }))
  rows.sort((a, b) => b.total - a.total || b.wins - a.wins)
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.rank = prev && prev.total === r.total && prev.wins === r.wins ? prev.rank : i + 1
  })
  return rows
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

export const startReveillon = (soireeId: string, theme: ThemeId, rounds: number, gameIds: string[], challengeIds: string[]) =>
  rpc('reveillon_start', { p_soiree_id: soireeId, p_theme: theme, p_rounds: rounds, p_game_ids: gameIds, p_challenge_ids: challengeIds })

export const rerollReveillon = (soireeId: string, gameIds: string[]) => rpc('reveillon_reroll', { p_soiree_id: soireeId, p_game_ids: gameIds })

export const launchReveillon = async (soireeId: string, options: Record<string, unknown>) => {
  const { data, error } = await rpc('reveillon_launch', { p_soiree_id: soireeId, p_options: options })
  return { matchId: error ? null : (data as string), error }
}

export const nextReveillon = (soireeId: string, bravo: string[], gameIds: string[]) =>
  rpc('reveillon_next', { p_soiree_id: soireeId, p_bravo: bravo, p_game_ids: gameIds })

export const stopReveillon = (soireeId: string) => rpc('reveillon_stop', { p_soiree_id: soireeId })

/** Scénario joué pendant une soirée (récap) ; null si aucun (ou serveur pas à jour). */
export async function fetchReveillonRecap(soireeId: string): Promise<Scenario | null> {
  const { data, error } = await rpc('reveillon_recap', { p_soiree_id: soireeId })
  if (error || !data || typeof data !== 'object') return null
  const sc = data as Scenario
  return Array.isArray(sc.history) && sc.history.length > 0 ? sc : null
}

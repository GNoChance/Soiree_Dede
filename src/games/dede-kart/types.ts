/**
 * Types de Dédé Kart (contrat : supabase/games/dede-kart.sql).
 * Phases : racing (go_at = feu vert) -> results (15 s) -> racing … -> finished.
 */
export type DkPhase = 'racing' | 'results' | 'finished' | 'aborted'

export interface DkPlace {
  /** profile_id ou 'botN' */
  id: string
  place: number
  pts: number
  /** ms depuis le feu vert, null si pas arrivé */
  time: number | null
  laps: number
}

export interface DkStanding {
  race: number
  track: number
  places: DkPlace[]
}

export interface DkState {
  game: 'dede-kart'
  phase: DkPhase
  players: string[]
  bots: string[]
  laps: number
  races: number
  race: number
  track: number
  go_at: string
  deadline: string | null
  laps_done: Record<string, number>
  finish: Record<string, number>
  arrival: string[]
  points: Record<string, number>
  standings: DkStanding[]
  forced?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
}

export interface DkOptions {
  races: 1 | 3
  laps: 2 | 3
  /** Compléter la grille avec des bots jusqu'à N karts (0 = pas de bots). */
  fill: 0 | 6 | 8 | 12
}

export const dkActions = {
  lap: (lap: number, bot?: string) => (bot ? { type: 'lap', lap, bot } : { type: 'lap', lap }),
  tick: () => ({ type: 'tick' }),
  next: () => ({ type: 'next' }),
  endGame: () => ({ type: 'end_game' }),
}

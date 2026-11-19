/**
 * Types de Dédé Kart (contrat : supabase/games/dede-kart.sql).
 * Phases : racing (go_at = feu vert) -> results (15 s) -> racing … -> finished.
 */
import type { Fx, Hazard, UsePayload } from './engine/items'

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
  /** Circuit de la course en cours (index de TRACKS) = (track0 + race - 1) % 6. */
  track: number
  track0?: number
  go_at: string
  deadline: string | null
  laps_done: Record<string, number>
  finish: Record<string, number>
  arrival: string[]
  points: Record<string, number>
  standings: DkStanding[]
  /** Boules, glue, beurre et poules en jeu. */
  hazards: Hazard[]
  /** Effets en cours (nuage, confettis, demi-tour, klaxon). */
  fx: Fx[]
  /** Touches réussies par lanceur (cumul de la coupe). */
  hits: Record<string, number>
  forced?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
}

export interface DkOptions {
  races: 1 | 3
  laps: 2 | 3
  /** Compléter la grille avec des bots jusqu'à N karts (0 = pas de bots). */
  fill: 0 | 6 | 8 | 12
  /** Premier circuit (0..5, index de TRACKS) ; -1 = surprise (tiré au hasard par le serveur). */
  track: number
}

export const dkActions = {
  lap: (lap: number) => ({ type: 'lap', lap }),
  use: (u: UsePayload) => ({ type: 'use', ...u }),
  hit: (hazard: number) => ({ type: 'hit', hazard }),
  tick: () => ({ type: 'tick' }),
  next: () => ({ type: 'next' }),
  endGame: () => ({ type: 'end_game' }),
}

/**
 * Types du Mini-golf (contrat : supabase/games/mini-golf.sql).
 * Tout le monde joue le même trou en même temps ; phases : playing -> hole_end -> … -> finished.
 */

export type MgPhase = 'playing' | 'hole_end' | 'finished' | 'aborted'

export interface MgLastHole {
  id: string
  /** Index du trou dans `holes`. */
  hole: number
  /** Score inscrit (pickedUp(par) = ramassée : 7 sur un par 2 à 4, 8 sur un par 5, 9 sur un par 6). */
  strokes: number
  holed: boolean
  at: string
}

export interface MiniGolfState {
  game: 'mini-golf'
  phase: MgPhase
  seq?: number
  players: string[]
  /** Index (0-based) du trou en cours dans `holes`. */
  hole: number
  round?: number
  total_rounds?: number
  /** Parcours choisi (absent sur les parties d'avant le tirage au sort). */
  course?: MgCourse
  /** Ids des trous du parcours (La Kermesse = 1..9, Défi = 21..29 dans l'ordre ; sinon tirés au sort parmi 1..20, par croissant). */
  holes: number[]
  /** Par de chaque trou du parcours (même ordre que `holes`). */
  pars: number[]
  /** Chrono par trou en secondes (0 = sans chrono). */
  timer: number
  /** Fin de l'annonce du trou = début du jeu (ISO). */
  hole_started_at: string
  /** Prochaine échéance du `tick` (fin du chrono, fin du classement) ou null. */
  deadline: string | null
  /** uid -> coups par trou joué. */
  cards: Record<string, number[]>
  totals: Record<string, number>
  /** Joueurs ayant fini le trou courant. */
  done: string[]
  last_hole: MgLastHole | null
  forced?: boolean
  winners: string[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number; stats?: Record<string, number> }> | null
}

/** random = 9 trous tirés au sort parmi 1..20 (défaut) ; kermesse = trous 1..9 ; express = 5 tirés au sort ; defi = trous 21..29. */
export type MgCourse = 'random' | 'kermesse' | 'express' | 'defi'

export interface MgOptions {
  course: MgCourse
  /** secondes par trou, 0 = sans chrono */
  timer: 0 | 60 | 90
}

export interface MgHoleStats {
  water: number
  mill_hits: number
  bank_shot: 0 | 1
}

export const mgActions = {
  hole: (hole: number, strokes: number, holed: boolean, stats: MgHoleStats) => ({ type: 'hole', hole, strokes, holed, stats }),
  tick: () => ({ type: 'tick' }),
  next: () => ({ type: 'next' }),
  endGame: () => ({ type: 'end_game' }),
}

/** Message broadcast `golf:<matchId>` (jamais en base). */
export interface GolfMsg {
  id: string
  /** Index du trou. */
  h: number
  x: number
  y: number
  z: number
  /** Coups joués sur ce trou (pénalités comprises). */
  n: number
  /** 0 roule, 1 arrêtée, 2 dans le trou. */
  s: 0 | 1 | 2
}

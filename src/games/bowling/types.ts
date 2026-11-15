/**
 * Types du Bowling (contrat : supabase/games/bowling.sql).
 * Tout le monde joue en même temps ; phases : playing -> finished.
 */
import type { Sheet } from './scoring'

export type BwPhase = 'playing' | 'finished' | 'aborted'

export interface BwNext {
  frame: number
  roll: number
  /** Masque des quilles debout avant ce lancer. */
  standing: number
}

export type BwKind = 'strike' | 'spare' | 'zero' | 'normal'

export interface BwLastRoll {
  player: string
  frame: number
  roll: number
  mask: number
  pins: number
  kind: BwKind
  at: string
}

export interface BowlingState {
  game: 'bowling'
  phase: BwPhase
  seq?: number
  players: string[]
  /** Nombre de frames (3, 5 ou 10). */
  frames: number
  /** Limite globale en minutes (0 = aucune). */
  time_limit: number
  started_at: string
  /** Échéance globale ISO (null = aucune). */
  deadline: string | null
  /** uid -> feuille (frames de masques). */
  sheets: Record<string, Sheet>
  /** uid -> score total (bonus non joués comptés 0). */
  scores: Record<string, number>
  /** uid -> cumul officiel par frame (null = en attente). */
  cum: Record<string, Array<number | null>>
  /** uid -> prochain lancer attendu (null = a fini). */
  next: Record<string, BwNext | null>
  /** Joueurs ayant fini leur partie. */
  done: string[]
  last_roll: BwLastRoll | null
  /** Fin forcée (hôte / échéance) : lancers manquants comptés 0. */
  forced: boolean
  winners: string[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
}

export interface BwOptions {
  frames: 3 | 5 | 10
  /** minutes, 0 = sans limite */
  time_limit: number
}

export const bwActions = {
  roll: (frame: number, roll: number, mask: number) => ({ type: 'roll', frame, roll, pins_down_mask: mask }),
  tick: () => ({ type: 'tick' }),
  endGame: () => ({ type: 'end_game' }),
}

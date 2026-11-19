/**
 * Types du jeu « Nom de Code » — miroir du state public de supabase/games/nom-de-code.sql.
 * La clé (couleur des 25 cases) n'est jamais dans le state pendant une manche : seuls les
 * espions la reçoivent dans leur secret ; elle devient publique (`key`) en fin de manche.
 */
import type { BaseGameState } from '@/games/types'
import type { TeamColor } from '@/features/teams/teams'

export type NdcCell = TeamColor | 'neutral' | 'bomb'
export type NdcPhase = 'clue' | 'guess' | 'round_end' | 'finished' | 'aborted'
export type NdcTimer = 'relaxed' | 'normal' | 'fast'
export type NdcRounds = 'one' | 'each'

export interface NdcTeam {
  id: TeamColor
  players: string[]
  spy: string
  found: number
  total: number
  eliminated: boolean
}

export interface NdcStats {
  bomb_votes: number
  idle_clue: number
  enemy_reveals: number
  first_good: number
  best_clue: number
  spy_wins: number
  flawless: number
  comeback: number
}

export interface NdcState extends BaseGameState {
  game: 'nom-de-code'
  phase: NdcPhase
  /** Membres d'équipe uniquement (jamais le banc). */
  players: string[]
  bench: string[]
  round: number
  total_rounds: number
  rounds: NdcRounds
  timer: NdcTimer
  deadline: string | null
  words: string[]
  /** Ordre fixe rouge, bleu, vert, jaune (équipes présentes) = ordre de jeu. */
  teams: NdcTeam[]
  turn: TeamColor
  /** Clé = index '0'..'24'. */
  revealed: Record<string, { color: NdcCell; by: TeamColor }>
  clue: { word: string; n: number } | null
  guesses_left: number
  /** Têtes posées : joueur -> index de la carte (équipe active). */
  votes: Record<string, number>
  stop: string[]
  turn_found: number
  round_wins: Partial<Record<TeamColor, number>>
  round_winner: TeamColor | null
  round_end_reason: 'words' | 'bomb' | 'last_team' | null
  key: NdcCell[] | null
  winners?: TeamColor[]
}

/** Secret d'un joueur : la clé pour l'espion de la manche, null pour les autres (manches 2+). */
export interface NdcSecret {
  round: number
  key: NdcCell[] | null
}

/**
 * Types du jeu « Kems » — miroir du state public de supabase/games/kems.sql.
 * Les mains ne sont JAMAIS dans le state public avant la révélation : chacun reçoit la sienne
 * dans son secret (`match_secrets`), relu quand `state.hand_ver[moi]` augmente.
 * Carte = valeur + couleur : « 7H », « 10S », « AD » (S pique, H coeur, D carreau, C trèfle).
 */
import type { BaseGameState } from '@/games/types'
import type { TeamColor } from '@/features/teams/teams'

export type KemsPhase = 'signs' | 'playing' | 'reveal' | 'finished' | 'aborted'
export type KemsTarget = 3 | 5 | 7

export interface KemsTeam {
  id: TeamColor
  /** Exactement 2 joueurs. */
  players: string[]
  score: number
}

export interface KemsFeedItem {
  n: number
  by: string
  took: string
  gave: string
}

export interface KemsCall {
  type: 'kems' | 'counter' | 'timeout'
  by: string | null
  /** Équipe de celui qui a crié (null en manche blanche). */
  team: TeamColor | null
  /** Équipe visée par un Contre-Kems. */
  target: TeamColor | null
  ok: boolean
  double: boolean
  deltas: Partial<Record<TeamColor, number>>
  /** Toutes les mains, révélées. */
  hands: Record<string, string[]>
  /** Joueurs qui avaient un carré. */
  holders: string[]
  round: number
}

export interface KemsTeamStats {
  kems: number
  counters: number
  errors: number
  countered: number
}

export interface KemsState extends BaseGameState {
  game: 'kems'
  phase: KemsPhase
  /** Membres d'équipe uniquement (jamais le banc). */
  players: string[]
  bench: string[]
  round: number
  target: KemsTarget
  teams: KemsTeam[]
  ready: string[]
  /** 4 cartes publiques (vide pendant les signes). */
  center: string[]
  deck_count: number
  sweep: { votes: string[]; deadline: string | null }
  round_deadline: string | null
  /** Prochaine échéance pour le tick (signes, balayage auto / manche blanche, fin de révélation). */
  deadline: string | null
  /** 6 derniers échanges, le plus récent d'abord. */
  feed: KemsFeedItem[]
  swaps: number
  sweeps: number
  hand_ver: Record<string, number>
  call: KemsCall | null
  tstats: Partial<Record<TeamColor, KemsTeamStats>>
  winners?: TeamColor[]
}

export interface KemsSecret {
  round: number
  hand: string[]
  square: boolean
  sign_ideas: string[]
  v: number
}

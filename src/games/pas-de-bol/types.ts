/**
 * Contrat « Pas de bol ! » (id `pas-de-bol`) — miroir de supabase/games/pas-de-bol.sql.
 *
 * State public (`matches.state`) : PdbState. Secret de chaque joueur
 * (`match_secrets.secret`) : PdbSecret. Le paquet, la défausse et les mains
 * restent côté serveur (`match_server_state`).
 */

export type PdbColor = 'tomate' | 'soleil' | 'menthe' | 'ciel'
export type PdbKind = 'num' | 'plus2' | 'reverse' | 'skip' | 'wild' | 'wild4' | 'perso'
export type PersoSlug = 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini'

export interface PdbCard {
  id: string
  kind: PdbKind
  /** Absent pour wild / wild4 / perso. */
  color?: PdbColor
  value?: number
  perso?: PersoSlug
}

export type PdbLogEntry =
  | { n: number; t: 'play'; p: string; card: PdbCard; color: PdbColor; target?: string; blocked?: number; discarded?: PdbCard[]; chosen?: PdbColor; stolen?: boolean; skipped?: boolean }
  | { n: number; t: 'draw'; p: string; count: number; auto?: boolean; cumul?: boolean }
  | { n: number; t: 'pass'; p: string; auto?: boolean }
  | { n: number; t: 'announce'; p: string }
  | { n: number; t: 'denounce'; p: string; target: string; count: number }
  | { n: number; t: 'out'; p: string; place: number }
  | { n: number; t: 'reshuffle' }

export interface PdbState {
  game: 'pas-de-bol'
  phase: 'playing' | 'finished' | 'aborted'
  mode: 'classique' | 'persos'
  /** Joueurs de la partie (ordre de la soirée). */
  players: string[]
  /** Ordre autour de la table (tiré au sort). */
  order: string[]
  /** Joueurs ayant encore des cartes, dans l'ordre de la table. */
  active: string[]
  /** Ordre de sortie (= classement). */
  out: string[]
  direction: 1 | -1
  /** Couleur demandée. */
  color: PdbColor
  top: PdbCard
  /** Dernières cartes posées (la dernière = top). */
  pile: PdbCard[]
  counts: Record<string, number>
  /** Version du secret de chaque joueur (incrémentée quand sa main change). */
  hand_ver: Record<string, number>
  draw_count: number
  pending_draw: number
  pending_kind: 'plus2' | 'wild4' | null
  /** 'open' = 1 carte non annoncée (dénonçable) ; 'safe' = annoncée. */
  last_card: Record<string, 'open' | 'safe'>
  turn: string | null
  /** 'drawn' = le joueur a pioché une carte jouable : il peut la poser ou passer. */
  turn_phase: 'play' | 'drawn'
  turn_seq: number
  turn_seconds: number
  deadline: string | null
  log: PdbLogEntry[]
  log_seq: number
  reshuffles: number
  loser: string | null
  final_hands: Record<string, PdbCard[]> | null
  seq?: number
  aborted?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  new_unlocks?: Record<string, string[]>
  xp_gained?: Record<string, number>
}

export interface PdbPeek {
  target: string
  hand: PdbCard[]
  /** ISO : fin d'affichage conseillée. */
  until: string
  n: number
  /** Id de la carte que Manon vient de prendre à la cible (dans `hand`). */
  stolen?: string
}

export interface PdbSecret {
  hand: PdbCard[]
  /** Id de la carte qui vient d'être piochée (phase 'drawn'). */
  drawn: string | null
  /** = state.hand_ver[moi] */
  v: number
  peek?: PdbPeek
}

export type PdbAction =
  | { type: 'play'; card: string; color?: PdbColor; target?: string; announce?: boolean }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'last_card' }
  | { type: 'denounce'; target: string }
  | { type: 'tick' }

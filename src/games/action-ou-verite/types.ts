/**
 * Contrat du jeu « Action ou vérité » (state public de matches.state + actions).
 * Côté serveur : supabase/games/action-ou-verite.sql.
 */
import type { BaseGameState } from '../types'

export type AovKind = 'action' | 'verite'
export type AovLevel = 1 | 2 | 3
export type AovOutcome = 'success' | 'fail' | 'refused'

/** Carte telle que publiée dans le state. */
export interface AovCard {
  id: string
  kind: AovKind
  level: AovLevel
  text: string
}

/** Paramètres de l'animation de roue (identiques pour tous les écrans). */
export interface AovSpin {
  round: number
  target: string
  /** Tours complets avant l'arrêt (4 à 6). */
  turns: number
  /** Position d'arrêt dans la part du désigné (0..1). */
  offset: number
  /** Fin de l'animation (ISO, horloge serveur). */
  until: string
}

/** Dépouillement du vote des propositions (public à partir de `perform`). */
export interface AovCardVote {
  votes: Record<string, number>
  /** Nombre de votes par proposition (même ordre que `proposals`). */
  counts: number[]
  winner: number
  /** Indices ex-aequo départagés au hasard (vide si pas d'égalité). */
  tied: number[]
  random: boolean
}

export interface AovResult {
  round: number
  target: string
  kind: AovKind
  card: AovCard
  outcome: AovOutcome
  up: number
  down: number
  /** voter -> true (👍) / false (👎). Vide en cas de refus. */
  votes: Record<string, boolean>
  /** Gage tiré au sort (refus seulement). */
  gage: string | null
  points: number
}

export interface AovHistoryEntry {
  round: number
  target: string
  kind: AovKind
  text: string
  outcome: AovOutcome
  gage: string | null
}

export interface AovPlayerStats {
  turns: number
  actions: number
  verites: number
  success: number
  fails: number
  refusals: number
  thumbs_up: number
  thumbs_down: number
}

export interface AovState extends BaseGameState {
  game: 'action-ou-verite'
  phase: 'choose' | 'vote' | 'perform' | 'result' | 'finished' | 'aborted'
  round: number
  /** 0 = illimité (jusqu'à ce que l'hôte arrête). */
  total_rounds: number
  levels: AovLevel[]
  soft_timer: boolean
  auto: boolean
  /** Joueur désigné par la roue. */
  target: string
  kind: AovKind | null
  /** true si le type a été tiré au sort (temps écoulé / hôte). */
  kind_random: boolean
  spin: AovSpin
  /** Échéance de la phase (ISO) ; null en `result` sans passage auto. */
  deadline: string | null
  /** Minuteur doux d'une action (indicatif, jamais imposé). */
  timer_until: string | null
  /** Les 3 propositions (phase vote et suivantes). */
  proposals: AovCard[]
  /** Votants ayant voté pour une proposition (pas leur choix). */
  voted: string[]
  card: AovCard | null
  card_vote: AovCardVote | null
  /** Votants ayant jugé (👍/👎), pas leur verdict. */
  validated: string[]
  turns: Record<string, number>
  scores: Record<string, number>
  stats: Record<string, AovPlayerStats>
  last_result: AovResult | null
  history: AovHistoryEntry[]
  winners: string[] | null
}

/**
 * Contrat du jeu « Tu préfères ? » (state public de matches.state + actions).
 * Côté serveur : supabase/games/tu-preferes.sql.
 */
import type { BaseGameState } from '../types'

export type TpSide = 'a' | 'b'

/** Dilemme tel que publié dans le state (tiré par l'hôte côté front). */
export interface TpDilemma {
  id: string
  a: string
  b: string
  theme: string | null
}

/** Compteurs cumulés par joueur (aussi dans results[].stats). */
export interface TpPlayerStats {
  /** Paris justes sur la majorité. */
  bets_ok: number
  /** Fois « seul de son avis » (compté même si le bonus est désactivé). */
  rebel: number
  /** Fois où son propre choix = la majorité. */
  norm: number
  /** Manches répondues. */
  answered: number
}

export interface TpReveal {
  round: number
  dilemma: TpDilemma
  /** Choix de chaque joueur ayant répondu (public seulement à la révélation). */
  choices: Record<string, TpSide>
  /** Pari de chaque joueur sur la majorité. */
  bets: Record<string, TpSide>
  counts: { a: number; b: number }
  /** null = égalité parfaite (ou personne n'a répondu) : pas de point de pari. */
  majority: TpSide | null
  /** Joueurs dont le pari est juste (+1). */
  bettors_ok: string[]
  /** 0 ou 1 joueur : seul de son camp face à ≥ 2 joueurs (+1 si rebel_bonus). */
  rebels: string[]
  /** Points gagnés à cette manche par joueur. */
  gains: Record<string, number>
}

export interface TpHistoryEntry {
  round: number
  dilemma: TpDilemma
  counts: { a: number; b: number }
  majority: TpSide | null
  rebels: string[]
}

export interface TpState extends BaseGameState {
  game: 'tu-preferes'
  phase: 'answering' | 'reveal' | 'finished' | 'aborted'
  round: number
  total_rounds: number
  /** Secondes de réponse par manche (20/30/45). */
  timer: number
  rebel_bonus: boolean
  /** Échéance ISO de la phase `answering` (null sinon). */
  deadline: string | null
  dilemma: TpDilemma | null
  /** Joueurs ayant répondu à la manche en cours (pas leurs choix). */
  answered: string[]
  scores: Record<string, number>
  stats: Record<string, TpPlayerStats>
  last_reveal: TpReveal | null
  history: TpHistoryEntry[]
  winners: string[] | null
}

/** Mon secret (match_secrets) : ma dernière réponse, pour la retrouver après un rechargement. */
export interface TpSecret {
  round: number
  choice: TpSide
  bet: TpSide
}

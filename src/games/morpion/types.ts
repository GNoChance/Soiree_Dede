/**
 * Contrat « Morpion » (id `morpion`) — miroir de supabase/games/morpion.sql.
 * Jeu en DUEL : le state public est un DuelState<MorpionBoard, MorpionMove>
 * (cf. src/features/duel/types.ts) ; seul `board` est propre au jeu. Pas de
 * secret, pas de phase de préparation.
 */
import type { DuelState } from '@/features/duel/types'
import type { CellValue, MiniStatus, Variant } from './logic'

export interface MorpionBoard {
  variant: Variant
  /** Côté de la grille de cases : 3 (classique), 10 (géant), 9 (ultime). */
  size: number
  /** Alignement gagnant : 3, 5 (géant, « ou plus »), 3 petits morpions (ultime). */
  align: number
  /** Duellistes (a = couleur 1, b = couleur 2). */
  a: string
  b: string
  /** ❌ = celui qui commence la manche ; ⭕ = l'autre. */
  x: string
  o: string
  /** size² cases. Classique / géant : i = ligne × size + colonne ; ultime : i = 9 × petit + case. */
  cells: CellValue[]
  /** Coups joués. */
  count: number
  last: { cell: number; by: string } | null
  /** Segments gagnants (ordonnés d'un bout à l'autre) : cases, ou petits morpions (ultime). */
  lines: number[][] | null
  /** Ultime : état des 9 petits morpions (null = en cours) ; null sinon. */
  boards: MiniStatus[] | null
  /** Ultime : petit morpion imposé au joueur au trait (null = libre). */
  next: number | null
}

export interface MorpionMove {
  cell: number
}

export type MorpionState = DuelState<MorpionBoard, MorpionMove>

/** Options propres au jeu (`options.board`). */
export interface MorpionBoardOptions {
  variant: Variant
}

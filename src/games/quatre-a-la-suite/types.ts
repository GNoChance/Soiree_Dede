/**
 * Contrat « 4 à la suite » (id `quatre-a-la-suite`) — miroir de
 * supabase/games/quatre-a-la-suite.sql. Jeu en DUEL : le state public est un
 * DuelState<Q4Board, Q4Move> (cf. src/features/duel/types.ts) ; seul `board`
 * est propre au jeu. Pas de secret, pas de phase de préparation.
 */
import type { DuelState } from '@/features/duel/types'

/** Case [colonne, ligne] ; ligne 0 = en bas. */
export type Q4Cell = [number, number]

export interface Q4Board {
  width: 7
  height: 6
  /** Une liste par colonne, du BAS vers le haut : id du joueur propriétaire du jeton. */
  cols: string[][]
  /** Duellistes : a = couleur 1, b = couleur 2. */
  a: string
  b: string
  /** Jetons posés. */
  count: number
  last: { col: number; row: number; by: string } | null
  /** Jetons alignés gagnants (≥ 4, plusieurs directions possibles), sinon null. */
  line: Q4Cell[] | null
}

export interface Q4Move {
  col: number
}

export type Q4State = DuelState<Q4Board, Q4Move>

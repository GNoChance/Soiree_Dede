/**
 * Contrat « Échecs » (id `echecs`) — miroir de supabase/games/echecs.sql.
 * Jeu en DUEL : le state public est un DuelState<ChessBoard, ChessMove>
 * (cf. src/features/duel/types.ts) ; seul `board` est propre au jeu.
 * Le front n'a AUCUN moteur d'échecs : il affiche les coups légaux publiés
 * par le serveur (`board.moves`).
 */
import type { DuelState } from '@/features/duel/types'

export type ChessSide = 'w' | 'b'
export type Cadence = 'blitz3' | 'rapid5' | 'slow10' | 'none'
export type ChessEndReason = 'mate' | 'stalemate' | 'repetition' | 'fifty' | 'material' | 'time' | 'resign' | 'agreement'

export interface ChessBoard {
  /** 64 caractères, index 0 = a8 … 63 = h1 ; '.' = vide, MAJUSCULES = Blancs (KQRBNP). */
  sq: string
  /** uid des Blancs (= premier joueur de la manche) et des Noirs. */
  white: string
  black: string
  /** Camp au trait. */
  side: ChessSide
  /** Droits de roque restants (« KQkq », "" = aucun). */
  castle: string
  /** Case de prise en passant (index) ou null. */
  ep: number | null
  /** Demi-coups depuis la dernière prise / le dernier coup de pion (nul à 100). */
  half: number
  /** Numéro du coup (commence à 1, +1 après chaque coup des Noirs). */
  full: number
  /** Coups légaux du camp au trait : {"<from>": [to, …]} (vide en fin de manche). */
  moves: Record<string, number[]>
  /** Le roi du camp au trait est en échec. */
  check: boolean
  last: { from: number; to: number } | null
  /** Pièces prises PAR chaque camp (w = pièces noires prises par les Blancs). */
  captured: { w: string; b: string }
  cadence: Cadence
  /** Pendule (ms restantes au début du tour) ; null = sans pendule. */
  clock: Record<string, number> | null
  /** Début du tour en cours (ISO, horloge serveur). */
  turn_started_at: string
  /** Joueur qui propose nul (l'adversaire peut accepter à son tour), sinon null. */
  draw_offer: string | null
  /** Fin de manche ; winner null = nul. */
  end: { reason: ChessEndReason; winner: string | null } | null
}

/** Coup envoyé ({"type":"move","move": ChessMove}). */
export type ChessMove =
  | { from: number; to: number; promo?: Promo; offer_draw?: boolean }
  | { type: 'resign' }
  | { type: 'accept_draw' }
  | { type: 'flag' }

export type Promo = 'q' | 'r' | 'b' | 'n'

export type ChessState = DuelState<ChessBoard, ChessMove>

/** Bilan d'une manche rangé par le socle dans duel.games[].x (trophées). */
export interface ChessGameX {
  reason: ChessEndReason
  p: Record<string, { moves: number; captures: number; queens_lost: number; castles: number; en_passants: number; promotions: number; stalemate_blunders: number }>
}

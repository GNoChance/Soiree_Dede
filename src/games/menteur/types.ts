/**
 * Contrat « Menteur » (id `menteur`) — miroir de supabase/games/menteur.sql.
 *
 * State public (`matches.state`) : MtrState. Les dés de la manche en cours ne
 * sont JAMAIS dans le state public avant une vérification : chacun lit les
 * siens dans son secret (`match_secrets.secret` = MtrSecret, réécrit à chaque
 * manche). À la vérification, `reveal.dice` expose tous les dés de la manche.
 *
 * Règles des 1 (« Paco ») : les 1 sont jokers (comptent pour toutes les
 * valeurs) sauf si l'enchère porte sur les 1. Passer sur les 1 : quantité
 * ≥ ⌈q/2⌉ ; en sortir : quantité ≥ 2q+1 ; pas d'ouverture sur les 1.
 */

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

export interface MtrBid {
  qty: number
  face: DieFace
  /** Enchérisseur */
  by: string
  /** Enchère posée automatiquement à l'échéance du minuteur. */
  auto?: boolean
}

export interface MtrReveal {
  round: number
  kind: 'liar' | 'pile'
  caller: string
  /** Vérification automatique (minuteur, enchère impossible à monter). */
  auto: boolean
  bid: MtrBid
  /** Tous les dés de la manche : {uid: [faces]} (joueurs vivants au moment du cri). */
  dice: Record<string, DieFace[]>
  /** Nombre de dés comptés (valeur annoncée + 1 jokers sauf enchère Paco). */
  count: number
  exact: boolean
  /** Perd un dé (null : Pile juste). */
  loser: string | null
  /** Regagne un dé (Pile juste, si < 5 dés). */
  gainer: string | null
  /** Éliminé par cette vérification. */
  eliminated: string | null
  /** Commence la manche suivante. */
  next_starter: string | null
  /** Dernière vérification : la partie se termine à l'échéance. */
  final: boolean
}

export interface MtrHistoryEntry {
  round: number
  kind: 'liar' | 'pile'
  caller: string
  bid: MtrBid
  count: number
  loser: string | null
  gainer: string | null
  eliminated: string | null
}

export interface MtrState {
  game: 'menteur'
  phase: 'bidding' | 'reveal' | 'finished' | 'aborted'
  /** Joueurs de la partie (ordre de la soirée). */
  players: string[]
  /** Ordre autour de la table (tiré au sort). */
  order: string[]
  /** Joueurs ayant encore des dés, dans l'ordre de la table. */
  alive: string[]
  /** Ordre d'élimination (le premier éliminé en tête). */
  eliminated: string[]
  dice_count: Record<string, number>
  /** Nombre de dés en jeu dans la manche. */
  total_dice: number
  round: number
  starter: string | null
  /** Joueur qui doit parler (null hors phase bidding). */
  turn: string | null
  turn_seq: number
  turn_seconds: 30 | 45 | 60
  pile_enabled: boolean
  bid: MtrBid | null
  /** Enchères de la manche en cours (30 dernières). */
  bids: MtrBid[]
  reveal: MtrReveal | null
  history: MtrHistoryEntry[]
  /** ISO : fin du tour (bidding) ou de la révélation (reveal). */
  deadline: string | null
  winner: string | null
  seq?: number
  aborted?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  new_unlocks?: Record<string, string[]>
  xp_gained?: Record<string, number>
}

export interface MtrSecret {
  round: number
  dice: DieFace[]
}

export type MtrAction =
  | { type: 'bid'; qty: number; face: DieFace }
  | { type: 'liar' }
  | { type: 'pile' }
  | { type: 'next' }
  | { type: 'tick' }

export interface MtrOptions {
  turn_seconds: 30 | 45 | 60
  pile: boolean
}

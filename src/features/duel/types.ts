import type { ComponentType } from 'react'
import type { PlayerInfo } from '@/games/types'

/**
 * Contrat du SOCLE « jeux en duel » — miroir TS de supabase/features/duel.sql.
 * Doc complète : docs/ARCHITECTURE.md, section « Jeux en duel ».
 *
 * Le state public d'un jeu en duel = DuelState<Board, Move> :
 *  - `session` : la soirée de duels (mode, file du roi / tableau du tournoi,
 *    points, stats, série, historique) ;
 *  - `duel`    : le duel annoncé ou en cours (2 duellistes, tour, paris…) ;
 *  - `board`   : le plateau PUBLIC du jeu (propre à chaque jeu, null en transition).
 * Tous les identifiants de joueurs sont des uuid (string).
 */

export type DuelMode = 'king' | 'tournament' | 'duel'

/**
 * transition : « Prochain duel : X vs Y » (paris ouverts), deadline 8 s (1er) / 5 s.
 * setup      : préparation simultanée optionnelle (ex. placer sa flotte), les deux `ready`.
 * playing    : au tour de `duel.turn`, deadline = turn_seconds (coup auto à l'échéance).
 * result     : fin d'une manche (4 s) ou du duel (5 s, `duel.result` renseigné).
 * finished   : fin de session (`results`, `winners`). aborted : annulée par l'hôte.
 */
export type DuelPhase = 'transition' | 'setup' | 'playing' | 'result' | 'finished' | 'aborted'

export type DuelEndReason = 'streak' | 'rotation' | 'limit' | 'bracket' | 'duel' | 'stopped'

export interface DuelPlayerStats {
  /** Duels joués (terminés). */
  played: number
  wins: number
  draws: number
  losses: number
  /** Paris posés / gagnés. */
  bets: number
  bets_won: number
  /** Manches commencées (sert à alterner le premier joueur). */
  starts: number
}

export interface BracketMatch {
  a: string | null
  b: string | null
  winner: string | null
  /** bye = exempt (b null, qualifié d'office). */
  status: 'pending' | 'done' | 'bye'
  /** Nuls déjà joués (1 = revanche en cours, 2 = qualifié au tirage). */
  draws: number
  /** Qualifié au tirage au sort après 2 nuls. */
  random: boolean
}

export interface DuelBracket {
  /** Puissance de 2 >= nombre de joueurs. */
  size: number
  byes: number
  /** rounds[0] = 1er tour … rounds[last][0] = finale. */
  rounds: BracketMatch[][]
}

export interface DuelGameRecord {
  no: number
  starter: string
  /** null = manche nulle. */
  winner: string | null
  moves: number
}

export interface DuelResult {
  /** Vainqueur du duel (null = nul). */
  winner: string | null
  draw: boolean
  /** Tournoi : qualifié au tirage au sort après le 2e nul. */
  advanced: string | null
  /** Spectateurs qui avaient parié sur le vainqueur. */
  bets_right: string[]
}

export interface DuelHistoryEntry {
  no: number
  a: string
  b: string
  winner: string | null
  draw: boolean
  advanced: string | null
  wins: Record<string, number>
  games: DuelGameRecord[]
  /** {parieur: duelliste choisi} */
  bets: Record<string, string>
  bets_right: string[]
  round: number | null
  match: number | null
  replay: boolean
}

export interface DuelSession {
  mode: DuelMode
  /** 1 ou 3 (3 seulement en mode duel). */
  best_of: 1 | 3
  turn_seconds: number
  /** Options propres au jeu (`p_options.board`), passées à board_new. */
  board_options: Record<string, unknown>
  /** Points de session : victoire de duel +3, nul +1, pari juste +1. */
  scores: Record<string, number>
  stats: Record<string, DuelPlayerStats>
  /** Victoires de duel consécutives (remise à zéro par un nul). */
  streak: { player: string | null; count: number }
  /** Roi : fin dès qu'une série atteint ce nombre (et que tout le monde a joué). */
  streak_target: number
  /** Roi : fin quand tout le monde a joué au moins ce nombre de duels. */
  min_played: number
  duel_count: number
  history: DuelHistoryEntry[]
  /** Roi : file d'attente ; queue[0] = roi, queue[1] = challenger. */
  queue: string[] | null
  bracket: DuelBracket | null
  /** Mode duel : les deux duellistes. */
  pair: [string, string] | null
  over: boolean
  end_reason: DuelEndReason | null
  /** Champion du tournoi / vainqueur du mode duel. */
  champion: string | null
}

export interface DuelLastMove<M> {
  by: string
  move: M
  /** Coup joué automatiquement à l'échéance du minuteur. */
  auto: boolean
}

export interface DuelInfo<M = unknown> {
  /** Numéro du duel dans la session (1, 2…). */
  no: number
  a: string
  b: string
  /** Premier joueur de la manche 1 ; il alterne à chaque manche. */
  first: string
  /** Premier joueur de la manche en cours. */
  starter: string
  /** Au trait (phase playing), sinon null. */
  turn: string | null
  /** Manche en cours (0 en transition). */
  game_no: number
  wins: Record<string, number>
  games: DuelGameRecord[]
  /** Paris : {spectateur: duelliste}. Publics. */
  bets: Record<string, string>
  /** Fin de la fenêtre de 15 s des paris (ISO), à partir du début du duel. */
  bets_until: string | null
  /** Coups joués dans la manche. */
  moves: number
  last_move: DuelLastMove<M> | null
  /** Issue de la manche (phase result). */
  outcome: 'win' | 'draw' | null
  winner: string | null
  /** Phase setup : duellistes prêts. */
  ready: string[]
  /** Coups automatiques consécutifs par duelliste (3 = forfait). Absent des anciennes parties. */
  auto_streak?: Record<string, number>
  /** Duelliste ayant perdu la manche par forfait (absent), sinon null/undefined. */
  forfeit?: string | null
  /** Renseigné quand le DUEL est terminé. */
  result: DuelResult | null
  /** Tournoi : position dans le tableau. */
  round: number | null
  match: number | null
  /** Tournoi : revanche après un nul. */
  replay: boolean
}

export interface DuelState<B = unknown, M = unknown> {
  game: string
  phase: DuelPhase
  players: string[]
  session: DuelSession
  duel: DuelInfo<M> | null
  board: B | null
  /** Échéance ISO de la phase en cours. */
  deadline: string | null
  /** Fin : gagnants (won). */
  winners: string[] | null
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  seq?: number
  aborted?: boolean
  new_unlocks?: Record<string, string[]>
  new_tenues?: Record<string, string[]>
  xp_gained?: Record<string, number>
}

export type DuelAction<M = unknown> =
  | { type: 'move'; move: M }
  | { type: 'ready' }
  | { type: 'bet'; winner: string }
  | { type: 'tick' }
  | { type: 'next' }
  | { type: 'stop' }

/** Options de l'écran de lancement (communes aux jeux en duel). */
export interface DuelOptionsValue {
  mode: DuelMode
  best_of: 1 | 3
  /** Mode duel : 2 joueurs choisis par l'hôte ; null = au hasard. */
  duel_players: [string, string] | null
  /** Options propres au jeu (envoyées sous `board`). */
  board: Record<string, unknown>
}

/** Rôle de l'utilisateur dans le duel courant. */
export type DuelRole = 'a' | 'b' | 'spectator' | 'outsider'

/** Props du composant Plateau fourni par chaque jeu en duel. */
export interface DuelBoardProps<B = unknown, M = unknown> {
  board: B
  /** Mon id. */
  me: string
  /** Phase playing et c'est mon tour. */
  isMyTurn: boolean
  /** Envoie {type:'move', move}. En phase setup : coup de préparation. */
  onMove: (move: M) => void
  /** Une action est en cours d'envoi. */
  pending: boolean
  duel: DuelInfo<M>
  phase: DuelPhase
  /** Je ne joue pas ce duel (je regarde). */
  spectator: boolean
  /** Annuaire (avec repli). */
  get: (id: string) => PlayerInfo
  /** Couleurs attribuées aux duellistes (cf. DuelPlay `sideColors`). */
  colors: { a: string; b: string }
  /** Secret du joueur (jeux à information cachée), tel que reçu. */
  secret: unknown
  /** Envoie {type:'ready'} (phase setup). */
  onReady: () => void
}

/** Options propres au jeu, affichées sous les options communes. */
export interface DuelBoardOptionsProps {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  playerCount: number
}

export type DuelBoardComponent<B, M> = ComponentType<DuelBoardProps<B, M>>

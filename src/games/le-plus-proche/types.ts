/**
 * Contrat du jeu « Le plus proche » (state public de matches.state + actions).
 * Côté serveur : supabase/games/le-plus-proche.sql.
 *
 * p_options de start_match : {duration: 20|30|45, questions: LppQuestionInput[]}
 * (le front tire les questions ; la réponse reste côté serveur jusqu'à la révélation).
 *
 * Actions (game_action) :
 *  - {type:'answer', round, value: number|null}  joueur, phase question ; null = « je ne sais pas ».
 *    Modifiable jusqu'à la révélation. Révélation auto quand tous ont répondu.
 *  - {type:'reveal', round}  hôte, force la révélation.
 *  - {type:'next', round}    hôte, reveal -> manche suivante (ou fin).
 *  - {type:'tick'}           n'importe qui, à l'échéance (ignoré si en avance).
 *
 * Secret (match_secrets.secret) : {round, value: number|null, answered: true} = ma
 * dernière saisie (relue au rechargement ; ignorée si `round` ≠ manche courante).
 *
 * Erreurs : invalid_number, number_out_of_range, not_a_player, not_host, unknown_action,
 * missing_questions, invalid_questions, not_enough_players, too_many_players.
 */
import type { BaseGameState } from '../types'
import type { CloseTheme } from './questions'

export type LppDifficulty = 'facile' | 'mixte' | 'difficile'

/** Question envoyée à start_match. */
export interface LppQuestionInput {
  id: string
  theme: CloseTheme | string
  difficulty: 1 | 2 | 3
  prompt: string
  unit: string | null
  answer: number
  note: string | null
}

/** Question publiée pendant la phase `question` (ni réponse ni note). */
export interface LppPublicQuestion {
  id: string
  theme: CloseTheme | string
  difficulty: 1 | 2 | 3 | null
  prompt: string
  unit: string | null
}

export interface LppRankingEntry {
  profile_id: string
  value: number
  /** Écart absolu à la réponse. */
  gap: number
  /** Rang « sportif » (ex-aequo : même rang, 1,1,3…). */
  rank: number
  /** Égal à la réponse à l'arrondi de sa précision (bonus +5). */
  exact: boolean
  points: number
}

export interface LppReveal {
  round: number
  question: LppPublicQuestion
  answer: number
  note: string | null
  /** Estimations : {profile_id: valeur | null (« je ne sais pas »)} ; absent = pas répondu. */
  answers: Record<string, number | null>
  /** Joueurs ayant donné une valeur, du plus proche au plus loin. */
  ranking: LppRankingEntry[]
  /** Points gagnés sur la manche (> 0 seulement). */
  points: Record<string, number>
}

export interface LppHistoryItem {
  round: number
  id: string
  theme: string
  prompt: string
  unit: string | null
  answer: number
  note: string | null
  answers: Record<string, number | null>
  ranking: LppRankingEntry[]
}

export interface LppState extends BaseGameState {
  game: 'le-plus-proche'
  phase: 'question' | 'reveal' | 'finished' | 'aborted'
  round: number
  total_rounds: number
  /** Secondes par question. */
  duration: number
  started_at: string
  /** Fin du temps de réponse (phase question), null en révélation. */
  deadline: string | null
  question: LppPublicQuestion
  /** Joueurs ayant répondu (valeur ou « je ne sais pas ») — jamais les valeurs. */
  answered: string[]
  scores: Record<string, number>
  /** Nombre d'estimations exactes par joueur. */
  exacts: Record<string, number>
  last_reveal: LppReveal | null
  history: LppHistoryItem[]
  winners: string[] | null
}

export interface LppSecret {
  round: number
  value: number | null
  answered: true
}

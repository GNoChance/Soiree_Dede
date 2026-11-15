/**
 * Contrat du jeu « Cerveau en fête » (state public de matches.state + actions).
 * Côté serveur : supabase/games/cerveau-en-fete.sql.
 */
import type { BaseGameState } from '../types'
import type { QuizTheme } from './questions'

export type CefMode = 'typed' | 'mcq'
export type CefFormat = 'mixte' | 'tape' | 'qcm'
export type CefDifficulty = 'facile' | 'mixte' | 'difficile'

/** Question telle que publiée pendant la phase `question` (jamais la réponse). */
export interface CefPublicQuestion {
  id: string
  theme: QuizTheme | string
  difficulty: 1 | 2 | 3 | null
  prompt: string
  image: { url: string; credit: string; license: string } | null
  mode: CefMode
  /** 4 choix mélangés (QCM) ; null en réponse tapée. */
  choices: string[] | null
}

export interface CefFound {
  profile_id: string
  /** Rang d'arrivée (1 = premier). */
  rank: number
  /** Temps de réponse depuis l'ouverture de la question. */
  ms: number
  points: number
}

export interface CefReveal {
  round: number
  question: CefPublicQuestion
  answer: string
  mode: CefMode
  choices: string[] | null
  /** Index de la bonne réponse dans `choices` (QCM). */
  correct: number | null
  found: CefFound[]
  passed: string[]
  missed: string[]
  /** Choix QCM de chacun : {profile_id: index}. */
  picks: Record<string, number>
  /** Nombre de propositions tapées : {profile_id: n}. */
  tries: Record<string, number>
  /** Points gagnés sur la question : {profile_id: pts}. */
  points: Record<string, number>
}

export interface CefHistoryItem {
  round: number
  id: string
  theme: string
  prompt: string
  answer: string
  mode: CefMode
  found: CefFound[]
}

export interface CefState extends BaseGameState {
  game: 'cerveau-en-fete'
  phase: 'question' | 'reveal' | 'finished' | 'aborted'
  round: number
  total_rounds: number
  /** Secondes par question. */
  duration: number
  /** Durée de la révélation avant enchaînement automatique (s). */
  reveal_seconds: number
  /** ISO : ouverture de la question courante. */
  started_at: string
  /** ISO : fin du temps de réponse (phase question) ou de la révélation (phase reveal). */
  deadline: string | null
  question: CefPublicQuestion
  found: CefFound[]
  passed: string[]
  /** QCM : mauvaise réponse (un seul essai). */
  missed: string[]
  /** Scores cumulés (mis à jour à chaque révélation). */
  scores: Record<string, number>
  last_reveal: CefReveal | null
  history: CefHistoryItem[]
  winners: string[] | null
}

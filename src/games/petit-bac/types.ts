/**
 * Types du Petit bac (contrat : supabase/games/petit-bac.sql).
 * Phases : writing -> validation -> round_score -> … -> finished.
 */

export interface PbCategory {
  id: string
  label: string
  emoji: string
}

/** (state) score_deadline?: string — fin de la phase round_score (auto-avance), absent sur les anciennes parties. */
export type PbPhase = 'writing' | 'validation' | 'round_score' | 'finished' | 'aborted'

/** Refus automatique : vide ou mauvaise lettre (null = à valider par les joueurs). */
export type PbAuto = 'empty' | 'letter' | null

export interface PbAnswer {
  text: string
  /** Réponse normalisée (sans article, accents, espaces ni ponctuation). */
  norm: string
  auto: PbAuto
}

/** Statut final d'une réponse dans le décompte d'une manche. */
export type PbStatus = 'unique' | 'shared' | 'refused' | 'empty' | 'letter'

export interface PbDetail {
  text: string
  status: PbStatus
  pts: number
  contests: number
}

export interface PbValidation {
  /** Catégorie affichée (0-based). */
  cat_index: number
  /** Fin du temps de la catégorie en cours (auto-avance) ; absent sur les anciennes parties. */
  deadline?: string
  /** catId -> uid -> réponse */
  answers: Record<string, Record<string, PbAnswer>>
  /** catId -> uid ciblé -> uids des contestataires */
  contests: Record<string, Record<string, string[]>>
}

export interface PbLastRound {
  round: number
  letter: string
  points: Record<string, number>
  uniques: Record<string, number>
  /** catId -> uid -> détail */
  detail: Record<string, Record<string, PbDetail>>
}

export interface PetitBacState {
  game: 'petit-bac'
  phase: PbPhase
  seq?: number
  round: number
  total_rounds: number
  players: string[]
  categories: PbCategory[]
  /** Durée d'écriture (s). */
  duration: number
  letter: string
  letters_used: string[]
  /** Fin de l'animation de tirage / début de l'écriture (ISO). */
  starts_at: string
  /** Échéance de l'écriture (ISO). */
  deadline: string
  /** true si l'hôte a forcé la fin de manche. */
  forced?: boolean
  /** uid -> nb de cases remplies (les réponses restent secrètes). */
  progress: Record<string, number>
  validation: PbValidation | null
  scores: Record<string, number>
  /** uid -> nb total de réponses uniques (2 pts). */
  uniques: Record<string, number>
  last_round: PbLastRound | null
  history: Array<{ round: number; letter: string; points: Record<string, number> }>
  winners: string[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
}

/** Mon secret (match_secrets) : mes réponses de la manche en cours. */
export interface PbSecret {
  round: number
  answers: Record<string, string>
}

export interface PbOptions {
  /** ids de catégories choisies (6 à 8). */
  categories: string[]
  duration: number
  rounds: number
}

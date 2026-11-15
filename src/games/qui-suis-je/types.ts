/**
 * Types de « Qui suis-je ? » (contrat avec supabase/games/qui-suis-je.sql).
 *
 * Principe : à tour de rôle, le DEVINEUR pose SON téléphone sur son front, écran
 * vers les autres. Une carte s'affiche en très gros ; les autres le font deviner
 * à l'oral. Incliner vers le BAS = trouvé, vers le HAUT = passer (boutons de
 * secours toujours disponibles). 1 point par carte trouvée.
 *
 * OPTIONS (p_options de start_match, préparées par l'hôte, cf. setup.ts) :
 *   {rounds: 1|2, turn_seconds: 45|60|90, difficulty, themes: string[],
 *    cards: QsjCard[]}  — `cards` = une file unique consommée dans l'ordre par
 *   tous les tours (les cartes non montrées passent au tour suivant, on reboucle
 *   si la file est épuisée). Minimum 5 cartes, maximum 800.
 *
 * STATE PUBLIC (matches.state) :
 *   phase   'placing'  le devineur se prépare (pas d'échéance) → action `ready`
 *         | 'playing'  3-2-1 jusqu'à `starts_at`, puis chrono jusqu'à `deadline`
 *         | 'recap'    4 s (deadline) : résumé du tour (`last_turn`)
 *         | 'finished' | 'aborted'
 *   card        carte courante (null hors 'playing') — la file reste côté serveur
 *   card_index  index attendu (0-based, dans le tour) pour `found` / `pass`
 *   turn_log    cartes jouées dans le tour [{i, r:'found'|'pass', card}]
 *
 * ACTIONS :
 *   ready              devineur, 'placing' → 'playing' (starts_at = now + countdown_seconds)
 *   found {index}      devineur, 'playing', starts_at ≤ now < deadline + 1 s, index = card_index
 *   pass  {index}      idem
 *   tick               n'importe qui : 'playing' échu → 'recap' ; 'recap' échu → tour suivant / fin
 *   skip_turn          hôte, 'placing' | 'playing' → 'recap' (cartes déjà trouvées gardées)
 *
 * Erreurs : wrong_phase, not_your_turn, wrong_card (index ≠ card_index : geste en
 * double / périmé), invalid_card, missing_cards, not_enough_cards, invalid_cards.
 *
 * Fin : points = cartes trouvées, won = max (ex-aequo inclus, personne si 0),
 * stats {found}.
 */

export type QsjPhase = 'placing' | 'playing' | 'recap' | 'finished' | 'aborted'
export type QsjDifficulty = 'facile' | 'mixte' | 'difficile'

/** Carte telle qu'envoyée au serveur et publiée dans le state. */
export interface QsjCard {
  id: string
  name: string
  theme: string
  difficulty: 1 | 2 | 3
  /** Thème « Les Soirées de Dédé » : slug du perso (affiche son chibi). */
  slug?: string
  /** Sous-titre (ex. prénom du perso). */
  sub?: string
}

export interface QsjLogEntry {
  i: number
  r: 'found' | 'pass'
  card: QsjCard
}

/** Résumé compact d'un tour : log = [{n: nom, r, s?: slug}]. */
export interface QsjTurnSummary {
  turn: number
  guesser: string
  found: number
  passed: number
  skipped: boolean
  log: Array<{ n: string; r: 'found' | 'pass'; s?: string }>
}

export interface QsjState {
  game: 'qui-suis-je'
  phase: QsjPhase
  players: string[]
  /** Ordre de passage (tiré au sort), guesser = order[(turn-1) % n]. */
  order: string[]
  round: number
  total_rounds: number
  turn: number
  total_turns: number
  difficulty: QsjDifficulty
  themes: string[]
  turn_seconds: number
  countdown_seconds: number
  recap_seconds: number
  guesser: string
  card: QsjCard | null
  card_index: number
  starts_at: string | null
  deadline: string | null
  turn_found: number
  turn_passed: number
  turn_log: QsjLogEntry[]
  scores: Record<string, number>
  last_turn: QsjTurnSummary | null
  history: QsjTurnSummary[]
  winners: string[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  seq?: number
  aborted?: boolean
}

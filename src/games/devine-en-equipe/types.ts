/**
 * Types de « Devine en équipe » (contrat avec supabase/games/devine-en-equipe.sql).
 *
 * 2 équipes (`red` 🔴 / `blue` 🔵), 3 manches avec LES MÊMES mots :
 *   1 « Décris » · 2 « Un seul mot » · 3 « Mime ».
 *
 * STATE PUBLIC (matches.state) — le mot courant n'y apparaît JAMAIS :
 *   phase   'ready'     écran « Au tour de X — prêt ? » (échéance ~45 s : orateur absent → passage sauté ; l'orateur envoie `ready`)
 *         | 'playing'   passage en cours jusqu'à `deadline` → `{"type":"tick"}` par n'importe qui
 *         | 'round_end' tableau des scores entre deux manches (l'hôte envoie `next_round`)
 *         | 'finished' | 'aborted'
 *   team / speaker   équipe et orateur du passage courant (ou à venir en `ready`/`round_end`)
 *   budget           durée (s) du passage courant ; `carried` = temps conservé de la manche précédente
 *   carry_seconds    (round_end) secondes que l'orateur courant gardera à la manche suivante, ou null
 *   card_no          compteur de cartes tirées (croissant) : `index` des actions found/pass
 *   turn_words       mots trouvés pendant ce passage (publics : ils viennent d'être devinés)
 *
 * SECRETS (match_secrets, mis à jour en cours de partie — le front les relit lui-même) :
 *   orateur    {turn_no, card_no, round, role:'speaker', word, kind, next_word, next_kind}
 *   adversaire {turn_no, card_no, round, role:'watcher', word, kind}   (surveille la triche)
 *   coéquipier {turn_no, card_no, round, role:'teammate', word:null}
 *   Un secret dont `turn_no` ≠ state.turn_no (ou `card_no` ≠ state.card_no pour orateur/
 *   adversaire) est périmé : les secrets ne sont jamais effacés.
 *   `next_word` = carte suivante de la pioche (affichage optimiste instantané après un appui).
 *
 * ACTIONS : ready (orateur, phase ready) · found {index:card_no} · pass {index:card_no}
 *           (orateur, phase playing ; index périmé = ignoré sans erreur ; après l'échéance
 *           + 1,5 s de tolérance le passage se termine sans compter) · tick ·
 *           skip_turn (hôte, ready|playing) · next_round (hôte, round_end).
 *
 * RÈGLES SERVEUR :
 *   - « Passer » est permis dans les 3 manches : la carte retourne en FIN de pioche.
 *   - À l'échéance (ou skip), la carte en cours retourne en fin de pioche ; la main passe
 *     à l'autre équipe ; chaque équipe fait tourner ses orateurs dans l'ordre de `teams`.
 *   - Pioche vide = fin de manche. S'il restait ≥ 5 s, le même orateur recommence la manche
 *     suivante avec ce temps (`carried`) ; sinon la rotation continue normalement.
 *   - Fin : équipe(s) au meilleur score = won (égalité → les deux), placement 1 sinon 2 ;
 *     points = mots trouvés en tant qu'orateur.
 */

export type Team = 'red' | 'blue'
export type TeamPhase = 'ready' | 'playing' | 'round_end' | 'finished' | 'aborted'
export type WordKind = 'perso' | 'objet'
export type WordDifficulty = 'facile' | 'mixte'

export interface DeckWord {
  word: string
  kind: WordKind
}

export interface PassageRecap {
  turn_no: number
  round: number
  team: Team
  speaker: string
  found: string[]
  passed: number
  /** time = échéance, empty = pioche vide (fin de manche), skip = sauté par l'hôte */
  reason: 'time' | 'empty' | 'skip'
}

export interface TeamResult {
  profile_id: string
  points: number
  won: boolean
  placement: number
  stats?: { found: number; team: Team }
}

/** Compteurs par orateur (state.tstat), cumulés au fil des passages (absent des parties anciennes). */
export interface TeamTStat {
  empty_turns?: number
  max_passed?: number
  best_turn?: number
  found_r3?: number
  best_r2?: number
  carries?: number
}

export interface TeamState {
  game: 'devine-en-equipe'
  phase: TeamPhase
  players: string[]
  teams: Record<Team, string[]>
  round: number
  total_rounds: number
  total_words: number
  turn_seconds: number
  team: Team
  speaker: string
  next_idx: Record<Team, number>
  turn_no: number
  card_no: number
  budget: number
  carried: boolean
  deadline: string | null
  started_at: string | null
  pile_left: number
  carry_seconds: number | null
  turn_found: number
  turn_passed: number
  turn_words: string[]
  scores: Record<Team, number>
  round_scores: Array<Record<Team, number>>
  speaker_points: Record<string, number>
  tstat?: Record<string, TeamTStat>
  last_turn: PassageRecap | null
  winners: Team[] | null
  results: TeamResult[] | null
  seq?: number
  aborted?: boolean
}

export interface TeamSecret {
  turn_no: number
  card_no: number
  round: number
  role: 'speaker' | 'watcher' | 'teammate'
  word: string | null
  kind?: WordKind
  next_word?: string | null
  next_kind?: WordKind | null
}

/** Options de l'écran de lancement (avant prepareStart). */
export interface TeamOptions {
  words: number
  turnSeconds: number
  difficulty: WordDifficulty
  teamMode: 'random' | 'manual'
  /** Composition manuelle (ids de profils). */
  teams?: Record<Team, string[]>
}

/**
 * Types de Dédé Party (contrat : supabase/games/dede-party.sql).
 * Phases : intro -> roll -> move -> mg_intro -> mg_play -> mg_result -> roll … -> awards -> finished.
 */

export type DpPhase = 'intro' | 'roll' | 'move' | 'mg_intro' | 'mg_play' | 'mg_result' | 'awards' | 'finished' | 'aborted'

export type MgKind = 'quiz' | 'pif' | 'majorite' | 'buzzer' | 'etoiles' | 'chrono'

/** Évènement d'une étape de déplacement (ou de la case d'arrivée). */
export interface DpEvent {
  t: 'start' | 'clap' | 'pub' | 'star' | 'star_poor' | 'card'
  /** Pièces gagnées / perdues (start, clap, pub ; pickpocket, Téléthon). */
  d?: number
  /** Étoile : prix payé, nouvelle Loge, achat pile sur la case. */
  cost?: number
  to?: number | string
  exact?: boolean
  need?: number
  /** Carte : id, texte, gain du tireur, dé relancé, joueur visé… */
  card?: string
  text?: string
  gain?: number
  die?: number
  with?: string
  from?: string
  cell?: number
  none?: boolean
}

export interface DpStep {
  cell: number
  ev: DpEvent[]
  /** Étape due à une carte (avance / recule / relance). */
  card?: boolean
}

export interface DpSnap {
  pos: Record<string, number>
  coins: Record<string, number>
  stars: Record<string, number>
  star_cell: number
  dist: Record<string, number>
}

export interface DpMove {
  id: string
  dice: number[]
  double: boolean
  auto: boolean
  from: number
  to: number
  steps: DpStep[]
  /** Plateau juste après ce déplacement. */
  after: DpSnap
}

export interface DpRoll {
  dice: number[]
  double: boolean
  at: string
  auto?: boolean
}

export interface DpMgResult {
  id: string
  /** Rang (ex aequo partagés) ; null = pas joué. */
  rank: number | null
  coins: number
  played: boolean
  /** quiz : bonnes réponses ; pif : valeur ; majorite : joueur désigné ; buzzer / chrono : ms ; etoiles : score. */
  score: number | string | null
  ms?: number
  answers?: Array<number | null>
  false_start?: boolean
}

export interface QuizData {
  questions: Array<{ prompt: string; choices: string[] }>
  per_q: number
}
export interface PifData {
  prompt: string
  unit: string | null
}
export interface MajData {
  question: string
}
export interface BuzzerData {
  go_at?: string
}
export interface EtoilesData {
  seed: number
  cap: number
  dur: number
}
export interface ChronoData {
  target: number
  hide_after: number
}

export interface DpMg {
  kind: MgKind
  no: number
  data: Record<string, unknown>
  submitted: string[]
  results: DpMgResult[] | null
  /** quiz {answers}, pif {answer, unit}, majorite {counts, top}, chrono {target}. */
  reveal: Record<string, unknown> | null
  started_at: string | null
  finale: boolean
}

export interface DpAward {
  kind: 'king' | 'poisse'
  ids: string[]
  value: number
}

export interface DpRank {
  id: string
  stars: number
  coins: number
  rank: number
}

export interface DpStats {
  pubs: number
  broke: number
  coins_earned: number
  envelopes: number
  star_exact: number
  stars_bought: number
  mg_wins: number
  mg_streak: number
  mg_streak_max: number
  doubles: number
  king?: number
  best_card?: { card: string; text: string; gain: number }
}

export interface DedePartyState {
  game: 'dede-party'
  phase: DpPhase
  seq?: number
  players: string[]
  round: number
  rounds: number
  total_rounds?: number
  deadline: string | null
  order: string[]
  pos: Record<string, number>
  dist: Record<string, number>
  coins: Record<string, number>
  stars: Record<string, number>
  star_cell: number
  half_price: Record<string, boolean>
  double_left: Record<string, number>
  rolls: Record<string, DpRoll | null>
  moves: DpMove[]
  moves_at: string | null
  before: DpSnap | null
  mg_no: number
  mg: DpMg | null
  awards: DpAward[] | null
  ranking: DpRank[] | null
  winners: string[] | null
  forced?: boolean
  stats: Record<string, DpStats>
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number; stats?: Record<string, number> }> | null
}

export const dpActions = {
  roll: (double: boolean) => ({ type: 'roll', double }),
  submit: (no: number, payload: Record<string, unknown>) => ({ type: 'mg_submit', no, payload }),
  tick: () => ({ type: 'tick' }),
  skip: () => ({ type: 'skip' }),
  endGame: () => ({ type: 'end_game' }),
}

/** Durée d'animation d'un pion pendant les déplacements (le serveur laisse 5 s par joueur). */
export const MOVE_SEG_MS = 5000

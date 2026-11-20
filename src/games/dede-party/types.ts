/**
 * Types de Dédé Party (contrat : supabase/games/dede-party.sql).
 * Phases : intro -> roll -> move -> mg_intro -> mg_play -> mg_result -> roll … -> awards -> finished.
 */
import type { MapId } from './boards/types'

export type DpPhase = 'intro' | 'roll' | 'move' | 'mg_intro' | 'mg_play' | 'mg_result' | 'awards' | 'finished' | 'aborted'

export type MgKind = 'quiz' | 'pif' | 'majorite' | 'buzzer' | 'etoiles' | 'chrono'

/** Évènement d'une étape de déplacement (ou de la case d'arrivée). */
export interface DpEvent {
  /**
   * toll : péage de la Tombola (d ≤ 0, pot = cagnotte après) ; jackpot : gros lot (d, pot = 5) ;
   * riton : croisement de Riton (k steal | drop | none, d, sack après) ; tp : télésiège / verglas (k, from, to).
   * wash : pion emporté par la vague (front seulement, tiré de l'épilogue de la marée).
   */
  t: 'start' | 'clap' | 'pub' | 'star' | 'star_poor' | 'card' | 'fork' | 'toll' | 'jackpot' | 'riton' | 'tp' | 'wash'
  /** Pièces gagnées / perdues (start, clap, pub ; pickpocket, Téléthon). */
  d?: number
  /** Étoile : prix payé, nouvelles cases des étoiles (aussi carte « changement de décor »), achat pile sur la case. */
  cost?: number
  stars?: number[]
  /** Téléthon : joueur qui reçoit. */
  to?: number | string
  /** Embranchement : numéro de l'aiguillage et voie prise (0 = tout droit, 1 = détour). */
  fork?: number
  way?: number
  /** Embranchement commandé par la marée (Dédé-sur-Mer) : pas de bascule. */
  tide?: boolean
  /** Tombola : cagnotte après l'évènement. Riton : contenu du sac après. */
  pot?: number
  sack?: number
  /** Riton : steal | drop | none ; tp : lift | ice. */
  k?: string
  exact?: boolean
  need?: number
  /** Carte : id, texte, gain du tireur, dé relancé, joueur visé… */
  card?: string
  text?: string
  gain?: number
  die?: number
  with?: string
  /** Carte pickpocket : joueur volé ; tp / wash : case de départ. */
  from?: string | number
  cell?: number
  none?: boolean
  /** Évènements d'épilogue (front) : joueur concerné. */
  id?: string
}

export interface DpStep {
  cell: number
  ev: DpEvent[]
  /** Étape due à une carte (avance / recule / relance). */
  card?: boolean
  /** Étape ajoutée par un téléporteur (Dédé 2000) : saut en cloche, pas un pas à pied. */
  tp?: 'lift' | 'ice'
}

/** État de la mécanique du plateau : {} (grand, ski) · marée · cagnotte · Riton. */
export interface DpMech {
  /** Dédé-sur-Mer : 0 = basse, 1 = haute ; fins de tour avant le prochain changement. */
  tide?: 0 | 1
  tide_in?: number
  /** La Kermesse : cagnotte de la Tombola. */
  pot?: number
  /** Le Camping : case de Riton et contenu de son sac. */
  riton?: number
  sack?: number
}

export interface DpRitonHit {
  id: string
  cell: number
  k: 'steal' | 'drop' | 'none'
  d: number
  sack: number
}

/** Épilogue du tour (joué après le dernier pion, EPI_MS). */
export type DpEpi =
  | { t: 'tide'; tide: 0 | 1; washed: Array<{ id: string; from: number; d: number }>; stars?: number[]; after: DpSnap }
  | { t: 'riton'; die: number; from: number; path: number[]; hits: DpRitonHit[]; after: DpSnap }

export interface DpSnap {
  pos: Record<string, number>
  coins: Record<string, number>
  stars: Record<string, number>
  /** Cases des étoiles en jeu (1 à 3 selon le nombre de joueurs). */
  star_cells: number[]
  /** Aiguillages des embranchements (0 = tout droit, 1 = détour) : basculent à chaque passage. */
  sw: number[]
  dist: Record<string, number>
  /** Mécanique du plateau (cagnotte, sac et case de Riton, marée) « en direct ». */
  mech?: DpMech
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
  /** Plus gros gain en une fois : carte Enveloppe, gros lot (card 'jackpot'), sac de Riton (card 'riton'). */
  best_card?: { card: string; text: string; gain: number }
  washed?: number
  toll_paid?: number
  jackpots?: number
  jackpot_best?: number
  robbed?: number
  loot?: number
  lifts?: number
  slides?: number
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
  star_cells: number[]
  sw: number[]
  /** Plateau de la partie (absent : partie lancée avant les 5 plateaux = Grand Plateau). */
  map?: MapId
  mech?: DpMech
  /** Épilogue du tour (null quand le tour n'en a pas). */
  epi?: DpEpi | null
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
/** Durée de l'épilogue du tour (marée, ronde de Riton) : `_dp_const().epi_s`. */
export const EPI_MS = 4000
/** Épilogue de Riton : le dé roule, puis Riton trottine case par case. */
export const RITON_DIE_MS = 600
export const RITON_STEP_MS = 350
/** Épilogue de la marée : l'eau monte (ou descend) en 2 s, la vague emporte les pions à 1,2 s. */
export const TIDE_MS = 2000
export const WASH_AT_MS = 1200

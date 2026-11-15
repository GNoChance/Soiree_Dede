/**
 * Contrat « Loup-garou » (id `loup-garou`) — miroir de supabase/games/loup-garou.sql.
 *
 * State public (`matches.state`) : LgState — AUCUN secret (rôles des vivants,
 * votes des loups, résultats de la voyante, potions, amoureux restent côté
 * serveur et dans les secrets). Secret de chaque joueur (`match_secrets.secret`,
 * recalculé et ré-upserté à chaque action) : LgSecret ; meneur non joueur :
 * LgNarratorSecret.
 *
 * Choix de règles (non imposés par le cahier des charges) :
 * - Étapes de nuit : cupidon, amoureux (nuit 1) → voyante → protecteur → loups → sorcière.
 *   Une étape existe dès que le rôle est dans la composition (publique), vivant
 *   ou non. Durée : max si un acteur vivant doit agir ; dès qu'il a agi, fin à
 *   début + minimum (+ aléa 0-3 s) ; rôle mort/absent : minimum + aléa 0-6 s.
 * - Loups : vote modifiable, visible des autres loups ; unanimité = étape finie
 *   (après le minimum). Échéance : majorité, égalité → tirage parmi les ex-aequo,
 *   aucun vote → personne. Les loups ne peuvent pas viser un loup.
 * - Sorcière : voit la cible des loups même si le protecteur l'a protégée (elle
 *   ne connaît pas la protection) ; peut se sauver elle-même ; ne peut pas
 *   s'empoisonner ; peut utiliser ses deux potions la même nuit.
 * - Protecteur : peut se protéger ; pas la même cible deux nuits de suite
 *   (une nuit sans protection remet le compteur à zéro). Ne protège pas du poison.
 * - Vote du jour : public et modifiable, dépouillé dès que tous les vivants ont
 *   voté (ou échéance / hôte). Majorité relative ; 1re égalité → revote entre
 *   ex-aequo ; 2e égalité → personne n'est éliminé. Aucun vote → personne.
 * - Chasseur : tire de nuit comme de jour, 40 s ; échéance = pas de tir.
 * - Amoureux : un loup + un non-loup forment un camp à part (« amoureux ») qui
 *   gagne s'ils sont les 2 derniers ; ils perdent avec leur ancien camp sinon.
 *   Amoureux du même camp : gagnent avec leur camp.
 * - Victoire testée après chaque révélation (et après le tir du chasseur) :
 *   amoureux mixtes vivants → gagnent à 2, loups « purs » gagnent s'ils sont ≥
 *   aux autres vivants ; sinon village si 0 loup, loups si loups ≥ autres.
 * - Morts = spectateurs : ils ne voient que les rôles révélés (pas de rôles
 *   secrets, sinon la tentation de souffler est trop forte).
 * - Hôte meneur (option) : retiré des joueurs, il reçoit un secret avec tous
 *   les rôles (grimoire à maintenir appuyé) et la voix ; il garde les boutons.
 * - Causes de mort publiques : « night » (sans préciser loups ou poison),
 *   « vote », « chagrin », « chasseur ».
 */

export type LgRole = 'loup' | 'villageois' | 'voyante' | 'sorciere' | 'cupidon' | 'chasseur' | 'protecteur'
export type LgSpecialRole = 'voyante' | 'sorciere' | 'chasseur' | 'cupidon' | 'protecteur'
export type LgStep = 'cupidon' | 'amoureux' | 'voyante' | 'protecteur' | 'loups' | 'sorciere'
export type LgPhase = 'roles' | 'night' | 'reveal' | 'hunter' | 'day' | 'vote' | 'finished' | 'aborted'
export type LgCause = 'night' | 'vote' | 'chagrin' | 'chasseur'
export type LgWinner = 'village' | 'loups' | 'amoureux'

export interface LgComposition {
  loup: number
  villageois: number
  voyante: number
  sorciere: number
  chasseur: number
  cupidon: number
  protecteur: number
}

export interface LgDeath {
  id: string
  role: LgRole
  cause: LgCause
  night: number
  /** Révélation pendant laquelle la mort a eu lieu. */
  when: 'dawn' | 'vote' | 'hunter'
}

export interface LgReveal {
  kind: 'dawn' | 'vote' | 'hunter'
  night: number
  deaths: LgDeath[]
  /** vote */
  votes?: Record<string, string>
  counts?: Record<string, number>
  tied?: string[]
  outcome?: 'majority' | 'tie' | 'none'
  eliminated?: string | null
  revote?: boolean
  /** hunter */
  hunter?: string
  target?: string | null
}

/** Chronique privée d'une nuit (publique en fin de partie). */
export interface LgNightLog {
  night: number
  lovers?: [string, string]
  seer?: string
  protect?: string
  wolves?: string | null
  saved?: string
  poison?: string
  deaths: string[]
}

export interface LgState {
  game: 'loup-garou'
  phase: LgPhase
  players: string[]
  alive: string[]
  /** Hôte meneur non joueur (null si l'hôte joue). */
  narrator: string | null
  composition: LgComposition
  debate_seconds: number
  /** Numéro de nuit (le jour N suit la nuit N). 0 pendant `roles`. */
  night: number
  step: LgStep | null
  step_started: string | null
  /** Durée max de l'étape (s) : compte à rebours de l'acteur = step_started + step_max. */
  step_max: number | null
  /** Échéance du prochain `tick` (non affichée pendant la nuit : elle trahirait les morts). */
  deadline: string | null
  votes: Record<string, string>
  candidates: string[]
  revote: boolean
  first_vote: { votes: Record<string, string>; counts: Record<string, number>; tied: string[] } | null
  reveal: LgReveal | null
  after: 'day' | 'night' | null
  /** Chasseur qui doit tirer (phase hunter). */
  hunter: string | null
  hunter_pending: string | null
  dead: LgDeath[]
  history: LgReveal[]
  winner: LgWinner | null
  /** Fin de partie uniquement. */
  roles: Record<string, LgRole> | null
  lovers: string[] | null
  chronicle: LgNightLog[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  seq?: number
}

export interface LgSecret {
  role: LgRole
  night: number
  step: LgStep | null
  /** Je dois agir pendant l'étape de nuit en cours. */
  acting: boolean
  /** J'ai agi (ou unanimité des loups). */
  done: boolean
  /** Loups : tous les loups (ordre des joueurs) + votes de l'étape en cours. */
  wolves?: string[]
  wolf_votes?: Record<string, string>
  /** Voyante : toutes ses visions. */
  seer?: Array<{ night: number; target: string; role: LgRole }>
  /** Sorcière */
  potions?: { life: boolean; death: boolean }
  victim?: string | null
  /** Protecteur */
  last_protected?: string | null
  /** Amoureux (dès l'étape « amoureux »). */
  lover?: { id: string; role: LgRole; mixed: boolean }
}

export interface LgNarratorSecret {
  narrator: true
  roles: Record<string, LgRole>
  lovers: string[]
  step: LgStep | null
}

export type LgAnySecret = LgSecret | LgNarratorSecret

export const isNarratorSecret = (s: unknown): s is LgNarratorSecret =>
  Boolean(s && typeof s === 'object' && (s as { narrator?: unknown }).narrator === true)

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export type LgCompositionInput = Omit<LgComposition, 'villageois'>

export interface LgOptions {
  /** Absente = suggestion automatique selon le nombre de joueurs. */
  composition?: LgCompositionInput
  debate_seconds: number
  host_plays: boolean
}

export const LG_DEFAULT_OPTIONS: LgOptions = { debate_seconds: 180, host_plays: true }
export const LG_MIN_PLAYERS = 5
export const LG_MAX_PLAYERS = 9
export const SPECIAL_ROLES: LgSpecialRole[] = ['voyante', 'sorciere', 'protecteur', 'chasseur', 'cupidon']

/** Miroir de `_lg_suggest` (SQL). */
export function suggestComposition(n: number): LgCompositionInput {
  if (n <= 5) return { loup: 1, voyante: 1, sorciere: 1, chasseur: 0, cupidon: 0, protecteur: 0 }
  if (n === 6) return { loup: 2, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 0, protecteur: 0 }
  if (n === 7) return { loup: 2, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, protecteur: 0 }
  return { loup: 2, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, protecteur: 1 }
}

export function specialsCount(c: LgCompositionInput): number {
  return SPECIAL_ROLES.reduce((s, r) => s + (c[r] ? 1 : 0), 0)
}

/** null si valide, sinon message FR. */
export function compositionError(c: LgCompositionInput, n: number): string | null {
  if (c.loup < 1) return 'Il faut au moins un loup-garou.'
  if (c.loup * 2 >= n) return 'Les loups doivent être moins de la moitié des joueurs.'
  if (c.loup + specialsCount(c) > n) return 'Trop de rôles pour le nombre de joueurs.'
  return null
}

export function fullComposition(c: LgCompositionInput, n: number): LgComposition {
  return { ...c, villageois: Math.max(0, n - c.loup - specialsCount(c)) }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export const lgActions = {
  tick: () => ({ type: 'tick' }),
  next: () => ({ type: 'next' }),
  endDebate: () => ({ type: 'end_debate' }),
  closeVote: () => ({ type: 'close_vote' }),
  dayVote: (target: string) => ({ type: 'day_vote', target }),
  hunterShot: (target: string | null) => ({ type: 'hunter_shot', target }),
  cupidon: (a: string, b: string) => ({ type: 'night_action', targets: [a, b] }),
  target: (target: string | null) => ({ type: 'night_action', target }),
  witch: (save: boolean, target: string | null) => ({ type: 'night_action', save, target }),
}

/* -------------------------------------------------------------------------- */
/* Présentation des rôles                                                       */
/* -------------------------------------------------------------------------- */

export interface RoleInfo {
  label: string
  plural: string
  emoji: string
  /** Couleur de carte */
  color: string
  camp: 'loups' | 'village'
  goal: string
  power: string
}

export const ROLE_INFO: Record<LgRole, RoleInfo> = {
  loup: {
    label: 'Loup-garou',
    plural: 'Loups-garous',
    emoji: '🐺',
    color: '#ef476f',
    camp: 'loups',
    goal: 'Dévorer les villageois jusqu’à être aussi nombreux qu’eux.',
    power: 'Chaque nuit, avec ta meute, choisis une victime. Le jour, fais-toi passer pour un innocent.',
  },
  villageois: {
    label: 'Villageois',
    plural: 'Villageois',
    emoji: '🧑‍🌾',
    color: '#06d6a0',
    camp: 'village',
    goal: 'Démasquer et éliminer tous les loups-garous.',
    power: 'Pas de pouvoir… mais ta voix au vote compte autant que les autres. Observe, accuse, convaincs !',
  },
  voyante: {
    label: 'Voyante',
    plural: 'Voyantes',
    emoji: '🔮',
    color: '#8b5cf6',
    camp: 'village',
    goal: 'Aider le village à trouver les loups.',
    power: 'Chaque nuit, découvre le vrai rôle d’un joueur. Attention à ne pas te dévoiler trop vite !',
  },
  sorciere: {
    label: 'Sorcière',
    plural: 'Sorcières',
    emoji: '🧪',
    color: '#4cc9f0',
    camp: 'village',
    goal: 'Aider le village à trouver les loups.',
    power: 'Tu sais qui les loups ont attaqué. Une potion de vie pour le sauver, une potion de mort pour éliminer quelqu’un. Une seule fois chacune.',
  },
  cupidon: {
    label: 'Cupidon',
    plural: 'Cupidons',
    emoji: '💘',
    color: '#ff8fa3',
    camp: 'village',
    goal: 'Aider le village à trouver les loups.',
    power: 'La première nuit, unis deux joueurs par l’amour. Si l’un meurt, l’autre meurt de chagrin.',
  },
  chasseur: {
    label: 'Chasseur',
    plural: 'Chasseurs',
    emoji: '🏹',
    color: '#fb8500',
    camp: 'village',
    goal: 'Aider le village à trouver les loups.',
    power: 'Si tu meurs, de nuit comme de jour, tu emportes immédiatement quelqu’un avec toi.',
  },
  protecteur: {
    label: 'Protecteur',
    plural: 'Protecteurs',
    emoji: '🛡️',
    color: '#ffb703',
    camp: 'village',
    goal: 'Aider le village à trouver les loups.',
    power: 'Chaque nuit, protège un joueur des loups (toi compris), mais jamais le même deux nuits de suite.',
  },
}

export const ROLE_ORDER: LgRole[] = ['loup', 'voyante', 'sorciere', 'protecteur', 'chasseur', 'cupidon', 'villageois']

export const STEP_INFO: Record<LgStep, { label: string; emoji: string }> = {
  cupidon: { label: 'Cupidon', emoji: '💘' },
  amoureux: { label: 'Les amoureux', emoji: '💞' },
  voyante: { label: 'La voyante', emoji: '🔮' },
  protecteur: { label: 'Le protecteur', emoji: '🛡️' },
  loups: { label: 'Les loups-garous', emoji: '🐺' },
  sorciere: { label: 'La sorcière', emoji: '🧪' },
}

export const CAUSE_LABEL: Record<LgCause, string> = {
  night: 'mort·e cette nuit',
  vote: 'éliminé·e par le village',
  chagrin: 'mort·e de chagrin',
  chasseur: 'abattu·e par le chasseur',
}

export const WINNER_INFO: Record<LgWinner, { text: string; emoji: string; color: string }> = {
  village: { text: 'Le village a gagné !', emoji: '🏡', color: '#06d6a0' },
  loups: { text: 'Les loups-garous ont gagné !', emoji: '🐺', color: '#ef476f' },
  amoureux: { text: 'L’amour a triomphé !', emoji: '💞', color: '#ff8fa3' },
}

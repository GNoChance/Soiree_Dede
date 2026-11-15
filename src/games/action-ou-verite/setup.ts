/**
 * Logique pure de « Action ou vérité » côté front (sans React) : options, tirage
 * du lot de cartes (historique localStorage), forme des actions, roue, stats.
 * Contrat : ./types.ts et supabase/games/action-ou-verite.sql.
 * (Fichier sans alias `@/` : importable tel quel par les tests Node.)
 */
import type { TruthDareCard } from './cards'
import type { AovKind, AovLevel, AovPlayerStats, AovState } from './types'

export const aovActions = {
  choose: (kind: AovKind) => ({ type: 'choose', kind }),
  voteCard: (index: number) => ({ type: 'vote_card', index }),
  voteResult: (success: boolean) => ({ type: 'vote_result', success }),
  refuse: () => ({ type: 'refuse' }),
  /** Hôte : fait avancer la phase (choix aléatoire, dépouillement, tour suivant). */
  next: (round?: number) => (round === undefined ? { type: 'next' } : { type: 'next', round }),
  /** Hôte : termine la partie avec les scores actuels. */
  stop: () => ({ type: 'stop' }),
  tick: () => ({ type: 'tick' }),
}

export const AOV_LEVELS: { id: AovLevel; label: string; emoji: string; color: string; hint: string }[] = [
  { id: 1, label: 'Soft', emoji: '🌱', color: '#06D6A0', hint: 'Tranquille' },
  { id: 2, label: 'Fun', emoji: '😜', color: '#FFB703', hint: 'Ça chambre' },
  { id: 3, label: 'Osé', emoji: '🌶️', color: '#EF476F', hint: 'Gênant (tout public)' },
]

export const KIND_INFO: Record<AovKind, { label: string; emoji: string; color: string; text: string }> = {
  action: { label: 'ACTION', emoji: '🔥', color: '#EF476F', text: 'text-white' },
  verite: { label: 'VÉRITÉ', emoji: '🤫', color: '#4CC9F0', text: 'text-[#1f1b2e]' },
}

/** 0 = jusqu'à ce que l'hôte arrête. */
export const AOV_ROUND_CHOICES = [10, 15, 20, 0] as const

export interface AovOptions {
  rounds: number
  levels: AovLevel[]
  /** Minuteur doux de 60 s pour les actions. */
  softTimer: boolean
  /** Tour suivant automatique après 12 s. */
  auto: boolean
}

export const AOV_DEFAULT_OPTIONS: AovOptions = { rounds: 10, levels: [1, 2], softTimer: true, auto: false }

export function readOptions(o: Record<string, unknown>): AovOptions {
  const rounds = Number(o.rounds)
  const levels = Array.isArray(o.levels)
    ? ([1, 2, 3] as AovLevel[]).filter((l) => (o.levels as unknown[]).includes(l))
    : AOV_DEFAULT_OPTIONS.levels
  return {
    rounds: (AOV_ROUND_CHOICES as readonly number[]).includes(rounds) ? rounds : AOV_DEFAULT_OPTIONS.rounds,
    levels: levels.length ? levels : [1, 2, 3],
    softTimer: o.softTimer !== false,
    auto: o.auto === true,
  }
}

/* -------------------------------------------------------------------------- */
/* Tirage du lot de cartes (historique local : pas de répétition récente)      */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'dede:aov-played'

function readHistory(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(ids: string[]) {
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(ids))
  } catch {
    /* stockage indisponible : pas grave */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Cartes par type à envoyer : de quoi faire tous les tours du même type (3 propositions/tour). */
export function cardsPerKind(rounds: number): number {
  return rounds > 0 ? rounds * 3 + 6 : 90
}

/**
 * Tire `n` cartes de chaque type parmi les niveaux choisis : d'abord celles
 * jamais jouées, puis les plus anciennement jouées. Historique borné (ordre
 * ancien -> récent) pour toujours laisser du choix.
 */
export function pickCards(
  bank: TruthDareCard[],
  n: number,
  levels: AovLevel[],
  history: string[] = readHistory(),
): { picked: TruthDareCard[]; history: string[] } {
  const seen = new Set(history)
  const picked: TruthDareCard[] = []
  for (const kind of ['action', 'verite'] as const) {
    const pool = bank.filter((c) => c.kind === kind && levels.includes(c.level))
    const count = Math.min(n, pool.length)
    const fresh = shuffle(pool.filter((c) => !seen.has(c.id))).slice(0, count)
    if (fresh.length < count) {
      const byId = new Map(pool.map((c) => [c.id, c]))
      for (const id of history) {
        if (fresh.length >= count) break
        const c = byId.get(id)
        if (c && !fresh.includes(c)) fresh.push(c)
      }
    }
    picked.push(...fresh)
  }
  const ids = new Set(picked.map((c) => c.id))
  const maxLen = Math.max(0, bank.length - 60)
  const next = [...history.filter((id) => !ids.has(id)), ...picked.map((c) => c.id)].slice(-maxLen)
  return { picked, history: next }
}

/** p_options de start_match('action-ou-verite'). */
export function buildStartOptions(bank: TruthDareCard[], gages: string[], options: Record<string, unknown>, history?: string[]) {
  const o = readOptions(options)
  const { picked, history: next } = pickCards(bank, cardsPerKind(o.rounds), o.levels, history)
  return {
    options: {
      rounds: o.rounds,
      levels: o.levels,
      soft_timer: o.softTimer,
      auto: o.auto,
      gages,
      cards: picked.map((c) => ({ id: c.id, kind: c.kind, level: c.level, text: c.text })),
    },
    history: next,
  }
}

export async function prepareActionVeriteStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [{ TD_CARDS }, { GAGES }] = await Promise.all([import('./cards'), import('./gages')])
  const { options: start, history } = buildStartOptions(TD_CARDS, GAGES, options)
  writeHistory(history)
  return start
}

/* -------------------------------------------------------------------------- */
/* Roue                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Rotation finale (degrés, sens horaire) de la roue pour que le pointeur (en haut)
 * s'arrête dans la part `index` (sur `n`), à la position `offset` (0..1) de la part,
 * après `turns` tours complets. Part i = de i*360/n à (i+1)*360/n depuis le haut.
 */
export function wheelFinalAngle(n: number, index: number, turns: number, offset: number): number {
  const slice = 360 / Math.max(1, n)
  const a = (index + Math.min(0.95, Math.max(0.05, offset))) * slice
  return turns * 360 + (360 - a)
}

/** Part sous le pointeur pour une rotation donnée. */
export function sliceAt(n: number, rotation: number): number {
  const slice = 360 / Math.max(1, n)
  const a = (((360 - (rotation % 360)) % 360) + 360) % 360
  return Math.floor(a / slice) % n
}

/** Décélération réaliste (ease-out quintique) : rapide au départ, longue glissade. */
export const spinEase = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4.2)

/* -------------------------------------------------------------------------- */
/* Stats de fin                                                                */
/* -------------------------------------------------------------------------- */

export interface AovHighlights {
  brave: { id: string; count: number } | null
  sincere: { id: string; count: number } | null
  chicken: { id: string; count: number } | null
  judge: { id: string; count: number } | null
  champion: { id: string; count: number } | null
}

function topBy(ids: string[], score: (id: string) => number): { id: string; count: number } | null {
  let best: { id: string; count: number } | null = null
  for (const id of ids) {
    const v = score(id)
    if (v > 0 && (!best || v > best.count)) best = { id, count: v }
  }
  return best
}

export function computeHighlights(s: Pick<AovState, 'players' | 'stats'>): AovHighlights {
  const st = (id: string): Partial<AovPlayerStats> => s.stats?.[id] ?? {}
  const ids = s.players ?? []
  return {
    brave: topBy(ids, (id) => st(id).actions ?? 0),
    sincere: topBy(ids, (id) => st(id).verites ?? 0),
    chicken: topBy(ids, (id) => st(id).refusals ?? 0),
    judge: topBy(ids, (id) => st(id).thumbs_down ?? 0),
    champion: topBy(ids, (id) => st(id).success ?? 0),
  }
}

/** Libellé court du nombre de tours. */
export const roundsLabel = (n: number) => (n > 0 ? String(n) : '∞')

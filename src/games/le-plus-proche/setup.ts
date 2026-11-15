/**
 * Logique pure de « Le plus proche » côté front (sans React) : options, tirage des
 * questions, saisie/formatage des nombres en français, échelle de la règle de
 * révélation, statistiques de fin de partie.
 * Contrat : ./types.ts et supabase/games/le-plus-proche.sql.
 * (Fichier sans alias `@/` ni dépendance : importable tel quel par les tests Node.)
 */
import type { CloseQuestion, CloseTheme } from './questions'
import type { LppDifficulty, LppHistoryItem, LppQuestionInput } from './types'

export const lppActions = {
  answer: (round: number, value: number | null) => ({ type: 'answer', round, value }),
  reveal: (round: number) => ({ type: 'reveal', round }),
  next: (round: number) => ({ type: 'next', round }),
  tick: () => ({ type: 'tick' }),
}

export const LPP_THEMES: { id: CloseTheme; label: string; emoji: string; color: string }[] = [
  { id: 'geographie', label: 'Géo', emoji: '🌍', color: '#4CC9F0' },
  { id: 'histoire', label: 'Histoire', emoji: '🏰', color: '#FFB570' },
  { id: 'sciences', label: 'Sciences', emoji: '🔬', color: '#B5E61D' },
  { id: 'sport', label: 'Sport', emoji: '⚽', color: '#06D6A0' },
  { id: 'culture', label: 'Culture', emoji: '🎭', color: '#FF8FA3' },
  { id: 'corps-humain', label: 'Corps humain', emoji: '🫀', color: '#FFC8DD' },
  { id: 'animaux', label: 'Animaux', emoji: '🐾', color: '#06D6A0' },
  { id: 'records', label: 'Records', emoji: '🏆', color: '#FFB703' },
  { id: 'quotidien', label: 'Quotidien', emoji: '🛒', color: '#C4B5FD' },
  { id: 'espace', label: 'Espace', emoji: '🚀', color: '#8B5CF6' },
]

export const themeInfo = (id: string) =>
  LPP_THEMES.find((t) => t.id === id) ?? { id, label: 'Culture G', emoji: '🎯', color: '#FFB703' }

export const LPP_ROUND_CHOICES = [10, 15, 20] as const
export const LPP_DURATION_CHOICES = [20, 30, 45] as const

/** Valeur absolue maximale (questions et estimations), identique au serveur. */
export const LPP_MAX_ABS = 1e15
/** Décimales max d'une estimation (le serveur arrondit au-delà). */
export const LPP_MAX_DECIMALS = 6

export interface LppOptions {
  rounds: number
  /** Thèmes retenus ; vide = tous. */
  themes: CloseTheme[]
  difficulty: LppDifficulty
  duration: number
}

export const LPP_DEFAULT_OPTIONS: LppOptions = { rounds: 10, themes: [], difficulty: 'mixte', duration: 30 }

export function readOptions(o: Record<string, unknown>): LppOptions {
  const rounds = Number(o.rounds)
  const duration = Number(o.duration)
  const valid = new Set<string>(LPP_THEMES.map((t) => t.id))
  return {
    rounds: (LPP_ROUND_CHOICES as readonly number[]).includes(rounds) ? rounds : LPP_DEFAULT_OPTIONS.rounds,
    themes: Array.isArray(o.themes) ? (o.themes.filter((t) => typeof t === 'string' && valid.has(t)) as CloseTheme[]) : [],
    difficulty: o.difficulty === 'facile' || o.difficulty === 'difficile' ? o.difficulty : 'mixte',
    duration: (LPP_DURATION_CHOICES as readonly number[]).includes(duration) ? duration : LPP_DEFAULT_OPTIONS.duration,
  }
}

/* -------------------------------------------------------------------------- */
/* Tirage (historique localStorage)                                            */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'dede:lpp-played'

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

/** Question jouable : énoncé non vide, réponse finie dans les bornes du serveur. */
export const isPlayable = (q: CloseQuestion) =>
  typeof q.prompt === 'string' && q.prompt.trim().length > 0 && Number.isFinite(q.answer) && Math.abs(q.answer) <= LPP_MAX_ABS

/** Écart de difficulté toléré : 0 = demandé, 1 = voisin, 2 = opposé. */
function tier(q: CloseQuestion, d: LppDifficulty): number {
  if (d === 'mixte') return 0
  return Math.abs(q.difficulty - (d === 'facile' ? 1 : 3))
}

/**
 * Tire `rounds` questions parmi les thèmes choisis (élargit à toute la banque si
 * trop peu), difficulté respectée au mieux, questions déjà jouées sur cet appareil
 * en dernier (les plus anciennes d'abord). Mixte : crescendo de difficulté.
 */
export function pickQuestions(bank: CloseQuestion[], opts: LppOptions, history: string[]): { picked: CloseQuestion[]; history: string[] } {
  const playable = bank.filter(isPlayable)
  const themes = opts.themes.length ? new Set<string>(opts.themes) : null
  let pool = themes ? playable.filter((q) => themes.has(q.theme)) : playable
  if (pool.length < opts.rounds) pool = playable
  const age = new Map(history.map((id, i) => [id, i]))
  const score = (q: CloseQuestion) => {
    const t = tier(q, opts.difficulty)
    const seen = age.has(q.id)
    const rank = t === 2 ? 4 + (seen ? 1 : 0) : seen ? 2 + t : t
    return rank * 1e6 + (seen ? (age.get(q.id) ?? 0) : 0)
  }
  const picked = shuffle(pool)
    .map((q) => ({ q, s: score(q) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, Math.max(0, Math.min(opts.rounds, pool.length)))
    .map((x) => x.q)
  if (opts.difficulty === 'mixte') picked.sort((a, b) => a.difficulty - b.difficulty)
  const ids = new Set(picked.map((q) => q.id))
  const maxLen = Math.max(0, playable.length - 30)
  const next = [...history.filter((id) => !ids.has(id)), ...picked.map((q) => q.id)].slice(-maxLen)
  return { picked, history: next }
}

/** p_options de start_match('le-plus-proche') à partir d'une banque (testable). */
export function buildStartOptions(bank: CloseQuestion[], options: Record<string, unknown>, history: string[] = []) {
  const opts = readOptions(options)
  const { picked, history: nextHistory } = pickQuestions(bank, opts, history)
  const questions: LppQuestionInput[] = picked.map((q) => ({
    id: q.id,
    theme: q.theme,
    difficulty: q.difficulty,
    prompt: q.prompt,
    unit: q.unit ?? null,
    answer: q.answer,
    note: q.note ?? null,
  }))
  return { history: nextHistory, options: { duration: opts.duration, questions } }
}

export async function prepareLppStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { CLOSE_QUESTIONS } = await import('./questions')
  const { options: out, history } = buildStartOptions(CLOSE_QUESTIONS, options, readHistory())
  writeHistory(history)
  return out
}

/* -------------------------------------------------------------------------- */
/* Saisie des nombres (FR)                                                     */
/* -------------------------------------------------------------------------- */

/** Espace fine insécable : séparateur de milliers de fr-FR (Intl). */
export const THIN = '\u202F'
/** Séparateurs de milliers tolérés : espaces (dont insécables/fines), apostrophes, « _ ». */
const SPACES = /[\s'\u2019_]/g
/** Signes moins typographiques ramenés à « - ». */
const MINUS = /[\u2212\u2012\u2013]/g

/**
 * Découpe un corps « chiffres + séparateurs » (sans signe ni espaces) :
 * - virgule ET point présents : le DERNIER des deux est la virgule décimale, l'autre
 *   sert de séparateur de milliers (« 1.234,5 » et « 1,234.5 » = 1234,5) ;
 * - un seul type répété avec des groupes de 3 chiffres : milliers (« 1.234.567 ») ;
 * - sinon le PREMIER séparateur est décimal (« 1,5 », « 1.5 », « 1.234 » = 1,234) et
 *   les suivants sont `extra` (refusés au parsing, ignorés à la saisie en direct).
 */
function splitBody(body: string): { int: string; frac: string | null; extra: boolean } {
  const hasComma = body.includes(',')
  const hasDot = body.includes('.')
  if (hasComma && hasDot) {
    const dec = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.'
    const thou = dec === ',' ? '.' : ','
    const i = body.lastIndexOf(dec)
    const head = body.slice(0, i)
    const tail = body.slice(i + 1)
    const extra = head.includes(dec) || tail.includes(thou) || !validGroups(head.split(thou))
    return { int: head.replace(/[.,]/g, ''), frac: tail.replace(/[.,]/g, ''), extra }
  }
  const sep = hasComma ? ',' : hasDot ? '.' : null
  if (!sep) return { int: body, frac: null, extra: false }
  const parts = body.split(sep)
  if (parts.length > 2 && validGroups(parts)) return { int: parts.join(''), frac: null, extra: false }
  return { int: parts[0], frac: parts.slice(1).join(''), extra: parts.length > 2 }
}

function validGroups(parts: string[]): boolean {
  if (parts.length < 2) return true
  return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))
}

export type ParseResult = { ok: true; value: number } | { ok: false; reason: 'empty' | 'invalid' | 'range' }

/**
 * Lit une estimation tapée en français, de façon tolérante :
 * « 1 234,5 », « 1234.5 », « 1.234,5 », « 1,234.5 », « -12 », « −12 », « ,5 », « 12, ».
 * Espaces (normales, insécables, fines), apostrophes et « _ » = séparateurs de milliers.
 * REFUSÉ (invalid) : suffixes (« 1.5k », « 2 M », « 3 millions »), notation scientifique
 * (« 1e6 »), unités, texte. Le clavier numérique n'a pas de lettres et « k » serait
 * ambigu (kilo ? milliers ?) : on préfère obliger à taper le nombre.
 * Hors bornes (|x| > 1e15) : range. Plus de 6 décimales : arrondi à 6.
 */
export function parseNumberInput(raw: string): ParseResult {
  let s = String(raw ?? '').replace(MINUS, '-').replace(SPACES, '')
  if (!s) return { ok: false, reason: 'empty' }
  let neg = false
  if (s[0] === '-' || s[0] === '+') {
    neg = s[0] === '-'
    s = s.slice(1)
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, reason: 'invalid' }
  const { int, frac, extra } = splitBody(s)
  if (extra) return { ok: false, reason: 'invalid' }
  const n = Number(`${int || '0'}.${frac || '0'}`)
  if (!Number.isFinite(n)) return { ok: false, reason: 'invalid' }
  if (n > LPP_MAX_ABS) return { ok: false, reason: 'range' }
  const r = (frac ?? '').length > LPP_MAX_DECIMALS ? Number(n.toFixed(LPP_MAX_DECIMALS)) : n
  const value = neg && r !== 0 ? -r : r
  return { ok: true, value }
}

const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN)

/**
 * Formatage en direct du champ de saisie : chiffres groupés par 3 (espace fine),
 * virgule décimale, signe moins en tête. Conserve une virgule finale (« 12, » pendant
 * la frappe). Limite : 16 chiffres entiers, 6 décimales.
 * `caret` (position dans `raw`) est reportée dans le texte formaté en comptant
 * les caractères significatifs (chiffres, virgule, signe) qui la précèdent.
 */
export function formatLive(raw: string, caret: number = raw.length): { text: string; caret: number } {
  const norm = String(raw ?? '').replace(MINUS, '-')
  const sig = (c: string) => /[\d.,-]/.test(c)
  const before = [...norm.slice(0, caret)].filter(sig).length
  const neg = /^\s*-/.test(norm)
  const body = norm.replace(/[^\d.,]/g, '')
  if (!body) return { text: neg ? '-' : '', caret: neg ? 1 : 0 }
  const { int: rawInt, frac: rawFrac } = splitBody(body)
  let int = rawInt.replace(/^0+(?=\d)/, '').slice(0, 16)
  const frac = rawFrac === null ? null : rawFrac.slice(0, LPP_MAX_DECIMALS)
  if (!int && frac !== null) int = '0'
  const text = `${neg ? '-' : ''}${groupDigits(int)}${frac !== null ? `,${frac}` : ''}`
  // Report du curseur
  let count = 0
  let pos = 0
  while (pos < text.length && count < before) {
    if (sig(text[pos])) count++
    pos++
  }
  return { text, caret: before === 0 ? 0 : pos }
}

/** Texte de saisie à partir d'une valeur (rechargement, « Modifier »). */
export const toInputText = (n: number) => formatLive(String(n).replace('.', ',')).text

/** « 1 234,5 » (espace fine), jusqu'à 6 décimales significatives. */
export function formatNumber(n: number, maxDecimals = LPP_MAX_DECIMALS): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('fr-FR', { maximumFractionDigits: maxDecimals })
}

/** Libellé court pour les graduations : « 1,5 k », « 12 M », « 3 Md ». */
export function formatCompact(n: number): string {
  if (Math.abs(n) < 10000) return formatNumber(n, Math.abs(n) < 10 ? 2 : 1)
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** « 1 234 m » / « 12 % » / « 1 234 » */
export const withUnit = (n: number, unit: string | null | undefined) => (unit ? `${formatNumber(n)} ${unit}` : formatNumber(n))

/* -------------------------------------------------------------------------- */
/* Échelle de la règle graduée                                                 */
/* -------------------------------------------------------------------------- */

export interface RulerScale {
  kind: 'linear' | 'log'
  min: number
  max: number
  ticks: number[]
  /** Position 0..1 sur la règle (bornée). */
  pos: (v: number) => number
}

/** Rapport max/min à partir duquel la règle passe en logarithmique. */
export const LOG_RATIO = 100

function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

/**
 * Échelle automatique : logarithmique si toutes les valeurs (estimations + réponse)
 * sont strictement positives et s'étalent sur au moins deux ordres de grandeur
 * (max/min ≥ 100), linéaire sinon (valeurs nulles ou négatives comprises).
 * Bornes arrondies à des graduations « rondes » englobant toutes les valeurs.
 */
export function buildScale(values: number[], truth: number): RulerScale {
  const all = [...values, truth].filter(Number.isFinite)
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (min > 0 && max / min >= LOG_RATIO) {
    const lo = Math.floor(Math.log10(min))
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)))
    const every = Math.ceil((hi - lo + 1) / 7)
    const ticks: number[] = []
    for (let e = lo; e <= hi; e += every) ticks.push(10 ** e)
    const l0 = lo
    const span = hi - lo
    return {
      kind: 'log',
      min: 10 ** lo,
      max: 10 ** hi,
      ticks,
      pos: (v) => (v <= 0 ? 0 : Math.min(1, Math.max(0, (Math.log10(v) - l0) / span))),
    }
  }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1
    min -= pad
    max += pad
  }
  const step = niceStep(max - min, 4)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step)
  return {
    kind: 'linear',
    min: lo,
    max: hi,
    ticks,
    pos: (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))),
  }
}

/**
 * Répartit des marqueurs (positions 0..1) sur des « étages » pour éviter qu'ils se
 * chevauchent : un marqueur monte d'un étage si un autre est à moins de `gap`.
 */
export function assignLanes(positions: number[], gap = 0.12, maxLanes = 3): number[] {
  const order = positions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const lastByLane: number[] = []
  const lanes = new Array<number>(positions.length).fill(0)
  for (const { p, i } of order) {
    let lane = lastByLane.findIndex((last) => p - last >= gap)
    if (lane === -1) lane = lastByLane.length < maxLanes ? lastByLane.length : lastByLane.indexOf(Math.min(...lastByLane))
    lastByLane[lane] = p
    lanes[i] = lane
  }
  return lanes
}

/* -------------------------------------------------------------------------- */
/* Statistiques de fin de partie                                               */
/* -------------------------------------------------------------------------- */

/** Écart relatif |v − a| / |a| (si a = 0 : |v|). */
export const relError = (v: number, a: number) => (a === 0 ? Math.abs(v) : Math.abs(v - a) / Math.abs(a))

export interface LppPlayerStats {
  id: string
  /** Manches avec une valeur donnée. */
  answered: number
  exacts: number
  /**
   * Somme des écarts relatifs, chacun plafonné à 1 (100 %) ; une manche sans
   * estimation compte 1. Plus bas = plus précis.
   */
  precision: number
}

export interface LppWorst {
  profile_id: string
  round: number
  prompt: string
  unit: string | null
  value: number
  answer: number
  rel: number
}

export function computeStats(players: string[], history: LppHistoryItem[]) {
  const stats: LppPlayerStats[] = players.map((id) => {
    let answered = 0
    let exacts = 0
    let precision = 0
    for (const h of history) {
      const v = h.answers?.[id]
      if (typeof v === 'number') {
        answered++
        const e = h.ranking.find((r) => r.profile_id === id)
        if (e?.exact) exacts++
        precision += e?.exact ? 0 : Math.min(1, relError(v, h.answer))
      } else {
        precision += 1
      }
    }
    return { id, answered, exacts, precision }
  })
  const withAnswers = stats.filter((s) => s.answered > 0)
  const bestPrec = withAnswers.length ? Math.min(...withAnswers.map((s) => s.precision)) : null
  const mostPrecise = bestPrec === null ? [] : withAnswers.filter((s) => s.precision === bestPrec).map((s) => s.id)
  const maxExact = Math.max(0, ...stats.map((s) => s.exacts))
  const exactKings = maxExact > 0 ? stats.filter((s) => s.exacts === maxExact).map((s) => s.id) : []
  let worst: LppWorst | null = null
  for (const h of history) {
    for (const r of h.ranking) {
      const rel = relError(r.value, h.answer)
      if (rel > 0 && (!worst || rel > worst.rel)) {
        worst = { profile_id: r.profile_id, round: h.round, prompt: h.prompt, unit: h.unit, value: r.value, answer: h.answer, rel }
      }
    }
  }
  return { stats, mostPrecise, exactKings, maxExact, worst }
}

/** « 12 % », « ×8 », « ÷20 » : ampleur d'une erreur, lisible. */
export function describeMiss(value: number, answer: number): string {
  if (answer !== 0 && value !== 0 && Math.sign(value) === Math.sign(answer)) {
    const ratio = value / answer
    if (ratio >= 2) return `×${formatNumber(ratio, ratio < 10 ? 1 : 0)}`
    if (ratio <= 0.5) return `÷${formatNumber(1 / ratio, 1 / ratio < 10 ? 1 : 0)}`
  }
  if (answer === 0) return `à ${formatNumber(Math.abs(value))}`
  return `${formatNumber(Math.round(relError(value, answer) * 100))} %`
}

export const rankLabel = (n: number) => (n === 1 ? '1er' : `${n}e`)

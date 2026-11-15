/**
 * Logique pure de « Cerveau en fête » côté front (sans React) : options, tirage
 * des questions, forme des actions envoyées à game_action.
 * Contrat : ./types.ts et supabase/games/cerveau-en-fete.sql.
 * (Fichier sans alias `@/` ni dépendance : importable tel quel par les tests Node.)
 */
import type { QuizQuestion, QuizTheme } from './questions'
import type { CefDifficulty, CefFormat, CefMode } from './types'

export const cefActions = {
  answer: (round: number, text: string) => ({ type: 'answer', round, text }),
  choose: (round: number, index: number) => ({ type: 'choose', round, index }),
  pass: (round: number) => ({ type: 'pass', round }),
  skip: (round: number) => ({ type: 'skip', round }),
  next: (round: number) => ({ type: 'next', round }),
  tick: () => ({ type: 'tick' }),
}

export const CEF_THEMES: { id: QuizTheme; label: string; emoji: string; color: string }[] = [
  { id: 'cinema', label: 'Cinéma', emoji: '🎬', color: '#FF8FA3' },
  { id: 'series', label: 'Séries', emoji: '📺', color: '#C4B5FD' },
  { id: 'musique', label: 'Musique', emoji: '🎵', color: '#4CC9F0' },
  { id: 'sport', label: 'Sport', emoji: '⚽', color: '#06D6A0' },
  { id: 'geographie', label: 'Géo', emoji: '🌍', color: '#4CC9F0' },
  { id: 'histoire', label: 'Histoire', emoji: '🏰', color: '#FFB570' },
  { id: 'sciences', label: 'Sciences', emoji: '🔬', color: '#B5E61D' },
  { id: 'gastronomie', label: 'Gastronomie', emoji: '🧀', color: '#FFB703' },
  { id: 'jeux-video', label: 'Jeux vidéo', emoji: '🎮', color: '#C4B5FD' },
  { id: 'animaux', label: 'Animaux', emoji: '🐾', color: '#06D6A0' },
  { id: 'culture-pop', label: 'Culture pop', emoji: '✨', color: '#FF8FA3' },
  { id: 'langue-francaise', label: 'Langue française', emoji: '📚', color: '#FFC8DD' },
]

export const themeInfo = (id: string) =>
  CEF_THEMES.find((t) => t.id === id) ?? { id, label: 'Culture G', emoji: '🧠', color: '#FFB703' }

export const CEF_COUNT_CHOICES = [10, 20, 30] as const
export const CEF_DURATION_CHOICES = [15, 20, 30] as const

export interface CefOptions {
  count: number
  /** Thèmes retenus ; vide = tous. */
  themes: QuizTheme[]
  difficulty: CefDifficulty
  duration: number
  /** Format des réponses (mixte par défaut). */
  format: CefFormat
}

export const CEF_DEFAULT_OPTIONS: CefOptions = { count: 20, themes: [], difficulty: 'mixte', duration: 20, format: 'mixte' }

export function readOptions(o: Record<string, unknown>): CefOptions {
  const count = Number(o.count)
  const duration = Number(o.duration)
  const valid = new Set<string>(CEF_THEMES.map((t) => t.id))
  return {
    count: (CEF_COUNT_CHOICES as readonly number[]).includes(count) ? count : CEF_DEFAULT_OPTIONS.count,
    themes: Array.isArray(o.themes) ? (o.themes.filter((t) => typeof t === 'string' && valid.has(t)) as QuizTheme[]) : [],
    difficulty: o.difficulty === 'facile' || o.difficulty === 'difficile' ? o.difficulty : 'mixte',
    duration: (CEF_DURATION_CHOICES as readonly number[]).includes(duration) ? duration : CEF_DEFAULT_OPTIONS.duration,
    format: o.format === 'tape' || o.format === 'qcm' ? o.format : 'mixte',
  }
}

/* -------------------------------------------------------------------------- */
/* Historique local (questions déjà jouées sur cet appareil)                   */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'dede:cef-played'

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

/** Écart de difficulté toléré : 0 = demandé, 1 = voisin (moyen), 2 = opposé. */
function tier(q: QuizQuestion, d: CefDifficulty): number {
  if (d === 'mixte') return 0
  const target = d === 'facile' ? 1 : 3
  return Math.abs(q.difficulty - target)
}

/**
 * Tire `count` questions parmi les thèmes choisis, en respectant au mieux la
 * difficulté et en évitant les questions déjà jouées (historique localStorage).
 * Priorité : bonne difficulté jamais jouée > difficulté voisine jamais jouée >
 * bonne difficulté déjà jouée (les plus anciennes d'abord) > voisine déjà jouée >
 * difficulté opposée.
 */
export function pickQuestions(bank: QuizQuestion[], opts: CefOptions, history: string[]): { picked: QuizQuestion[]; history: string[] } {
  const themes = opts.themes.length ? new Set<string>(opts.themes) : null
  let pool = themes ? bank.filter((q) => themes.has(q.theme)) : bank
  if (pool.length < Math.min(opts.count, 5)) pool = bank // thèmes trop maigres : on élargit
  const age = new Map(history.map((id, i) => [id, i]))
  const score = (q: QuizQuestion) => {
    const t = tier(q, opts.difficulty)
    const seen = age.has(q.id)
    const rank = t === 2 ? 4 + (seen ? 1 : 0) : seen ? 2 + t : t
    return rank * 1e6 + (seen ? (age.get(q.id) ?? 0) : 0)
  }
  const picked = shuffle(pool)
    .map((q) => ({ q, s: score(q) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, Math.max(0, Math.min(opts.count, pool.length)))
    .map((x) => x.q)
  // Mixte : crescendo de difficulté (ordre aléatoire à difficulté égale).
  if (opts.difficulty === 'mixte') picked.sort((a, b) => a.difficulty - b.difficulty)
  const ids = new Set(picked.map((q) => q.id))
  const maxLen = Math.max(0, bank.length - 40)
  const next = [...history.filter((id) => !ids.has(id)), ...picked.map((q) => q.id)].slice(-maxLen)
  return { picked, history: next }
}

/** Mode tiré pour une question selon le format choisi. */
export function drawMode(q: QuizQuestion, format: CefFormat, rnd: () => number = Math.random): CefMode {
  const canType = q.typeable !== false
  const canMcq = Array.isArray(q.distractors) && q.distractors.length >= 3
  if (!canMcq) return 'typed'
  if (!canType || format === 'qcm') return 'mcq'
  if (format === 'tape') return 'typed'
  return rnd() < 0.5 ? 'typed' : 'mcq'
}

/** p_options de start_match('cerveau-en-fete') à partir d'une banque (testable). */
export function buildStartOptions(bank: QuizQuestion[], options: Record<string, unknown>, history: string[] = []) {
  const opts = readOptions(options)
  const { picked, history: nextHistory } = pickQuestions(bank, opts, history)
  return {
    history: nextHistory,
    options: {
      duration: opts.duration,
      questions: picked.map((q) => ({
        id: q.id,
        theme: q.theme,
        difficulty: q.difficulty,
        prompt: q.prompt,
        image: q.image ?? null,
        answer: q.answer,
        aliases: q.aliases ?? [],
        distractors: q.distractors,
        mode: drawMode(q, opts.format),
      })),
    },
  }
}

export async function prepareCerveauStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { QUESTIONS } = await import('./questions')
  const { options: out, history } = buildStartOptions(QUESTIONS, options, readHistory())
  writeHistory(history)
  return out
}

/* -------------------------------------------------------------------------- */
/* Affichage                                                                   */
/* -------------------------------------------------------------------------- */

/** "4,2 s" */
export const formatMs = (ms: number) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`

export const rankLabel = (n: number) => (n === 1 ? '1er' : `${n}e`)

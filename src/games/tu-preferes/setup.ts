/**
 * Logique pure de « Tu préfères ? » côté front (sans React) : options, tirage
 * des dilemmes (historique localStorage), forme des actions, stats de fin.
 * Contrat : ./types.ts et supabase/games/tu-preferes.sql.
 * (Fichier sans alias `@/` ni dépendance : importable tel quel par les tests Node.)
 */
import type { Dilemma, DilemmaTheme } from './dilemmas'
import type { TpHistoryEntry, TpSide, TpState } from './types'
import { customQuota, mergeDeck } from '../../features/cartes/merge'

export const tpActions = {
  answer: (round: number, choice: TpSide, bet: TpSide) => ({ type: 'answer', round, choice, bet }),
  reveal: () => ({ type: 'reveal' }),
  next: () => ({ type: 'next' }),
  tick: () => ({ type: 'tick' }),
}

export const TP_THEMES: { id: DilemmaTheme; label: string; emoji: string; color: string }[] = [
  { id: 'absurde', label: 'Absurde', emoji: '🤪', color: '#C4B5FD' },
  { id: 'quotidien', label: 'Quotidien', emoji: '🏠', color: '#FFB570' },
  { id: 'bouffe', label: 'Bouffe', emoji: '🍕', color: '#FFB703' },
  { id: 'pouvoirs', label: 'Pouvoirs', emoji: '⚡', color: '#4CC9F0' },
  { id: 'voyage', label: 'Voyage', emoji: '✈️', color: '#06D6A0' },
  { id: 'soiree', label: 'Soirée', emoji: '🎉', color: '#FF8FA3' },
  { id: 'gênant', label: 'Gênant', emoji: '🙈', color: '#FFC8DD' },
  { id: 'futur', label: 'Futur', emoji: '🚀', color: '#B5E61D' },
  { id: 'animaux', label: 'Animaux', emoji: '🐾', color: '#06D6A0' },
  { id: 'pop', label: 'Pop culture', emoji: '✨', color: '#FF8FA3' },
]

export const themeInfo = (id: string | null | undefined) =>
  TP_THEMES.find((t) => t.id === id) ?? { id: id ?? '', label: 'Dilemme', emoji: '🤔', color: '#FFB703' }

export const TP_ROUND_CHOICES = [10, 15, 20] as const
export const TP_TIMER_CHOICES = [20, 30, 45] as const

export interface TpOptions {
  rounds: number
  /** Secondes de réponse par manche. */
  timer: number
  /** Thèmes retenus ; vide = tous. */
  themes: DilemmaTheme[]
  /** Bonus « Rebelle » (+1 au seul de son avis). */
  rebel: boolean
  /** Mélange les cartes écrites par la bande (jusqu'à 1 sur 3). */
  customCards: boolean
}

export const TP_DEFAULT_OPTIONS: TpOptions = { rounds: 15, timer: 30, themes: [], rebel: true, customCards: true }

export function readOptions(o: Record<string, unknown>): TpOptions {
  const rounds = Number(o.rounds)
  const timer = Number(o.timer)
  const valid = new Set<string>(TP_THEMES.map((t) => t.id))
  return {
    rounds: (TP_ROUND_CHOICES as readonly number[]).includes(rounds) ? rounds : TP_DEFAULT_OPTIONS.rounds,
    timer: (TP_TIMER_CHOICES as readonly number[]).includes(timer) ? timer : TP_DEFAULT_OPTIONS.timer,
    themes: Array.isArray(o.themes) ? (o.themes.filter((t) => typeof t === 'string' && valid.has(t)) as DilemmaTheme[]) : [],
    rebel: o.rebel !== false,
    customCards: o.customCards !== false,
  }
}

/* -------------------------------------------------------------------------- */
/* Historique local (dilemmes déjà joués sur cet appareil)                     */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'dede:tp-played'

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

/**
 * Tire `n` dilemmes des thèmes choisis (vide = tous) sans répétition récente :
 * d'abord ceux jamais joués, puis les plus anciennement joués. S'il y a moins
 * de `n` dilemmes dans ces thèmes, on en renvoie moins (le serveur réduit `rounds`).
 * L'historique (ordre ancien -> récent) est borné pour toujours laisser du choix.
 */
export function pickDilemmas(bank: Dilemma[], n: number, themes: DilemmaTheme[] = [], history: string[] = readHistory()): { picked: Dilemma[]; history: string[] } {
  const pool = themes.length ? bank.filter((d) => themes.includes(d.theme)) : bank
  const count = Math.max(0, Math.min(n, pool.length))
  const seen = new Set(history)
  const picked = shuffle(pool.filter((d) => !seen.has(d.id))).slice(0, count)
  if (picked.length < count) {
    const byId = new Map(pool.map((d) => [d.id, d]))
    for (const id of history) {
      if (picked.length >= count) break
      const d = byId.get(id)
      if (d && !picked.includes(d)) picked.push(d)
    }
  }
  const pickedIds = new Set(picked.map((d) => d.id))
  const maxLen = Math.max(0, bank.length - 30)
  const next = [...history.filter((id) => !pickedIds.has(id)), ...picked.map((d) => d.id)].slice(-maxLen)
  return { picked, history: next }
}

/** p_options de start_match('tu-preferes') à partir des options de l'écran de lancement. */
export function buildStartOptions(bank: Dilemma[], options: Record<string, unknown>, history?: string[], custom: TpCustomDilemma[] = []) {
  const o = readOptions(options)
  const mine = o.customCards ? custom : []
  const k = customQuota(o.rounds, mine.length)
  const { picked, history: next } = pickDilemmas(bank, o.rounds - k, o.themes, history)
  const base: TpCustomDilemma[] = picked.map((d) => ({ id: d.id, a: d.a, b: d.b, theme: d.theme }))
  const deck = mergeDeck(base, mine, o.rounds)
  return {
    options: {
      rounds: deck.length,
      timer: o.timer,
      rebel: o.rebel,
      dilemmas: deck.map((d) => ({ id: d.id, a: d.a, b: d.b, theme: d.theme, ...(d.by ? { by: d.by } : {}) })),
    },
    history: next,
  }
}

/** Dilemme du lot envoyé au serveur ; `by` = profil auteur d'une carte maison. */
export interface TpCustomDilemma {
  id: string
  a: string
  b: string
  theme: string | null
  by?: string
}

export async function prepareTuPreferesStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { DILEMMAS } = await import('./dilemmas')
  let custom: TpCustomDilemma[] = []
  if (readOptions(options).customCards) {
    const { fetchPlayableCards } = await import('../../features/cartes/api')
    custom = (await fetchPlayableCards('tu-preferes')).map((c) => ({
      id: `cc-${c.id}`,
      a: String(c.payload.a ?? ''),
      b: String(c.payload.b ?? ''),
      theme: null,
      by: c.author_id,
    }))
  }
  const { options: start, history } = buildStartOptions(DILEMMAS, options, undefined, custom)
  writeHistory(history)
  return start
}

/* -------------------------------------------------------------------------- */
/* Stats fun de fin de partie                                                  */
/* -------------------------------------------------------------------------- */

export interface TpHighlights {
  /** Plus de fois « seul de son avis » (≥ 1). */
  rebel: { id: string; count: number } | null
  /** Plus souvent dans la majorité (≥ 1). */
  norm: { id: string; count: number; answered: number } | null
  /** Meilleur pronostiqueur de la majorité (≥ 1). */
  oracle: { id: string; count: number } | null
  /** Dilemme le plus partagé (le plus proche de 50/50, ≥ 2 réponses). */
  split: TpHistoryEntry | null
  /** Dilemme le plus unanime (≥ 2 réponses). */
  unanimous: TpHistoryEntry | null
}

function topBy(ids: string[], score: (id: string) => number): { id: string; v: number } | null {
  let best: { id: string; v: number } | null = null
  for (const id of ids) {
    const v = score(id)
    if (v > 0 && (!best || v > best.v)) best = { id, v }
  }
  return best
}

export function computeHighlights(s: Pick<TpState, 'players' | 'stats' | 'history'>): TpHighlights {
  const stats = s.stats ?? {}
  const ids = s.players ?? []
  const rebel = topBy(ids, (id) => stats[id]?.rebel ?? 0)
  // Ratio d'abord (dans la norme « en proportion »), puis le volume en départage.
  const norm = topBy(ids, (id) => {
    const st = stats[id]
    return st && st.answered ? st.norm / st.answered + st.norm / 1000 : 0
  })
  const oracle = topBy(ids, (id) => stats[id]?.bets_ok ?? 0)

  const rated = (s.history ?? []).filter((h) => h.counts.a + h.counts.b >= 2)
  let split: TpHistoryEntry | null = null
  let unanimous: TpHistoryEntry | null = null
  for (const h of rated) {
    const total = h.counts.a + h.counts.b
    const gap = Math.abs(h.counts.a - h.counts.b) / total
    if (!split) split = h
    else {
      const g = Math.abs(split.counts.a - split.counts.b) / (split.counts.a + split.counts.b)
      if (gap < g || (gap === g && total > split.counts.a + split.counts.b)) split = h
    }
    if (!unanimous) unanimous = h
    else {
      const g = Math.abs(unanimous.counts.a - unanimous.counts.b) / (unanimous.counts.a + unanimous.counts.b)
      if (gap > g || (gap === g && total > unanimous.counts.a + unanimous.counts.b)) unanimous = h
    }
  }
  if (split && unanimous && split === unanimous) unanimous = null

  return {
    rebel: rebel ? { id: rebel.id, count: stats[rebel.id].rebel } : null,
    norm: norm ? { id: norm.id, count: stats[norm.id].norm, answered: stats[norm.id].answered } : null,
    oracle: oracle ? { id: oracle.id, count: stats[oracle.id].bets_ok } : null,
    split,
    unanimous,
  }
}

/** Pourcentages arrondis (somme = 100 si au moins une réponse). */
export function percents(counts: { a: number; b: number }): { a: number; b: number } {
  const total = counts.a + counts.b
  if (!total) return { a: 50, b: 50 }
  const a = Math.round((counts.a / total) * 100)
  return { a, b: 100 - a }
}

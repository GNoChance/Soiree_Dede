/**
 * Logique pure de « Dessine & devine » côté front (sans React) : actions,
 * options, tirage des triplets de mots (p_options de start_match).
 * Contrat : en-tête de ./types.ts et supabase/games/dessine-devine.sql.
 */
import type { DrawWord } from './words'
import type { Difficulty, WordChoice } from './types'

export const ddActions = {
  chooseWord: (index: number) => ({ type: 'choose_word', index }),
  guess: (text: string) => ({ type: 'guess', text: text.trim().slice(0, 40) }),
  drawingStarted: () => ({ type: 'drawing_started' }),
  tick: () => ({ type: 'tick' }),
  skipTurn: () => ({ type: 'skip_turn' }),
}

export const DD_ROUND_CHOICES = [1, 2, 3] as const
export const DD_SECONDS_CHOICES = [60, 80, 100] as const
export const DD_DIFFICULTIES: Difficulty[] = ['facile', 'mixte', 'difficile']
export const DD_DEFAULT_OPTIONS = { rounds: 1, drawSeconds: 80, difficulty: 'mixte' as Difficulty }

/** Palette de l'app (8 couleurs). */
export const PALETTE = ['#1f1b2e', '#ef476f', '#fb8500', '#ffb703', '#06d6a0', '#4cc9f0', '#8b5cf6', '#8d5524'] as const
/** Épaisseurs (fraction de la largeur du canvas). */
export const SIZES = [0.007, 0.016, 0.034] as const
export const ERASER_SIZE = 0.05

export const DIFFICULTY_LABEL: Record<1 | 2 | 3, { label: string; tone: 'mint' | 'sun' | 'tomato' }> = {
  1: { label: 'Facile', tone: 'mint' },
  2: { label: 'Moyen', tone: 'sun' },
  3: { label: 'Difficile', tone: 'tomato' },
}

const HISTORY_KEY = 'dede:dd-played'

function readHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(ids: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(ids.slice(-400)))
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

/** Difficultés voulues pour les 3 cartes d'un triplet. */
function wantedFor(difficulty: Difficulty): Array<1 | 2 | 3> {
  if (difficulty === 'facile') return [1, 1, 1]
  if (difficulty === 'difficile') return [2, 3, 3]
  return [1, 2, 3]
}

/** Replis si une difficulté est épuisée (plus proche d'abord). */
const FALLBACK: Record<1 | 2 | 3, Array<1 | 2 | 3>> = { 1: [1, 2, 3], 2: [2, 1, 3], 3: [3, 2, 1] }

/**
 * Tire `count` triplets de mots sans doublon dans la partie, en évitant
 * l'historique récent (repli sur toute la banque si elle est trop petite).
 */
export function buildChoices(words: DrawWord[], difficulty: Difficulty, count: number, history: string[] = []): { choices: WordChoice[][]; used: string[] } {
  const need = count * 3
  const unique = new Map<string, DrawWord>()
  for (const w of words) if (w.word?.trim() && !unique.has(w.id)) unique.set(w.id, w)
  const all = [...unique.values()]
  if (all.length < need) throw new Error(`Pas assez de mots (${all.length}) pour ${count} tours.`)
  const recent = new Set(history)
  const fresh = all.filter((w) => !recent.has(w.id))
  // Si l'historique laisse trop peu de mots, on oublie le plus ancien.
  const base = fresh.length >= need * 1.5 ? fresh : all
  const pools: Record<1 | 2 | 3, DrawWord[]> = {
    1: shuffle(base.filter((w) => w.difficulty === 1)),
    2: shuffle(base.filter((w) => w.difficulty === 2)),
    3: shuffle(base.filter((w) => w.difficulty === 3)),
  }
  const others = shuffle(all.filter((w) => !base.includes(w)))
  const taken = new Set<string>()
  const takenWords = new Set<string>()
  const take = (d: 1 | 2 | 3): DrawWord => {
    for (const dd of FALLBACK[d]) {
      while (pools[dd].length) {
        const w = pools[dd].pop()!
        const key = w.word.trim().toLowerCase()
        if (taken.has(w.id) || takenWords.has(key)) continue
        taken.add(w.id)
        takenWords.add(key)
        return w
      }
    }
    while (others.length) {
      const w = others.pop()!
      const key = w.word.trim().toLowerCase()
      if (taken.has(w.id) || takenWords.has(key)) continue
      taken.add(w.id)
      takenWords.add(key)
      return w
    }
    throw new Error('Banque de mots épuisée.')
  }
  const choices: WordChoice[][] = []
  for (let i = 0; i < count; i++) {
    const trip = wantedFor(difficulty).map((d) => {
      const w = take(d)
      return { word: w.word.trim(), aliases: (w.aliases ?? []).filter((a) => a.trim()).slice(0, 8), difficulty: w.difficulty }
    })
    // Triplet affiché du plus facile au plus dur.
    choices.push(trip.sort((a, b) => a.difficulty - b.difficulty))
  }
  return { choices, used: [...taken] }
}

/** p_options pour start_match('dessine-devine'). */
export async function prepareDessineStart(options: Record<string, unknown>, playerCount: number): Promise<Record<string, unknown>> {
  const rounds = DD_ROUND_CHOICES.includes(Number(options.rounds) as 1) ? Number(options.rounds) : DD_DEFAULT_OPTIONS.rounds
  const drawSeconds = DD_SECONDS_CHOICES.includes(Number(options.drawSeconds) as 80) ? Number(options.drawSeconds) : DD_DEFAULT_OPTIONS.drawSeconds
  const difficulty = DD_DIFFICULTIES.includes(options.difficulty as Difficulty) ? (options.difficulty as Difficulty) : DD_DEFAULT_OPTIONS.difficulty
  const { WORDS } = await import('./words')
  const history = readHistory()
  const { choices, used } = buildChoices(WORDS, difficulty, rounds * Math.max(playerCount, 1), history)
  writeHistory([...history.filter((id) => !used.includes(id)), ...used])
  return { rounds, draw_seconds: drawSeconds, difficulty, choices }
}

/** Découpe l'indice en caractères : lettre cachée, lettre visible ou séparateur. */
export function hintCells(hint: string | null): Array<{ ch: string; kind: 'hidden' | 'letter' | 'sep' }> {
  if (!hint) return []
  return [...hint].map((ch) => ({
    ch,
    kind: ch === '_' ? 'hidden' : /[\s\-'’.,&]/.test(ch) ? 'sep' : 'letter',
  }))
}

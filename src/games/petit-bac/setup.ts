/**
 * Logique front du Petit bac (sans React) : forme exacte des actions envoyées à
 * game_action et construction de p_options de start_match.
 * Contrat : supabase/games/petit-bac.sql.
 */
import { CATEGORIES, LETTERS, type BacCategory } from './categories'
import type { PbCategory } from './types'

export const pbActions = {
  /** Sauvegarde (fusion) de mes réponses de la manche `round`. */
  save: (round: number, answers: Record<string, string>) => ({ type: 'save', round, answers }),
  tick: () => ({ type: 'tick' }),
  /** « STOP ! » : hôte à tout moment, joueur seulement s'il a tout rempli (ses réponses voyagent avec l'action). */
  endRound: (answers?: Record<string, string>) => (answers ? { type: 'end_round', answers } : { type: 'end_round' }),
  contest: (category: string, target: string, value: boolean) => ({ type: 'contest', category, target, value }),
  nextCategory: () => ({ type: 'next_category' }),
  closeValidation: () => ({ type: 'close_validation' }),
  nextRound: () => ({ type: 'next_round' }),
}

export const PB_DURATIONS = [90, 120, 180, 300] as const
export const PB_ROUNDS = [3, 5, 7] as const
export const PB_MIN_CATS = 6
export const PB_MAX_CATS = 8
export const PB_DEFAULT_OPTIONS = { categories: [] as string[], duration: 120, rounds: 5 }

/** Lettres de secours si la banque n'en fournit pas (sans K, Q, W, X, Y, Z). */
export const FALLBACK_LETTERS = 'ABCDEFGHIJLMNOPRSTUV'.split('')

export const formatDuration = (s: number) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`)

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Tirage de `n` catégories (au moins la moitié « faciles » si la banque en
 * signale), en évitant `exclude`.
 */
export function randomCategories(bank: BacCategory[], n = PB_MIN_CATS, exclude: string[] = []): string[] {
  const pool = bank.filter((c) => !exclude.includes(c.id))
  const easy = shuffle(pool.filter((c) => c.easy))
  const picked = easy.slice(0, Math.ceil(n / 2))
  const rest = shuffle(pool.filter((c) => !picked.includes(c)))
  return shuffle([...picked, ...rest.slice(0, n - picked.length)]).map((c) => c.id)
}

/** Ids choisis encore présents dans la banque (ordre conservé, sans doublon). */
export function validChoice(bank: BacCategory[], ids: unknown): string[] {
  const known = new Set(bank.map((c) => c.id))
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && known.has(x)) : []
  return [...new Set(list)].slice(0, PB_MAX_CATS)
}

/** Catégorie au format serveur (id ^[a-z0-9_-]{1,40}$, libellé ≤ 40). */
function toServer(c: BacCategory, i: number): PbCategory {
  const id = /^[a-z0-9_-]{1,40}$/.test(c.id) ? c.id : `cat-${i}`
  return { id, label: c.label.trim().slice(0, 40) || `Catégorie ${i + 1}`, emoji: [...(c.emoji ?? '')].slice(0, 16).join('') }
}

/** p_options pour start_match('petit-bac'). */
export async function preparePetitBacStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  let ids = validChoice(CATEGORIES, options.categories)
  if (ids.length < PB_MIN_CATS) ids = [...ids, ...randomCategories(CATEGORIES, PB_MIN_CATS - ids.length, ids)]
  if (!ids.length) throw new Error('Aucune catégorie disponible.')
  const byId = new Map(CATEGORIES.map((c) => [c.id, c]))
  const duration = PB_DURATIONS.includes(Number(options.duration) as (typeof PB_DURATIONS)[number]) ? Number(options.duration) : PB_DEFAULT_OPTIONS.duration
  const rounds = PB_ROUNDS.includes(Number(options.rounds) as (typeof PB_ROUNDS)[number]) ? Number(options.rounds) : PB_DEFAULT_OPTIONS.rounds
  const letters = (LETTERS.length ? LETTERS : FALLBACK_LETTERS).map((l) => l.toUpperCase()).filter((l) => /^[A-Z]$/.test(l))
  return {
    categories: ids.map((id, i) => toServer(byId.get(id)!, i)),
    duration,
    rounds,
    letters: letters.length ? letters : FALLBACK_LETTERS,
  }
}

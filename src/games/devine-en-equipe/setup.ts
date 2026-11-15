/**
 * Logique pure de « Devine en équipe » côté front (sans React) : actions,
 * options, équipes, tirage des mots (p_options de start_match).
 * Contrat : en-tête de ./types.ts et supabase/games/devine-en-equipe.sql.
 */
import type { DrawWord } from '../dessine-devine/words'
import type { WhoCard } from '../qui-suis-je/cards'
import type { DeckWord, Team, TeamOptions, WordDifficulty } from './types'

export const teamActions = {
  ready: () => ({ type: 'ready' }),
  found: (index: number) => ({ type: 'found', index }),
  pass: (index: number) => ({ type: 'pass', index }),
  tick: () => ({ type: 'tick' }),
  skipTurn: () => ({ type: 'skip_turn' }),
  nextRound: () => ({ type: 'next_round' }),
}

export const TEAM_WORD_CHOICES = [30, 40, 50] as const
export const TEAM_SECONDS_CHOICES = [30, 45, 60] as const
export const TEAM_DIFFICULTIES: WordDifficulty[] = ['facile', 'mixte']
export const TEAM_DEFAULT_OPTIONS: TeamOptions = { words: 40, turnSeconds: 30, difficulty: 'mixte', teamMode: 'random' }
export const TEAMS: Team[] = ['red', 'blue']

export const TEAM_META: Record<Team, { label: string; short: string; emoji: string; color: string; soft: string; text: string }> = {
  red: { label: 'Équipe rouge', short: 'Rouges', emoji: '🔴', color: '#ef476f', soft: '#ffd6df', text: '#ffffff' },
  blue: { label: 'Équipe bleue', short: 'Bleus', emoji: '🔵', color: '#3a86ff', soft: '#d6e6ff', text: '#ffffff' },
}

export const ROUND_RULES: Record<number, { name: string; emoji: string; rule: string; short: string }> = {
  1: { name: 'Décris', emoji: '💬', short: 'Tout sauf le mot', rule: 'Fais deviner avec autant de mots que tu veux… sauf le mot lui-même (ni un morceau !).' },
  2: { name: 'Un seul mot', emoji: '☝️', short: 'Un seul mot', rule: 'Un seul mot d’indice par carte. Choisis-le bien : ton équipe a déjà entendu tous les mots !' },
  3: { name: 'Mime', emoji: '🤸', short: 'Gestes et bruitages', rule: 'Plus un mot : uniquement des gestes, des mimiques et des bruitages.' },
}

export const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red')

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export function readOptions(o: Record<string, unknown>): TeamOptions {
  const words = TEAM_WORD_CHOICES.includes(Number(o.words) as 40) ? Number(o.words) : TEAM_DEFAULT_OPTIONS.words
  const turnSeconds = TEAM_SECONDS_CHOICES.includes(Number(o.turnSeconds) as 30) ? Number(o.turnSeconds) : TEAM_DEFAULT_OPTIONS.turnSeconds
  const difficulty = TEAM_DIFFICULTIES.includes(o.difficulty as WordDifficulty) ? (o.difficulty as WordDifficulty) : TEAM_DEFAULT_OPTIONS.difficulty
  const teamMode = o.teamMode === 'manual' ? 'manual' : 'random'
  const t = o.teams as Partial<Record<Team, unknown>> | undefined
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const teams = t && typeof t === 'object' ? { red: list(t.red), blue: list(t.blue) } : undefined
  return { words, turnSeconds, difficulty, teamMode, teams }
}

/**
 * Recale une composition sur les joueurs réels : retire les absents, place les
 * nouveaux dans l'équipe la moins nombreuse, puis garantit ≥ 2 joueurs par
 * équipe (si possible) en déplaçant depuis la plus grosse.
 */
export function normalizeTeams(teams: Partial<Record<Team, string[]>> | undefined, playerIds: string[], enforceMin = true): Record<Team, string[]> {
  const ids = new Set(playerIds)
  const seen = new Set<string>()
  const keep = (arr: string[] | undefined) =>
    (arr ?? []).filter((id) => {
      if (!ids.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
  const out: Record<Team, string[]> = { red: keep(teams?.red), blue: keep(teams?.blue) }
  for (const id of playerIds) {
    if (seen.has(id)) continue
    seen.add(id)
    out[out.red.length <= out.blue.length ? 'red' : 'blue'].push(id)
  }
  if (enforceMin && playerIds.length >= 4) {
    for (const t of TEAMS) {
      while (out[t].length < 2) out[t].push(out[other(t)].pop()!)
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Tirage des mots                                                             */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'dede:dee-played'

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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(ids.slice(-600)))
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

interface Candidate {
  id: string
  word: string
  kind: DeckWord['kind']
  difficulty: 1 | 2 | 3
}

/** Part de personnages dans la pioche (le reste : objets, actions, expressions…). */
export const PERSO_SHARE = 0.4

/** Poids par difficulté. */
const WEIGHTS: Record<WordDifficulty, Record<1 | 2 | 3, number>> = {
  facile: { 1: 1, 2: 0, 3: 0 },
  mixte: { 1: 0.5, 2: 0.35, 3: 0.15 },
}

/**
 * Tire `count` cartes sans doublon : ~40 % de personnages (WHO_CARDS) et le reste
 * dans WORDS, selon la difficulté, en évitant l'historique récent de l'appareil.
 * Replis : autres difficultés, puis l'autre banque, puis l'historique.
 */
export function buildDeck(
  who: Pick<WhoCard, 'id' | 'name' | 'difficulty'>[],
  words: Pick<DrawWord, 'id' | 'word' | 'difficulty'>[],
  count: number,
  difficulty: WordDifficulty,
  history: string[] = [],
): { deck: DeckWord[]; used: string[] } {
  const all: Candidate[] = [
    ...who.filter((c) => c.name?.trim()).map((c) => ({ id: c.id, word: c.name.trim(), kind: 'perso' as const, difficulty: c.difficulty })),
    ...words.filter((w) => w.word?.trim()).map((w) => ({ id: w.id, word: w.word.trim(), kind: 'objet' as const, difficulty: w.difficulty })),
  ]
  const uniq = new Map<string, Candidate>()
  for (const c of all) if (!uniq.has(c.id)) uniq.set(c.id, c)
  if (uniq.size < count) throw new Error(`Pas assez de mots (${uniq.size}) pour ${count} cartes.`)
  const recent = new Set(history)
  const taken = new Set<string>()
  const takenWords = new Set<string>()
  const deck: DeckWord[] = []
  const used: string[] = []

  const tryTake = (c: Candidate) => {
    const key = c.word.toLowerCase()
    if (taken.has(c.id) || takenWords.has(key)) return false
    taken.add(c.id)
    takenWords.add(key)
    deck.push({ word: c.word, kind: c.kind })
    used.push(c.id)
    return true
  }

  // Quotas par (type, difficulté).
  const persoTarget = Math.round(count * PERSO_SHARE)
  const plan: Array<{ kind: DeckWord['kind']; n: number }> = [
    { kind: 'perso', n: persoTarget },
    { kind: 'objet', n: count - persoTarget },
  ]
  const pool = (kind: DeckWord['kind'], d: 1 | 2 | 3, fresh: boolean) =>
    shuffle([...uniq.values()].filter((c) => c.kind === kind && c.difficulty === d && (!fresh || !recent.has(c.id))))

  for (const { kind, n } of plan) {
    const w = WEIGHTS[difficulty]
    const levels = ([1, 2, 3] as const).filter((d) => w[d] > 0)
    let left = n
    levels.forEach((d, i) => {
      const want = i === levels.length - 1 ? left : Math.round(n * w[d])
      let got = 0
      for (const c of pool(kind, d, true)) {
        if (got >= want) break
        if (tryTake(c)) got++
      }
      left -= got
    })
  }
  // Replis : même difficulté d'abord (tout type), puis tout le reste, frais puis déjà vus.
  const okLevels = (([1, 2, 3] as const).filter((d) => WEIGHTS[difficulty][d] > 0)) as Array<1 | 2 | 3>
  const rest = [
    ...shuffle([...uniq.values()].filter((c) => okLevels.includes(c.difficulty) && !recent.has(c.id))),
    ...shuffle([...uniq.values()].filter((c) => !recent.has(c.id))).sort((a, b) => a.difficulty - b.difficulty),
    ...shuffle([...uniq.values()]).sort((a, b) => a.difficulty - b.difficulty),
  ]
  for (const c of rest) {
    if (deck.length >= count) break
    tryTake(c)
  }
  if (deck.length < count) throw new Error('Banque de mots épuisée.')
  return { deck: shuffle(deck.slice(0, count)), used: used.slice(0, count) }
}

/** p_options pour start_match('devine-en-equipe'). */
export async function prepareTeamStart(options: Record<string, unknown>, playerIds: string[]): Promise<Record<string, unknown>> {
  const o = readOptions(options)
  const [{ WHO_CARDS }, { WORDS }] = await Promise.all([import('../qui-suis-je/cards'), import('../dessine-devine/words')])
  const history = readHistory()
  const { deck, used } = buildDeck(WHO_CARDS, WORDS, o.words, o.difficulty, history)
  writeHistory([...history.filter((id) => !used.includes(id)), ...used])
  const out: Record<string, unknown> = { words: deck, turn_seconds: o.turnSeconds, difficulty: o.difficulty }
  if (o.teamMode === 'manual' && playerIds.length >= 4) out.teams = normalizeTeams(o.teams, playerIds)
  return out
}

/** Pluriel simple. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

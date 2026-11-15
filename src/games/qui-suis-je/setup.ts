/**
 * « Qui suis-je ? » côté front (sans React) : actions, options, thèmes et
 * préparation de p_options (tirage de la file de cartes par l'hôte).
 * Contrat : en-tête de ./types.ts et supabase/games/qui-suis-je.sql.
 */
import type { WhoTheme } from './cards'
import { SOIREES_THEME, buildCardQueue, characterCards, fromWhoCard } from './deck'
import type { QsjCard, QsjDifficulty } from './types'

export const qsjActions = {
  ready: () => ({ type: 'ready' }),
  found: (index: number) => ({ type: 'found', index }),
  pass: (index: number) => ({ type: 'pass', index }),
  tick: () => ({ type: 'tick' }),
  skipTurn: () => ({ type: 'skip_turn' }),
}

export type QsjThemeId = WhoTheme | typeof SOIREES_THEME

export const QSJ_THEMES = [
  { id: SOIREES_THEME, label: 'Les Soirées de Dédé', emoji: '🥳' },
  { id: 'celebrites', label: 'Célébrités', emoji: '🌟' },
  { id: 'films-series', label: 'Films & séries', emoji: '🎬' },
  { id: 'dessins-animes', label: 'Dessins animés', emoji: '🧸' },
  { id: 'sportifs', label: 'Sportifs', emoji: '⚽' },
  { id: 'chanteurs', label: 'Chanteurs', emoji: '🎤' },
  { id: 'personnages-historiques', label: 'Histoire', emoji: '🏛️' },
  { id: 'jeux-video', label: 'Jeux vidéo', emoji: '🎮' },
] as const satisfies ReadonlyArray<{ id: QsjThemeId; label: string; emoji: string }>

export const themeInfo = (id: string) => QSJ_THEMES.find((t) => t.id === id)

export const QSJ_SECONDS_CHOICES = [45, 60, 90] as const
export const QSJ_ROUND_CHOICES = [1, 2] as const
export const QSJ_DIFFICULTIES: QsjDifficulty[] = ['facile', 'mixte', 'difficile']
/** Cartes tirées par tour (la file est partagée : le surplus sert aux tours suivants). */
export const CARDS_PER_TURN = 25

export const QSJ_DEFAULT_OPTIONS = {
  rounds: 1,
  turnSeconds: 60,
  difficulty: 'mixte' as QsjDifficulty,
  themes: QSJ_THEMES.map((t) => t.id) as string[],
}

/** Options normalisées (écran de lancement → valeurs sûres). */
export function readOptions(o: Record<string, unknown>) {
  const rounds = QSJ_ROUND_CHOICES.includes(Number(o.rounds) as 1) ? Number(o.rounds) : QSJ_DEFAULT_OPTIONS.rounds
  const turnSeconds = QSJ_SECONDS_CHOICES.includes(Number(o.turnSeconds) as 60) ? Number(o.turnSeconds) : QSJ_DEFAULT_OPTIONS.turnSeconds
  const difficulty = QSJ_DIFFICULTIES.includes(o.difficulty as QsjDifficulty) ? (o.difficulty as QsjDifficulty) : QSJ_DEFAULT_OPTIONS.difficulty
  const known = new Set<string>(QSJ_THEMES.map((t) => t.id))
  const raw = Array.isArray(o.themes) ? o.themes.filter((t): t is string => typeof t === 'string' && known.has(t)) : []
  const themes = raw.length ? [...new Set(raw)] : QSJ_DEFAULT_OPTIONS.themes
  return { rounds, turnSeconds, difficulty, themes }
}

const HISTORY_KEY = 'dede:qsj-played'

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

/**
 * Mémorise les cartes réellement MONTRÉES (appelé par chaque téléphone en fin de
 * tour) : la file tirée contient bien plus de cartes que celles jouées, on ne
 * « grille » donc que ce qui a été vu. Le prochain hôte, quel qu'il soit, les évite.
 */
export function rememberShown(ids: string[]) {
  if (!ids.length) return
  const set = new Set(ids)
  writeHistory([...readHistory().filter((id) => !set.has(id)), ...set])
}

/** p_options pour start_match('qui-suis-je'). */
export async function prepareQsjStart(options: Record<string, unknown>, playerCount: number): Promise<Record<string, unknown>> {
  const { rounds, turnSeconds, difficulty, themes } = readOptions(options)
  const [{ WHO_CARDS }, { CHARACTERS }] = await Promise.all([import('./cards'), import('@/data/characters')])
  const pool: QsjCard[] = [
    ...(themes.includes(SOIREES_THEME) ? characterCards(CHARACTERS) : []),
    ...WHO_CARDS.filter((c) => themes.includes(c.theme) && c.name?.trim()).map(fromWhoCard),
  ]
  const count = Math.min(rounds * Math.max(playerCount, 1) * CARDS_PER_TURN, 800)
  const history = readHistory()
  const { cards } = buildCardQueue(pool, difficulty, count, history)
  return { rounds, turn_seconds: turnSeconds, difficulty, themes, cards }
}

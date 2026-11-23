/**
 * Logique pure d'Undercover côté front (sans React) : forme exacte des actions
 * envoyées à game_action et construction de p_options de start_match.
 * Contrat : supabase/README.md (jeu undercover).
 */

export const ucActions = {
  startVote: () => ({ type: 'start_vote' }),
  vote: (target: string) => ({ type: 'vote', target }),
  closeVote: () => ({ type: 'close_vote' }),
  guess: (word: string) => ({ type: 'guess', word: word.trim().slice(0, 60) }),
  skipGuess: () => ({ type: 'skip_guess' }),
  next: () => ({ type: 'next' }),
  tick: () => ({ type: 'tick' }),
}

export const UC_DEFAULT_OPTIONS = { misterWhite: true }
/** Mister White n'est distribué qu'à partir de ce nombre de joueurs (cf. serveur). */
export const MISTER_WHITE_MIN_PLAYERS = 5

const HISTORY_KEY = 'dede:uc-played'

function readHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Tire une paire au hasard en évitant les 40 dernières jouées. */
export function pickPair<P extends { id: string }>(pairs: P[], history = readHistory()): P {
  const recent = new Set(history.slice(-Math.min(40, Math.max(0, pairs.length - 5))))
  const pool = pairs.filter((p) => !recent.has(p.id))
  const from = pool.length ? pool : pairs
  return from[Math.floor(Math.random() * from.length)]
}

/** p_options pour start_match('undercover') : {pair:[civil, undercover], misterWhite}. */
export async function prepareUndercoverStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { WORD_PAIRS } = await import('./words')
  const history = readHistory()
  const pair = pickPair(WORD_PAIRS, history)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([...history.filter((id) => id !== pair.id), pair.id].slice(-80)))
  } catch {
    /* ignore */
  }
  return { pair: [pair.civil, pair.undercover], misterWhite: options.misterWhite !== false }
}

/** Libellés des rôles (révélation à l'élimination et en fin de partie). */
export const ROLE_INFO: Record<'civil' | 'undercover' | 'mrwhite', { label: string; emoji: string; bg: string }> = {
  civil: { label: 'Civil', emoji: '😇', bg: 'bg-mint text-[#1f1b2e]' },
  undercover: { label: 'Undercover', emoji: '🕵️', bg: 'bg-tomato text-white' },
  mrwhite: { label: 'Mister White', emoji: '🤫', bg: 'bg-white text-[#1f1b2e]' },
}

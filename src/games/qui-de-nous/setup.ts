/**
 * Logique pure de « Qui de nous ? » côté front (sans React) : forme exacte des
 * actions envoyées à game_action et construction de p_options de start_match.
 * Contrat : supabase/README.md (jeu qui-de-nous).
 */
import { customQuota, mergeDeck } from '../../features/cartes/merge'

export const qdnActions = {
  vote: (target: string) => ({ type: 'vote', target }),
  reveal: () => ({ type: 'reveal' }),
  next: () => ({ type: 'next' }),
}

export const QDN_ROUND_CHOICES = [5, 10, 15] as const
export const QDN_DEFAULT_OPTIONS = { rounds: 10, customCards: true }

const HISTORY_KEY = 'dede:qdn-played'

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(ids: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(ids))
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
 * Tire `n` questions sans répétition récente : d'abord celles jamais jouées
 * (historique localStorage), puis les plus anciennement jouées.
 */
export function pickQuestions<Q extends { id: string; text: string }>(bank: Q[], n: number, history = readHistory()): { picked: Q[]; history: string[] } {
  const count = Math.max(1, Math.min(n, bank.length))
  const seen = new Set(history)
  const fresh = shuffle(bank.filter((q) => !seen.has(q.id)))
  const picked = fresh.slice(0, count)
  if (picked.length < count) {
    const byId = new Map(bank.map((q) => [q.id, q]))
    for (const id of history) {
      if (picked.length >= count) break
      const q = byId.get(id)
      if (q && !picked.includes(q)) picked.push(q)
    }
  }
  const pickedIds = new Set(picked.map((q) => q.id))
  // L'historique garde l'ordre ancien -> récent, borné pour toujours laisser du choix.
  const maxLen = Math.max(0, bank.length - 20)
  const next = [...history.filter((id) => !pickedIds.has(id)), ...picked.map((q) => q.id)].slice(-maxLen)
  return { picked, history: next }
}

/** p_options pour start_match('qui-de-nous'). */
export async function prepareQuiDeNousStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { QUESTIONS } = await import('./questions')
  const rounds = Number(options.rounds) || QDN_DEFAULT_OPTIONS.rounds
  let custom: { id: string; text: string; by?: string }[] = []
  if (options.customCards !== false) {
    const { fetchPlayableCards } = await import('../../features/cartes/api')
    custom = (await fetchPlayableCards('qui-de-nous')).map((c) => ({ id: `cc-${c.id}`, text: String(c.payload.text ?? ''), by: c.author_id }))
  }
  const k = customQuota(rounds, custom.length)
  const { picked, history } = pickQuestions(QUESTIONS, rounds - k)
  writeHistory(history)
  const deck = mergeDeck<{ id: string; text: string; by?: string }>(picked, custom, rounds)
  return { rounds: deck.length, questions: deck.map((q) => q.text), authors: deck.map((q) => q.by ?? null) }
}

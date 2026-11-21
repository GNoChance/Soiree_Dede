/**
 * Dédé Party côté front (sans React) : options et tirage des questions des mini-jeux
 * (banques de Cerveau en fête, Le plus proche et Qui de nous ?, importées sans les modifier).
 * Contrat : supabase/games/dede-party.sql (`game_dede_party_start`).
 */

import { isMapId, MAP_IDS, type MapId } from './board'

export const DP_ROUNDS = [6, 9, 12] as const
export type DpRounds = (typeof DP_ROUNDS)[number]
/** Plateau choisi par l'hôte : un des 5, ou « Au hasard » (résolu ici, le serveur reçoit toujours un id). */
export type DpMapChoice = MapId | 'random'
export const DP_DEFAULT_OPTIONS = { rounds: 9 as DpRounds, map: 'random' as DpMapChoice, bots: 0 }

/** Dernier plateau joué sur cet appareil (pas de redite au tirage « Au hasard »). */
const LAST_MAP_KEY = 'dp:last-map'

/** Tirage « Au hasard » : uniforme parmi les 5, sauf le dernier plateau joué sur cet appareil. */
export function drawMap(rand: () => number = Math.random): MapId {
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_MAP_KEY)
  } catch {
    /* stockage indisponible : tirage parmi les 5 */
  }
  const pool = MAP_IDS.filter((id) => id !== last)
  return pool[Math.floor(rand() * pool.length)] ?? 'grand'
}

function rememberMap(id: MapId) {
  try {
    localStorage.setItem(LAST_MAP_KEY, id)
  } catch {
    /* stockage indisponible */
  }
}

/** Durée indicative d'une partie (≈ 1 min 30 par tour à 4-6 joueurs). */
export const DP_DURATION: Record<DpRounds, { label: string; minutes: string }> = {
  6: { label: 'Courte', minutes: '≈ 10 min' },
  9: { label: 'Normale', minutes: '≈ 15 min' },
  12: { label: 'Longue', minutes: '≈ 20 min' },
}

export function normalizeOptions(o: Record<string, unknown>): { rounds: DpRounds; map: DpMapChoice; bots: number } {
  const r = Number(o.rounds)
  const b = Number(o.bots)
  return {
    bots: Number.isInteger(b) && b >= 0 && b <= 7 ? b : 0,
    rounds: (DP_ROUNDS as readonly number[]).includes(r) ? (r as DpRounds) : DP_DEFAULT_OPTIONS.rounds,
    map: isMapId(o.map) ? o.map : 'random',
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

/** Combien de questions de chaque banque (2 passages de chaque mini-jeu en partie longue, avec de la marge). */
const COUNTS = { quiz: 18, pif: 6, majorite: 6 }

/** p_options de start_match('dede-party') : durée, plateau concret (« Au hasard » résolu ici) + questions tirées dans les banques existantes. */
export async function prepareDedePartyStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const o = normalizeOptions(options)
  const map = o.map === 'random' ? drawMap() : o.map
  rememberMap(map)
  const [{ QUESTIONS: QUIZ }, { CLOSE_QUESTIONS }, { QUESTIONS: QDN }] = await Promise.all([
    import('../cerveau-en-fete/questions'),
    import('../le-plus-proche/questions'),
    import('../qui-de-nous/questions'),
  ])
  // QCM éclair : questions faciles ou moyennes, sans image, avec 3 mauvaises réponses.
  const quiz = shuffle(QUIZ.filter((q) => !q.image && q.difficulty <= 2 && q.distractors?.length >= 3 && q.prompt.length <= 110))
    .slice(0, COUNTS.quiz)
    .map((q) => ({ prompt: q.prompt, answer: q.answer, distractors: q.distractors.slice(0, 3) }))
  const pif = shuffle(CLOSE_QUESTIONS.filter((q) => q.difficulty <= 2 && Number.isFinite(q.answer) && Math.abs(q.answer) <= 1e12))
    .slice(0, COUNTS.pif)
    .map((q) => ({ prompt: q.prompt, answer: q.answer, unit: q.unit ?? null }))
  const majorite = shuffle(QDN).slice(0, COUNTS.majorite).map((q) => q.text)
  return { rounds: o.rounds, map, bots: o.bots, quiz, pif, majorite }
}

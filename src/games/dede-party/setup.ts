/**
 * Dédé Party côté front (sans React) : options et tirage des questions des mini-jeux
 * (banques de Cerveau en fête, Le plus proche et Qui de nous ?, importées sans les modifier).
 * Contrat : supabase/games/dede-party.sql (`game_dede_party_start`).
 */

export const DP_ROUNDS = [6, 9, 12] as const
export type DpRounds = (typeof DP_ROUNDS)[number]
export const DP_DEFAULT_OPTIONS = { rounds: 9 as DpRounds }

/** Durée indicative d'une partie (≈ 1 min 30 par tour à 4-6 joueurs). */
export const DP_DURATION: Record<DpRounds, { label: string; minutes: string }> = {
  6: { label: 'Courte', minutes: '≈ 10 min' },
  9: { label: 'Normale', minutes: '≈ 15 min' },
  12: { label: 'Longue', minutes: '≈ 20 min' },
}

export function normalizeOptions(o: Record<string, unknown>): { rounds: DpRounds } {
  const r = Number(o.rounds)
  return { rounds: (DP_ROUNDS as readonly number[]).includes(r) ? (r as DpRounds) : DP_DEFAULT_OPTIONS.rounds }
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

/** p_options de start_match('dede-party') : durée + questions tirées dans les banques existantes. */
export async function prepareDedePartyStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  return { ...normalizeOptions(options), quiz, pif, majorite }
}

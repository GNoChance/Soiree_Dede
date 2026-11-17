import { hash, rng } from './scoring'

export interface QcmRound {
  kind: 'qcm'
  bonus: boolean
  id: string
  theme: string
  prompt: string
  choices: string[]
  /** Index de la bonne réponse dans `choices`. */
  correct: number
}
export interface EstimateRound {
  kind: 'estimate'
  bonus: false
  id: string
  theme: string
  prompt: string
  unit: string
  answer: number
  note?: string
}
export type DailyRound = QcmRound | EstimateRound

/**
 * Tirage du défi d'un jour (`day` = 'YYYY-MM-DD', date serveur Europe/Paris).
 * Déterministe : graine = hash(day). Composition : QCM facile, facile, moyen, moyen,
 * estimation « le plus proche », puis QCM difficile bonus (×2). Banques chargées à la demande.
 * Attention : changer la composition/les banques change le défi (à éviter en cours de journée).
 */
export async function buildChallenge(day: string): Promise<DailyRound[]> {
  const [{ QUESTIONS }, { CLOSE_QUESTIONS }] = await Promise.all([
    import('@/games/cerveau-en-fete/questions'),
    import('@/games/le-plus-proche/questions'),
  ])
  const rand = rng(hash(`defi-${day}`))
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const usedThemes = new Set<string>()
  const pickQcm = (diff: 1 | 2 | 3, bonus: boolean): QcmRound => {
    const pool = QUESTIONS.filter((q) => q.difficulty === diff && !q.image && q.distractors.length === 3 && q.answer.length <= 40)
    const fresh = pool.filter((q) => !usedThemes.has(q.theme))
    const q = shuffle(fresh.length ? fresh : pool)[0]
    usedThemes.add(q.theme)
    const choices = shuffle([q.answer, ...q.distractors])
    return { kind: 'qcm', bonus, id: q.id, theme: q.theme, prompt: q.prompt, choices, correct: choices.indexOf(q.answer) }
  }
  const rounds: DailyRound[] = [pickQcm(1, false), pickQcm(1, false), pickQcm(2, false), pickQcm(2, false)]
  const est = shuffle(CLOSE_QUESTIONS.filter((q) => q.difficulty <= 2 && q.answer > 0))[0]
  rounds.push({ kind: 'estimate', bonus: false, id: est.id, theme: est.theme, prompt: est.prompt, unit: est.unit ?? '', answer: est.answer, note: est.note })
  rounds.push(pickQcm(3, true))
  return rounds
}

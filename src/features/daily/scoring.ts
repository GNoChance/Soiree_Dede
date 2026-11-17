/** Barème du Défi du jour (miroir de supabase/features/daily.sql : _daily_round_max). */
export const QCM_TIME_MS = 20_000
export const EST_TIME_MS = 30_000
export const ROUND_MAX = [100, 100, 100, 100, 100, 200] as const
export const TOTAL_MAX = ROUND_MAX.reduce((a, b) => a + b, 0)

const speed = (ms: number, limit: number) => Math.max(0, Math.min(1, 1 - ms / limit))

/** QCM : 70 pts pour une bonne réponse + jusqu'à 30 de rapidité. Bonus : 140 + jusqu'à 60. */
export function qcmPoints(correct: boolean, ms: number, bonus: boolean): number {
  if (!correct) return 0
  const s = speed(ms, QCM_TIME_MS)
  return bonus ? 140 + Math.round(60 * s) : 70 + Math.round(30 * s)
}

/** Estimation : 100 pts moins l'écart relatif (en %), plancher 0. 10 % d'écart = 90 pts. */
export function estimatePoints(value: number | null, answer: number): number {
  if (value === null || !Number.isFinite(value)) return 0
  const rel = Math.abs(value - answer) / Math.max(Math.abs(answer), 1)
  return Math.round(100 * Math.max(0, 1 - rel))
}

export const XP_CAP = 50
export const xpFor = (score: number) => Math.min(Math.floor(score / 10), XP_CAP)

const TITLES = [
  'Le défi qui sent bon le croissant', 'Chauffe tes neurones !', 'Le défi du jour, version XXL',
  'Aujourd’hui, on ne rigole pas (si, un peu)', 'Neurones en vacances ? Pas aujourd’hui', 'Le défi qui pique (gentiment)',
  'Plus on est de fous, plus on score',
]
export const dailyTitle = (day: string) => TITLES[Math.abs(hash(day)) % TITLES.length]

export function endMessage(score: number): { emoji: string; text: string } {
  const r = score / TOTAL_MAX
  if (r >= 0.9) return { emoji: '🧠', text: 'Génie absolu ! Les autres vont pleurer.' }
  if (r >= 0.7) return { emoji: '😎', text: 'Très solide. Tu peux le dire au dîner.' }
  if (r >= 0.45) return { emoji: '🙂', text: 'Honorable ! Demain, tu feras mieux.' }
  if (r >= 0.2) return { emoji: '😅', text: 'Bon… l’important, c’est de participer.' }
  return { emoji: '🫠', text: 'Aïe. On dira que le téléphone a glissé.' }
}

/** Hash de chaîne (FNV-1a 32 bits) → graine du tirage du jour. */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** PRNG mulberry32 : mêmes graines → mêmes tirages chez tout le monde. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

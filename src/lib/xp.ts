import { levelForXp } from '@/types/db'

export interface XpProgress {
  level: number
  /** XP accumulée dans le niveau courant */
  current: number
  /** XP nécessaire pour finir le niveau courant */
  needed: number
  /** 0..1 */
  ratio: number
  /** XP totale du prochain niveau */
  next: number
}

/** Niveau = floor(sqrt(xp/100)) + 1  =>  seuil du niveau L = 100 * (L-1)^2 */
export function xpProgress(xp: number): XpProgress {
  const level = levelForXp(xp)
  const start = 100 * (level - 1) ** 2
  const end = 100 * level ** 2
  return { level, current: xp - start, needed: end - start, ratio: Math.min(1, (xp - start) / (end - start)), next: end }
}

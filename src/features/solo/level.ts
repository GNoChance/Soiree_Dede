/**
 * Niveau du bot qui s'adapte (mode solo) : 1 à 10 par jeu, départ à 3, gardé sur le
 * téléphone uniquement (localStorage `solo:level:<jeu>`) — ce n'est pas une stat.
 */
export const LEVEL_MIN = 1
export const LEVEL_MAX = 10
export const LEVEL_DEFAULT = 3

const key = (gameId: string) => `solo:level:${gameId}`
const clamp = (n: number) => Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(n)))

export function readLevel(gameId: string): number {
  try {
    const v = Number(localStorage.getItem(key(gameId)))
    return Number.isFinite(v) && v >= LEVEL_MIN && v <= LEVEL_MAX ? clamp(v) : LEVEL_DEFAULT
  } catch {
    return LEVEL_DEFAULT
  }
}

export function writeLevel(gameId: string, level: number): void {
  try {
    localStorage.setItem(key(gameId), String(clamp(level)))
  } catch {
    /* stockage bloqué : le niveau reste celui de la session */
  }
}

/** Victoire du joueur : +1 ; défaite : −1 ; nul : 0 (bornes 1 et 10). */
export function nextLevel(level: number, result: 'win' | 'loss' | 'draw'): number {
  return clamp(level + (result === 'win' ? 1 : result === 'loss' ? -1 : 0))
}

/** Étoiles sur 5 (demi-étoiles) : niveau 1 = ½, niveau 10 = 5. */
export const levelStars = (level: number): number => clamp(level) / 2

/** « ★★★½ » */
export function starsText(level: number): string {
  const s = levelStars(level)
  return '★'.repeat(Math.floor(s)) + (s % 1 ? '½' : '')
}

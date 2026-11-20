/**
 * Niveau du bot qui s'adapte (mode solo) : 1 à 10 par jeu et par profil, départ à 3, gardé
 * sur le téléphone uniquement (localStorage `solo:level:<jeu>:<profil>`) — ce n'est pas une
 * stat. L'ancienne clé de l'étape 1 (`solo:level:<jeu>`, par téléphone) est reprise une fois.
 */
export const LEVEL_MIN = 1
export const LEVEL_MAX = 10
export const LEVEL_DEFAULT = 3

const oldKey = (gameId: string) => `solo:level:${gameId}`
const key = (gameId: string, pid: string) => `solo:level:${gameId}:${pid}`
const clamp = (n: number) => Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(n)))

const valid = (raw: string | null): number | null => {
  if (raw === null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= LEVEL_MIN && v <= LEVEL_MAX ? clamp(v) : null
}

export function readLevel(gameId: string, pid = 'local'): number {
  try {
    const own = valid(localStorage.getItem(key(gameId, pid)))
    if (own !== null) return own
    // Étape 1 : niveau par téléphone -> repris une fois pour ce profil, puis l'ancienne clé disparaît.
    const old = valid(localStorage.getItem(oldKey(gameId)))
    if (old !== null) {
      localStorage.setItem(key(gameId, pid), String(old))
      localStorage.removeItem(oldKey(gameId))
      return old
    }
    return LEVEL_DEFAULT
  } catch {
    return LEVEL_DEFAULT
  }
}

export function writeLevel(gameId: string, level: number, pid = 'local'): void {
  try {
    localStorage.setItem(key(gameId, pid), String(clamp(level)))
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

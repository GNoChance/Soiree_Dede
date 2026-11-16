/**
 * Géométrie du plateau 3D (unités « monde ») : même grille que le plateau 2D
 * (11 pistes, coins ×1,5), centrée sur l'origine ; +z = vers le joueur (bas de l'écran).
 * Pur : aucune dépendance three.
 */
export const BOARD_SIZE = 12
const CORNER = 1.5
const TRACKS = [CORNER, 1, 1, 1, 1, 1, 1, 1, 1, 1, CORNER]
const STARTS = TRACKS.map((_, k) => TRACKS.slice(0, k).reduce((a, b) => a + b, 0))

/** (ligne, colonne) 0-10 de la case i (0 = coin bas-droit, sens horaire). */
export function gridPos(i: number): { row: number; col: number } {
  if (i <= 10) return { row: 10, col: 10 - i }
  if (i <= 20) return { row: 20 - i, col: 0 }
  if (i <= 30) return { row: 0, col: i - 20 }
  return { row: i - 30, col: 10 }
}

export type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner'
export const sideOf = (i: number): Side => (i % 10 === 0 ? 'corner' : i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right')

export interface CellBox {
  /** Coin haut-gauche dans le plan du plateau, en unités depuis le coin du plateau (0..12). */
  u: number
  v: number
  w: number
  d: number
  /** Centre en coordonnées monde. */
  cx: number
  cz: number
}

export function cellBox(i: number): CellBox {
  const { row, col } = gridPos(i)
  const u = STARTS[col]
  const v = STARTS[row]
  const w = TRACKS[col]
  const d = TRACKS[row]
  return { u, v, w, d, cx: u + w / 2 - BOARD_SIZE / 2, cz: v + d / 2 - BOARD_SIZE / 2 }
}

/** Hauteur d'une case (relief) et du plateau. */
export const CELL_H = 0.16
export const SLAB_H = 0.3
export const CENTER_H = 0.06

/** Emplacements des tas (centre du plateau). */
export const DECK_POS = {
  hasard: { x: -2.35, z: 0.1, yaw: 0.14 },
  potes: { x: 2.35, z: 0.1, yaw: -0.14 },
} as const
export const CARD_W = 1.8
export const CARD_D = 2.5
export const DECK_H = 0.5

/** Cagnotte des taxes : tas de billets entre les deux paquets, étiquette juste derrière (les dés ne la cachent pas). */
export const POT_POS = { x: 0, z: -0.4 } as const
export const POT_LABEL_Z = -1.5
export const BILL_W = 0.98
export const BILL_D = 0.55
export const BILL_H = 0.03

/** Position de repos des deux dés. */
export const DICE_REST: [number, number][] = [
  [-0.75, 1.6],
  [0.75, 2.0],
]

/**
 * Emplacements des pions sur une case : n pions en grille ≤ 3×3, centrée,
 * rangée incomplète centrée. Renvoie les décalages (dx, dz) et l'échelle conseillée.
 */
export function pawnSlots(n: number, w: number, d: number): { dx: number; dz: number; scale: number }[] {
  if (n <= 0) return []
  const k = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / k)
  const cell = Math.min(w, d) * 0.92
  const step = n === 1 ? 0 : Math.min(cell / k, 0.62)
  const scale = n === 1 ? 1 : Math.max(0.5, Math.min(0.95, (cell / k) * 1.05))
  const out: { dx: number; dz: number; scale: number }[] = []
  for (let j = 0; j < n; j++) {
    const row = Math.floor(j / k)
    const inRow = row === rows - 1 ? n - (rows - 1) * k : k
    const col = j % k
    out.push({ dx: (col - (inRow - 1) / 2) * step, dz: (row - (rows - 1) / 2) * step * 0.9, scale })
  }
  return out
}

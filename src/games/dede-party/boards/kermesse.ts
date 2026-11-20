/**
 * Plateau n°3 « La Kermesse de Dédé » : 40 cases sur une grille 11 × 7, une seule boucle en nœud papillon
 * (deux lobes reliés par l'allée). Deux cases Tombola (13 et 33) partagent UNE cagnotte (state.mech.pot) :
 * passer dessus coûte 3 pièces (versées dans la cagnotte), s'y arrêter pile avec ses dés rafle tout.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('kermesse')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import type { BoardDef, CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'tombola', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'tombola', 'clap', 'env', 'loge', 'clap', 'pub', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 0]
export const PREV: number[] = [39, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]
export const XY: Array<[number, number]> = [[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [5, 4], [4, 4], [4, 5], [4, 6], [3, 6], [2, 6], [1, 6]]
export const EXTRA: Record<string, unknown> = {"no":3,"mech":"tombola","forks":[]}

/** Le stand de la Tombola, entre les deux cases Tombola (coordonnées de grille). */
export const STAND = { col: 5, row: 3 }

export const board: BoardDef = {
  id: 'kermesse',
  no: 3,
  name: 'La Kermesse de Dédé',
  emoji: '🎪',
  pitch: 'Une Tombola à péage : la cagnotte grossit, qui la décroche ?',
  rule: 'Passer devant la Tombola coûte 3 pièces, versées dans la cagnotte. S’arrêter pile dessus : le gros lot est à toi !',
  cols: 11,
  rows: 7,
  cells: CELLS,
  next: NEXT,
  prev: PREV,
  xy: XY,
  forks: [],
  jumps: [],
  extra: EXTRA,
  zones: [
    { id: 'allee', name: 'L’Allée de la Tombola', emoji: '🎟️', cells: [12, 13, 14, 32, 33, 34], road: '#FFD6A8' },
    { id: 'chapiteau', name: 'Le Chapiteau', emoji: '🎪', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 35, 36, 37, 38, 39], deco: true },
    { id: 'roue', name: 'La Grande Roue', emoji: '🎡', cells: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], deco: true },
  ],
  dede: { col: 2, row: 3.9, scale: 0.85 },
  hole: { col: 6.95, row: 0.95, w: 3.1, h: 5.1 },
}

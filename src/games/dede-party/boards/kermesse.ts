/**
 * Plateau n°3 « La Kermesse de Dédé » : 40 cases sur une grille 11 × 7, une seule boucle en nœud papillon
 * (deux lobes reliés par l'allée). Deux cases Tombola (13 et 33) partagent UNE cagnotte (state.mech.pot) :
 * passer dessus coûte 3 pièces (versées dans la cagnotte), s'y arrêter pile avec ses dés rafle tout.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('kermesse')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import { range, sizeBoards, type BaseBoard } from './build'
import type { CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'tombola', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'tombola', 'clap', 'env', 'loge', 'clap', 'pub', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 0]
export const PREV: number[] = [39, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]
export const XY: Array<[number, number]> = [[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [5, 4], [4, 4], [4, 5], [4, 6], [3, 6], [2, 6], [1, 6]]
export const EXTRA: Record<string, unknown> = {"no":3,"mech":"tombola","forks":[]}

// >>> grandes tailles : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.
export const CELLS_M: CellType[] = ['start', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'tombola', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'tombola', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'tombola', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'tombola', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'clap']
export const NEXT_M: Array<number | [number, number]> = [1, 2, 3, [4, 40], 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, [27, 71], 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 0, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 5, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 28]
export const PREV_M: number[] = [39, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 3, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 26, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]
export const XY_M: Array<[number, number]> = [[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [5, 4], [4, 4], [4, 5], [4, 6], [3, 6], [2, 6], [1, 6], [-1, 3], [-2, 3], [-2, 4], [-2, 5], [-2, 6], [-2, 7], [-3, 7], [-4, 7], [-5, 7], [-6, 7], [-7, 7], [-8, 7], [-9, 7], [-9, 6], [-9, 5], [-9, 4], [-9, 3], [-9, 2], [-9, 1], [-9, 0], [-9, -1], [-8, -1], [-7, -1], [-6, -1], [-5, -1], [-4, -1], [-3, -1], [-2, -1], [-2, 0], [-2, 1], [-1, 1], [10, 7], [10, 8], [11, 8], [12, 8], [13, 8], [13, 9], [13, 10], [13, 11], [13, 12], [12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12], [6, 12], [5, 12], [4, 12], [3, 12], [3, 11], [3, 10], [3, 9], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [8, 7]]
export const JUMPS_M: Array<[number, number]> = []
export const EXTRA_M: Record<string, unknown> = {"no":3,"mech":"tombola","forks":["toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[2,6,10,15,20,25,30,36]},{"n":1,"loges":[42,47,54,59,66]},{"n":1,"loges":[73,78,90,97]}]}
// <<< grandes tailles

/** Le stand de la Tombola, entre les deux cases Tombola (coordonnées de grille). */
export const STAND = { col: 5, row: 3 }

/** Le plateau classique (taille S). */
const base: BaseBoard = {
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

/** Les tailles (spec grands plateaux §3.3) : M « La Grande Kermesse » — le Train Fantôme et le Grand Huit, 4 guichets. */
export const boards = sizeBoards(base, { m: { cells: CELLS_M, next: NEXT_M, prev: PREV_M, xy: XY_M, jumps: JUMPS_M, extra: EXTRA_M } }, {
  titles: { m: 'La Grande Kermesse' },
  quarters: [
    { id: 'fantome', name: 'Le Train Fantôme', emoji: '👻', opens: 'm', cells: range(40, 70), gate: 3, road: '#E3D0FF', veil: 'fence' },
    { id: 'huit', name: 'Le Grand Huit', emoji: '🎢', opens: 'm', cells: range(71, 99), gate: 26, road: '#FFD1E0', veil: 'fence' },
  ],
  forks: [
    { cell: 3, ways: [4, 40], names: ['Tout droit', 'Le Train Fantôme'], emojis: ['⬆️', '👻'], mode: 'toggle', look: 'turnstile' },
    { cell: 26, ways: [27, 71], names: ['Tout droit', 'Le Grand Huit'], emojis: ['⬅️', '🎢'], mode: 'toggle', look: 'turnstile' },
  ],
  transports: {},
  cellNames: { 55: 'Le guichet du Train Fantôme', 85: 'Le guichet du Grand Huit' },
})
export const board = boards.s

/**
 * Plateau n°5 « Dédé 2000 » : 49 cases en escargot (grille 11 × 9), de la Station (Départ) au Sommet.
 * S'arrêter pile sur un Télésiège (lift) monte à l'étage du dessus ; pile sur une Plaque de verglas (ice),
 * on glisse à l'étage du dessous. Au Sommet (48), la Grande Luge ramène au Départ (liaison `jumps` 48 → 0).
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('ski')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import { range, sizeBoards, type BaseBoard } from './build'
import type { CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'clap', 'lift', 'loge', 'pub', 'lift', 'env', 'clap', 'loge', 'pub', 'clap', 'lift', 'clap', 'env', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'ice', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'ice', 'pub', 'clap', 'ice', 'clap', 'loge']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 0]
export const PREV: number[] = [48, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
export const XY: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [8, 3], [8, 4]]
export const EXTRA: Record<string, unknown> = {"no":5,"mech":"tp","forks":[],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20}}

// >>> grandes tailles : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.
export const CELLS_M: CellType[] = ['start', 'clap', 'clap', 'lift', 'loge', 'pub', 'lift', 'env', 'clap', 'loge', 'pub', 'clap', 'lift', 'clap', 'env', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'ice', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'ice', 'pub', 'clap', 'ice', 'clap', 'loge', 'halt', 'clap', 'loge', 'clap', 'env', 'pub', 'lift', 'loge', 'clap', 'clap', 'clap', 'lift', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'ice', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'halt', 'clap', 'loge', 'clap', 'env', 'pub', 'lift', 'loge', 'clap', 'clap', 'clap', 'lift', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'ice', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap']
export const NEXT_M: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, [12, 49], 13, 77, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 0, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 14, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 18]
export const PREV_M: number[] = [48, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 76, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 11, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 13, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103]
export const XY_M: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [8, 3], [8, 4], [4, -2], [3, -2], [2, -2], [1, -2], [0, -2], [-1, -2], [-2, -2], [-3, -2], [-4, -2], [-5, -2], [-6, -2], [-7, -2], [-8, -2], [-9, -2], [-9, -3], [-9, -4], [-8, -4], [-7, -4], [-6, -4], [-5, -4], [-4, -4], [-3, -4], [-2, -4], [-1, -4], [0, -4], [1, -4], [2, -4], [3, -4], [6, -2], [7, -2], [8, -2], [9, -2], [10, -2], [11, -2], [12, -2], [13, -2], [14, -2], [15, -2], [16, -2], [17, -2], [18, -2], [19, -2], [19, -3], [19, -4], [18, -4], [17, -4], [16, -4], [15, -4], [14, -4], [13, -4], [12, -4], [11, -4], [10, -4], [9, -4], [8, -4], [7, -4]]
export const JUMPS_M: Array<[number, number]> = [[48, 0], [11, 49], [76, 14], [13, 77], [104, 18]]
export const EXTRA_M: Record<string, unknown> = {"no":5,"mech":"tp","forks":["toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86},"size":"m","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]}]}
export const CELLS_L: CellType[] = ['start', 'clap', 'clap', 'lift', 'loge', 'pub', 'lift', 'env', 'clap', 'loge', 'pub', 'clap', 'lift', 'clap', 'env', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'ice', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'ice', 'pub', 'clap', 'ice', 'clap', 'loge', 'halt', 'clap', 'loge', 'clap', 'env', 'pub', 'lift', 'loge', 'clap', 'clap', 'clap', 'lift', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'ice', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'halt', 'clap', 'loge', 'clap', 'env', 'pub', 'lift', 'loge', 'clap', 'clap', 'clap', 'lift', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'ice', 'clap', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'halt', 'clap', 'loge', 'clap', 'lift', 'pub', 'clap', 'loge', 'clap', 'lift', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'loge', 'lift', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'lift', 'pub', 'clap', 'loge', 'clap', 'env', 'ice', 'pub', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'ice', 'env', 'clap', 'pub', 'clap', 'loge', 'halt', 'clap', 'loge', 'clap', 'lift', 'pub', 'clap', 'loge', 'clap', 'lift', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'loge', 'lift', 'env', 'clap', 'pub', 'clap', 'clap', 'loge', 'clap', 'lift', 'pub', 'clap', 'loge', 'clap', 'env', 'ice', 'pub', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'ice', 'env', 'clap', 'pub', 'clap']
export const NEXT_L: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, [12, 49], 13, 77, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 0, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, [14, 105], 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, [18, 155], 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, [131, 20], 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 0, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, [181, 24], 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 154]
export const PREV_L: number[] = [48, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 76, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 11, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 13, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 76, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 104, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202]
export const XY_L: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [8, 3], [8, 4], [4, -2], [3, -2], [2, -2], [1, -2], [0, -2], [-1, -2], [-2, -2], [-3, -2], [-4, -2], [-5, -2], [-6, -2], [-7, -2], [-8, -2], [-9, -2], [-9, -3], [-9, -4], [-8, -4], [-7, -4], [-6, -4], [-5, -4], [-4, -4], [-3, -4], [-2, -4], [-1, -4], [0, -4], [1, -4], [2, -4], [3, -4], [6, -2], [7, -2], [8, -2], [9, -2], [10, -2], [11, -2], [12, -2], [13, -2], [14, -2], [15, -2], [16, -2], [17, -2], [18, -2], [19, -2], [19, -3], [19, -4], [18, -4], [17, -4], [16, -4], [15, -4], [14, -4], [13, -4], [12, -4], [11, -4], [10, -4], [9, -4], [8, -4], [7, -4], [4, -6], [3, -6], [2, -6], [1, -6], [0, -6], [-1, -6], [-2, -6], [-3, -6], [-4, -6], [-5, -6], [-6, -6], [-7, -6], [-8, -6], [-8, -7], [-8, -8], [-7, -8], [-6, -8], [-5, -8], [-4, -8], [-3, -8], [-2, -8], [-1, -8], [0, -8], [1, -8], [2, -8], [3, -8], [3, -9], [3, -10], [2, -10], [1, -10], [0, -10], [-1, -10], [-2, -10], [-3, -10], [-4, -10], [-5, -10], [-6, -10], [-6, -11], [-6, -12], [-5, -12], [-4, -12], [-3, -12], [-2, -12], [-1, -12], [0, -12], [1, -12], [2, -12], [3, -12], [4, -12], [5, -12], [6, -6], [7, -6], [8, -6], [9, -6], [10, -6], [11, -6], [12, -6], [13, -6], [14, -6], [15, -6], [16, -6], [17, -6], [18, -6], [18, -7], [18, -8], [17, -8], [16, -8], [15, -8], [14, -8], [13, -8], [12, -8], [11, -8], [10, -8], [9, -8], [8, -8], [7, -8], [7, -9], [7, -10], [8, -10], [9, -10], [10, -10], [11, -10], [12, -10], [13, -10], [14, -10], [15, -10], [16, -10], [16, -11], [16, -12], [15, -12], [14, -12], [13, -12], [12, -12], [11, -12], [10, -12], [9, -12], [8, -12], [7, -12], [6, -12]]
export const JUMPS_L: Array<[number, number]> = [[48, 0], [11, 49], [76, 14], [13, 77], [104, 18], [76, 105], [154, 0], [104, 155], [130, 20], [180, 24]]
export const EXTRA_L: Record<string, unknown> = {"no":5,"mech":"tp","forks":["toggle","toggle","toggle","toggle","toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86,"109":127,"114":122,"125":137,"133":151,"139":123,"149":135,"159":177,"164":172,"175":187,"183":201,"189":173,"199":185},"size":"l","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]},{"n":2,"loges":[107,112,119,124,131,136,143,148,154]},{"n":2,"loges":[157,162,169,174,181,186,193,198]}],"starts":[49,77,105,155]}
// <<< grandes tailles

/** Le plateau classique (taille S). */
const base: BaseBoard = {
  id: 'ski',
  no: 5,
  name: 'Dédé 2000',
  emoji: '⛷️',
  pitch: 'Télésièges, verglas et Grande Luge : ça monte et ça glisse !',
  rule: 'Arrête-toi pile sur un télésiège : tu montes d’un étage. Pile sur une plaque de verglas : tu redescends. Au Sommet, la Grande Luge ramène au Départ.',
  cols: 11,
  rows: 9,
  cells: CELLS,
  next: NEXT,
  prev: PREV,
  xy: XY,
  forks: [],
  jumps: [[48, 0]],
  extra: EXTRA,
  zones: [
    { id: 'vallee', name: 'La Vallée', emoji: '🌲', cells: Array.from({ length: 35 }, (_, i) => i), road: '#CDE7BE' },
    { id: 'pistes', name: 'Les Pistes', emoji: '⛷️', cells: Array.from({ length: 12 }, (_, i) => 35 + i), road: '#BFE3FF' },
    { id: 'sommet', name: 'Le Sommet', emoji: '🏔️', cells: [47, 48], road: '#FFFFFF' },
  ],
  dede: { col: 5.2, row: 5.4, scale: 1 },
  hole: { col: 2.95, row: 2.95, w: 5.1, h: 5.1 },
  cellNames: { 0: 'La Station', 48: 'La Loge du Sommet' },
  tp: {
    3: { to: 37, name: 'Télésiège de la Vallée' },
    6: { to: 40, name: 'Télésiège des Sapins' },
    12: { to: 42, name: 'Télésiège du Chalet' },
    15: { to: 45, name: 'Télésiège des Crêtes' },
    21: { to: 47, name: 'Télésiège du Sommet' },
    36: { to: 2, name: 'Verglas du Virage' },
    43: { to: 13, name: 'Verglas de la Corniche' },
    46: { to: 20, name: 'Verglas du Sommet' },
  },
}

/** Relief (spec grands plateaux §3.5) : la Station à plat, chaque lacet sur sa terrasse, les raccords à mi-hauteur. */
const TERRACE = [0, 0.6, 1.2, 1.9, 2.6, 3.3, 4.0]
export const altOfRow = (row: number) => {
  if (row >= 0) return 0
  const k = -row / 2
  const lo = Math.floor(k)
  const hi = Math.min(TERRACE.length - 1, Math.ceil(k))
  return TERRACE[Math.min(lo, TERRACE.length - 1)] + (TERRACE[hi] - TERRACE[Math.min(lo, TERRACE.length - 1)]) * (k - lo)
}

/** Les tailles (spec grands plateaux §3.5) : M « Dédé 2500 », L « Dédé 3000 » — on monte à pied, on redescend en glissant. */
export const boards = sizeBoards(
  base,
  {
    m: { cells: CELLS_M, next: NEXT_M, prev: PREV_M, xy: XY_M, jumps: JUMPS_M, extra: EXTRA_M },
    l: { cells: CELLS_L, next: NEXT_L, prev: PREV_L, xy: XY_L, jumps: JUMPS_L, extra: EXTRA_L },
  },
  {
    titles: { m: 'Dédé 2500', l: 'Dédé 3000' },
    quarters: [
      { id: 'combe', name: 'La Combe aux Chamois', emoji: '🐐', opens: 'm', cells: range(49, 76), gate: 11, road: '#BFE3FF', veil: 'clouds' },
      { id: 'alpages', name: 'Les Alpages', emoji: '🐄', opens: 'm', cells: range(77, 104), gate: 13, road: '#BFE3FF', veil: 'clouds' },
      { id: 'glacier', name: 'Le Glacier', emoji: '🧊', opens: 'l', cells: range(105, 154), gate: 76, road: '#FFFFFF', veil: 'clouds' },
      { id: 'aigles', name: 'La Crête des Aigles', emoji: '🦅', opens: 'l', cells: range(155, 203), gate: 104, road: '#FFFFFF', veil: 'clouds' },
    ],
    forks: [
      { cell: 11, ways: [12, 49], names: ['La Vallée', 'Télécabine des Chamois'], emojis: ['🌲', '🚠'], mode: 'toggle', look: 'cabin' },
      { cell: 76, ways: [14, 105], names: ['Piste des Chamois', 'Télécabine du Glacier'], emojis: ['⛷️', '🚠'], mode: 'toggle', look: 'cabin' },
      { cell: 104, ways: [18, 155], names: ['Piste des Alpages', 'Télécabine des Aigles'], emojis: ['⛷️', '🚠'], mode: 'toggle', look: 'cabin' },
      { cell: 130, ways: [131, 20], names: ['L’arête', 'Piste rouge du Glacier'], emojis: ['🧗', '⛷️'], mode: 'toggle', look: 'piste' },
      { cell: 180, ways: [181, 24], names: ['L’arête', 'Piste rouge des Aigles'], emojis: ['🧗', '⛷️'], mode: 'toggle', look: 'piste' },
    ],
    transports: {
      '48-0': { kind: 'luge', name: 'La Grande Luge' },
      '11-49': { kind: 'cabin', name: 'La télécabine des Chamois' },
      '13-77': { kind: 'cabin', name: 'La télécabine des Alpages' },
      '76-14': { kind: 'slide', name: 'La piste des Chamois' },
      '104-18': { kind: 'slide', name: 'La piste des Alpages' },
      '76-105': { kind: 'cabin', name: 'La télécabine du Glacier' },
      '104-155': { kind: 'cabin', name: 'La télécabine des Aigles' },
      '130-20': { kind: 'slide', name: 'La piste rouge du Glacier' },
      '180-24': { kind: 'slide', name: 'La piste rouge des Aigles' },
      '154-0': { kind: 'luge', name: 'La Grande Descente' },
    },
    tp: {
      55: 'Télésiège des Chamois',
      60: 'Téléski du Virage',
      68: 'Verglas de la Combe',
      83: 'Télésiège des Alpages',
      88: 'Téléski de la Bergerie',
      96: 'Verglas des Alpages',
      109: 'Télésiège du Glacier',
      114: 'Téléski des Séracs',
      125: 'Télésiège des Crevasses',
      133: 'Télésiège de l’Arête Ouest',
      139: 'Verglas du Glacier',
      149: 'Verglas de l’Arête',
      159: 'Télésiège des Aigles',
      164: 'Téléski du Nid',
      175: 'Télésiège des Corniches',
      183: 'Télésiège de l’Arête Est',
      189: 'Verglas des Aigles',
      199: 'Verglas du Vertige',
    },
    cellNames: { 49: 'Gare des Chamois', 77: 'Gare des Alpages', 105: 'Gare du Glacier', 155: 'Gare des Aigles', 154: 'La Loge du Pic' },
    alt: (xy) => xy.map(([, r]) => altOfRow(r)),
  },
)
export const board = boards.s

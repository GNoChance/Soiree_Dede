/**
 * Plateau n°2 « Dédé-sur-Mer » : 45 cases sur une grille 11 × 9.
 * Boucle de 36 cases (0-35) autour de la baie + le Banc de sable (36-44), détour en U accroché à la Digue :
 * embranchement en 12 → [13, 36], retour en 14. L'embranchement suit LA MARÉE (state.mech.tide, tenu par le
 * serveur) : marée basse → tout le monde coupe par le Banc ; marée haute → tout le monde passe par la Digue.
 * Quand la mer monte (fin de tour), les pions restés sur le Banc sont emportés en 14 et perdent 5 pièces.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('mer')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import { range, sizeBoards, type BaseBoard } from './build'
import type { CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'env', 'clap', 'pub', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'clap', 'env', 'clap', 'loge', 'clap', 'env', 'clap', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, [13, 36], 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 41, 42, 43, 44, 14]
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 12, 36, 37, 38, 39, 40, 41, 42, 43]
export const XY: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [4, 1], [4, 2], [4, 3], [4, 4], [5, 4], [6, 4], [6, 3], [6, 2], [6, 1]]
export const EXTRA: Record<string, unknown> = {"no":2,"mech":"tide","forks":["tide"],"bank":[36,37,38,39,40,41,42,43,44],"wash_to":14}

// >>> grandes tailles : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.
export const CELLS_M: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'env', 'clap', 'pub', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'clap', 'env', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'halt', 'loge', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'env', 'clap', 'halt', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap']
export const NEXT_M: Array<number | [number, number]> = [1, 2, 3, 4, [5, 45], 6, 7, 8, 9, [10, 73], 11, 12, [13, 36], 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 41, 42, 43, 44, 14, 46, 47, 48, 49, [50, 68], 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 8, 69, 70, 71, 72, 51, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 11]
export const PREV_M: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 12, 36, 37, 38, 39, 40, 41, 42, 43, 4, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 49, 68, 69, 70, 71, 9, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]
export const XY_M: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [4, 1], [4, 2], [4, 3], [4, 4], [5, 4], [6, 4], [6, 3], [6, 2], [6, 1], [-3, 0], [-3, 1], [-3, 2], [-4, 2], [-5, 2], [-6, 2], [-7, 2], [-8, 2], [-9, 2], [-9, 1], [-9, 0], [-9, -1], [-9, -2], [-9, -3], [-9, -4], [-8, -4], [-7, -4], [-6, -4], [-5, -4], [-4, -4], [-3, -4], [-3, -3], [-3, -2], [-5, 3], [-5, 4], [-6, 4], [-7, 4], [-7, 3], [2, -2], [1, -2], [0, -2], [0, -3], [0, -4], [0, -5], [0, -6], [1, -6], [2, -6], [3, -6], [4, -6], [5, -6], [6, -6], [7, -6], [8, -6], [9, -6], [10, -6], [10, -5], [10, -4], [10, -3], [10, -2], [9, -2], [8, -2], [7, -2], [6, -2], [5, -2], [4, -2]]
export const JUMPS_M: Array<[number, number]> = [[4, 45], [67, 8], [9, 73], [99, 11]]
export const EXTRA_M: Record<string, unknown> = {"no":2,"mech":"tide","forks":["toggle","toggle","tide","tide"],"size":"m","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]}],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73}]}
export const CELLS_L: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'env', 'clap', 'pub', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'clap', 'env', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'halt', 'loge', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'env', 'clap', 'halt', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'halt', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'halt', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'pub', 'env', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'clap', 'halt', 'loge', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'clap', 'clap', 'pub', 'env', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'loge', 'clap', 'clap', 'clap', 'clap', 'env', 'clap', 'loge', 'clap']
export const NEXT_L: Array<number | [number, number]> = [1, 2, 3, 4, [5, 45], 6, 7, 8, 9, [10, 73], 11, 12, [13, 36], 14, 15, 16, 17, 18, 19, 20, [21, 100], 22, 23, 24, 25, 26, [27, 131], 28, 29, 30, 31, [32, 167], 33, 34, 35, 0, 37, 38, 39, 40, 41, 42, 43, 44, 14, 46, 47, 48, 49, [50, 68], 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 8, 69, 70, 71, 72, 51, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 11, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 22, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, [144, 160], 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 28, 161, 162, 163, 164, 165, 166, 145, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, [179, 194], 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 33, 195, 196, 197, 198, 199, 200, 180]
export const PREV_L: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 12, 36, 37, 38, 39, 40, 41, 42, 43, 4, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 49, 68, 69, 70, 71, 9, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 20, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 26, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 143, 160, 161, 162, 163, 164, 165, 31, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 178, 194, 195, 196, 197, 198, 199]
export const XY_L: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [4, 1], [4, 2], [4, 3], [4, 4], [5, 4], [6, 4], [6, 3], [6, 2], [6, 1], [-3, 0], [-3, 1], [-3, 2], [-4, 2], [-5, 2], [-6, 2], [-7, 2], [-8, 2], [-9, 2], [-9, 1], [-9, 0], [-9, -1], [-9, -2], [-9, -3], [-9, -4], [-8, -4], [-7, -4], [-6, -4], [-5, -4], [-4, -4], [-3, -4], [-3, -3], [-3, -2], [-5, 3], [-5, 4], [-6, 4], [-7, 4], [-7, 3], [2, -2], [1, -2], [0, -2], [0, -3], [0, -4], [0, -5], [0, -6], [1, -6], [2, -6], [3, -6], [4, -6], [5, -6], [6, -6], [7, -6], [8, -6], [9, -6], [10, -6], [10, -5], [10, -4], [10, -3], [10, -2], [9, -2], [8, -2], [7, -2], [6, -2], [5, -2], [4, -2], [12, 1], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2], [17, 2], [18, 2], [19, 2], [20, 2], [20, 1], [20, 0], [20, -1], [20, -2], [20, -3], [20, -4], [20, -5], [20, -6], [19, -6], [18, -6], [17, -6], [16, -6], [15, -6], [14, -6], [13, -6], [12, -6], [12, -5], [12, -4], [12, -3], [12, -2], [12, -1], [12, 8], [12, 7], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6], [17, 6], [18, 6], [19, 6], [20, 6], [20, 7], [20, 8], [20, 9], [20, 10], [20, 11], [20, 12], [20, 13], [19, 13], [18, 13], [17, 13], [16, 13], [15, 13], [14, 13], [13, 13], [12, 13], [12, 12], [12, 11], [12, 10], [19, 8], [18, 8], [17, 8], [17, 9], [17, 10], [18, 10], [19, 10], [-3, 8], [-3, 7], [-3, 6], [-4, 6], [-5, 6], [-6, 6], [-7, 6], [-8, 6], [-9, 6], [-10, 6], [-10, 7], [-10, 8], [-10, 9], [-10, 10], [-10, 11], [-10, 12], [-10, 13], [-9, 13], [-8, 13], [-7, 13], [-6, 13], [-5, 13], [-4, 13], [-3, 13], [-3, 12], [-3, 11], [-3, 10], [-9, 8], [-8, 8], [-7, 8], [-7, 9], [-7, 10], [-8, 10], [-9, 10]]
export const JUMPS_L: Array<[number, number]> = [[4, 45], [67, 8], [9, 73], [99, 11], [20, 100], [130, 22], [26, 131], [159, 28], [31, 167], [193, 33]]
export const EXTRA_L: Record<string, unknown> = {"no":2,"mech":"tide","forks":["toggle","toggle","tide","toggle","toggle","toggle","tide","tide","tide"],"size":"l","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]},{"n":1,"loges":[101,105,110,113,117,122,125,129]},{"n":1,"loges":[132,136,141,144,148,153,156,163]},{"n":1,"loges":[168,172,177,184,189,192,199]}],"starts":[45,73,100,131,167],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73},{"cells":[160,161,162,163,164,165,166],"wash_to":145,"end":167},{"cells":[194,195,196,197,198,199,200],"wash_to":180,"end":201}]}
// <<< grandes tailles

export const BANK = [36, 37, 38, 39, 40, 41, 42, 43, 44]
export const WASH_TO = 14

/** Le plateau classique (taille S). */
const base: BaseBoard = {
  id: 'mer',
  no: 2,
  name: 'Dédé-sur-Mer',
  emoji: '🏖️',
  pitch: 'La marée monte et descend : gare au Banc de sable !',
  rule: 'À marée basse, tout le monde coupe par le Banc de sable. Quand la mer monte, ceux qui y traînent sont emportés : −5 pièces.',
  cols: 11,
  rows: 9,
  cells: CELLS,
  next: NEXT,
  prev: PREV,
  xy: XY,
  forks: [{ cell: 12, ways: [13, 36], names: ['La Digue', 'Le Banc de sable'], emojis: ['🌊', '🏝️'], mode: 'tide' }],
  jumps: [],
  extra: EXTRA,
  zones: [
    { id: 'banc', name: 'Le Banc de sable', emoji: '🏝️', cells: BANK, road: '#FFE9B0' },
    { id: 'port', name: 'Le Port', emoji: '⚓', cells: [1, 2, 3, 4, 5, 6, 7, 8], deco: true },
    { id: 'digue', name: 'La Digue', emoji: '🌊', cells: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18], deco: true },
    { id: 'corniche', name: 'La Corniche', emoji: '🪨', cells: [19, 20, 21, 22, 23, 24, 25, 26], deco: true },
    { id: 'plage', name: 'La Plage', emoji: '⛱️', cells: [27, 28, 29, 30, 31, 32, 33, 34, 35], deco: true },
  ],
  dede: { col: 5, row: 6.3, scale: 0.85 },
  hole: { col: 1.1, row: 4.95, w: 8.8, h: 2.95 },
  cellNames: { 13: 'La Baraque à frites', 40: 'La Loge du Phare' },
}

/** Les tailles (spec grands plateaux §3.2) : M « Les Îles », L « L’Archipel ». On part en bac, on revient en navette. */
export const boards = sizeBoards(
  base,
  {
    m: { cells: CELLS_M, next: NEXT_M, prev: PREV_M, xy: XY_M, jumps: JUMPS_M, extra: EXTRA_M },
    l: { cells: CELLS_L, next: NEXT_L, prev: PREV_L, xy: XY_L, jumps: JUMPS_L, extra: EXTRA_L },
  },
  {
    titles: { m: 'Les Îles', l: 'L’Archipel' },
    quarters: [
      { id: 'mouettes', name: 'L’Île aux Mouettes', emoji: '🐦', opens: 'm', cells: range(45, 72), gate: 4, road: '#FFF6E5', veil: 'mist' },
      { id: 'coco', name: 'L’Île Coco', emoji: '🥥', opens: 'm', cells: range(73, 99), gate: 9, road: '#FFE9B0', veil: 'mist' },
      { id: 'piton', name: 'Le Piton Fumant', emoji: '🌋', opens: 'l', cells: range(100, 130), gate: 20, road: '#F1DDD2', veil: 'mist' },
      { id: 'pirates', name: 'La Crique des Pirates', emoji: '🏴‍☠️', opens: 'l', cells: range(131, 166), gate: 26, road: '#FFE3B3', veil: 'mist' },
      { id: 'crabes', name: 'L’Îlot des Crabes', emoji: '🦀', opens: 'l', cells: range(167, 200), gate: 31, road: '#FFDCCF', veil: 'mist' },
    ],
    forks: [
      { cell: 4, ways: [5, 45], names: ['La Grande Île', 'L’Île aux Mouettes'], emojis: ['🏝️', '🐦'], mode: 'toggle', look: 'boat' },
      { cell: 9, ways: [10, 73], names: ['La Grande Île', 'L’Île Coco'], emojis: ['🏝️', '🥥'], mode: 'toggle', look: 'boat' },
      { cell: 20, ways: [21, 100], names: ['La Grande Île', 'Le Piton Fumant'], emojis: ['🏝️', '🌋'], mode: 'toggle', look: 'boat' },
      { cell: 26, ways: [27, 131], names: ['La Grande Île', 'La Crique des Pirates'], emojis: ['🏝️', '🏴‍☠️'], mode: 'toggle', look: 'boat' },
      { cell: 31, ways: [32, 167], names: ['La Grande Île', 'L’Îlot des Crabes'], emojis: ['🏝️', '🦀'], mode: 'toggle', look: 'boat' },
      { cell: 49, ways: [50, 68], names: ['L’Île aux Mouettes', 'La Langue des Mouettes'], emojis: ['🌊', '🏝️'], mode: 'tide' },
      { cell: 143, ways: [144, 160], names: ['La Crique', 'Le Gué du Trésor'], emojis: ['🌊', '🏝️'], mode: 'tide' },
      { cell: 178, ways: [179, 194], names: ['L’Îlot', 'Le Gué des Crabes'], emojis: ['🌊', '🏝️'], mode: 'tide' },
    ],
    transports: {
      '4-45': { kind: 'boat', name: 'Le bac des Mouettes' },
      '67-8': { kind: 'boat', name: 'La navette des Mouettes' },
      '9-73': { kind: 'boat', name: 'Le bac de l’Île Coco' },
      '99-11': { kind: 'boat', name: 'La navette Coco' },
      '20-100': { kind: 'boat', name: 'Le bac du Piton' },
      '130-22': { kind: 'boat', name: 'La navette du Piton' },
      '26-131': { kind: 'boat', name: 'Le bac des Pirates' },
      '159-28': { kind: 'boat', name: 'La navette des Pirates' },
      '31-167': { kind: 'boat', name: 'Le bac des Crabes' },
      '193-33': { kind: 'boat', name: 'La navette des Crabes' },
    },
    zones: {
      m: [{ id: 'banc-mouettes', name: 'La Langue des Mouettes', emoji: '🏝️', cells: range(68, 72), road: '#FFE9B0' }],
      l: [
        { id: 'banc-mouettes', name: 'La Langue des Mouettes', emoji: '🏝️', cells: range(68, 72), road: '#FFE9B0' },
        { id: 'gue-tresor', name: 'Le Gué du Trésor', emoji: '🏝️', cells: range(160, 166), road: '#FFE9B0' },
        { id: 'gue-crabes', name: 'Le Gué des Crabes', emoji: '🏝️', cells: range(194, 200), road: '#FFE9B0' },
      ],
    },
    cellNames: {
      45: 'Ponton des Mouettes',
      73: 'Ponton Coco',
      100: 'Ponton du Piton',
      131: 'Ponton des Pirates',
      167: 'Ponton des Crabes',
      70: 'La Loge des Mouettes',
      163: 'La Loge du Trésor',
      199: 'La Loge des Crabes',
    },
  },
)
export const board = boards.s

/**
 * Plateau n°4 « Le Camping des Pins Penchés » : 36 cases, le contour d'une croix (grille 11 × 9) autour du
 * feu de camp. Riton le raton (state.mech = {riton: case, sack: pièces}) fait sa ronde À CONTRESENS à la fin
 * de chaque tour (1 dé) : sac vide, il pique 5 pièces au pion croisé ; sac plein, il lâche tout.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('camping')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import { range, sizeBoards, type BaseBoard } from './build'
import type { CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0]
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]
export const XY: Array<[number, number]> = [[4, 8], [4, 7], [4, 6], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5], [0, 4], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 4], [10, 5], [9, 5], [8, 5], [7, 5], [6, 5], [6, 6], [6, 7], [6, 8], [5, 8]]
export const EXTRA: Record<string, unknown> = {"no":4,"mech":"riton","forks":[],"riton_start":18}

// >>> grandes tailles : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.
export const CELLS_M: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'loge', 'clap']
export const NEXT_M: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, [8, 36], 9, 10, 11, 12, 13, 14, 15, 16, [17, 67], 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 9, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 18]
export const PREV_M: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 7, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 16, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]
export const XY_M: Array<[number, number]> = [[4, 8], [4, 7], [4, 6], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5], [0, 4], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 4], [10, 5], [9, 5], [8, 5], [7, 5], [6, 5], [6, 6], [6, 7], [6, 8], [5, 8], [-1, 5], [-2, 5], [-2, 6], [-2, 7], [-2, 8], [-3, 8], [-4, 8], [-5, 8], [-6, 8], [-7, 8], [-8, 8], [-9, 8], [-9, 7], [-9, 6], [-9, 5], [-9, 4], [-9, 3], [-9, 2], [-9, 1], [-9, 0], [-8, 0], [-7, 0], [-6, 0], [-5, 0], [-4, 0], [-3, 0], [-2, 0], [-2, 1], [-2, 2], [-2, 3], [-1, 3], [4, -1], [4, -2], [3, -2], [2, -2], [1, -2], [0, -2], [0, -3], [0, -4], [0, -5], [0, -6], [0, -7], [0, -8], [1, -8], [2, -8], [3, -8], [4, -8], [5, -8], [6, -8], [7, -8], [8, -8], [9, -8], [10, -8], [10, -7], [10, -6], [10, -5], [10, -4], [10, -3], [10, -2], [9, -2], [8, -2], [7, -2], [6, -2], [6, -1]]
export const JUMPS_M: Array<[number, number]> = []
export const EXTRA_M: Record<string, unknown> = {"no":4,"mech":"riton","forks":["toggle","toggle"],"riton_start":18,"size":"m","stars":[{"n":0,"loges":[3,8,13,18,23,28,33]},{"n":1,"loges":[38,43,50,55,62]},{"n":1,"loges":[69,74,81,86,93,98]}],"pack":[{"name":"Rita","start":51,"path":[66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36]},{"name":"Ritou","start":83,"path":[99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81,80,79,78,77,76,75,74,73,72,71,70,69,68,67]}]}
// <<< grandes tailles

export const RITON_START = 18
/** Le feu de camp, au centre de la croix. */
export const FIRE = { col: 5, row: 4 }

/** Le plateau classique (taille S). */
const base: BaseBoard = {
  id: 'camping',
  no: 4,
  name: 'Le Camping des Pins Penchés',
  emoji: '🏕️',
  pitch: 'Riton le raton rôde : il chipe… puis il lâche tout !',
  rule: 'Riton remonte le sentier à contresens. Sac vide : il te pique 5 pièces. Sac plein : il lâche tout au pion qu’il croise.',
  cols: 11,
  rows: 9,
  cells: CELLS,
  next: NEXT,
  prev: PREV,
  xy: XY,
  forks: [],
  jumps: [],
  extra: EXTRA,
  zones: [
    { id: 'accueil', name: 'L’Accueil', emoji: '🏠', cells: [0, 1, 2, 3, 31, 32, 33, 34, 35], deco: true },
    { id: 'lac', name: 'Le Lac', emoji: '🛶', cells: [4, 5, 6, 7, 8, 9, 10, 11, 12], deco: true },
    { id: 'pins', name: 'Les Pins', emoji: '🌲', cells: [13, 14, 15, 16, 17, 18, 19, 20, 21], deco: true },
    { id: 'tentes', name: 'Les Tentes', emoji: '⛺', cells: [22, 23, 24, 25, 26, 27, 28, 29, 30], deco: true },
  ],
  dede: { col: 8.6, row: 0.9, scale: 0.85 },
  hole: { col: 0.05, row: 5.95, w: 3.9, h: 3 },
}

/** Les tailles (spec grands plateaux §3.4) : M « Le Grand Camping » — le Sous-bois (Rita) et la Rivière (Ritou). */
export const boards = sizeBoards(base, { m: { cells: CELLS_M, next: NEXT_M, prev: PREV_M, xy: XY_M, jumps: JUMPS_M, extra: EXTRA_M } }, {
  titles: { m: 'Le Grand Camping' },
  quarters: [
    { id: 'sousbois', name: 'Le Sous-bois aux Champignons', emoji: '🍄', opens: 'm', cells: range(36, 66), gate: 7, road: '#E6D3AE', veil: 'forest' },
    { id: 'riviere', name: 'La Rivière aux Castors', emoji: '🦫', opens: 'm', cells: range(67, 99), gate: 16, road: '#D4ECFF', veil: 'forest' },
  ],
  forks: [
    { cell: 7, ways: [8, 36], names: ['Le camp', 'Le Sous-bois'], emojis: ['🏕️', '🍄'], mode: 'toggle', look: 'gate' },
    { cell: 16, ways: [17, 67], names: ['Le camp', 'La Rivière'], emojis: ['🏕️', '🦫'], mode: 'toggle', look: 'gate' },
  ],
  transports: {},
})
export const board = boards.s

/** Les ratons de la famille (en plus de Riton), dans l'ordre de `mech.pack` : nom, teinte du foulard, échelle. */
export const PACK = [
  { name: 'Rita', scarf: '#FF8FA3', scale: 1 },
  { name: 'Ritou', scarf: '#4CC9F0', scale: 0.7 },
]

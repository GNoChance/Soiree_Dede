/**
 * Plateau n°4 « Le Camping des Pins Penchés » : 36 cases, le contour d'une croix (grille 11 × 9) autour du
 * feu de camp. Riton le raton (state.mech = {riton: case, sack: pièces}) fait sa ronde À CONTRESENS à la fin
 * de chaque tour (1 dé) : sac vide, il pique 5 pièces au pion croisé ; sac plein, il lâche tout.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('camping')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import type { BoardDef, CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap', 'env', 'pub', 'loge', 'clap', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0]
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]
export const XY: Array<[number, number]> = [[4, 8], [4, 7], [4, 6], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5], [0, 4], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 4], [10, 5], [9, 5], [8, 5], [7, 5], [6, 5], [6, 6], [6, 7], [6, 8], [5, 8]]
export const EXTRA: Record<string, unknown> = {"no":4,"mech":"riton","forks":[],"riton_start":18}

export const RITON_START = 18
/** Le feu de camp, au centre de la croix. */
export const FIRE = { col: 5, row: 4 }

export const board: BoardDef = {
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

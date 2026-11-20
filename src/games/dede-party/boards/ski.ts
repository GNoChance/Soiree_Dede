/**
 * Plateau n°5 « Dédé 2000 » : 49 cases en escargot (grille 11 × 9), de la Station (Départ) au Sommet.
 * S'arrêter pile sur un Télésiège (lift) monte à l'étage du dessus ; pile sur une Plaque de verglas (ice),
 * on glisse à l'étage du dessous. Au Sommet (48), la Grande Luge ramène au Départ (liaison `jumps` 48 → 0).
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('ski')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import type { BoardDef, CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'clap', 'lift', 'loge', 'pub', 'lift', 'env', 'clap', 'loge', 'pub', 'clap', 'lift', 'clap', 'env', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'lift', 'loge', 'pub', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'pub', 'loge', 'clap', 'env', 'ice', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'ice', 'pub', 'clap', 'ice', 'clap', 'loge']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 0]
export const PREV: number[] = [48, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
export const XY: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [8, 3], [8, 4]]
export const EXTRA: Record<string, unknown> = {"no":5,"mech":"tp","forks":[],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20}}

export const board: BoardDef = {
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

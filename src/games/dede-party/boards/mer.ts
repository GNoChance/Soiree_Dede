/**
 * Plateau n°2 « Dédé-sur-Mer » : 45 cases sur une grille 11 × 9.
 * Boucle de 36 cases (0-35) autour de la baie + le Banc de sable (36-44), détour en U accroché à la Digue :
 * embranchement en 12 → [13, 36], retour en 14. L'embranchement suit LA MARÉE (state.mech.tide, tenu par le
 * serveur) : marée basse → tout le monde coupe par le Banc ; marée haute → tout le monde passe par la Digue.
 * Quand la mer monte (fin de tour), les pions restés sur le Banc sont emportés en 14 et perdent 5 pièces.
 * CELLS / NEXT / PREV / EXTRA = `_dp_board('mer')` / `_dp_next` / `_dp_prev` / `_dp_map` (synchro testée).
 */
import type { BoardDef, CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'loge', 'env', 'clap', 'pub', 'loge', 'clap', 'pub', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'clap', 'env', 'clap', 'loge', 'clap', 'env', 'clap', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, [13, 36], 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 41, 42, 43, 44, 14]
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 12, 36, 37, 38, 39, 40, 41, 42, 43]
export const XY: Array<[number, number]> = [[0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [4, 1], [4, 2], [4, 3], [4, 4], [5, 4], [6, 4], [6, 3], [6, 2], [6, 1]]
export const EXTRA: Record<string, unknown> = {"no":2,"mech":"tide","forks":["tide"],"bank":[36,37,38,39,40,41,42,43,44],"wash_to":14}

export const BANK = [36, 37, 38, 39, 40, 41, 42, 43, 44]
export const WASH_TO = 14

export const board: BoardDef = {
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

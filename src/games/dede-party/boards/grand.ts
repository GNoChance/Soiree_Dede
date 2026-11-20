/**
 * Plateau n°1 « Le Grand Plateau de Dédé » : 47 cases sur une grille 11 × 9.
 * - cases 0-35 : la grande boucle (coins en escalier), Départ en bas à gauche, sens horaire ;
 * - cases 36-40 : « La Scène », détour doré de l'aiguillage de la case 13 (retour en 15) ;
 * - cases 41-46 : « Le Tunnel de la pub », détour piégé de l'aiguillage de la case 22 (retour en 25).
 * Aucun choix pour le joueur : à un embranchement, l'aiguillage envoie le pion puis BASCULE.
 * CELLS / NEXT / PREV / EXTRA sont dupliqués avec `_dp_board('grand')` / `_dp_next` / `_dp_prev` / `_dp_map`
 * (supabase/games/dede-party.sql) : synchro vérifiée par tools/sql-tests/dede-party.mjs (une ligne chacun).
 */
import { range, sizeBoards, type BaseBoard } from './build'
import type { CellType } from './types'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'pub', 'env', 'pub', 'clap']
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, [14, 36], 15, 16, 17, 18, 19, 20, 21, 22, [23, 41], 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 15, 42, 43, 44, 45, 46, 25]
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 13, 36, 37, 38, 39, 22, 41, 42, 43, 44, 45]
export const XY: Array<[number, number]> = [[1, 8], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [9, 1], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [9, 3], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6]]
export const EXTRA: Record<string, unknown> = {"no":1,"mech":"forks","forks":["toggle","toggle"]}

// >>> grandes tailles : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.
export const CELLS_M: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'pub', 'env', 'pub', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'loge', 'clap', 'env', 'clap', 'pub', 'clap', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'env', 'pub', 'clap', 'loge', 'clap', 'env', 'pub', 'clap', 'env', 'loge', 'pub', 'clap', 'env', 'clap']
export const NEXT_M: Array<number | [number, number]> = [1, 2, 3, 4, [5, 47], 6, 7, 8, 9, 10, 11, 12, 13, [14, 36], 15, 16, 17, 18, 19, 20, 21, 22, [23, 41], 24, 25, 26, 27, 28, [29, 73], 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 15, 42, 43, 44, 45, 46, 25, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 7, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 32]
export const PREV_M: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 13, 36, 37, 38, 39, 22, 41, 42, 43, 44, 45, 4, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 28, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]
export const XY_M: Array<[number, number]> = [[1, 8], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [9, 1], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [4, 1], [4, 2], [5, 2], [6, 2], [6, 1], [9, 3], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6], [-1, 5], [-2, 5], [-2, 6], [-2, 7], [-2, 8], [-3, 8], [-4, 8], [-5, 8], [-6, 8], [-7, 8], [-7, 7], [-7, 6], [-7, 5], [-7, 4], [-7, 3], [-7, 2], [-7, 1], [-7, 0], [-6, 0], [-5, 0], [-4, 0], [-3, 0], [-2, 0], [-2, 1], [-2, 2], [-1, 2], [9, 9], [9, 10], [10, 10], [11, 10], [11, 11], [11, 12], [11, 13], [11, 14], [10, 14], [9, 14], [8, 14], [7, 14], [6, 14], [5, 14], [4, 14], [3, 14], [2, 14], [1, 14], [1, 13], [1, 12], [1, 11], [1, 10], [2, 10], [3, 10], [4, 10], [5, 10], [5, 9]]
export const JUMPS_M: Array<[number, number]> = []
export const EXTRA_M: Record<string, unknown> = {"no":1,"mech":"forks","forks":["toggle","toggle","toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[3,7,11,17,20,27,30,33,38]},{"n":1,"loges":[49,55,61,67]},{"n":1,"loges":[77,83,89,95]}]}
// <<< grandes tailles

/** Le plateau classique (taille S). */
const base: BaseBoard = {
  id: 'grand',
  no: 1,
  name: 'Le Grand Plateau de Dédé',
  emoji: '🎤',
  pitch: 'Le plateau de l’émission : aiguillages qui basculent, Scène et Tunnel de la pub.',
  rule: 'Aux embranchements, l’aiguillage envoie le pion puis bascule : un sur deux file vers La Scène (ça rapporte), un sur deux vers le Tunnel de la pub (ça coûte) !',
  cols: 11,
  rows: 9,
  cells: CELLS,
  next: NEXT,
  prev: PREV,
  xy: XY,
  forks: [
    { cell: 13, ways: [14, 36], names: ['Tout droit', 'La Scène'], emojis: ['➡️', '🎭'], mode: 'toggle' },
    { cell: 22, ways: [23, 41], names: ['Tout droit', 'Le Tunnel de la pub'], emojis: ['⬇️', '📺'], mode: 'toggle' },
  ],
  jumps: [],
  extra: EXTRA,
  zones: [
    { id: 'scene', name: 'La Scène', emoji: '🎭', cells: [36, 37, 38, 39, 40] },
    { id: 'tunnel', name: 'Le Tunnel de la pub', emoji: '📺', cells: [41, 42, 43, 44, 45, 46] },
  ],
  dede: { col: 4.31, row: 4.96, scale: 1 },
  hole: { col: 1.2, row: 3, w: 6.4, h: 4 },
}

/** Les tailles (spec grands plateaux §3.1) : M « Les Studios Dédé » — les Coulisses à gauche, la Régie devant. */
export const boards = sizeBoards(base, { m: { cells: CELLS_M, next: NEXT_M, prev: PREV_M, xy: XY_M, jumps: JUMPS_M, extra: EXTRA_M } }, {
  titles: { m: 'Les Studios Dédé' },
  quarters: [
    { id: 'coulisses', name: 'Les Coulisses', emoji: '👗', opens: 'm', cells: range(47, 72), gate: 4, road: '#F2D4B0', veil: 'curtain' },
    { id: 'regie', name: 'La Régie', emoji: '🎛️', opens: 'm', cells: range(73, 99), gate: 28, road: '#C9D6FF', veil: 'curtain' },
  ],
  forks: [
    { cell: 4, ways: [5, 47], names: ['Tout droit', 'Les Coulisses'], emojis: ['⬆️', '👗'], mode: 'toggle', look: 'switch' },
    { cell: 28, ways: [29, 73], names: ['Tout droit', 'La Régie'], emojis: ['⬅️', '🎛️'], mode: 'toggle', look: 'switch' },
  ],
  transports: {},
})
export const board = boards.s

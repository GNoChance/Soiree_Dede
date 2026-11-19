/**
 * « Le Grand Plateau de Dédé » : 47 cases sur une grille 11 × 9.
 * - cases 0-35 : la grande boucle (coins en escalier), Départ en bas à gauche, sens horaire ;
 * - cases 36-40 : « La Scène », détour doré de l'aiguillage de la case 13 (retour en 15) ;
 * - cases 41-46 : « Le Tunnel de la pub », détour piégé de l'aiguillage de la case 22 (retour en 25).
 * Aucun choix pour le joueur : à un embranchement, l'aiguillage envoie le pion puis BASCULE.
 * CELLS / NEXT / PREV sont dupliqués avec `_dp_board()` / `_dp_next()` / `_dp_prev()`
 * (supabase/games/dede-party.sql) : synchro vérifiée par tools/sql-tests/dede-party.mjs.
 * Noms et positions à l'écran : front seulement.
 */

export type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge'

export const CELLS: CellType[] = ['start', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'loge', 'pub', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'clap', 'clap', 'clap', 'env', 'loge', 'clap', 'pub', 'loge', 'clap', 'env', 'loge', 'pub', 'clap', 'clap', 'env', 'loge', 'clap', 'clap', 'pub', 'clap', 'pub', 'env', 'pub', 'clap']

/** Case suivante ; [tout droit, détour] = embranchement (aiguillage 0 ou 1). */
export const NEXT: Array<number | [number, number]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, [14, 36], 15, 16, 17, 18, 19, 20, 21, 22, [23, 41], 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 37, 38, 39, 40, 15, 42, 43, 44, 45, 46, 25]

/** Case précédente (carte « recule ») : à un retour d'embranchement, par la grande boucle. */
export const PREV: number[] = [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 13, 36, 37, 38, 39, 22, 41, 42, 43, 44, 45]

export const N_CELLS = CELLS.length

export const STAR_PRICE = 30
export const HALF_PRICE = 15

export interface ForkInfo {
  /** Case de l'embranchement. */
  cell: number
  /** Premières cases : [tout droit, détour]. */
  ways: [number, number]
  /** Nom de chaque voie. */
  names: [string, string]
  emojis: [string, string]
}

/** Les embranchements, dans l'ordre de `state.sw`. */
export const FORKS: ForkInfo[] = [
  { cell: 13, ways: [14, 36], names: ['Tout droit', 'La Scène'], emojis: ['➡️', '🎭'] },
  { cell: 22, ways: [23, 41], names: ['Tout droit', 'Le Tunnel de la pub'], emojis: ['⬇️', '📺'] },
]

/** Zones du plateau (décor, légende). */
export const SCENE_CELLS = [36, 37, 38, 39, 40]
export const TUNNEL_CELLS = [41, 42, 43, 44, 45, 46]

export interface CellInfo {
  label: string
  emoji: string
  /** Fond de la case (vif, lisible en clair comme en sombre : texte sombre dessus). */
  color: string
  /** Effet en une phrase (aide). */
  effect: string
}

export const CELL_INFO: Record<CellType, CellInfo> = {
  start: { label: 'Départ', emoji: '🎬', color: '#FFB703', effect: '+5 pièces à chaque passage' },
  clap: { label: 'Applaudissements', emoji: '👏', color: '#06D6A0', effect: '+3 pièces' },
  pub: { label: 'Page de pub', emoji: '📺', color: '#EF476F', effect: '−3 pièces' },
  env: { label: 'Enveloppe surprise', emoji: '✉️', color: '#8B5CF6', effect: 'Dédé tire une carte' },
  loge: { label: 'Loge', emoji: '✨', color: '#4CC9F0', effect: 'Une étoile peut s’y installer (30 pièces, la 1re à 15)' },
}

/** Grille en paysage (télé) ; au téléphone le plateau est transposé (9 × 11). */
export const COLS = 11
export const ROWS = 9

const XY: Array<[number, number]> = [
  // Grande boucle (0-35), sens horaire depuis le coin bas-gauche.
  [1, 8], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0],
  [9, 0], [9, 1], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8],
  // La Scène (36-40).
  [4, 1], [4, 2], [5, 2], [6, 2], [6, 1],
  // Le Tunnel de la pub (41-46).
  [9, 3], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6],
]

/** Position (colonne, ligne) de la case i ; `portrait` : plateau transposé (9 colonnes × 11 lignes). */
export function cellXY(i: number, portrait = false): { col: number; row: number } {
  const [c, r] = XY[((i % N_CELLS) + N_CELLS) % N_CELLS]
  return portrait ? { col: r, row: c } : { col: c, row: r }
}

/** Toutes les liaisons du tracé (case → case), pour dessiner le chemin. */
export const LINKS: Array<[number, number]> = NEXT.flatMap((n, i) => (Array.isArray(n) ? n.map((x) => [i, x] as [number, number]) : [[i, n] as [number, number]]))

/** Nombre d'étoiles en jeu selon le nombre de joueurs (comme `_dp_const().star_count`). */
export const starCount = (players: number) => (players <= 2 ? 1 : players <= 6 ? 2 : 3)

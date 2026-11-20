/** Modèle de données d'un plateau de Dédé Party (spec : docs/superpowers/specs/2026-11-20-dede-party-plateaux-design.md §1.3). */

export type MapId = 'grand' | 'mer' | 'kermesse' | 'camping' | 'ski'
export type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge' | 'tombola' | 'lift' | 'ice'

export interface ForkInfo {
  /** Case de l'embranchement. */
  cell: number
  /** Premières cases : [tout droit, détour]. */
  ways: [number, number]
  names: [string, string]
  emojis: [string, string]
  /** toggle : l'aiguillage bascule après chaque pion ; tide : il suit la marée (tenu par le serveur). */
  mode: 'toggle' | 'tide'
}

export interface Zone {
  id: string
  name: string
  emoji: string
  cells: number[]
  /** Teinte du ruban du chemin dans la zone. */
  road?: string
  /** Zone purement décorative (pas d'effet de jeu). */
  deco?: boolean
}

export interface BoardDef {
  id: MapId
  /** 1..5 (stat `map_no`). */
  no: number
  name: string
  emoji: string
  /** Une ligne pour les options. */
  pitch: string
  /** La mécanique en une phrase (générique, aide). */
  rule: string
  /** Grille paysage ; au téléphone la grille est transposée. */
  cols: number
  rows: number
  cells: CellType[]
  /** Case suivante ; [tout droit, détour] = embranchement. */
  next: Array<number | [number, number]>
  /** Case précédente (carte « recule ») : par la grande boucle aux retours. */
  prev: number[]
  /** (colonne, ligne) de chaque case. */
  xy: Array<[number, number]>
  /** Embranchements, dans l'ordre de `state.sw`. */
  forks: ForkInfo[]
  /** Liaisons sans ruban, franchies en grande cloche (Grande Luge). */
  jumps: Array<[number, number]>
  /** Miroir exact de `_dp_map(id)` (données de la mécanique). */
  extra: Record<string, unknown>
  zones: Zone[]
  /** Estrade de Dédé (coordonnées de grille, décimales permises). */
  dede: { col: number; row: number; scale: number }
  /** Zone libre du plateau 2D (repli sans WebGL) où l'on pose « qui joue » et Dédé, en coordonnées paysage. */
  hole: { col: number; row: number; w: number; h: number }
  /** Noms propres de quelques cases (aide, étiquettes). */
  cellNames?: Record<number, string>
  /** Téléporteurs (Dédé 2000) : case → { arrivée, nom }. */
  tp?: Record<number, { to: number; name: string }>
}

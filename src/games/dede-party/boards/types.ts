/**
 * Modèle de données d'un plateau de Dédé Party (spec : docs/superpowers/specs/2026-11-20-dede-party-plateaux-design.md §1.3,
 * tailles S / M / L : 2026-11-20-dede-party-grands-plateaux-design.md §1.3).
 */

export type MapId = 'grand' | 'mer' | 'kermesse' | 'camping' | 'ski'
export type CellType = 'start' | 'clap' | 'pub' | 'env' | 'loge' | 'tombola' | 'lift' | 'ice' | 'halt'
/** Taille d'une partie : s (2-4 joueurs, plateau classique), m (5-6, grand format), l (7-8, format géant : mer, ski). */
export type SizeId = 's' | 'm' | 'l'
/** Véhicule d'un transport (liaison entre deux cases non voisines, 1 pas). */
export type TransportKind = 'boat' | 'cabin' | 'slide' | 'luge'
/** Habillage d'une porte (embranchement) : aiguillage, bac, cabine, barrière, tourniquet, portique de piste. */
export type GateLook = 'switch' | 'boat' | 'cabin' | 'gate' | 'turnstile' | 'piste'
/** Voile d'un quartier fermé. */
export type VeilKind = 'curtain' | 'mist' | 'fence' | 'forest' | 'clouds'

export interface ForkInfo {
  /** Case de l'embranchement. */
  cell: number
  /** Premières cases : [tout droit, détour]. */
  ways: [number, number]
  names: [string, string]
  emojis: [string, string]
  /** toggle : l'aiguillage bascule après chaque pion ; tide : il suit la marée (tenu par le serveur). */
  mode: 'toggle' | 'tide'
  /** Habillage de la porte (défaut : aiguillage). */
  look?: GateLook
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

/** Un quartier : une excursion qui part d'une case du plateau de base (la porte) et y revient. */
export interface Quarter {
  id: string
  name: string
  emoji: string
  /** Taille qui l'ouvre. */
  opens: 'm' | 'l'
  /** Ses cases (bancs compris). */
  cells: number[]
  /** Case qui y mène (plateau de base, ou quartier du dessous). */
  gate: number
  /** Emprise en grille (décor, voile de fermeture, caméra), bornes comprises. */
  box: { c0: number; r0: number; c1: number; r1: number }
  road?: string
  /** Voile quand il est fermé. */
  veil: VeilKind
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
  /** Taille de ce tracé, tailles que le plateau possède, nom de la taille (« Les Îles », « Dédé 3000 »). */
  size: SizeId
  sizes: SizeId[]
  title?: string
  /** Emprise des cases ouvertes : coin haut-gauche (≤ 0) et largeur / hauteur ; au téléphone la grille est transposée. */
  col0: number
  row0: number
  cols: number
  rows: number
  cells: CellType[]
  /** Case suivante ; [tout droit, détour] = embranchement. */
  next: Array<number | [number, number]>
  /** Case précédente (carte « recule ») : par la grande boucle aux retours. */
  prev: number[]
  /** (colonne, ligne) de chaque case, repère du plateau de base prolongé (négatifs permis). */
  xy: Array<[number, number]>
  /** Embranchements, dans l'ordre de `state.sw`. */
  forks: ForkInfo[]
  /** Liaisons sans ruban : transports (Grande Luge, bacs, télécabines, pistes, Grande Descente). */
  jumps: Array<[number, number]>
  /** Un transport par liaison de `jumps` (clé « de-vers »). */
  transports: Record<string, { kind: TransportKind; name: string }>
  /** Miroir exact de `_dp_map(id, size)` (données de la mécanique). */
  extra: Record<string, unknown>
  zones: Zone[]
  /** Quartiers ouverts à cette taille, et fermés (aperçu derrière le voile). */
  quarters: Quarter[]
  closed: Quarter[]
  /** Haltes de départ (taille L). */
  starts?: number[]
  /** Altitude de chaque case (unités de scène ; Dédé 2000, rendu seulement). */
  alt?: number[]
  /** Estrade de Dédé (coordonnées de grille, décimales permises). */
  dede: { col: number; row: number; scale: number }
  /** Zone libre du plateau 2D (repli sans WebGL) où l'on pose « qui joue » et Dédé, en coordonnées paysage. */
  hole: { col: number; row: number; w: number; h: number }
  /** Noms propres de quelques cases (aide, étiquettes). */
  cellNames?: Record<number, string>
  /** Téléporteurs (Dédé 2000) : case → { arrivée, nom }. */
  tp?: Record<number, { to: number; name: string }>
}

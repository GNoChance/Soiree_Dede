/**
 * Registre des 5 plateaux de Dédé Party (un fichier par plateau dans `boards/`).
 * Chaque plateau = tableaux parallèles indexés par numéro de case (0 = Départ) + une fiche de mécanique,
 * dupliqués avec `_dp_board(map, taille)` / `_dp_next` / `_dp_prev` / `_dp_map` ; tailles S / M / L : `boards/build.ts`
 * (supabase/games/dede-party.sql) : synchro vérifiée par tools/sql-tests/dede-party.mjs.
 * Noms, positions à l'écran, zones et décor : front seulement.
 */
import { boards as camping } from './boards/camping'
import { boards as grand } from './boards/grand'
import { boards as kermesse } from './boards/kermesse'
import { boards as mer } from './boards/mer'
import { boards as ski } from './boards/ski'
import type { BoardDef, CellType, MapId, Quarter, SizeId, TransportKind } from './boards/types'

export type { BoardDef, CellType, ForkInfo, GateLook, MapId, Quarter, SizeId, TransportKind, VeilKind, Zone } from './boards/types'

/** Ordre de présentation (options, tirage) = numéro du plateau. */
export const MAP_IDS: MapId[] = ['grand', 'mer', 'kermesse', 'camping', 'ski']

/** Les plateaux classiques (taille S). */
export const BOARDS: Record<MapId, BoardDef> = { grand: grand.s, mer: mer.s, kermesse: kermesse.s, camping: camping.s, ski: ski.s }
/** Toutes les tailles de chaque plateau (`list` : tailles possédées, de la plus petite à la plus grande). */
export const SIZED: Record<MapId, Partial<Record<SizeId, BoardDef>> & { list: SizeId[] }> = { grand, mer, kermesse, camping, ski }

/**
 * Plateau d'une partie : id absent ou inconnu → le Grand Plateau (parties lancées avant les 5 plateaux) ;
 * taille absente ou que le plateau n'a pas → taille S (parties lancées avant les grandes tailles).
 */
export function boardOf(id?: string | null, size?: string | null): BoardDef {
  const all = (id && (SIZED as Record<string, (typeof SIZED)[MapId]>)[id]) || SIZED.grand
  return (size && all[size as SizeId]) || all.s!
}

export const isMapId = (x: unknown): x is MapId => typeof x === 'string' && (MAP_IDS as string[]).includes(x)
export const isSizeId = (x: unknown): x is SizeId => x === 's' || x === 'm' || x === 'l'

/** Taille d'une partie selon le nombre de joueurs (même règle que `_dp_size`) : l à 7-8 si le plateau l'a, m dès 5. */
export function sizeFor(map: MapId, players: number): SizeId {
  const list = SIZED[map].list
  if (players >= 7 && list.includes('l')) return 'l'
  if (players >= 5 && list.includes('m')) return 'm'
  return 's'
}

/** Libellé d'une taille (options, générique). */
export const SIZE_LABEL: Record<SizeId, string> = { s: 'Format classique', m: 'Grand format', l: 'Format géant' }

export const STAR_PRICE = 30
export const HALF_PRICE = 15

/** Position (colonne, ligne) de la case i ; `portrait` : plateau transposé (rows × cols). */
export function cellXY(b: BoardDef, i: number, portrait = false): { col: number; row: number } {
  const n = b.cells.length
  const [c0, r0] = b.xy[((i % n) + n) % n]
  // Repère prolongé (quartiers en colonnes / lignes négatives) ramené à l'emprise : 0..cols-1, 0..rows-1.
  const c = c0 - b.col0
  const r = r0 - b.row0
  return portrait ? { col: r, row: c } : { col: c, row: r }
}

/** Quartier ouvert d'une case (null : le plateau de base). */
export const quarterOf = (b: BoardDef, cell: number): Quarter | null => b.quarters.find((q) => q.cells.includes(cell)) ?? null

/** Transport de la liaison from → to (null : on y va à pied). */
export const transportOf = (b: BoardDef, from: number, to: number): { kind: TransportKind; name: string } | null => b.transports[`${from}-${to}`] ?? null

/** Toutes les liaisons du tracé (case → case), sauts compris. */
export function linksOf(b: BoardDef): Array<[number, number]> {
  return b.next.flatMap((n, i) => (Array.isArray(n) ? n.map((x) => [i, x] as [number, number]) : [[i, n] as [number, number]]))
}

/** La liaison a → b est-elle un saut (pas de ruban : Grande Luge) ? */
export const isJump = (b: BoardDef, from: number, to: number) => b.jumps.some(([x, y]) => x === from && y === to)

/** Types de cases présents sur le plateau (légende, aide), dans l'ordre de CELL_INFO. */
export function cellTypesOf(b: BoardDef): CellType[] {
  return (Object.keys(CELL_INFO) as CellType[]).filter((t) => b.cells.includes(t))
}

/** Zone (fonctionnelle ou décorative) d'une case, s'il y en a une. */
export const zoneOf = (b: BoardDef, cell: number) => b.zones.find((z) => z.cells.includes(cell))

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
  tombola: { label: 'Tombola', emoji: '🎟️', color: '#FF8C42', effect: '3 pièces au passage · gros lot si tu t’arrêtes pile dessus' },
  lift: { label: 'Télésiège', emoji: '🚡', color: '#B5E61D', effect: 'Pile dessus : tu montes à l’étage du dessus' },
  ice: { label: 'Plaque de verglas', emoji: '🧊', color: '#DFF3FF', effect: 'Pile dessus : tu glisses à l’étage du dessous' },
  halt: { label: 'Halte', emoji: '🏁', color: '#FFB703', effect: '+5 pièces quand tu y débarques' },
}

/** Nombre d'étoiles en jeu selon le nombre de joueurs (comme `_dp_const().star_count`). */
export const starCount = (players: number) => (players <= 2 ? 1 : players <= 6 ? 2 : 3)

/** Étoiles en jeu sur un plateau (grande taille : la base, 2 ou 3, plus celles de chaque quartier). */
export function starsInPlay(b: BoardDef, players: number): number {
  const zones = b.extra.stars as Array<{ n: number }> | undefined
  if (!zones) return starCount(players)
  return zones.reduce((a, z) => a + (z.n || Math.max(2, starCount(players))), 0)
}

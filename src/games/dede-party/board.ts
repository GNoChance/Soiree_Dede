/**
 * Registre des 5 plateaux de Dédé Party (un fichier par plateau dans `boards/`).
 * Chaque plateau = tableaux parallèles indexés par numéro de case (0 = Départ) + une fiche de mécanique,
 * dupliqués avec `_dp_board(map)` / `_dp_next(map)` / `_dp_prev(map)` / `_dp_map(map)`
 * (supabase/games/dede-party.sql) : synchro vérifiée par tools/sql-tests/dede-party.mjs.
 * Noms, positions à l'écran, zones et décor : front seulement.
 */
import { board as camping } from './boards/camping'
import { board as grand } from './boards/grand'
import { board as kermesse } from './boards/kermesse'
import { board as mer } from './boards/mer'
import { board as ski } from './boards/ski'
import type { BoardDef, CellType, MapId } from './boards/types'

export type { BoardDef, CellType, ForkInfo, MapId, Zone } from './boards/types'

/** Ordre de présentation (options, tirage) = numéro du plateau. */
export const MAP_IDS: MapId[] = ['grand', 'mer', 'kermesse', 'camping', 'ski']

export const BOARDS: Record<MapId, BoardDef> = { grand, mer, kermesse, camping, ski }

/** Plateau d'une partie : id absent ou inconnu → le Grand Plateau (parties lancées avant les 5 plateaux). */
export function boardOf(id?: string | null): BoardDef {
  return (id && (BOARDS as Record<string, BoardDef>)[id]) || grand
}

export const isMapId = (x: unknown): x is MapId => typeof x === 'string' && (MAP_IDS as string[]).includes(x)

export const STAR_PRICE = 30
export const HALF_PRICE = 15

/** Position (colonne, ligne) de la case i ; `portrait` : plateau transposé (rows × cols). */
export function cellXY(b: BoardDef, i: number, portrait = false): { col: number; row: number } {
  const n = b.cells.length
  const [c, r] = b.xy[((i % n) + n) % n]
  return portrait ? { col: r, row: c } : { col: c, row: r }
}

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
}

/** Nombre d'étoiles en jeu selon le nombre de joueurs (comme `_dp_const().star_count`). */
export const starCount = (players: number) => (players <= 2 ? 1 : players <= 6 ? 2 : 3)

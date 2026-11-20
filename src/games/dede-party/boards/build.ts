/**
 * Les tailles d'un plateau (spec grands plateaux §1.3) : à partir du plateau classique (taille S, constantes de
 * tête de boards/<id>.ts) et des tracés générés (CELLS_M … EXTRA_L), construit un `BoardDef` par taille. Tout ce
 * qui n'est que du rendu (quartiers, noms, véhicules) est décrit une fois, pour la plus grande taille ; chaque
 * taille garde ce qui la concerne (embranchements présents dans son tracé, quartiers ouverts ou fermés…).
 */
import type { BoardDef, CellType, ForkInfo, Quarter, SizeId, TransportKind, VeilKind, Zone } from './types'

export const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export interface SizeData {
  cells: CellType[]
  next: Array<number | [number, number]>
  prev: number[]
  xy: Array<[number, number]>
  jumps: Array<[number, number]>
  extra: Record<string, unknown>
}

export interface QuarterSpec {
  id: string
  name: string
  emoji: string
  opens: 'm' | 'l'
  cells: number[]
  gate: number
  road?: string
  veil: VeilKind
}

export interface SizeSpec {
  quarters: QuarterSpec[]
  /** Embranchements des grandes tailles (en plus de ceux du plateau classique). */
  forks: ForkInfo[]
  /** Véhicule de chaque transport (clé « de-vers ») ; ceux du plateau classique compris. */
  transports: Record<string, { kind: TransportKind; name: string }>
  /** Noms propres des cases des grandes tailles. */
  cellNames?: Record<number, string>
  /** Noms des téléporteurs des grandes tailles. */
  tp?: Record<number, string>
  titles?: Partial<Record<SizeId, string>>
  /** Zones fonctionnelles en plus (bancs de marée des îles), par taille. */
  zones?: Partial<Record<SizeId, Zone[]>>
  /** Altitude de chaque case (rendu seulement). */
  alt?: (xy: Array<[number, number]>) => number[]
}

/** Plateau classique, sans les champs propres aux tailles. */
export type BaseBoard = Omit<BoardDef, 'size' | 'sizes' | 'title' | 'col0' | 'row0' | 'quarters' | 'closed' | 'transports' | 'starts' | 'alt'>

const RANK: Record<SizeId, number> = { s: 0, m: 1, l: 2 }

function boxOf(xy: Array<[number, number]>, cells: number[]) {
  const cs = cells.map((i) => xy[i][0])
  const rs = cells.map((i) => xy[i][1])
  return { c0: Math.min(...cs), r0: Math.min(...rs), c1: Math.max(...cs), r1: Math.max(...rs) }
}

export function sizeBoards(base: BaseBoard, data: Partial<Record<'m' | 'l', SizeData>>, spec: SizeSpec): Record<SizeId, BoardDef> & { list: SizeId[] } {
  const sizes: SizeId[] = ['s', ...(['m', 'l'] as const).filter((x) => data[x])]
  const biggest = data.l ?? data.m
  const allForks = [...base.forks, ...spec.forks].sort((a, b) => a.cell - b.cell)
  const out = { list: sizes } as Record<SizeId, BoardDef> & { list: SizeId[] }
  for (const size of sizes) {
    const d: SizeData = size === 's' ? { cells: base.cells, next: base.next, prev: base.prev, xy: base.xy, jumps: base.jumps, extra: base.extra } : data[size]!
    const n = d.cells.length
    const forks = allForks.filter((f) => {
      const nx = d.next[f.cell]
      return Array.isArray(nx) && nx[0] === f.ways[0] && nx[1] === f.ways[1]
    })
    const quarter = (q: QuarterSpec): Quarter => ({ ...q, box: boxOf(biggest?.xy ?? d.xy, q.cells) })
    const quarters = spec.quarters.filter((q) => RANK[q.opens] <= RANK[size]).map(quarter)
    const closed = spec.quarters.filter((q) => RANK[q.opens] > RANK[size]).map(quarter)
    const box = size === 's' ? { c0: 0, r0: 0, c1: base.cols - 1, r1: base.rows - 1 } : boxOf(d.xy, d.xy.map((_, i) => i))
    const tpOf = d.extra.tp as Record<string, number> | undefined
    const tp = tpOf
      ? Object.fromEntries(Object.entries(tpOf).map(([a, to]) => [Number(a), { to, name: base.tp?.[Number(a)]?.name ?? spec.tp?.[Number(a)] ?? 'Télésiège' }]))
      : undefined
    out[size] = {
      ...base,
      size,
      sizes,
      title: spec.titles?.[size],
      col0: box.c0,
      row0: box.r0,
      cols: box.c1 - box.c0 + 1,
      rows: box.r1 - box.r0 + 1,
      cells: d.cells,
      next: d.next,
      prev: d.prev,
      xy: d.xy,
      forks,
      jumps: d.jumps,
      transports: Object.fromEntries(d.jumps.map(([a, b]) => [`${a}-${b}`, spec.transports[`${a}-${b}`] ?? { kind: 'luge' as const, name: 'Transport' }])),
      extra: d.extra,
      zones: [
        ...(spec.zones?.[size] ?? []),
        ...base.zones,
        ...quarters.map((q): Zone => ({ id: q.id, name: q.name, emoji: q.emoji, cells: q.cells, road: q.road })),
      ],
      quarters,
      closed,
      starts: (d.extra.starts as number[] | undefined) ?? undefined,
      alt: spec.alt?.(d.xy),
      cellNames: { ...base.cellNames, ...Object.fromEntries(Object.entries(spec.cellNames ?? {}).filter(([i]) => Number(i) < n)) },
      tp,
    }
  }
  return out
}

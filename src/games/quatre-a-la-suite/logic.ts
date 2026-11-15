/**
 * Règles PURES de « 4 à la suite » (miroir de _q4s_line / board_move en SQL).
 * Sans dépendance : testable sous Node. Grille = 7 colonnes de jetons empilés
 * du bas vers le haut (cols[c][r], r = 0 en bas).
 */

export const WIDTH = 7
export const HEIGHT = 6
export const ALIGN = 4

export type Cols = ReadonlyArray<ReadonlyArray<string>>
export type Cell = [number, number]

/** Propriétaire de la case (c, r), ou null (vide / hors grille). */
export function cellAt(cols: Cols, c: number, r: number): string | null {
  if (c < 0 || c >= WIDTH || r < 0 || r >= HEIGHT) return null
  return cols[c]?.[r] ?? null
}

/** Ligne où tomberait un jeton dans la colonne `c`, ou null si pleine / invalide. */
export function dropRow(cols: Cols, c: number): number | null {
  if (!Number.isInteger(c) || c < 0 || c >= WIDTH) return null
  const n = cols[c]?.length ?? 0
  return n < HEIGHT ? n : null
}

export const legalColumns = (cols: Cols): number[] => [...Array(WIDTH).keys()].filter((c) => dropRow(cols, c) !== null)

export const isFull = (cols: Cols): boolean => legalColumns(cols).length === 0

const DIRS: Cell[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/** Jetons alignés (≥ 4) passant par (c, r) pour `who`, toutes directions ; null sinon. */
export function findLine(cols: Cols, c: number, r: number, who: string): Cell[] | null {
  const out = new Map<string, Cell>()
  for (const [dc, dr] of DIRS) {
    const seg: Cell[] = [[c, r]]
    for (let k = 1; cellAt(cols, c + k * dc, r + k * dr) === who; k++) seg.push([c + k * dc, r + k * dr])
    for (let k = 1; cellAt(cols, c - k * dc, r - k * dr) === who; k++) seg.push([c - k * dc, r - k * dr])
    if (seg.length >= ALIGN) for (const p of seg) out.set(`${p[0]},${p[1]}`, p)
  }
  return out.size ? [...out.values()] : null
}

export interface DropResult {
  cols: string[][]
  row: number
  line: Cell[] | null
  outcome: 'win' | 'draw' | null
}

/** Joue un jeton (sans muter `cols`). null si le coup est illégal. */
export function drop(cols: Cols, c: number, who: string): DropResult | null {
  const row = dropRow(cols, c)
  if (row === null) return null
  const next = cols.map((col, i) => (i === c ? [...col, who] : [...col]))
  const line = findLine(next, c, row, who)
  return { cols: next, row, line, outcome: line ? 'win' : isFull(next) ? 'draw' : null }
}

/** Ensemble « c,r » des cases gagnantes (accès rapide pour l'affichage). */
export const lineKeys = (line: ReadonlyArray<Cell> | null | undefined): Set<string> => new Set((line ?? []).map(([c, r]) => `${c},${r}`))

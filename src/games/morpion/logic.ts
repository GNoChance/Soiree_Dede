/**
 * Règles PURES du Morpion — miroir de supabase/games/morpion.sql
 * (_morpion_runs, game_morpion_board_move / _board_auto). Sans dépendance :
 * testable sous Node (type stripping). Trois variantes :
 *  - classic  : grille 3×3, aligner 3 ;
 *  - giant    : grille 10×10, aligner 5 ou plus ;
 *  - ultimate : 9 petits morpions 3×3 dans un grand. Case i = 9 × petit + case
 *               (petit et case de 0 à 8, sens de lecture).
 * Les grilles sont stockées à plat : i = ligne × côté + colonne.
 */

export type Sym = 'x' | 'o'
export type CellValue = Sym | null
/** État d'un petit morpion (ultime) : gagné par x / o, nul (plein), en cours. */
export type MiniStatus = Sym | 'draw' | null
export type Variant = 'classic' | 'giant' | 'ultimate'
export type MoveError = 'invalid_move' | 'wrong_board' | 'board_closed' | 'cell_taken'

export interface VariantInfo {
  id: Variant
  /** Côté de la grille de cases. */
  size: number
  /** Alignement gagnant (ultime : 3 petits morpions). */
  align: number
  label: string
  /** Résumé d'une ligne (options). */
  short: string
  help: string
}

export const VARIANTS: VariantInfo[] = [
  {
    id: 'classic',
    size: 3,
    align: 3,
    label: 'Classique',
    short: '3×3 · aligne 3',
    help: 'La grille de 3×3 de toujours : aligne 3 symboles (ligne, colonne ou diagonale). Grille pleine = nul.',
  },
  {
    id: 'giant',
    size: 10,
    align: 5,
    label: 'Géant',
    short: '10×10 · aligne 5',
    help: 'Une grande grille de 10×10 : aligne 5 symboles ou plus pour gagner. Grille pleine = nul.',
  },
  {
    id: 'ultimate',
    size: 9,
    align: 3,
    label: 'Ultime',
    short: '9 morpions en 1',
    help: '9 petits morpions dans un grand : la case où tu joues envoie l’adversaire dans le petit morpion correspondant (s’il est fini : n’importe où). Gagne un petit morpion pour y poser ton grand symbole, et aligne-en 3 !',
  },
]

export const isVariant = (v: unknown): v is Variant => v === 'classic' || v === 'giant' || v === 'ultimate'

/** Variante des options du plateau (absente / inconnue -> classic, comme le SQL). */
export function variantOf(options: unknown): Variant {
  const v = options && typeof options === 'object' ? (options as { variant?: unknown }).variant : undefined
  return isVariant(v) ? v : 'classic'
}

export const variantInfo = (v: Variant): VariantInfo => VARIANTS.find((x) => x.id === v) ?? VARIANTS[0]

/** Partie logique du plateau (sous-ensemble du plateau public). */
export interface Grid {
  variant: Variant
  size: number
  align: number
  cells: CellValue[]
  /** Ultime : état des 9 petits morpions ; null sinon. */
  boards: MiniStatus[] | null
  /** Ultime : petit morpion imposé (null = libre). */
  next: number | null
}

export function newGrid(variant: Variant): Grid {
  const { size, align } = variantInfo(variant)
  return {
    variant,
    size,
    align,
    cells: Array<CellValue>(size * size).fill(null),
    boards: variant === 'ultimate' ? Array<MiniStatus>(9).fill(null) : null,
    next: null,
  }
}

/** Directions (dr, dc), dans l'ordre du SQL : ligne, colonne, diagonale \, diagonale /. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

function at(grid: ReadonlyArray<string | null>, n: number, r: number, c: number): string | null {
  return r >= 0 && r < n && c >= 0 && c < n ? (grid[r * n + c] ?? null) : null
}

/**
 * Segments de `sym` alignés (≥ `align`) passant par la case `idx` d'une grille
 * n × n à plat, chacun ordonné d'un bout à l'autre ; null s'il n'y en a pas.
 * Miroir exact de _morpion_runs (même ordre des directions et des cases).
 */
export function runsThrough(grid: ReadonlyArray<string | null>, n: number, idx: number, align: number, sym: Sym): number[][] | null {
  const r = Math.floor(idx / n)
  const c = idx % n
  if (at(grid, n, r, c) !== sym) return null
  const out: number[][] = []
  for (const [dr, dc] of DIRS) {
    let k = 0
    while (at(grid, n, r - (k + 1) * dr, c - (k + 1) * dc) === sym) k++
    const seg: number[] = []
    while (at(grid, n, r - k * dr, c - k * dc) === sym) {
      seg.push((r - k * dr) * n + (c - k * dc))
      k--
    }
    if (seg.length >= align) out.push(seg)
  }
  return out.length ? out : null
}

/** Les 9 cases du petit morpion `b` (ultime). */
export const subGrid = <T>(cells: ReadonlyArray<T>, b: number): T[] => cells.slice(9 * b, 9 * b + 9)

export const isFull = (grid: ReadonlyArray<unknown>): boolean => grid.every((v) => v !== null && v !== undefined)

/** Petit morpion jouable maintenant ? (ultime ; toujours vrai sinon). */
export function boardPlayable(g: Pick<Grid, 'variant' | 'boards' | 'next'>, b: number): boolean {
  if (g.variant !== 'ultimate') return true
  if (g.boards?.[b] != null) return false
  return g.next === null || g.next === b
}

/** Petits morpions où le prochain coup est permis (ultime ; [] sinon). */
export function playableBoards(g: Pick<Grid, 'variant' | 'boards' | 'next'>): number[] {
  if (g.variant !== 'ultimate') return []
  return [...Array(9).keys()].filter((b) => boardPlayable(g, b))
}

/** Code d'erreur (le même que le SQL) si le coup est illégal, sinon null. */
export function moveError(g: Grid, cell: unknown): MoveError | null {
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= g.size * g.size) return 'invalid_move'
  if (g.variant === 'ultimate') {
    const b = Math.floor(cell / 9)
    if (g.next !== null && b !== g.next) return 'wrong_board'
    if (g.boards?.[b] != null) return 'board_closed'
  }
  if (g.cells[cell] != null) return 'cell_taken'
  return null
}

/** Cases jouables (pour le coup automatique : le serveur en tire une au hasard). */
export function legalCells(g: Grid): number[] {
  const out: number[] = []
  for (let i = 0; i < g.cells.length; i++) if (moveError(g, i) === null) out.push(i)
  return out
}

export interface MoveResult {
  grid: Grid
  /** Segments gagnants (cases ; ultime : petits morpions), sinon null. */
  lines: number[][] | null
  outcome: 'win' | 'draw' | null
}

/** Joue `sym` en `cell` (sans muter `g`). Lève une Error(code) si le coup est illégal. */
export function applyMove(g: Grid, cell: number, sym: Sym): MoveResult {
  const err = moveError(g, cell)
  if (err) throw new Error(err)
  const cells = [...g.cells]
  cells[cell] = sym
  if (g.variant !== 'ultimate') {
    const lines = runsThrough(cells, g.size, cell, g.align, sym)
    const outcome = lines ? 'win' : isFull(cells) ? 'draw' : null
    return { grid: { ...g, cells, next: null }, lines, outcome }
  }
  const b = Math.floor(cell / 9)
  const k = cell % 9
  const boards = [...(g.boards ?? Array<MiniStatus>(9).fill(null))]
  const sub = subGrid(cells, b)
  let lines: number[][] | null = null
  if (runsThrough(sub, 3, k, 3, sym)) {
    boards[b] = sym
    lines = runsThrough(boards, 3, b, 3, sym)
  } else if (isFull(sub)) {
    boards[b] = 'draw'
  }
  const outcome = lines ? 'win' : isFull(boards) ? 'draw' : null
  const next = outcome === null && boards[k] === null ? k : null
  return { grid: { ...g, cells, boards, next }, lines, outcome }
}

const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

/** Lignes complètes de `sym` dans une grille 3×3 (affichage d'un petit morpion gagné). */
export function triplesOf(grid3: ReadonlyArray<string | null>, sym: Sym): number[][] {
  return TRIPLES.filter((t) => t.every((i) => grid3[i] === sym)).map((t) => [...t])
}

/** Symbole d'un joueur sur ce plateau. */
export function symOf(board: { x: string; o: string }, id: string | null | undefined): Sym | null {
  return id === board.x ? 'x' : id === board.o ? 'o' : null
}

/** Joueur d'un symbole. */
export const playerOfSym = (board: { x: string; o: string }, sym: Sym): string => (sym === 'x' ? board.x : board.o)

/** Tactile : en géant / ultime (petites cases), un toucher vise et un second toucher joue. */
export const needsConfirm = (variant: Variant, touch: boolean): boolean => touch && variant !== 'classic'

/**
 * Consigne « À toi » du bandeau du socle (au-dessus du plateau, toujours à
 * l'écran avec le compte à rebours). En tactile hors classique, elle annonce le
 * double toucher : un premier toucher ne fait que viser.
 */
export function turnHint(b: { variant: Variant; next: number | null }, mine: string, touch: boolean): string {
  const confirm = needsConfirm(b.variant, touch)
  if (b.variant === 'ultimate') {
    const where = b.next === null ? 'où tu veux' : 'zone surlignée'
    return confirm ? `À toi ${mine} : ${where}, vise puis retouche !` : `À toi ${mine} : ${where} !`
  }
  return confirm ? `À toi ${mine} : vise puis retouche !` : `À toi : place ton ${mine} !`
}

/**
 * Ancrage horizontal de la bulle « Retouche » posée sur la case visée (colonne
 * affichée 0..cols-1) : collée à gauche / à droite près des bords pour ne jamais
 * sortir du plateau, centrée ailleurs.
 */
export function bubbleAnchor(col: number, cols: number): 'left' | 'center' | 'right' {
  if (col <= 1) return 'left'
  if (col >= cols - 2) return 'right'
  return 'center'
}

/** Position (ligne, colonne) d'une case sur la grille affichée (ultime : grille 9×9). */
export function cellRC(variant: Variant, size: number, i: number): [number, number] {
  if (variant !== 'ultimate') return [Math.floor(i / size), i % size]
  const b = Math.floor(i / 9)
  const k = i % 9
  return [Math.floor(b / 3) * 3 + Math.floor(k / 3), (b % 3) * 3 + (k % 3)]
}

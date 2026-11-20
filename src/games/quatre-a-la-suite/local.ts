/**
 * Moteur LOCAL de « 4 à la suite » (mode solo) : miroir exact des hooks
 * game_quatre_a_la_suite_board_new / board_move (synchro : tools/sql-tests/solo-sync.mjs).
 */
import type { LocalDuelGame } from '@/features/solo/engine'
import { ALIGN, HEIGHT, WIDTH, cellAt, drop, legalColumns } from './logic'
import type { Q4Board, Q4Move } from './types'

export const legalMoves = (b: Q4Board): number[] => legalColumns(b.cols)

/** Bilan de fin de manche pour les trophées (miroir de _q4s_kinds). */
function kinds(cols: string[][], c: number, r: number, who: string) {
  let n = 0
  let diag = false
  let five = false
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]
  dirs.forEach(([dc, dr], i) => {
    let len = 1
    for (let k = 1; cellAt(cols, c + k * dc, r + k * dr) === who; k++) len++
    for (let k = 1; cellAt(cols, c - k * dc, r - k * dr) === who; k++) len++
    if (len >= ALIGN) {
      n++
      if (i >= 2) diag = true
      if (len >= 5) five = true
    }
  })
  return { n, diag, five }
}

/**
 * Jetons gagnants, EXACTEMENT comme _q4s_line : segments ≥ 4 par direction, et un jeton
 * n'est ajouté que si `line @> [[c, r]]` est faux. Attention, la containment jsonb ignore
 * l'ordre : [2,3] « contient » [3,2] et [2,2] — le SQL peut donc omettre un jeton ; on
 * reproduit ce comportement pour garder le même state.
 */
function sqlLine(cols: string[][], c: number, r: number, who: string): Array<[number, number]> | null {
  let line: Array<[number, number]> = []
  for (const [dc, dr] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]) {
    const seg: Array<[number, number]> = [[c, r]]
    for (let k = 1; cellAt(cols, c + k * dc, r + k * dr) === who; k++) seg.push([c + k * dc, r + k * dr])
    for (let k = 1; cellAt(cols, c - k * dc, r - k * dr) === who; k++) seg.push([c - k * dc, r - k * dr])
    if (seg.length >= ALIGN) {
      const prior = line
      line = [...line, ...seg.filter(([x, y]) => !prior.some((p) => p.includes(x) && p.includes(y)))]
    }
  }
  return line.length ? line : null
}

export const local: LocalDuelGame<Q4Board, Q4Move> = {
  id: 'quatre-a-la-suite',
  boardNew: (_ctx, a, b) => ({
    board: { width: WIDTH, height: HEIGHT, cols: [[], [], [], [], [], [], []], a, b, count: 0, last: null, line: null },
  }),
  boardMove: (board, _server, actor, move) => {
    const col = (move as unknown as { col?: unknown })?.col
    if (typeof col !== 'number' || !Number.isInteger(col) || col < 0 || col >= WIDTH) throw new Error('invalid_move')
    const r = drop(board.cols, col, actor)
    if (!r) throw new Error('column_full')
    const count = board.count + 1
    const line = r.line ? sqlLine(r.cols, col, r.row, actor) : null
    const next: Q4Board = { ...board, cols: r.cols, count, last: { col, row: r.row, by: actor }, line }
    if (line) {
      const k = kinds(r.cols, col, r.row, actor)
      return { board: next, outcome: 'win', winner: actor, game: { diag: k.diag, double: k.n >= 2 || k.five } }
    }
    if (count >= WIDTH * HEIGHT) return { board: next, outcome: 'draw' }
    return { board: next, outcome: null }
  },
}

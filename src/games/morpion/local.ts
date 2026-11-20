/**
 * Moteur LOCAL du Morpion (mode solo) : miroir exact des hooks game_morpion_board_new /
 * board_move de supabase/games/morpion.sql (synchro : tools/sql-tests/solo-sync.mjs).
 */
import type { LocalDuelGame } from '@/features/solo/engine'
import { applyMove, legalCells, symOf, turnHint, variantInfo, type CellValue, type MiniStatus, type Sym, type Variant } from './logic'
import type { MorpionBoard, MorpionMove } from './types'

const variantOfOpts = (o: unknown): Variant => {
  const v = o && typeof o === 'object' ? (o as { variant?: unknown }).variant : undefined
  return v === 'classic' || v === 'giant' || v === 'ultimate' ? v : 'classic'
}

/** Consigne « À toi » du mode solo (même texte que le bandeau du socle duel). */
export const soloHint = (b: MorpionBoard, me: string): string => turnHint(b, symOf(b, me) === 'x' ? '❌' : '⭕', false)

/** Cases jouables du joueur au trait. */
export const legalMoves = (b: MorpionBoard): number[] => legalCells(b)

export const local: LocalDuelGame<MorpionBoard, MorpionMove> = {
  id: 'morpion',
  boardNew: (ctx, a, b) => {
    const variant = variantOfOpts(ctx.options)
    const { size, align } = variantInfo(variant)
    const x = ctx.starter === b ? b : a
    return {
      board: {
        variant,
        size,
        align,
        a,
        b,
        x,
        o: x === a ? b : a,
        cells: Array<CellValue>(size * size).fill(null),
        count: 0,
        last: null,
        lines: null,
        boards: variant === 'ultimate' ? Array<MiniStatus>(9).fill(null) : null,
        next: null,
      },
    }
  },
  boardMove: (board, _server, actor, move) => {
    const sym: Sym | null = actor === board.x ? 'x' : actor === board.o ? 'o' : null
    if (!sym) throw new Error('invalid_move')
    const m = move as unknown
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('invalid_move')
    const keys = Object.keys(m)
    if (keys.length !== 1 || keys[0] !== 'cell') throw new Error('invalid_move')
    const cell = (m as { cell: unknown }).cell
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 999) throw new Error('invalid_move')
    const r = applyMove(board, cell, sym) // lève invalid_move / wrong_board / board_closed / cell_taken
    const ult = board.variant === 'ultimate'
    const next: MorpionBoard = {
      ...board,
      cells: r.grid.cells,
      count: board.count + 1,
      last: { cell, by: actor },
      lines: r.lines,
      boards: ult ? r.grid.boards : null,
      next: ult && r.outcome === null ? r.grid.next : null,
    }
    if (r.outcome === 'win') {
      const opp = sym === 'x' ? 'o' : 'x'
      return { board: next, outcome: 'win', winner: actor, game: { clean_ultimate: ult && !(r.grid.boards ?? []).includes(opp) } }
    }
    return { board: next, outcome: r.outcome }
  },
}

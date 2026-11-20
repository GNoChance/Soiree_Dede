/**
 * Accès RAPIDE à chess.js pour le mode solo (moteur local + bot). L'API publique
 * (`moves({verbose})`, `move()`) calcule la notation SAN et deux FEN par coup : bien trop
 * lent pour une recherche. On passe donc par les méthodes internes `_moves`, `_makeMove`,
 * `_undoMove` et le tableau `_board` (0x88) — d'où la version EXACTE de chess.js dans
 * package.json (1.4.0) : à revérifier (tools/sql-tests/solo-sync.mjs) avant toute montée.
 */
import { Chess } from 'chess.js'
import type { ChessSide } from './types'

/** Position au format du serveur (cf. _echecs_fen). */
export interface ChessPos {
  sq: string
  side: ChessSide
  castle: string
  ep: number | null
  half: number
  full: number
}

export interface InternalMove {
  color: ChessSide
  from: number
  to: number
  piece: string
  captured?: string
  promotion?: string
  flags: number
}

interface Raw {
  _moves: (o?: { legal?: boolean }) => InternalMove[]
  _makeMove: (m: InternalMove) => void
  _undoMove: () => unknown
  _board: Array<{ type: string; color: ChessSide } | undefined | null>
  _turn: ChessSide
}

export const raw = (c: Chess): Raw => c as unknown as Raw

/** Case 0x88 de chess.js -> index 0..63 (0 = a8). */
export const idx = (sq: number): number => (sq >> 4) * 8 + (sq & 7)
const sqName = (i: number) => `${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}`

export function fenOf(p: ChessPos): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let empty = 0
    for (let c = 0; c < 8; c++) {
      const ch = p.sq[r * 8 + c]
      if (ch === '.') empty++
      else {
        if (empty) row += empty
        empty = 0
        row += ch
      }
    }
    rows.push(row + (empty ? empty : ''))
  }
  return `${rows.join('/')} ${p.side} ${p.castle || '-'} ${p.ep === null ? '-' : sqName(p.ep)} ${p.half} ${p.full}`
}

export const chessOf = (p: ChessPos): Chess => new Chess(fenOf(p), { skipValidation: true })

/** Coups légaux encodés comme le SQL : from + 64 × to + 4096 × promo (1 = q, 2 = r, 3 = b, 4 = n). */
export function legalCodes(c: Chess): number[] {
  return raw(c)
    ._moves({ legal: true })
    .map((m) => idx(m.from) + 64 * idx(m.to) + 4096 * (m.promotion ? 'qrbn'.indexOf(m.promotion) + 1 : 0))
}

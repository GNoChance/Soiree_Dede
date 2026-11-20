/**
 * Moteur LOCAL des Échecs (mode solo) : miroir exact des hooks game_echecs_board_new /
 * board_move / board_offturn de supabase/games/echecs.sql — même plateau public (sq, moves,
 * check, captured…), même part serveur (répétitions, compteurs). Génération des coups
 * légaux : chess.js ; tout le reste est porté du SQL (synchro : tools/sql-tests/solo-sync.mjs).
 */
import type { LocalDuelGame, HookResult } from '@/features/solo/engine'
import { chessOf, legalCodes, type ChessPos } from './chessCore'
import type { Cadence, ChessBoard, ChessEndReason, ChessMove, ChessSide, Promo } from './types'

const START: ChessPos = {
  sq: 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR',
  side: 'w',
  castle: 'KQkq',
  ep: null,
  half: 0,
  full: 1,
}
const TSTATS0 = { moves: 0, captures: 0, queens_lost: 0, castles: 0, en_passants: 0, promotions: 0, stalemate_blunders: 0 }
type TStats = Record<string, Record<string, number>>
interface ChessServer {
  positions?: Record<string, number>
  tstats?: TStats
}

const other = (s: ChessSide): ChessSide => (s === 'w' ? 'b' : 'w')
const isUpper = (ch: string) => ch !== '.' && ch === ch.toUpperCase()

/** Pièces seules après le coup (roque, prise en passant, promotion) — _echecs_after. */
function after(sq: string, m: number): string {
  const f = m & 63
  const t = (m >> 6) & 63
  const pr = m >> 12
  const pc = sq[f]
  const cap = sq[t]
  let np = pc
  if (pr > 0) {
    np = 'QRBN'[pr - 1]
    if (pc === 'p') np = np.toLowerCase()
  }
  const s = sq.split('')
  s[f] = '.'
  s[t] = np
  if ((pc === 'K' || pc === 'k') && Math.abs(t - f) === 2) {
    const rook = pc === 'K' ? 'R' : 'r'
    if (t > f) {
      s[f + 3] = '.'
      s[f + 1] = rook
    } else {
      s[f - 4] = '.'
      s[f - 1] = rook
    }
  } else if ((pc === 'P' || pc === 'p') && f % 8 !== t % 8 && cap === '.') {
    s[Math.floor(f / 8) * 8 + (t % 8)] = '.'
  }
  return s.join('')
}

/** Position suivante — _echecs_apply. */
export function applyPos(p: ChessPos, m: number): ChessPos {
  const f = m & 63
  const t = (m >> 6) & 63
  const pc = p.sq[f]
  const capt = p.sq[t] !== '.'
  let c = p.castle ?? ''
  if (pc === 'K') c = c.replace(/[KQ]/g, '')
  if (pc === 'k') c = c.replace(/[kq]/g, '')
  if (f === 63 || t === 63) c = c.replace('K', '')
  if (f === 56 || t === 56) c = c.replace('Q', '')
  if (f === 7 || t === 7) c = c.replace('k', '')
  if (f === 0 || t === 0) c = c.replace('q', '')
  const pawn = pc.toUpperCase() === 'P'
  return {
    sq: after(p.sq, m),
    side: other(p.side),
    castle: c,
    ep: pawn && Math.abs(t - f) === 16 ? (f + t) / 2 : null,
    half: pawn || capt ? 0 : (p.half ?? 0) + 1,
    full: (p.full ?? 1) + (p.side === 'b' ? 1 : 0),
  }
}

/** Clé de répétition — _echecs_key. */
function keyOf(p: ChessPos, legal: number[]): string {
  let ep = '-'
  if (p.ep !== null) {
    for (const m of legal) {
      if (((m >> 6) & 63) === p.ep && p.sq[m & 63].toUpperCase() === 'P') {
        ep = String(p.ep)
        break
      }
    }
  }
  return p.sq + p.side + (p.castle || '-') + ep
}

/** Coups légaux publics {"from": [to…]} — _echecs_moves_json. */
function movesJson(legal: number[]): Record<string, number[]> {
  const by = new Map<number, Set<number>>()
  for (const m of legal) {
    const f = m & 63
    if (!by.has(f)) by.set(f, new Set())
    by.get(f)!.add((m >> 6) & 63)
  }
  const out: Record<string, number[]> = {}
  for (const f of [...by.keys()].sort((x, y) => x - y)) out[String(f)] = [...by.get(f)!].sort((x, y) => x - y)
  return out
}

/** Matériel insuffisant — _echecs_insufficient. */
function insufficient(sq: string): boolean {
  const rest = sq.replace(/[.Kk]/g, '')
  if (rest === '') return true
  if (rest.length === 1 && 'BbNn'.includes(rest)) return true
  if (!/^[Bb]+$/.test(rest)) return false
  let color: number | null = null
  for (let i = 0; i < 64; i++) {
    if (sq[i] === 'B' || sq[i] === 'b') {
      const c = (Math.floor(i / 8) + (i % 8)) % 2
      if (color === null) color = c
      else if (color !== c) return false
    }
  }
  return true
}

/** Le camp `side` peut-il encore mater ? — _echecs_can_mate. */
function canMate(sq: string, side: ChessSide): boolean {
  const v = [...sq].filter((ch) => ch !== '.' && ch !== 'K' && ch !== 'k' && (side === 'w' ? isUpper(ch) : !isUpper(ch))).join('').toUpperCase()
  return !(v === '' || v === 'B' || v === 'N')
}

const VALUE: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9 }
function material(sq: string, side: ChessSide): number {
  let n = 0
  for (const ch of sq) if (ch !== '.' && (side === 'w' ? isUpper(ch) : !isUpper(ch))) n += VALUE[ch.toUpperCase()] ?? 0
  return n
}

const CLOCK_MS: Partial<Record<Cadence, number>> = { blitz3: 180000, rapid5: 300000, slow10: 600000 }

/** Temps restant (ms) au joueur au trait, null sans pendule — _echecs_left. */
function leftMs(b: ChessBoard): number | null {
  if (!b.clock || typeof b.clock !== 'object') return null
  const mover = b.side === 'w' ? b.white : b.black
  return (b.clock[mover] ?? 0) - Math.floor(Date.now() - new Date(b.turn_started_at).getTime())
}

const posOf = (b: ChessBoard): ChessPos => ({ sq: b.sq, side: b.side, castle: b.castle ?? '', ep: b.ep ?? null, half: b.half ?? 0, full: b.full ?? 1 })
const legalOf = (p: ChessPos) => legalCodes(chessOf(p))

function finish(board: ChessBoard, server: ChessServer, reason: ChessEndReason, winner: string | null): HookResult<ChessBoard> {
  return {
    board: { ...board, moves: {}, draw_offer: null, end: { reason, winner } },
    server,
    outcome: winner === null ? 'draw' : 'win',
    winner: winner ?? undefined,
    game: { reason, p: server.tstats ?? {} },
  }
}

function flag(board: ChessBoard, server: ChessServer): HookResult<ChessBoard> {
  const mover = board.side === 'w' ? board.white : board.black
  const opp = board.side === 'w' ? board.black : board.white
  const b = { ...board, clock: { ...(board.clock ?? {}), [mover]: 0 } }
  return finish(b, server, 'time', canMate(b.sq, other(board.side)) ? opp : null)
}

const tinc = (t: TStats, p: string, k: string, n: number): TStats => ({ ...t, [p]: { ...t[p], [k]: (t[p]?.[k] ?? 0) + n } })

/** Coups légaux du camp au trait, au format des coups envoyés (promotion : les 4 pièces). */
export function legalMoves(b: ChessBoard): Array<{ from: number; to: number; promo?: Promo }> {
  return legalOf(posOf(b)).map((m) => {
    const pr = m >> 12
    return { from: m & 63, to: (m >> 6) & 63, ...(pr ? { promo: 'qrbn'[pr - 1] as Promo } : {}) }
  })
}

function boardMove(board: ChessBoard, server0: unknown, actor: string, move: ChessMove): HookResult<ChessBoard> {
  const m = move as unknown as Record<string, unknown>
  const type = m.type === undefined || m.type === null ? null : String(m.type)
  const side = board.side
  const opp = other(side)
  const otherP = side === 'w' ? board.black : board.white
  let me: ChessSide
  if (actor === board.white) me = 'w'
  else if (actor === board.black) me = 'b'
  else throw new Error('invalid_move')
  if (board.end && typeof board.end === 'object') throw new Error('invalid_move')
  const left = leftMs(board)
  let server: ChessServer = server0 && typeof server0 === 'object' ? { ...(server0 as ChessServer) } : {}
  let t: TStats = server.tstats ?? { [board.white]: { ...TSTATS0 }, [board.black]: { ...TSTATS0 } }
  server = { ...server, tstats: t }
  const nkeys = Object.keys(m).length

  if (type === 'resign') {
    if (nkeys !== 1) throw new Error('invalid_move')
    return finish(board, server, 'resign', me === 'w' ? board.black : board.white)
  }
  if (me !== side) throw new Error('not_your_turn')
  if (type === 'flag') {
    if (nkeys !== 1) throw new Error('invalid_move')
    if (left === null || left > 50) throw new Error('invalid_move')
    return flag(board, server)
  }
  let f = 0
  let to = 0
  if (type === null) {
    const isIdx = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99
    if (
      Object.keys(m).some((k) => !['from', 'to', 'promo', 'offer_draw'].includes(k)) ||
      !isIdx(m.from) ||
      !isIdx(m.to) ||
      ('promo' in m && (typeof m.promo !== 'string' || !['q', 'r', 'b', 'n'].includes(m.promo))) ||
      ('offer_draw' in m && typeof m.offer_draw !== 'boolean')
    )
      throw new Error('invalid_move')
    f = m.from as number
    to = m.to as number
    if (f > 63 || to > 63) throw new Error('invalid_move')
  } else if (type !== 'accept_draw') throw new Error('invalid_move')

  if (left !== null && left <= 0) return flag(board, server)

  if (type === 'accept_draw') {
    if (nkeys !== 1) throw new Error('invalid_move')
    if (board.draw_offer !== otherP) throw new Error('no_draw_offer')
    return finish(board, server, 'agreement', null)
  }

  const pos = posOf(board)
  const legal = legalOf(pos)
  let pr = 0
  if (legal.includes(f + 64 * to + 4096)) {
    if (!('promo' in m)) throw new Error('promotion_required')
    pr = 'qrbn'.indexOf(m.promo as string) + 1
  } else if ('promo' in m) throw new Error('invalid_move')
  const code = f + 64 * to + 4096 * pr
  if (!legal.includes(code)) throw new Error('invalid_move')

  const pc = pos.sq[f]
  let cap = pos.sq[to]
  const isEp = pc.toUpperCase() === 'P' && f % 8 !== to % 8 && cap === '.'
  if (isEp) cap = side === 'w' ? 'p' : 'P'
  const np = applyPos(pos, code)
  const c = chessOf(np)
  const nlegal = legalCodes(c)
  const check = c.inCheck()

  const key = keyOf(np, nlegal)
  const rep = (server.positions?.[key] ?? 0) + 1
  server = { ...server, positions: { ...(server.positions ?? {}), [key]: rep } }

  t = tinc(t, actor, 'moves', 1)
  if (cap !== '.') {
    t = tinc(t, actor, 'captures', 1)
    if (cap.toUpperCase() === 'Q') t = tinc(t, otherP, 'queens_lost', 1)
  }
  if (isEp) t = tinc(t, actor, 'en_passants', 1)
  if (pc.toUpperCase() === 'K' && Math.abs(to - f) === 2) t = tinc(t, actor, 'castles', 1)
  if (pr > 0) t = tinc(t, actor, 'promotions', 1)

  let clock = board.clock
  let secs = 60
  if (left !== null && clock) {
    clock = { ...clock, [actor]: left }
    secs = (clock[otherP] ?? 0) / 1000
  }

  const next: ChessBoard = {
    ...board,
    sq: np.sq,
    side: opp,
    castle: np.castle,
    ep: np.ep,
    half: np.half,
    full: np.full,
    moves: movesJson(nlegal),
    check,
    last: { from: f, to },
    captured: cap !== '.' ? { ...board.captured, [side]: (board.captured?.[side] ?? '') + cap } : board.captured,
    clock,
    turn_started_at: new Date().toISOString(),
    draw_offer: m.offer_draw === true ? actor : null,
  }

  if (nlegal.length === 0) {
    if (check) return finish(next, { ...server, tstats: t }, 'mate', actor)
    if (material(np.sq, side) - material(np.sq, opp) >= 5) t = tinc(t, actor, 'stalemate_blunders', 1)
    return finish(next, { ...server, tstats: t }, 'stalemate', null)
  }
  server = { ...server, tstats: t }
  if (insufficient(np.sq)) return finish(next, server, 'material', null)
  if (rep >= 3) return finish(next, server, 'repetition', null)
  if (np.half >= 100) return finish(next, server, 'fifty', null)
  return { board: next, server, outcome: null, turn_seconds: secs }
}

export const local: LocalDuelGame<ChessBoard, ChessMove> = {
  id: 'echecs',
  boardNew: (ctx, a, b) => {
    const raw = ctx.options?.cadence
    const cadence: Cadence = raw === 'blitz3' || raw === 'rapid5' || raw === 'slow10' || raw === 'none' ? raw : 'rapid5'
    const ms = CLOCK_MS[cadence] ?? null
    const white = ctx.starter ?? a
    const black = white === a ? b : a
    const legal = legalOf(START)
    return {
      board: {
        ...START,
        white,
        black,
        moves: movesJson(legal),
        check: false,
        last: null,
        captured: { w: '', b: '' },
        cadence,
        clock: ms !== null ? { [white]: ms, [black]: ms } : null,
        turn_started_at: new Date().toISOString(),
        draw_offer: null,
        end: null,
      },
      server: { positions: { [keyOf(START, legal)]: 1 }, tstats: { [white]: { ...TSTATS0 }, [black]: { ...TSTATS0 } } },
      turn_seconds: ms !== null ? ms / 1000 : 60,
    }
  },
  boardMove,
  boardOffturn: (board, server, actor, move) => {
    if ((move as { type?: unknown }).type !== 'resign') throw new Error('not_your_turn')
    return boardMove(board, server, actor, move)
  },
}

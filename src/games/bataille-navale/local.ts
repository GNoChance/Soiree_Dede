/**
 * Moteur LOCAL de la Bataille navale (mode solo) : miroir exact des hooks
 * game_bataille_navale_board_new / board_setup / board_move de
 * supabase/games/bataille-navale.sql (synchro : tools/sql-tests/solo-sync.mjs).
 * Les flottes restent dans la part « serveur » (jamais affichée) ; chacun ne voit
 * la sienne que dans son secret, comme en ligne.
 */
import type { LocalDuelGame } from '@/features/solo/engine'
import { SHIPS, cellIndex, fleetError, fleetTouches, normalizeFleet, randomFleet, shipAt, shipCells } from './logic'
import type { BnBoard, BnMove, BnSecret, BnShip, BnShot, BnShotResult } from './types'

interface BnServer {
  fleets: Record<string, BnShip[]>
}
/** Stats du tireur côté SQL (compteurs de trophées en plus de BnStats). */
interface BnStatsX {
  shots: number
  hits: number
  streak: number
  best: number
  mstreak?: number
  mbest?: number
  fh?: number
}

export const SHIP_DEFS = SHIPS
export const fleetErrorOf = fleetError
export const fleetTouchesOf = fleetTouches

const isDigit = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9

/** Cases non encore visées dans les eaux adverses de `shooter`. */
export function legalMoves(b: BnBoard, shooter: string): Array<{ x: number; y: number }> {
  const target = shooter === b.a ? b.b : b.a
  const shot = new Set((b.waters[target]?.shots ?? []).map((s) => cellIndex(s.x, s.y)))
  const out: Array<{ x: number; y: number }> = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (!shot.has(cellIndex(x, y))) out.push({ x, y })
  return out
}

const secretOf = (b: BnBoard, me: string, fleet: BnShip[]): BnSecret => ({
  duel_no: b.duel_no,
  game_no: b.game_no,
  me,
  fleet,
  received: b.waters[me]?.shots ?? [],
})

function checkFleet(f: unknown): BnShip[] {
  const e = fleetError(f)
  if (e) throw new Error(e)
  return normalizeFleet(f as BnShip[])
}

const serverOf = (s: unknown): BnServer => {
  const o = s && typeof s === 'object' && !Array.isArray(s) ? (s as Partial<BnServer>) : {}
  const fleets = o.fleets && typeof o.fleets === 'object' && !Array.isArray(o.fleets) ? o.fleets : {}
  return { ...(o as object), fleets } as BnServer
}

export const local: LocalDuelGame<BnBoard, BnMove> = {
  id: 'bataille-navale',
  boardNew: (ctx, a, b) => {
    const fa = randomFleet()
    const fb = randomFleet()
    const n = SHIPS.length
    const board: BnBoard = {
      size: 10,
      a,
      b,
      duel_no: ctx.duel_no,
      game_no: ctx.game_no,
      ships: SHIPS.map((s) => ({ ...s })),
      waters: { [a]: { shots: [], sunk: [], left: n }, [b]: { shots: [], sunk: [], left: n } },
      stats: { [a]: { shots: 0, hits: 0, streak: 0, best: 0 }, [b]: { shots: 0, hits: 0, streak: 0, best: 0 } },
      count: 0,
      last: null,
      reveal: null,
    }
    return {
      board,
      server: { fleets: { [a]: fa, [b]: fb } },
      secrets: { [a]: secretOf(board, a, fa), [b]: secretOf(board, b, fb) },
      setup_seconds: 60,
    }
  },

  boardSetup: (board, server, actor, move) => {
    const srv = serverOf(server)
    const fleets = { ...srv.fleets }
    if (move.type === 'begin') {
      if (actor !== null) throw new Error('invalid_move')
      const secrets: Record<string, BnSecret> = {}
      for (const p of [board.a, board.b]) {
        let f = fleets[p]
        if (fleetError(f) !== null) f = randomFleet()
        fleets[p] = f
        secrets[p] = secretOf(board, p, f)
      }
      return { board, server: { ...srv, fleets }, secrets }
    }
    if (actor === null || (actor !== board.a && actor !== board.b)) throw new Error('not_duelist')
    let fleet = fleets[actor]
    if (move.type === 'place') fleet = checkFleet(move.ships)
    else if (move.type === 'shuffle') fleet = randomFleet()
    else if (move.type === 'ready') {
      if (fleetError(fleet) !== null) throw new Error('setup_incomplete')
      return { board }
    } else if (move.type === 'auto') {
      if (fleetError(fleet) === null) return { board }
      fleet = randomFleet()
    } else throw new Error('invalid_move')
    return { board, server: { ...srv, fleets: { ...fleets, [actor]: fleet } }, secrets: { [actor]: secretOf(board, actor, fleet) } }
  },

  boardMove: (board, server, actor, move) => {
    const { a, b } = board
    if (actor !== a && actor !== b) throw new Error('not_duelist')
    const m = move as unknown as Record<string, unknown>
    if (!m || typeof m !== 'object' || Array.isArray(m) || !isDigit(m.x) || !isDigit(m.y)) throw new Error('invalid_move')
    if (Object.keys(m).length !== 2) throw new Error('invalid_move')
    const x = m.x
    const y = m.y
    const cell = cellIndex(x, y)
    const target = actor === a ? b : a
    const w0 = board.waters[target] ?? { shots: [], sunk: [], left: SHIPS.length }
    let shots: BnShot[] = [...(w0.shots ?? [])]
    if (shots.some((s) => cellIndex(s.x, s.y) === cell)) throw new Error('already_shot')
    const fleets = serverOf(server).fleets
    const fleet = fleets[target]
    if (fleetError(fleet) !== null) throw new Error('invalid_board')

    let sunk = [...(w0.sunk ?? [])]
    const ship = shipAt(fleet, x, y)
    let r: BnShotResult
    if (!ship) {
      r = 'miss'
      shots = [...shots, { x, y, r: 'miss' }]
    } else {
      const cells = new Set((shipCells(ship) ?? []).map(([cx, cy]) => cellIndex(cx, cy)))
      const hits = shots.filter((s) => cells.has(cellIndex(s.x, s.y))).length + 1
      shots = [...shots, { x, y, r: 'hit' }]
      if (hits >= cells.size) {
        r = 'sunk'
        shots = shots.map((s) => (cells.has(cellIndex(s.x, s.y)) ? { ...s, r: 'sunk' } : s))
        sunk = [...sunk, ship]
      } else r = 'hit'
    }
    const left = fleet.length - sunk.length
    const w = { ...w0, sunk, shots, left }

    const st0 = (board.stats[actor] ?? {}) as Partial<BnStatsX>
    const miss = r === 'miss'
    const streak = miss ? 0 : (st0.streak ?? 0) + 1
    const mstreakNext = miss ? (st0.mstreak ?? 0) + 1 : 0
    const st: BnStatsX = {
      ...st0,
      shots: (st0.shots ?? 0) + 1,
      hits: (st0.hits ?? 0) + (miss ? 0 : 1),
      streak,
      best: Math.max(st0.best ?? 0, streak),
      mstreak: mstreakNext,
      mbest: Math.max(st0.mbest ?? 0, miss ? (st0.mstreak ?? 0) + 1 : 0),
      fh: (st0.shots ?? 0) === 0 ? (miss ? 0 : 1) : (st0.fh ?? 0),
    }
    let next: BnBoard = {
      ...board,
      waters: { ...board.waters, [target]: w },
      stats: { ...board.stats, [actor]: st },
      count: board.count + 1,
      last: { by: actor, x, y, r, ship: r === 'sunk' && ship ? ship.id : null },
    }
    const secrets = { [target]: secretOf(next, target, fleet) }

    if (left <= 0) {
      next = { ...next, reveal: { [a]: fleets[a], [b]: fleets[b] } }
      const sa = next.stats[a] as BnStatsX
      const sb = next.stats[b] as BnStatsX
      const pl = (s: BnStatsX | undefined, mine: string, theirs: string) => ({
        shots: s?.shots ?? 0,
        hits: s?.hits ?? 0,
        best: s?.best ?? 0,
        mbest: s?.mbest ?? 0,
        fh: s?.fh ?? 0,
        left: next.waters[mine]?.left ?? 5,
        enemy_left: next.waters[theirs]?.left ?? 5,
      })
      return {
        board: next,
        secrets,
        outcome: 'win',
        winner: actor,
        game: { total: next.count, p: { [a]: pl(sa, a, b), [b]: pl(sb, b, a) } },
      }
    }
    if (miss) return { board: next, secrets, outcome: null }
    return { board: next, secrets, outcome: null, turn: actor }
  },
}

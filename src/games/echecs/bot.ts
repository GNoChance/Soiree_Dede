/**
 * Bot des Échecs (mode solo) : règles chess.js (méthodes internes, cf. chessCore.ts),
 * alpha-bêta maison profondeur 1 → 3 selon le niveau (+ recherche des prises au calme dès
 * le niveau 6), évaluation matériel + position (tables simplifiées), approfondissement
 * itératif plafonné en temps (~1 s). Bruit aux niveaux bas : coup pris parmi ceux à moins
 * de X centipions du meilleur, et quelques gaffes aux niveaux 1-3. Tourne dans le Web Worker.
 */
import type { Chess } from 'chess.js'
import { chessOf, idx, raw, type InternalMove } from './chessCore'
import type { ChessBoard, ChessMove, ChessSide, Promo } from './types'

type Rng = () => number
const MATE = 100_000
const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

// Tables de position (Blancs, index 0 = a8), d'après la « Simplified Evaluation Function ».
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
}

/** Évaluation statique (centipions) du point de vue du camp au trait. */
export function evaluate(c: Chess): number {
  const r = raw(c)
  let s = 0
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7
      continue
    }
    const p = r._board[sq]
    if (!p) continue
    const i = idx(sq)
    const v = VAL[p.type] + PST[p.type][p.color === 'w' ? i : (7 - Math.floor(i / 8)) * 8 + (i % 8)]
    s += p.color === 'w' ? v : -v
  }
  return r._turn === 'w' ? s : -s
}

class Timeout extends Error {}
interface Ctx {
  nodes: number
  deadline: number
  quiet: boolean
}

const order = (ms: InternalMove[]) =>
  ms
    .map((m) => ({ m, k: (m.captured ? 10 * VAL[m.captured] - VAL[m.piece] / 10 : 0) + (m.promotion ? VAL[m.promotion] : 0) }))
    .sort((p, q) => q.k - p.k)
    .map((x) => x.m)

function quiesce(c: Chess, alpha: number, beta: number, qd: number, ctx: Ctx): number {
  const stand = evaluate(c)
  if (stand >= beta || qd === 0) return stand
  if (stand > alpha) alpha = stand
  const r = raw(c)
  for (const m of order(r._moves({ legal: true }).filter((x) => x.captured || x.promotion))) {
    if ((++ctx.nodes & 255) === 0 && performance.now() > ctx.deadline) throw new Timeout()
    r._makeMove(m)
    const s = -quiesce(c, -beta, -alpha, qd - 1, ctx)
    r._undoMove()
    if (s >= beta) return s
    if (s > alpha) alpha = s
  }
  return alpha
}

function search(c: Chess, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  if ((++ctx.nodes & 255) === 0 && performance.now() > ctx.deadline) throw new Timeout()
  const r = raw(c)
  const ms = r._moves({ legal: true })
  if (!ms.length) return c.inCheck() ? -MATE + ply : 0
  if (depth === 0) return ctx.quiet ? quiesce(c, alpha, beta, 4, ctx) : evaluate(c)
  let best = -Infinity
  for (const m of order(ms)) {
    r._makeMove(m)
    const s = -search(c, depth - 1, -beta, -alpha, ply + 1, ctx)
    r._undoMove()
    if (s > best) best = s
    if (s > alpha) alpha = s
    if (alpha >= beta) break
  }
  return best
}

export const depthFor = (level: number): number => [1, 1, 2, 2, 2, 3, 3, 3, 3, 3][Math.min(10, Math.max(1, level)) - 1]
/** Écart toléré (centipions) avec le meilleur coup : 360 au niveau 1 → 0 au niveau 10. */
const marginFor = (level: number) => (10 - level) * 40

const toMove = (m: InternalMove): ChessMove => ({ from: idx(m.from), to: idx(m.to), ...(m.promotion ? { promo: m.promotion as Promo } : {}) })

const boardChess = (b: ChessBoard) => chessOf({ sq: b.sq, side: b.side, castle: b.castle ?? '', ep: b.ep ?? null, half: b.half ?? 0, full: b.full ?? 1 })

/** Le bot accepte une nulle proposée s'il n'est pas mieux (évaluation ≤ +0,5 pion). */
export function acceptsDraw(b: ChessBoard): boolean {
  return evaluate(boardChess(b)) <= 50
}

export function chooseMove(b: ChessBoard, me: string, level: number, rng: Rng = Math.random, budgetMs = 900): ChessMove {
  const side: ChessSide = b.white === me ? 'w' : 'b'
  if (b.draw_offer && b.draw_offer !== me && b.side === side && acceptsDraw(b)) return { type: 'accept_draw' }
  const c = boardChess(b)
  const r = raw(c)
  const L = Math.min(10, Math.max(1, level))
  const root = order(r._moves({ legal: true }))
  if (!root.length) return { type: 'resign' }
  if (L <= 3 && rng() < 0.15 * (4 - L)) return toMove(root[Math.floor(rng() * root.length)])

  const ctx: Ctx = { nodes: 0, deadline: performance.now() + budgetMs, quiet: L >= 6 }
  const margin = marginFor(L)
  let scores: number[] = root.map(() => 0)
  for (let d = 1; d <= depthFor(L) + (L >= 9 ? 1 : 0); d++) {
    const cur: number[] = []
    let best = -Infinity
    try {
      for (const m of root) {
        r._makeMove(m)
        const s = -search(c, d - 1, -Infinity, -(best - margin - 1), 1, ctx)
        r._undoMove()
        cur.push(s)
        if (s > best) best = s
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e
      break // recherche interrompue (plateau `c` laissé tel quel, plus utilisé) : on garde la profondeur précédente
    }
    scores = cur
    // meilleur coup d'abord pour la profondeur suivante
    const perm = root.map((m, i) => ({ m, s: scores[i] })).sort((p, q) => q.s - p.s)
    root.splice(0, root.length, ...perm.map((x) => x.m))
    scores = perm.map((x) => x.s)
    if (scores[0] >= MATE - 100) break
  }
  const top = Math.max(...scores)
  const pool = root.filter((_, i) => scores[i] >= top - margin)
  return toMove(pool[Math.floor(rng() * pool.length)] ?? root[0])
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
/** Réaction du bot : `joie` s'il prend une pièce (ou donne échec et mat), `surprise` si le joueur le fait. */
export function reaction(prev: ChessBoard, next: ChessBoard, by: string, bot: string): 'joie' | 'surprise' | null {
  const sideBy: ChessSide = prev.white === by ? 'w' : 'b'
  const before = prev.captured?.[sideBy] ?? ''
  const after = next.captured?.[sideBy] ?? ''
  const gain = after.length > before.length ? (VALUE[after.slice(-1).toLowerCase()] ?? 0) : 0
  const big = gain >= 3 || next.end?.reason === 'mate' || (next.check && gain > 0)
  if (!big) return null
  return by === bot ? 'joie' : 'surprise'
}

/**
 * Bot du Morpion (mode solo). Classique : minimax complet (parfait au niveau 10) ;
 * niveaux bas : coup au hasard 60 % (niveau 1) → 0 % (niveau 10).
 * Géant / ultime (non proposés en solo pour l'instant) : gagner > bloquer > hasard.
 */
import { applyMove, legalCells, runsThrough, type CellValue, type Sym } from './logic'
import type { MorpionBoard, MorpionMove } from './types'

type Rng = () => number
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

const winner = (c: CellValue[]): Sym | null => {
  for (const [p, q, r] of LINES) if (c[p] && c[p] === c[q] && c[p] === c[r]) return c[p]
  return null
}

const memo = new Map<string, number>()
/** Score minimax pour `turn` au trait (+ = bon pour `turn`) ; gagner tôt = mieux (10 − cases remplies). */
function minimax(c: CellValue[], turn: Sym): number {
  const key = c.map((v) => v ?? '.').join('') + turn
  const hit = memo.get(key)
  if (hit !== undefined) return hit
  let best = -Infinity
  let any = false
  const filled = c.filter(Boolean).length + 1
  for (let i = 0; i < 9; i++) {
    if (c[i]) continue
    any = true
    c[i] = turn
    const s = winner(c) === turn ? 10 - filled : -minimax(c, turn === 'x' ? 'o' : 'x')
    c[i] = null
    if (s > best) best = s
  }
  const res = any ? best : 0
  memo.set(key, res)
  return res
}

/** Scores de chaque coup légal (classique). */
export function scoreMoves(b: MorpionBoard, sym: Sym): Array<{ cell: number; score: number }> {
  const c = [...b.cells]
  return legalCells(b).map((cell) => {
    c[cell] = sym
    const s = winner(c) === sym ? 10 - c.filter(Boolean).length : -minimax(c, sym === 'x' ? 'o' : 'x')
    c[cell] = null
    return { cell, score: s }
  })
}

const pick = <T>(a: T[], rng: Rng): T => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]

/** Coup gagnant immédiat de `sym` (toutes variantes), sinon null. */
export function winningCell(b: MorpionBoard, sym: Sym): number | null {
  for (const cell of legalCells(b)) {
    try {
      if (applyMove(b, cell, sym).outcome === 'win') return cell
    } catch {
      /* coup illégal */
    }
  }
  return null
}

export function chooseMove(b: MorpionBoard, me: string, level: number, rng: Rng = Math.random): MorpionMove {
  const sym: Sym = b.x === me ? 'x' : 'o'
  const legal = legalCells(b)
  const pRandom = (0.6 * (10 - level)) / 9
  if (rng() < pRandom) return { cell: pick(legal, rng) }
  if (b.variant === 'classic') {
    const scored = scoreMoves(b, sym)
    const top = Math.max(...scored.map((s) => s.score))
    return { cell: pick(scored.filter((s) => s.score === top).map((s) => s.cell), rng) }
  }
  const win = winningCell(b, sym)
  if (win !== null) return { cell: win }
  const block = winningCell({ ...b, next: b.next }, sym === 'x' ? 'o' : 'x')
  if (block !== null && legal.includes(block)) return { cell: block }
  return { cell: pick(legal, rng) }
}

/** Réaction du bot après le coup de `by` : `joie` (beau coup du bot), `surprise` (le joueur l'a contré). */
export function reaction(prev: MorpionBoard, next: MorpionBoard, by: string, bot: string): 'joie' | 'surprise' | null {
  const botSym: Sym = prev.x === bot ? 'x' : 'o'
  if (by === bot) {
    // le bot menace d'aligner au prochain coup (deux menaces = vraie joie)
    const threats = legalCells({ ...next, next: null }).filter((cell) => {
      const c = [...next.cells]
      c[cell] = botSym
      return next.variant !== 'ultimate' && runsThrough(c, next.size, cell, next.align, botSym)
    })
    return threats.length >= 2 ? 'joie' : null
  }
  // le joueur a pris la case qui faisait gagner le bot
  const win = winningCell(prev, botSym)
  return win !== null && next.last?.cell === win ? 'surprise' : null
}

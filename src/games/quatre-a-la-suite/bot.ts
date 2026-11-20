/**
 * Bot de « 4 à la suite » (mode solo) : négamax alpha-bêta avec heuristique d'alignements
 * (fenêtres de 4 cases), approfondissement itératif plafonné en temps (~1 s), profondeur
 * 1 → 7 selon le niveau. Dès le niveau 3 : gagne s'il peut, bloque TOUJOURS une victoire
 * immédiate. Bruit aux niveaux bas (coup au hasard). Tourne dans le Web Worker du solo.
 */
import type { Q4Board, Q4Move } from './types'

type Rng = () => number
const W = 7
const H = 6
const ORDER = [3, 2, 4, 1, 5, 0, 6]
const WIN = 1_000_000

/** Fenêtres de 4 cases (indices c * H + r). */
const WINDOWS: number[][] = (() => {
  const out: number[][] = []
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]
  for (let c = 0; c < W; c++)
    for (let r = 0; r < H; r++)
      for (const [dc, dr] of dirs) {
        const ec = c + 3 * dc
        const er = r + 3 * dr
        if (ec < 0 || ec >= W || er < 0 || er >= H) continue
        out.push([0, 1, 2, 3].map((k) => (c + k * dc) * H + r + k * dr))
      }
  return out
})()

class Pos {
  g = new Int8Array(W * H) // 0 vide, 1 = bot, 2 = adversaire
  h = new Int8Array(W)
  n = 0
  play(c: number, p: number) {
    this.g[c * H + this.h[c]] = p
    this.h[c]++
    this.n++
  }
  undo(c: number) {
    this.h[c]--
    this.g[c * H + this.h[c]] = 0
    this.n--
  }
  /** Le jeton posé en dernier dans la colonne c aligne-t-il 4 ? */
  wins(c: number, p: number): boolean {
    const r = this.h[c] - 1
    const at = (cc: number, rr: number) => cc >= 0 && cc < W && rr >= 0 && rr < H && this.g[cc * H + rr] === p
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      let k = 1
      for (let i = 1; at(c + i * dc, r + i * dr); i++) k++
      for (let i = 1; at(c - i * dc, r - i * dr); i++) k++
      if (k >= 4) return true
    }
    return false
  }
  /** Gagne immédiatement en jouant c ? */
  winsWith(c: number, p: number): boolean {
    if (this.h[c] >= H) return false
    this.play(c, p)
    const w = this.wins(c, p)
    this.undo(c)
    return w
  }
  /** Évaluation statique du point de vue de p. */
  eval(p: number): number {
    const q = 3 - p
    let s = 0
    for (let r = 0; r < H; r++) {
      if (this.g[3 * H + r] === p) s += 4
      else if (this.g[3 * H + r] === q) s -= 4
    }
    for (const w of WINDOWS) {
      let mine = 0
      let theirs = 0
      for (const i of w) {
        const v = this.g[i]
        if (v === p) mine++
        else if (v === q) theirs++
      }
      if (mine && theirs) continue
      if (mine === 3) s += 50
      else if (mine === 2) s += 6
      else if (theirs === 3) s -= 60
      else if (theirs === 2) s -= 6
    }
    return s
  }
}

class Timeout extends Error {}

function negamax(pos: Pos, depth: number, alpha: number, beta: number, p: number, ctx: { nodes: number; deadline: number }): number {
  if ((++ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) throw new Timeout()
  if (pos.n >= W * H) return 0
  // victoire immédiate
  for (const c of ORDER) if (pos.winsWith(c, p)) return WIN - pos.n
  if (depth === 0) return pos.eval(p)
  let best = -Infinity
  for (const c of ORDER) {
    if (pos.h[c] >= H) continue
    pos.play(c, p)
    const s = -negamax(pos, depth - 1, -beta, -alpha, 3 - p, ctx)
    pos.undo(c)
    if (s > best) best = s
    if (s > alpha) alpha = s
    if (alpha >= beta) break
  }
  return best
}

export const depthFor = (level: number): number => [1, 1, 2, 3, 3, 4, 5, 6, 7, 7][Math.min(10, Math.max(1, level)) - 1]

function fromBoard(b: Q4Board, me: string): Pos {
  const pos = new Pos()
  b.cols.forEach((col, c) => col.forEach((who) => pos.play(c, who === me ? 1 : 2)))
  return pos
}

export function chooseMove(b: Q4Board, me: string, level: number, rng: Rng = Math.random, budgetMs = 900): Q4Move {
  const pos = fromBoard(b, me)
  const legal = ORDER.filter((c) => pos.h[c] < H)
  const forced = level >= 3
  if (forced) {
    const win = legal.find((c) => pos.winsWith(c, 1))
    if (win !== undefined) return { col: win }
    const block = legal.find((c) => pos.winsWith(c, 2))
    if (block !== undefined) return { col: block }
  }
  const pRandom = (0.5 * (10 - level)) / 9
  if (rng() < pRandom) return { col: legal[Math.floor(rng() * legal.length)] }

  const ctx = { nodes: 0, deadline: performance.now() + budgetMs }
  let scores = new Map<number, number>(legal.map((c) => [c, 0]))
  for (let d = 1; d <= depthFor(level); d++) {
    const cur = new Map<number, number>()
    try {
      for (const c of legal) {
        pos.play(c, 1)
        cur.set(c, pos.wins(c, 1) ? WIN : -negamax(pos, d - 1, -Infinity, Infinity, 2, ctx))
        pos.undo(c)
      }
    } catch (e) {
      if (e instanceof Timeout) break
      throw e
    }
    scores = cur
  }
  const top = Math.max(...scores.values())
  // à égalité : préférer le centre (ORDER), avec un peu de hasard aux niveaux moyens
  const best = legal.filter((c) => scores.get(c) === top)
  return { col: level >= 8 ? best[0] : best[Math.floor(rng() * best.length)] }
}

/** Réaction du bot : `joie` s'il crée une double menace, `surprise` si le joueur bloque sa victoire. */
export function reaction(prev: Q4Board, next: Q4Board, by: string, bot: string): 'joie' | 'surprise' | null {
  if (by === bot) {
    const pos = fromBoard(next, bot)
    return ORDER.filter((c) => pos.winsWith(c, 1)).length >= 2 ? 'joie' : null
  }
  const pos = fromBoard(prev, bot)
  const col = next.last?.col
  return col !== undefined && pos.winsWith(col, 1) ? 'surprise' : null
}

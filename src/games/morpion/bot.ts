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

/* ------------------------------------------------------------------ apprentissage (2b) */

/** Les 8 symétries du 3 × 3 (permutations des cases). */
const SYMS: number[][] = (() => {
  const rot = (p: number[]) => p.map((_, i) => p[(2 - (i % 3)) * 3 + Math.floor(i / 3)])
  const flip = (p: number[]) => p.map((_, i) => p[Math.floor(i / 3) * 3 + (2 - (i % 3))])
  const out: number[][] = []
  let p = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  for (let k = 0; k < 4; k++) {
    out.push(p, flip(p))
    p = rot(p)
  }
  return out
})()

/** Grille vue du bot (m = joueur, b = bot, . = vide), la plus petite des 8 symétries. */
export function canonKey(cells: readonly CellValue[], botSym: Sym): string {
  const s = cells.map((v) => (v === null ? '.' : v === botSym ? 'b' : 'm'))
  let best = ''
  for (const p of SYMS) {
    const k = p.map((i) => s[i]).join('')
    if (!best || k < best) best = k
  }
  return best
}

export type OpeningType = 'center' | 'corner' | 'edge'
export const openingType = (cell: number): OpeningType => (cell === 4 ? 'center' : cell % 2 === 0 ? 'corner' : 'edge')
export const OPENING_CELLS: Record<OpeningType, number[]> = { center: [4], corner: [0, 2, 6, 8], edge: [1, 3, 5, 7] }

/**
 * Indices de la mémoire (calculés sur le fil principal par learn.ts) :
 * m1 = le joueur vient de jouer son ouverture favorite (réponse sans bruit) ;
 * m2 = type d'ouverture au meilleur bilan quand le bot commence ; traps = positions pièges.
 */
export interface MorpionHints {
  rate: number
  m1?: boolean
  m2?: OpeningType
  traps?: Record<string, number>
}

export interface MorpionChoice {
  move: MorpionMove
  learned?: string
}

/** Coup du bot. Sans indices (`hints`) : exactement le jeu de l'étape 1 (mêmes tirages). */
export function decide(b: MorpionBoard, me: string, level: number, rng: Rng = Math.random, hints?: MorpionHints): MorpionChoice {
  const sym: Sym = b.x === me ? 'x' : 'o'
  const legal = legalCells(b)
  const classic = b.variant === 'classic'
  const rate = hints?.rate ?? 0
  const best = () => {
    const scored = scoreMoves(b, sym)
    const top = Math.max(...scored.map((s) => s.score))
    return scored.filter((s) => s.score === top).map((s) => s.cell)
  }
  // M1 : réponse à l'ouverture favorite du joueur, sans bruit (le seul « coup appris » de la partie).
  if (classic && hints?.m1 && rate > 0 && rng() < rate) return { move: { cell: pick(best(), rng) }, learned: 'm1' }
  const pRandom = (0.6 * (10 - level)) / 9
  if (rng() < pRandom) return { move: { cell: pick(legal, rng) } }
  if (classic) {
    const top = best()
    if (rate > 0 && top.length > 1) {
      // M2 : le bot commence, les 9 cases se valent : il prend l'ouverture qui marche contre ce joueur.
      if (hints?.m2 && b.count === 0 && rng() < rate) {
        const cells = top.filter((c) => OPENING_CELLS[hints.m2!].includes(c))
        if (cells.length) return { move: { cell: pick(cells, rng) }, learned: 'm2' }
      }
      // M3 : entre coups de même valeur, celui qui mène à une position où le joueur s'est déjà trompé.
      const traps = hints?.traps
      if (traps && Object.keys(traps).length) {
        const c = [...b.cells]
        let pickCell = -1
        let w = 0
        for (const cell of top) {
          c[cell] = sym
          const k = traps[canonKey(c, sym)] ?? 0
          c[cell] = null
          if (k > w) {
            w = k
            pickCell = cell
          }
        }
        if (pickCell >= 0 && rng() < rate) return { move: { cell: pickCell }, learned: 'm3' }
      }
    }
    return { move: { cell: pick(top, rng) } }
  }
  const win = winningCell(b, sym)
  if (win !== null) return { move: { cell: win } }
  const block = winningCell({ ...b, next: b.next }, sym === 'x' ? 'o' : 'x')
  if (block !== null && legal.includes(block)) return { move: { cell: block } }
  return { move: { cell: pick(legal, rng) } }
}

export function chooseMove(b: MorpionBoard, me: string, level: number, rng: Rng = Math.random, hints?: MorpionHints): MorpionMove {
  return decide(b, me, level, rng, hints).move
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

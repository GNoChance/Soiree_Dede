/**
 * Mémoire du bot à « 4 à la suite » (2b) : colonnes jouées, 1re colonne, blocages oubliés par
 * direction, victoires manquées, cadeaux sous la case gagnante, livre des débuts de partie
 * (clé : qui commence + colonnes des 8 premiers jetons, la plus petite avec son miroir).
 * Ce que ça change : Q1 (départage vers ta colonne), Q2 (attaque là où tu ne regardes pas),
 * Q3 (évite une suite où il a déjà perdu, prend celle qui marche).
 */
import { howOften, memBase, sum, type GameLearner, type Insight, type MemBase } from '@/features/solo/memory'
import type { SoloLog } from '@/features/solo/log'
import type { Q4Hints } from './bot'
import type { Q4Board, Q4Move } from './types'
import { COL_NAMES, DIR_TXT, scan, type DirId } from './why'

export interface Q4Mem extends MemBase {
  /** [7] part de chaque colonne dans les coups du joueur (somme = 1 par partie). */
  cols: number[]
  /** [7] son 1er coup quand il commence. */
  first: number[]
  /** Blocages oubliés / occasions, par direction de mon alignement. */
  miss: { h: [number, number]; v: [number, number]; d: [number, number] }
  win: [number, number]
  /** Jetons posés juste sous ma case gagnante. */
  gift: number
  /** Débuts de partie -> [V, N, D] du bot (200 max). */
  book: Record<string, [number, number, number]>
}

const ENOUGH = 2.7
const BOOK_PLIES = 8
const DIRS: DirId[] = ['h', 'v', 'd']

const empty = (): Q4Mem => ({
  ...memBase(),
  cols: Array(7).fill(0),
  first: Array(7).fill(0),
  miss: { h: [0, 0], v: [0, 0], d: [0, 0] },
  win: [0, 0],
  gift: 0,
  book: {},
})

/** Clé du livre : « m » (le joueur commence) ou « b », puis les colonnes ; la plus petite avec le miroir. */
export function bookKey(meFirst: boolean, cols: readonly number[]): string {
  const a = cols.join('')
  const b = cols.map((c) => 6 - c).join('')
  return (meFirst ? 'm' : 'b') + (b < a ? b : a)
}

const colsOf = (log: SoloLog): number[] => log.entries.map((e) => (e.action.move as Q4Move).col)

function observe(mem: Q4Mem, log: SoloLog): Q4Mem {
  if (!log.x0) return mem
  const mine = log.entries.filter((e) => e.by === 'me').map((e) => (e.action.move as Q4Move).col)
  for (const c of mine) mem.cols[c] += 1 / mine.length
  const meFirst = log.first === log.me
  if (meFirst && mine.length) mem.first[mine[0]] += 1
  const s = scan(log, 'me')
  for (const d of DIRS) mem.miss[d] = [mem.miss[d][0] + s.miss[d][0], mem.miss[d][1] + s.miss[d][1]]
  mem.win = [mem.win[0] + s.win[0], mem.win[1] + s.win[1]]
  mem.gift += s.gift
  const r = log.outcome === 'loss' ? 0 : log.outcome === 'draw' ? 1 : 2
  const all = colsOf(log)
  for (let n = 1; n <= Math.min(BOOK_PLIES, all.length); n++) {
    const k = bookKey(meFirst, all.slice(0, n))
    const e: [number, number, number] = mem.book[k] ?? [0, 0, 0]
    e[r] += 1
    mem.book[k] = e
  }
  return mem
}

function favCol(mem: Q4Mem): { col: number; share: number } | null {
  const total = sum(mem.cols)
  if (total < ENOUGH) return null
  let best = 0
  for (let c = 1; c < 7; c++) if (mem.cols[c] > mem.cols[best]) best = c
  const share = mem.cols[best] / total
  return share >= 0.3 ? { col: best, share } : null
}

function firstCol(mem: Q4Mem): { col: number; share: number } | null {
  const total = sum(mem.first)
  // On ne commence qu'une partie sur deux : 3 parties récentes (n ≥ 2,7), dont au moins 2 commencées.
  if (mem.n < ENOUGH || total < 1.5) return null
  let best = 0
  for (let c = 1; c < 7; c++) if (mem.first[c] > mem.first[best]) best = c
  const share = mem.first[best] / total
  return share >= 0.6 ? { col: best, share } : null
}

/** Taux d'oubli par direction (si occasions ≥ 3). */
const missRate = (mem: Q4Mem, d: DirId): number => (mem.miss[d][1] >= 3 ? mem.miss[d][0] / mem.miss[d][1] : 0)

function insights(mem: Q4Mem): Insight[] {
  const out: Insight[] = []
  const f = firstCol(mem)
  if (f) out.push({ id: `first:${f.col}`, text: `Tu commences ${howOften(f.share)} par ${COL_NAMES[f.col]}.`, use: true, score: f.share })
  const fav = favCol(mem)
  if (fav) out.push({ id: `cols:${fav.col}`, text: `Tu adores ${COL_NAMES[fav.col]}.`, use: true, score: Math.min(1, 0.4 + fav.share) })
  for (const d of DIRS) {
    const r = missRate(mem, d)
    if (r >= 0.4) out.push({ id: `miss:${d}`, text: `Tu ne vois pas toujours mes alignements ${DIR_TXT[d]}.`, use: true, score: r })
  }
  const beaten = Object.values(mem.book).some((e) => e[2] >= 1)
  if (beaten) out.push({ id: 'book', text: 'Tu m’as déjà battu{e} avec ce début de partie : je m’en souviens !', use: true, score: 0.7 })
  if (mem.gift >= 2) out.push({ id: 'gift', text: 'Tu poses parfois ton jeton juste sous ma case gagnante.', use: false, score: Math.min(1, mem.gift / 4) })
  return out.sort((p, q) => q.score - p.score)
}

function hintsFor(mem: Q4Mem, rate: number, board: unknown, log: SoloLog | null): Q4Hints | undefined {
  const b = board as Q4Board
  if (rate <= 0 || !b) return undefined
  const h: Q4Hints = { rate }
  const fav = favCol(mem)
  if (fav) h.fav = fav.col
  const boost = DIRS.map((d) => 1 + 0.5 * rate * missRate(mem, d)) as [number, number, number]
  if (boost.some((k) => k > 1)) h.boost = boost
  if (log && b.count < BOOK_PLIES) {
    const played = colsOf(log)
    const meFirst = log.first === log.me
    const next: Record<number, [number, number, number]> = {}
    for (let c = 0; c < 7; c++) {
      if ((b.cols[c]?.length ?? 6) >= 6) continue
      const e = mem.book[bookKey(meFirst, [...played, c])]
      if (e) next[c] = e
    }
    if (Object.keys(next).length) h.next = next
  }
  return h.fav !== undefined || h.boost || h.next ? h : undefined
}

export const learner: GameLearner<Q4Mem, Q4Hints> & { bookKey: typeof bookKey } = {
  empty,
  observe,
  caps: { book: 200 },
  insights,
  hintsFor,
  bookKey,
}

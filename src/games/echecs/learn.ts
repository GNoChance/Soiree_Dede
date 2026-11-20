/**
 * Mémoire du bot aux Échecs (2b) : livre d'ouvertures appris des parties contre ce joueur
 * (12 premiers demi-coups, bilan [V, N, D] du bot), pièces qu'il laisse sans protection,
 * roque, dame sortie tôt, façons dont il se fait mater. Ce que ça change : E1 (il connaît tes
 * débuts de partie, et ne se fait pas battre deux fois par le même), E2 (il vise tes pièces
 * mal gardées). Jamais la profondeur ni le bruit.
 */
import { howOften, memBase, sum, type GameLearner, type Insight, type MemBase } from '@/features/solo/memory'
import type { SoloLog } from '@/features/solo/log'
import type { ChessHints } from './bot'
import type { ChessBoard, ChessMove } from './types'
import { pieceName, scan, squareName, type MateKind } from './why'

type Bilan = [number, number, number]
type HangType = 'p' | 'n' | 'b' | 'r' | 'q'

export interface ChessMem extends MemBase {
  /** Débuts de partie -> [V, N, D] du bot (400 max). Clé : couleur du bot + 2 caractères par demi-coup. */
  book: Record<string, Bilan>
  /** Pièces données ou laissées sans protection. */
  hang: Record<HangType, number>
  /** Parties où le joueur a roqué. */
  castle: number
  /** Parties où sa dame bouge avant son 6e coup. */
  queenEarly: number
  /** Façons dont il s'est fait mater. */
  mates: Record<MateKind, number>
}

/** 64 signes : une case par caractère. */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export const enc = (from: number, to: number): string => ABC[from] + ABC[to]
export const BOOK_PLIES = 12
const ENOUGH = 2.7
const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR'

const empty = (): ChessMem => ({
  ...memBase(),
  book: {},
  hang: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  castle: 0,
  queenEarly: 0,
  mates: { couloir: 0, berger: 0, autre: 0 },
})

/** Les premiers demi-coups (12 au plus), arrêtés à la première promotion ou au premier coup spécial. */
function lineOf(log: SoloLog): Array<[number, number]> | null {
  const out: Array<[number, number]> = []
  for (const e of log.entries) {
    const m = e.action.move as ChessMove & { from?: number; to?: number; promo?: string }
    if (typeof m?.from !== 'number' || typeof m.to !== 'number') break
    if (m.promo) return out.length < BOOK_PLIES ? null : out
    out.push([m.from, m.to])
    if (out.length >= BOOK_PLIES) break
  }
  return out
}

function observe(mem: ChessMem, log: SoloLog): ChessMem {
  const x0 = log.x0?.state.board as ChessBoard | undefined
  if (!x0) return mem
  const bot = x0.white === log.bot ? 'w' : 'b'
  const r = log.outcome === 'loss' ? 0 : log.outcome === 'draw' ? 1 : 2
  let key = bot
  for (const [f, t] of lineOf(log) ?? []) {
    key += enc(f, t)
    const e: Bilan = mem.book[key] ? [...mem.book[key]] : [0, 0, 0]
    e[r] += 1
    mem.book[key] = e
  }
  const s = scan(log)
  for (const t of s.hang) if (t in mem.hang) mem.hang[t as HangType] += 1
  if (s.castled) mem.castle += 1
  if (s.queenEarly) mem.queenEarly += 1
  if (s.mate) mem.mates[s.mate] += 1
  return mem
}

function insights(mem: ChessMem): Insight[] {
  const out: Insight[] = []
  // 1er coup du joueur avec les Blancs (le bot a les Noirs : clés « b » + 1 demi-coup).
  const firsts = Object.entries(mem.book).filter(([k]) => k.length === 3 && k[0] === 'b')
  const total = sum(firsts.map(([, v]) => sum(v)))
  // Blancs une partie sur deux : 3 parties récentes (n ≥ 2,7), dont au moins 2 avec les Blancs.
  if (mem.n >= ENOUGH && total >= 1.5) {
    const [k, v] = firsts.sort((p, q) => sum(q[1]) - sum(p[1]))[0]
    const share = sum(v) / total
    const often = howOften(share)
    if (often) {
      const from = ABC.indexOf(k[1])
      const to = ABC.indexOf(k[2])
      out.push({ id: `first:${from}-${to}`, text: `Tu commences ${often} par ${pieceName(START[from].toLowerCase(), 'me')} en ${squareName(to)}.`, use: true, score: share })
    }
  }
  if (Object.values(mem.book).some((v) => v[2] >= 0.9))
    out.push({ id: 'bookLoss', text: 'Tu as déjà gagné contre moi avec ce début de partie : je m’en souviens !', use: true, score: 0.7 })
  const hang = (Object.entries(mem.hang) as Array<[HangType, number]>).filter(([, v]) => v >= 2).sort((p, q) => q[1] - p[1])
  if (hang.length) out.push({ id: `hang:${hang[0][0]}`, text: `Tu laisses parfois ${pieceName(hang[0][0], 'me')} sans protection.`, use: true, score: Math.min(1, 0.5 + hang[0][1] / 10) })
  if (mem.n >= ENOUGH && mem.queenEarly / mem.n >= 0.6) out.push({ id: 'queenEarly', text: 'Tu sors ta dame très tôt.', use: true, score: mem.queenEarly / mem.n })
  if (mem.n >= 4 && mem.castle / mem.n <= 0.25) out.push({ id: 'castle', text: 'Tu oublies souvent de roquer.', use: false, score: 0.6 - mem.castle / mem.n })
  if (mem.mates.couloir >= 2) out.push({ id: 'mates:couloir', text: 'Le mat du couloir marche bien sur toi.', use: false, score: 0.6 })
  return out.sort((p, q) => q.score - p.score)
}

function hintsFor(mem: ChessMem, rate: number, board: unknown, log: SoloLog | null): ChessHints | undefined {
  const b = board as ChessBoard
  if (rate <= 0 || !b?.sq || b.end) return undefined
  const h: ChessHints = { rate }
  // E1 : débuts de partie connus (le bot est au trait : sa couleur = b.side).
  const line = log ? lineOf(log) : b.full === 1 && b.side === 'w' ? [] : null
  const played = log ? log.entries.length : 0
  if (line && line.length === played && line.length < BOOK_PLIES) {
    const prefix = b.side + line.map(([f, t]) => enc(f, t)).join('')
    const next: Record<string, Bilan> = {}
    for (const [from, tos] of Object.entries(b.moves ?? {}))
      for (const to of tos) {
        const v = mem.book[prefix + enc(Number(from), to)]
        if (v) next[`${from}-${to}`] = v
      }
    if (Object.keys(next).length) h.next = next
  }
  // E2 : pièces que le joueur laisse sans protection (et sa dame, s'il la sort tôt).
  const hang = (Object.entries(mem.hang) as Array<[HangType, number]>).filter(([, v]) => v >= 2).map(([t]) => t as string)
  if (mem.n >= ENOUGH && mem.queenEarly / mem.n >= 0.6 && !hang.includes('q')) hang.push('q')
  if (hang.length) h.hang = hang
  return h.next || h.hang ? h : undefined
}

export const learner: GameLearner<ChessMem, ChessHints> = {
  empty,
  observe,
  caps: { book: 400 },
  insights,
  hintsFor,
}

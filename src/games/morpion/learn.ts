/**
 * Mémoire du bot au Morpion (2b) : ouverture du joueur, bilan des ouvertures du bot,
 * blocages oubliés, victoires manquées, positions pièges (clé canonique : la plus petite
 * des 8 symétries). Ce que ça change : M1 (réponse sans bruit à l'ouverture favorite),
 * M2 (ouverture qui marche contre ce joueur), M3 (refait le piège qui marche).
 */
import { howOften, memBase, sum, type GameLearner, type Insight, type MemBase } from '@/features/solo/memory'
import type { SoloLog } from '@/features/solo/log'
import { canonKey, openingType, type MorpionHints, type OpeningType } from './bot'
import type { MorpionBoard, MorpionMove } from './types'
import { CELL_NAMES, scan } from './why'

export interface MorpionMem extends MemBase {
  /** [9] 1er coup du joueur quand il commence. */
  open: number[]
  /** [3] ouverture du bot (centre, coin, bord) × [victoires, nuls, défaites] du bot. */
  botOpen: number[][]
  /** Blocages oubliés / occasions. */
  block: [number, number]
  /** Victoires immédiates manquées / occasions. */
  win: [number, number]
  /** Positions (vues du bot) où le joueur a commis l'erreur perdante (30 max). */
  traps: Record<string, number>
}

const TYPES: OpeningType[] = ['center', 'corner', 'edge']
const TYPE_TXT: Record<OpeningType, string> = { center: 'au centre', corner: 'dans un coin', edge: 'sur un bord' }
const ENOUGH = 2.7

const empty = (): MorpionMem => ({
  ...memBase(),
  open: Array(9).fill(0),
  botOpen: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  block: [0, 0],
  win: [0, 0],
  traps: {},
})

/** Case favorite (part ≥ 60 %) ou type favori (part ≥ 70 %) de l'ouverture du joueur. */
function favourite(mem: MorpionMem): { cell?: number; type?: OpeningType; share: number } | null {
  const total = sum(mem.open)
  // On ne commence qu'une partie sur deux : 3 parties récentes (n ≥ 2,7), dont au moins 2 commencées.
  if (mem.n < ENOUGH || total < 1.5) return null
  let best = 0
  for (let c = 1; c < 9; c++) if (mem.open[c] > mem.open[best]) best = c
  const share = mem.open[best] / total
  if (share >= 0.6) return { cell: best, share }
  for (const t of ['corner', 'edge'] as const) {
    const s = mem.open.reduce((acc, v, c) => acc + (openingType(c) === t ? v : 0), 0) / total
    if (s >= 0.7) return { type: t, share: s }
  }
  return null
}

/** Type d'ouverture du bot au meilleur bilan contre ce joueur (≥ 2 essais, bilan positif). */
function bestOpening(mem: MorpionMem): { type: OpeningType; score: number } | null {
  let out: { type: OpeningType; score: number } | null = null
  mem.botOpen.forEach(([v, n, d], i) => {
    if (v + n + d < 2) return
    const score = (v - d) / (v + n + d + 1)
    if (score > 0 && (!out || score > out.score)) out = { type: TYPES[i], score }
  })
  return out
}

function observe(mem: MorpionMem, log: SoloLog): MorpionMem {
  const x0 = log.x0?.state.board as MorpionBoard | undefined
  if (!x0 || x0.variant !== 'classic') return mem
  const firstMove = log.entries[0]
  if (firstMove) {
    const cell = (firstMove.action.move as MorpionMove).cell
    if (firstMove.by === 'me') mem.open[cell] += 1
    else {
      const t = TYPES.indexOf(openingType(cell))
      const r = log.outcome === 'loss' ? 0 : log.outcome === 'draw' ? 1 : 2
      mem.botOpen[t][r] += 1
    }
  }
  const s = scan(log, 'me')
  mem.block = [mem.block[0] + s.block[0], mem.block[1] + s.block[1]]
  mem.win = [mem.win[0] + s.win[0], mem.win[1] + s.win[1]]
  if (s.err) {
    const k = canonKey(s.err.cells, x0.x === log.bot ? 'x' : 'o')
    mem.traps[k] = (mem.traps[k] ?? 0) + 1
  }
  return mem
}

function insights(mem: MorpionMem): Insight[] {
  const out: Insight[] = []
  const fav = favourite(mem)
  if (fav?.cell !== undefined) out.push({ id: `open:${fav.cell}`, text: `Tu commences ${howOften(fav.share)} par ${CELL_NAMES[fav.cell]}.`, use: true, score: fav.share })
  else if (fav?.type) out.push({ id: `open:${fav.type}`, text: `Tu commences souvent ${TYPE_TXT[fav.type]}.`, use: true, score: fav.share * 0.9 })
  const bo = bestOpening(mem)
  if (bo) out.push({ id: `botOpen:${bo.type}`, text: `Tu es moins à l’aise quand je commence ${TYPE_TXT[bo.type]}.`, use: true, score: 0.5 + bo.score / 2 })
  const trap = Math.max(0, ...Object.values(mem.traps))
  if (trap >= 2) out.push({ id: 'traps', text: 'Le coup des deux menaces marche bien sur toi.', use: true, score: Math.min(1, 0.5 + trap / 10) })
  const [forgot, occ] = mem.block
  if (occ >= 4 && forgot / occ >= 0.4) out.push({ id: 'block', text: 'Tu oublies parfois de me bloquer.', use: false, score: forgot / occ })
  return out.sort((p, q) => q.score - p.score)
}

function hintsFor(mem: MorpionMem, rate: number, board: unknown): MorpionHints | undefined {
  const b = board as MorpionBoard
  if (rate <= 0 || !b || b.variant !== 'classic') return undefined
  const h: MorpionHints = { rate }
  if (b.count === 1 && b.last) {
    const fav = favourite(mem)
    if (fav && (fav.cell === b.last.cell || (fav.type && fav.type === openingType(b.last.cell)))) h.m1 = true
  }
  if (b.count === 0) {
    const bo = bestOpening(mem)
    if (bo) h.m2 = bo.type
  }
  if (Object.keys(mem.traps).length) h.traps = mem.traps
  return h.m1 || h.m2 || h.traps ? h : undefined
}

export const learner: GameLearner<MorpionMem, MorpionHints> = {
  empty,
  observe,
  caps: { traps: 30 },
  insights,
  hintsFor,
}

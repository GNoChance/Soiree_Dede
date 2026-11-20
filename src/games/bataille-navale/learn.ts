/**
 * Mémoire du bot à la Bataille navale (2b). Loyauté : il n'apprend que des flottes RÉVÉLÉES
 * en fin de partie, et seulement des bateaux PLACÉS À LA MAIN (≥ 4 bateaux changés d'un
 * coup = « Mélanger » : rien à apprendre du hasard). Ce que ça change : B1 (tire d'abord sur
 * tes cachettes), B2 (cache sa flotte loin de tes premiers tirs), B3 (sens de tes bateaux),
 * B4 (bateaux collés ou espacés).
 */
import { replayTo, type SoloLog } from '@/features/solo/log'
import { memBase, sum, type GameLearner, type Insight, type MemBase } from '@/features/solo/memory'
import type { SoloAction } from '@/features/solo/engine'
import type { BnHints } from './bot'
import { local } from './local'
import { cellIndex, cellXY, fleetTouches, randomFleet, shipCells, type Rng } from './logic'
import type { BnBoard, BnShip, BnShipId, BnShotMove } from './types'
import type { BnLogCtx } from './why'

export interface BnMem extends MemBase {
  /** [100] cases de ses bateaux PLACÉS À LA MAIN. */
  place: number[]
  /** Poids des bateaux placés à la main (÷ 5 par partie). */
  hand: number
  /** Poids des bateaux laissés au hasard (÷ 5 par partie). */
  auto: number
  /** Bateaux couchés / debout (placés à la main). */
  orient: [number, number]
  /** Parties avec bateaux qui se touchent / parties placées à la main. */
  touch: [number, number]
  /** [100] ses 15 premiers tirs de chaque partie. */
  aim: number[]
}

const ENOUGH = 2.7
const AIM_SHOTS = 15

const empty = (): BnMem => ({ ...memBase(), place: Array(100).fill(0), hand: 0, auto: 0, orient: [0, 0], touch: [0, 0], aim: Array(100).fill(0) })

type Zone = 'tl' | 'tr' | 'bl' | 'br' | 'edges' | 'middle'
const ZONES: Array<{ id: Zone; txt: string; has: (x: number, y: number) => boolean }> = [
  { id: 'tl', txt: 'en haut à gauche', has: (x, y) => x < 5 && y < 5 },
  { id: 'tr', txt: 'en haut à droite', has: (x, y) => x >= 5 && y < 5 },
  { id: 'bl', txt: 'en bas à gauche', has: (x, y) => x < 5 && y >= 5 },
  { id: 'br', txt: 'en bas à droite', has: (x, y) => x >= 5 && y >= 5 },
  { id: 'edges', txt: 'le long des bords', has: (x, y) => x === 0 || y === 0 || x === 9 || y === 9 },
  { id: 'middle', txt: 'au milieu', has: (x, y) => x >= 3 && x <= 6 && y >= 3 && y <= 6 },
]

/** Zone la plus chargée (part ≥ 45 %) d'une table [100]. */
function bestZone(t: readonly number[]): { zone: (typeof ZONES)[number]; share: number } | null {
  const total = sum(t)
  if (total <= 0) return null
  let out: { zone: (typeof ZONES)[number]; share: number } | null = null
  for (const z of ZONES) {
    let s = 0
    t.forEach((v, i) => {
      const [x, y] = cellXY(i)
      if (z.has(x, y)) s += v
    })
    const share = s / total
    if (share >= 0.45 && (!out || share > out.share)) out = { zone: z, share }
  }
  return out
}

const sameShip = (p: BnShip, q: BnShip | undefined) => !!q && p.x === q.x && p.y === q.y && p.dir === q.dir

/** Bateaux placés à la main d'après les `place` successifs du joueur (depuis sa flotte tirée au sort). */
export function handShips(log: SoloLog): Set<BnShipId> {
  let cur: BnShip[] | null = (log.secret0 as { fleet?: BnShip[] } | null)?.fleet ?? null
  const hand = new Set<BnShipId>()
  for (const st of log.setup) {
    if (st.by !== 'me' || st.action.type !== 'move') continue
    const mv = st.action.move as { type?: string; ships?: BnShip[] } | undefined
    if (mv?.type === 'shuffle') {
      hand.clear()
      cur = null
      continue
    }
    if (mv?.type !== 'place' || !Array.isArray(mv.ships)) continue
    const changed = mv.ships.filter((s) => !sameShip(s, cur?.find((q) => q.id === s.id)))
    if (changed.length >= 4) hand.clear()
    else for (const s of changed) hand.add(s.id)
    cur = mv.ships
  }
  return hand
}

const pOf = (mem: BnMem, i: number) => (mem.hand > 0 ? Math.min(1, mem.place[i] / mem.hand) : 0)

function observe(mem: BnMem, log: SoloLog): BnMem {
  if (!log.x0) return mem
  const final = replayTo(local, log, log.entries.length).state.board as BnBoard
  const fleet = final.reveal?.[log.me]
  if (fleet?.length) {
    const hand = handShips(log)
    const mine = fleet.filter((s) => hand.has(s.id))
    for (const s of mine) {
      for (const [x, y] of shipCells(s) ?? []) mem.place[cellIndex(x, y)] += 1
      mem.orient[s.dir === 'h' ? 0 : 1] += 1
    }
    mem.hand += mine.length / 5
    mem.auto += (fleet.length - mine.length) / 5
    if (mine.length) {
      mem.touch[1] += 1
      if (fleetTouches(fleet)) mem.touch[0] += 1
    }
  }
  let k = 0
  for (const e of log.entries) {
    if (e.by !== 'me' || k >= AIM_SHOTS) continue
    const m = e.action.move as BnShotMove
    mem.aim[cellIndex(m.x, m.y)] += 1
    k++
  }
  return mem
}

function insights(mem: BnMem): Insight[] {
  const out: Insight[] = []
  if (mem.hand >= ENOUGH) {
    const strong = mem.place.filter((_, i) => pOf(mem, i) >= 0.8).length
    if (strong >= 8) out.push({ id: 'same', text: 'Tes bateaux sont presque toujours au même endroit.', use: true, score: 0.95 })
    const z = bestZone(mem.place)
    if (z) out.push({ id: `zone:${z.zone.id}`, text: `Tu caches souvent tes bateaux ${z.zone.txt}.`, use: true, score: z.share })
    const [h, v] = mem.orient
    if (h + v > 0) {
      const sh = h / (h + v)
      if (sh >= 0.75) out.push({ id: 'orient:h', text: 'Tu poses presque toujours tes bateaux couchés.', use: true, score: sh * 0.9 })
      else if (sh <= 0.25) out.push({ id: 'orient:v', text: 'Tu poses presque toujours tes bateaux debout.', use: true, score: (1 - sh) * 0.9 })
    }
  }
  const [tc, tn] = mem.touch
  if (tn >= ENOUGH) {
    const s = tc / tn
    if (s >= 0.6) out.push({ id: 'touch:yes', text: 'Tu colles tes bateaux les uns aux autres.', use: true, score: s * 0.85 })
    else if (s <= 0.15) out.push({ id: 'touch:no', text: 'Tu laisses toujours de l’eau autour de tes bateaux.', use: true, score: (1 - s) * 0.7 })
  }
  if (sum(mem.aim) / AIM_SHOTS >= ENOUGH) {
    const z = bestZone(mem.aim)
    if (z) out.push({ id: `aim:${z.zone.id}`, text: `Tu tires d’abord ${z.zone.txt}.`, use: true, score: z.share * 0.9 })
  }
  const all = mem.auto + mem.hand
  if (mem.n >= ENOUGH && all > 0 && mem.auto / all >= 0.6) {
    out.push({ id: 'auto', text: 'Tu laisses le hasard ranger tes bateaux : rien à deviner, malin !', use: false, score: (mem.auto / all) * 0.8 })
  }
  return out.sort((p, q) => q.score - p.score)
}

function hintsFor(mem: BnMem, rate: number): BnHints | undefined {
  if (!(rate > 0)) return undefined
  const h: BnHints = { rate }
  if (mem.hand >= ENOUGH) {
    h.place = mem.place.map((_, i) => Math.round(pOf(mem, i) * 100) / 100)
    const [ho, ve] = mem.orient
    if (ho + ve > 0) h.horiz = ho / (ho + ve)
  }
  const [tc, tn] = mem.touch
  if (tn >= ENOUGH) {
    if (tc / tn >= 0.6) h.touch = 'glued'
    else if (tc / tn <= 0.15) h.touch = 'spaced'
  }
  return h.place || h.touch ? h : undefined
}

function logCtx(mem: BnMem, rate: number): BnLogCtx {
  const b1 = rate > 0 && mem.hand >= ENOUGH
  return { b1, cells: b1 ? mem.place.map((_, i) => i).filter((i) => pOf(mem, i) >= 0.5) : [] }
}

/** B2 : le bot tire 1 + round(7 × dose) flottes et garde celle qui recouvre le moins tes premiers tirs. */
function botSetup(mem: BnMem, rate: number, _board: unknown, _me: string, rng: Rng = Math.random): SoloAction[] | null {
  if (!(rate > 0) || sum(mem.aim) / AIM_SHOTS < ENOUGH) return null
  let best: BnShip[] | null = null
  let bestCover = Infinity
  for (let k = 0; k < 1 + Math.round(7 * rate); k++) {
    const f = randomFleet(rng)
    const cover = f.reduce((acc, s) => acc + (shipCells(s) ?? []).reduce((a, [x, y]) => a + mem.aim[cellIndex(x, y)], 0), 0)
    if (cover < bestCover) {
      bestCover = cover
      best = f
    }
  }
  return best ? [{ type: 'move', move: { type: 'place', ships: best } }] : null
}

export const learner: GameLearner<BnMem, BnHints> = {
  empty,
  observe,
  caps: {},
  insights,
  hintsFor: (mem, rate) => hintsFor(mem, rate),
  logCtx,
  botSetup,
}

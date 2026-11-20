/**
 * Bot de la Bataille navale (mode solo). Placement : flotte aléatoire valide (celle de
 * board_new). Tir « chasse puis cible », d'après les seules infos PUBLIQUES (tirs reçus
 * par le joueur, bateaux coulés) :
 *  - niveau haut : carte de probabilités (placements possibles des bateaux restants,
 *    fortement pondérés autour des touchés non coulés) ;
 *  - niveau bas : tirs au hasard, avec un peu de suivi des touchés.
 */
import { SHIPS, autoShotCandidates, cellIndex, cellXY, shipCells } from './logic'
import type { BnBoard, BnShipId, BnShotMove } from './types'

type Rng = () => number
const N = 10

/** Carte de probabilités : nombre de placements possibles couvrant chaque case. */
export function heatMap(b: BnBoard, shooter: string): number[] {
  return heatCore(b, shooter, 1, 1)
}

/** Idem, placements couchés / debout pondérés (B3 ; 1 et 1 = carte de l'étape 1). */
function heatCore(b: BnBoard, shooter: string, wh: number, wv: number): number[] {
  const target = shooter === b.a ? b.b : b.a
  const w = b.waters[target]
  const state = new Int8Array(N * N) // 0 inconnu, 1 à l'eau, 2 touché (non coulé), 3 coulé
  for (const s of w?.shots ?? []) state[cellIndex(s.x, s.y)] = s.r === 'miss' ? 1 : s.r === 'hit' ? 2 : 3
  const sunk = new Set<BnShipId>((w?.sunk ?? []).map((s) => s.id))
  const left = SHIPS.filter((s) => !sunk.has(s.id))
  const heat = new Array<number>(N * N).fill(0)
  const hasHits = state.some((v) => v === 2)
  for (const def of left) {
    for (const dir of ['h', 'v'] as const) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const cells = shipCells({ id: def.id, x, y, dir })
          if (!cells) continue
          let hits = 0
          let ok = true
          for (const [cx, cy] of cells) {
            const v = state[cellIndex(cx, cy)]
            if (v === 1 || v === 3) {
              ok = false
              break
            }
            if (v === 2) hits++
          }
          if (!ok) continue
          if (hasHits && hits === 0) continue
          const wgt = (hasHits ? Math.pow(30, hits) : 1) * (dir === 'h' ? wh : wv)
          for (const [cx, cy] of cells) {
            const i = cellIndex(cx, cy)
            if (state[i] === 0) heat[i] += wgt
          }
        }
      }
    }
  }
  return heat
}

const unshot = (b: BnBoard, shooter: string): number[] => {
  const target = shooter === b.a ? b.b : b.a
  const done = new Set((b.waters[target]?.shots ?? []).map((s) => cellIndex(s.x, s.y)))
  return [...Array(N * N).keys()].filter((i) => !done.has(i))
}

const at = (i: number): BnShotMove => {
  const [x, y] = cellXY(i)
  return { x, y }
}

export function chooseMove(b: BnBoard, me: string, level: number, rng: Rng = Math.random): BnShotMove {
  const free = unshot(b, me)
  const target = me === b.a ? b.b : b.a
  const pick = (a: number[]) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]
  const L = Math.min(10, Math.max(1, level))
  // Niveaux 1-4 : hasard, et suivi des touchés avec une probabilité qui monte avec le niveau.
  if (L <= 4) {
    const c = autoShotCandidates(b.waters[target]?.shots ?? [])
    const follow = 0.25 + 0.15 * (L - 1)
    if (rng() < follow) {
      if (c.line.length) return at(pick(c.line))
      if (c.adjacent.length) return at(pick(c.adjacent))
    }
    return at(pick(free))
  }
  // Niveaux 5+ : carte de probabilités ; bruit (tir pris parmi les bonnes cases) qui diminue.
  const heat = heatMap(b, me)
  const ranked = free.filter((i) => heat[i] > 0).sort((p, q) => heat[q] - heat[p])
  if (!ranked.length) return at(pick(free))
  const top = heat[ranked[0]]
  const spread = L >= 9 ? 0 : (10 - L) * 0.08 // part de la meilleure valeur tolérée
  const pool = ranked.filter((i) => heat[i] >= top * (1 - spread))
  return at(pick(pool))
}

/** Réaction du bot : `joie` quand il coule un bateau, `surprise` quand le joueur coule l'un des siens. */
export function reaction(_prev: BnBoard, next: BnBoard, by: string, bot: string): 'joie' | 'surprise' | null {
  if (next.last?.by !== by) return null
  if (next.last.r === 'sunk') return by === bot ? 'joie' : 'surprise'
  if (next.last.r === 'hit' && by !== bot && next.stats[by]?.streak >= 2) return 'surprise'
  return null
}

/**
 * Indices de la mémoire du bot (2b), calculés par learn.ts d'après les flottes RÉVÉLÉES des
 * parties passées (jamais la flotte en cours) :
 * place = B1, part (0 à 1) de chaque case dans les bateaux placés à la main ;
 * horiz = B3, part des bateaux couchés ; touch = B4, bateaux collés ou espacés.
 */
export interface BnHints {
  rate: number
  place?: number[]
  horiz?: number
  touch?: 'glued' | 'spaced'
}

/** Carte de probabilités modulée par la mémoire (B1 en recherche, B3, B4). */
export function heatMapWith(b: BnBoard, shooter: string, h: BnHints): number[] {
  const r = h.rate
  const wh = h.horiz === undefined ? 1 : Math.max(0.25, 1 + r * (2 * h.horiz - 1))
  const wv = h.horiz === undefined ? 1 : Math.max(0.25, 1 + r * (2 * (1 - h.horiz) - 1))
  const heat = heatCore(b, shooter, wh, wv)
  const target = shooter === b.a ? b.b : b.a
  const w = b.waters[target]
  const searching = !(w?.shots ?? []).some((s) => s.r === 'hit')
  if (searching && h.place) for (let i = 0; i < N * N; i++) heat[i] *= 1 + 3 * r * Math.min(1, h.place[i] ?? 0)
  if (h.touch) {
    const f = h.touch === 'glued' ? 1 + r : 1 - 0.7 * r
    const near = new Set<number>()
    for (const s of w?.sunk ?? [])
      for (const [x, y] of shipCells(s) ?? [])
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < N && ny < N) near.add(cellIndex(nx, ny))
          }
    for (const i of near) heat[i] *= f
  }
  return heat
}

/** Tir du bot + habitude apprise utilisée. Sans `hints` (ou dose nulle) : exactement le jeu de l'étape 1. */
export function decide(b: BnBoard, me: string, level: number, rng: Rng = Math.random, hints?: BnHints): { move: BnShotMove; learned?: string } {
  if (!hints || !(hints.rate > 0)) return { move: chooseMove(b, me, level, rng) }
  const free = unshot(b, me)
  const target = me === b.a ? b.b : b.a
  const shots = b.waters[target]?.shots ?? []
  const searching = !shots.some((s) => s.r === 'hit')
  const pick = (a: number[]) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]
  const pOf = (i: number) => Math.min(1, hints.place?.[i] ?? 0)
  const tag = (cell: number) => ({ move: at(cell), ...(searching && pOf(cell) >= 0.5 ? { learned: 'b1' } : {}) })
  const L = Math.min(10, Math.max(1, level))
  if (L <= 4) {
    const c = autoShotCandidates(shots)
    const follow = 0.25 + 0.15 * (L - 1)
    if (rng() < follow) {
      if (c.line.length) return { move: at(pick(c.line)) }
      if (c.adjacent.length) return { move: at(pick(c.adjacent)) }
    }
    // B1 sur le tirage au hasard (niveaux 3-4) : les cachettes habituelles pèsent plus lourd.
    if (searching && hints.place) {
      const wts = free.map((i) => 1 + 3 * hints.rate * pOf(i))
      let t = rng() * wts.reduce((a, v) => a + v, 0)
      for (let k = 0; k < free.length; k++) {
        t -= wts[k]
        if (t <= 0) return tag(free[k])
      }
      return tag(free[free.length - 1])
    }
    return { move: at(pick(free)) }
  }
  const heat = heatMapWith(b, me, hints)
  const ranked = free.filter((i) => heat[i] > 0).sort((p, q) => heat[q] - heat[p])
  if (!ranked.length) return { move: at(pick(free)) }
  const top = heat[ranked[0]]
  const spread = L >= 9 ? 0 : (10 - L) * 0.08
  const pool = ranked.filter((i) => heat[i] >= top * (1 - spread))
  return tag(pick(pool))
}

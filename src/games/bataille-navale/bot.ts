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
          const wgt = hasHits ? Math.pow(30, hits) : 1
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

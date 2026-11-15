/**
 * Règles PURES de la « Bataille navale » (miroir de supabase/games/bataille-navale.sql).
 * Sans dépendance : testable sous Node (type stripping). Grille 10 × 10,
 * colonnes A–J (x = 0..9), lignes 1–10 (y = 0..9) ; case = indice y * 10 + x.
 */
import type { BnDir, BnSecret, BnShip, BnShipDef, BnShipId, BnShot, BnShotResult, BnStats } from './types'

export const SIZE = 10

/** Flotte classique (ordre d'affichage et de placement). */
export const SHIPS: readonly BnShipDef[] = [
  { id: 'porte-avions', name: 'Porte-avions', size: 5 },
  { id: 'cuirasse', name: 'Cuirassé', size: 4 },
  { id: 'croiseur', name: 'Croiseur', size: 3 },
  { id: 'sous-marin', name: 'Sous-marin', size: 3 },
  { id: 'torpilleur', name: 'Torpilleur', size: 2 },
]

/** Nombre total de cases de la flotte (17). */
export const FLEET_CELLS = SHIPS.reduce((n, s) => n + s.size, 0)

const DEFS = new Map<string, BnShipDef>(SHIPS.map((s) => [s.id, s]))
export const shipDef = (id: string): BnShipDef | undefined => DEFS.get(id)
export const shipSize = (id: string): number => DEFS.get(id)?.size ?? 0
export const shipName = (id: string | null | undefined): string => (id ? (DEFS.get(id)?.name ?? 'Bateau') : 'Bateau')

/* ---------------------------------------------------------------- coordonnées */

export const COLS = 'ABCDEFGHIJ'
export const colLabel = (x: number): string => COLS[x] ?? '?'
export const rowLabel = (y: number): string => String(y + 1)
/** « C7 » = colonne C (x = 2), ligne 7 (y = 6). */
export const cellName = (x: number, y: number): string => `${colLabel(x)}${rowLabel(y)}`
export const cellIndex = (x: number, y: number): number => y * SIZE + x
export const cellXY = (i: number): [number, number] => [i % SIZE, Math.floor(i / SIZE)]

const isCoord = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < SIZE
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Cases [x, y] d'un bateau, de la première à la dernière ; null si malformé / hors grille (miroir de _bn_cells). */
export function shipCells(ship: Pick<BnShip, 'id' | 'x' | 'y' | 'dir'> | null | undefined): Array<[number, number]> | null {
  if (!ship || typeof ship !== 'object') return null
  const def = DEFS.get(ship.id)
  if (!def || !isCoord(ship.x) || !isCoord(ship.y)) return null
  if (ship.dir === 'h') {
    if (ship.x + def.size > SIZE) return null
    return Array.from({ length: def.size }, (_, k) => [ship.x + k, ship.y] as [number, number])
  }
  if (ship.dir === 'v') {
    if (ship.y + def.size > SIZE) return null
    return Array.from({ length: def.size }, (_, k) => [ship.x, ship.y + k] as [number, number])
  }
  return null
}

/* ---------------------------------------------------------------- flottes */

export type FleetError = 'invalid_fleet' | 'fleet_overlap'

/**
 * Miroir de _bn_fleet_error : null si la flotte est valide (5 bateaux, chacun
 * une fois, dans la grille, sans chevauchement). Le contact est autorisé.
 */
export function fleetError(fleet: unknown): FleetError | null {
  if (!Array.isArray(fleet) || fleet.length !== SHIPS.length) return 'invalid_fleet'
  const taken = new Set<number>()
  let overlap = false
  for (const def of SHIPS) {
    const same = fleet.filter((s) => !!s && typeof s === 'object' && !Array.isArray(s) && (s as { id?: unknown }).id === def.id)
    if (same.length !== 1) return 'invalid_fleet'
    const cells = shipCells(same[0] as BnShip)
    if (!cells) return 'invalid_fleet'
    for (const [x, y] of cells) {
      const i = cellIndex(x, y)
      if (taken.has(i)) overlap = true
      taken.add(i)
    }
  }
  return overlap ? 'fleet_overlap' : null
}

export const isValidFleet = (fleet: unknown): fleet is BnShip[] => fleetError(fleet) === null

/** Flotte normalisée (ordre de la composition, {id, x, y, dir} seuls) — miroir de _bn_fleet_norm. */
export function normalizeFleet(fleet: readonly BnShip[]): BnShip[] {
  return SHIPS.flatMap((def) => {
    const s = fleet.find((f) => f.id === def.id)
    return s ? [{ id: def.id, x: s.x, y: s.y, dir: s.dir }] : []
  })
}

/** Case -> id du bateau qui l'occupe. */
export function fleetMap(fleet: readonly BnShip[] | null | undefined): Map<number, BnShipId> {
  const out = new Map<number, BnShipId>()
  for (const s of fleet ?? []) for (const [x, y] of shipCells(s) ?? []) out.set(cellIndex(x, y), s.id)
  return out
}

export function shipAt(fleet: readonly BnShip[] | null | undefined, x: number, y: number): BnShip | null {
  const i = cellIndex(x, y)
  return (fleet ?? []).find((s) => (shipCells(s) ?? []).some(([cx, cy]) => cellIndex(cx, cy) === i)) ?? null
}

/** Deux bateaux se touchent-ils (par un bord ou un coin) ? */
export function fleetTouches(fleet: readonly BnShip[]): boolean {
  const owner = fleetMap(fleet)
  for (const s of fleet) {
    for (const [x, y] of shipCells(s) ?? []) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
          const o = owner.get(cellIndex(nx, ny))
          if (o && o !== s.id) return true
        }
      }
    }
  }
  return false
}

export type Rng = () => number

/**
 * Placement automatique (miroir de _bn_fleet_random) : du plus grand au plus
 * petit, chaque bateau prend au hasard une position libre, SANS CONTACT avec
 * les précédents (ni bord, ni coin).
 */
export function randomFleet(rng: Rng = Math.random): BnShip[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocked = new Array<boolean>(SIZE * SIZE).fill(false)
    const fleet: BnShip[] = []
    let ok = true
    for (const def of SHIPS) {
      const options: BnShip[] = []
      for (const dir of ['h', 'v'] as const) {
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const ship: BnShip = { id: def.id, x, y, dir }
            const cells = shipCells(ship)
            if (cells && cells.every(([cx, cy]) => !blocked[cellIndex(cx, cy)])) options.push(ship)
          }
        }
      }
      if (!options.length) {
        ok = false
        break
      }
      const pick = options[Math.min(options.length - 1, Math.floor(rng() * options.length))]
      fleet.push(pick)
      for (const [cx, cy] of shipCells(pick) ?? []) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE) blocked[cellIndex(nx, ny)] = true
          }
        }
      }
    }
    if (ok) return fleet
  }
  throw new Error('randomFleet: aucune position trouvée')
}

/* ---------------------------------------------------------------- placement manuel */

/** `ship` peut-il remplacer le bateau de même id ? (dans la grille, sans chevauchement ; contact permis) */
export function canPlace(fleet: readonly BnShip[], ship: BnShip): boolean {
  const cells = shipCells(ship)
  if (!cells) return false
  const others = new Set<number>()
  for (const s of fleet) if (s.id !== ship.id) for (const [x, y] of shipCells(s) ?? []) others.add(cellIndex(x, y))
  return cells.every(([x, y]) => !others.has(cellIndex(x, y)))
}

/** Origine (arrondie) ramenée dans la grille pour ce bateau et cette direction. */
export function clampOrigin(id: string, dir: BnDir, x: number, y: number): { x: number; y: number } {
  const size = Math.max(1, shipSize(id))
  return {
    x: clamp(Math.round(x), 0, dir === 'h' ? SIZE - size : SIZE - 1),
    y: clamp(Math.round(y), 0, dir === 'v' ? SIZE - size : SIZE - 1),
  }
}

export const replaceShip = (fleet: readonly BnShip[], ship: BnShip): BnShip[] => fleet.map((s) => (s.id === ship.id ? { ...ship } : { ...s }))

/** Déplace un bateau (origine recalée dans la grille). null si chevauchement. */
export function moveShip(fleet: readonly BnShip[], id: BnShipId, x: number, y: number): BnShip[] | null {
  const s = fleet.find((f) => f.id === id)
  if (!s) return null
  const o = clampOrigin(id, s.dir, x, y)
  const next: BnShip = { id, x: o.x, y: o.y, dir: s.dir }
  return canPlace(fleet, next) ? replaceShip(fleet, next) : null
}

/**
 * Pivote un bateau (h <-> v) : autour de sa première case, sinon autour de sa
 * case centrale (recalé dans la grille). null si aucune position libre.
 */
export function rotateShip(fleet: readonly BnShip[], id: BnShipId): BnShip[] | null {
  const s = fleet.find((f) => f.id === id)
  if (!s) return null
  const dir: BnDir = s.dir === 'h' ? 'v' : 'h'
  const c = Math.floor((shipSize(id) - 1) / 2)
  const pivots = [
    { x: s.x, y: s.y },
    s.dir === 'h' ? { x: s.x + c, y: s.y - c } : { x: s.x - c, y: s.y + c },
  ]
  for (const p of pivots) {
    const o = clampOrigin(id, dir, p.x, p.y)
    const next: BnShip = { id, x: o.x, y: o.y, dir }
    if (canPlace(fleet, next)) return replaceShip(fleet, next)
  }
  return null
}

/* ---------------------------------------------------------------- tirs */

/** Case -> résultat du tir reçu. */
export function shotMap(shots: readonly BnShot[] | null | undefined): Map<number, BnShotResult> {
  const out = new Map<number, BnShotResult>()
  for (const s of shots ?? []) out.set(cellIndex(s.x, s.y), s.r)
  return out
}

export interface ShotOutcome {
  r: BnShotResult
  /** Bateau touché (ou coulé), sinon null. */
  ship: BnShip | null
  /** Tirs reçus après ce tir (cases du bateau coulé passées en `sunk`). */
  shots: BnShot[]
  /** Bateaux coulés après ce tir. */
  sunk: BnShip[]
  /** Bateaux encore à flot. */
  left: number
}

/**
 * Miroir de board_move : tir en (x, y) sur `fleet`, qui a déjà reçu `shots` et
 * perdu `sunk`. null si la case est hors grille ou déjà visée.
 */
export function resolveShot(
  fleet: readonly BnShip[],
  shots: readonly BnShot[],
  sunk: readonly BnShip[],
  x: number,
  y: number,
): ShotOutcome | null {
  if (!isCoord(x) || !isCoord(y)) return null
  const i = cellIndex(x, y)
  if (shots.some((s) => cellIndex(s.x, s.y) === i)) return null
  const ship = shipAt(fleet, x, y)
  let next: BnShot[] = [...shots.map((s) => ({ ...s })), { x, y, r: ship ? 'hit' : 'miss' }]
  let r: BnShotResult = ship ? 'hit' : 'miss'
  let nextSunk = sunk.map((s) => ({ ...s }))
  if (ship) {
    const cells = new Set((shipCells(ship) ?? []).map(([cx, cy]) => cellIndex(cx, cy)))
    const hits = next.filter((s) => cells.has(cellIndex(s.x, s.y))).length
    if (hits >= cells.size) {
      r = 'sunk'
      next = next.map((s) => (cells.has(cellIndex(s.x, s.y)) ? { ...s, r: 'sunk' as const } : s))
      nextSunk = [...nextSunk, { ...ship }]
    }
  }
  return { r, ship: ship ? { ...ship } : null, shots: next, sunk: nextSunk, left: fleet.length - nextSunk.length }
}

/** Statistiques du tireur après un tir (miroir de board_move). */
export function nextStats(st: BnStats | null | undefined, r: BnShotResult): BnStats {
  const cur = st ?? { shots: 0, hits: 0, streak: 0, best: 0 }
  const streak = r === 'miss' ? 0 : cur.streak + 1
  return { shots: cur.shots + 1, hits: cur.hits + (r === 'miss' ? 0 : 1), streak, best: Math.max(cur.best, streak) }
}

/** Précision en % (arrondie), ou null sans tir. */
export const accuracy = (st: Pick<BnStats, 'shots' | 'hits'> | null | undefined): number | null =>
  st && st.shots > 0 ? Math.round((100 * st.hits) / st.shots) : null

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Candidats du tir automatique (miroir de board_auto), d'après les seuls tirs
 * reçus (publics) : `line` = prolonge un alignement de touchés non coulés,
 * `adjacent` = voisin d'un touché non coulé (« chasse »), `any` = case non visée.
 */
export function autoShotCandidates(shots: readonly BnShot[]): { line: number[]; adjacent: number[]; any: number[] } {
  const res = shotMap(shots)
  const hit = (x: number, y: number) => isCoord(x) && isCoord(y) && res.get(cellIndex(x, y)) === 'hit'
  const free = (x: number, y: number) => isCoord(x) && isCoord(y) && !res.has(cellIndex(x, y))
  const line = new Set<number>()
  const adjacent = new Set<number>()
  for (const s of shots) {
    if (s.r !== 'hit') continue
    for (const [dx, dy] of DIRS) {
      const nx = s.x + dx
      const ny = s.y + dy
      if (!free(nx, ny)) continue
      adjacent.add(cellIndex(nx, ny))
      if (hit(s.x - dx, s.y - dy)) line.add(cellIndex(nx, ny))
    }
  }
  const any: number[] = []
  for (let i = 0; i < SIZE * SIZE; i++) if (!res.has(i)) any.push(i)
  return { line: [...line].sort((p, q) => p - q), adjacent: [...adjacent].sort((p, q) => p - q), any }
}

/** Tir automatique : au hasard dans le premier groupe de candidats non vide. */
export function autoShot(shots: readonly BnShot[], rng: Rng = Math.random): { x: number; y: number } | null {
  const c = autoShotCandidates(shots)
  const pool = c.line.length ? c.line : c.adjacent.length ? c.adjacent : c.any
  if (!pool.length) return null
  const [x, y] = cellXY(pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))])
  return { x, y }
}

/* ---------------------------------------------------------------- secret */

/** Secret de la bataille en cours pour `me` ? (le socle ne supprime jamais un ancien secret) */
export function isCurrentSecret(x: unknown, me: string, duelNo: number, gameNo: number): x is BnSecret {
  if (!x || typeof x !== 'object') return false
  const s = x as Partial<BnSecret>
  return s.me === me && s.duel_no === duelNo && s.game_no === gameNo && isValidFleet(s.fleet)
}

/** Deux flottes identiques (mêmes positions) ? */
export function sameFleet(p: readonly BnShip[] | null | undefined, q: readonly BnShip[] | null | undefined): boolean {
  if (!p || !q) return p === q
  const np = normalizeFleet(p)
  const nq = normalizeFleet(q)
  return np.length === nq.length && np.every((s, i) => s.id === nq[i].id && s.x === nq[i].x && s.y === nq[i].y && s.dir === nq[i].dir)
}

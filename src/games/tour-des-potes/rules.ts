/**
 * Helpers PURS du Tour des Potes (miroir des fonctions _tdp_* du SQL).
 * Sans dépendance React : importable sous Node (tests).
 */
import { BOARD, POTES_RENTS, SERVICE_MULT, type BoardCell, type GroupId } from './board.ts'
import type { TdpAction, TdpOptions, TdpState } from './types.ts'

type Owned = Pick<TdpState, 'owners' | 'buildings'>

export const cellAt = (i: number): BoardCell => BOARD[((i % 40) + 40) % 40]

export const isBuyable = (c: BoardCell) => c.type === 'quartier' || c.type === 'potes' || c.type === 'service'

/** Cases d'un quartier / d'une famille. */
export const groupCells = (group: GroupId): number[] => BOARD.filter((c) => c.group === group).map((c) => c.i)

/** Bâtiments sur une case : 0, 1-4 maisons, 5 = hôtel. */
export const levelOf = (s: Pick<TdpState, 'buildings'>, cell: number): number => s.buildings[String(cell)] ?? 0

export const ownerOf = (s: Pick<TdpState, 'owners'>, cell: number): string | null => s.owners[String(cell)] ?? null

export const ownsGroup = (s: Pick<TdpState, 'owners'>, player: string, group: GroupId): boolean =>
  groupCells(group).every((i) => ownerOf(s, i) === player)

/** Cases possédées par un joueur (ordre du plateau). */
export const cellsOf = (s: Pick<TdpState, 'owners'>, player: string): number[] =>
  Object.entries(s.owners)
    .filter(([, o]) => o === player)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b)

/**
 * Loyer dû en s'arrêtant sur `cell` (0 si libre). `diceSum` sert aux services.
 * mode 'card' : cartes « la plus proche » (maison des potes ×2, service dés ×10).
 * Miroir de `_tdp_rent`.
 */
export function rentFor(s: Owned, cell: number, diceSum = 7, mode: 'normal' | 'card' = 'normal'): number {
  const c = cellAt(cell)
  const o = ownerOf(s, cell)
  if (!o) return 0
  if (c.type === 'quartier') {
    const lvl = levelOf(s, cell)
    const rents = c.rents ?? []
    if (lvl > 0) return rents[lvl] ?? 0
    return (rents[0] ?? 0) * (c.group && ownsGroup(s, o, c.group) ? 2 : 1)
  }
  const n = cellsOf(s, o).filter((i) => cellAt(i).type === c.type).length
  if (c.type === 'potes') return (POTES_RENTS[n - 1] ?? 0) * (mode === 'card' ? 2 : 1)
  if (c.type === 'service') return diceSum * (mode === 'card' || n >= 2 ? SERVICE_MULT[1] : SERVICE_MULT[0])
  return 0
}

/** Code d'erreur serveur si `player` ne peut pas construire sur `cell` (hors phase / argent), sinon null. */
export function buildBlocker(s: Owned, player: string, cell: number): string | null {
  const c = cellAt(cell)
  if (c.type !== 'quartier' || !c.group) return 'not_buildable'
  if (ownerOf(s, cell) !== player) return 'not_owner'
  if (!ownsGroup(s, player, c.group)) return 'group_incomplete'
  const lvl = levelOf(s, cell)
  if (lvl >= 5) return 'max_buildings'
  if (lvl > Math.min(...groupCells(c.group).map((i) => levelOf(s, i)))) return 'build_uneven'
  return null
}

/** Code d'erreur serveur si `player` ne peut pas vendre un bâtiment de `cell`, sinon null. */
export function sellBlocker(s: Owned, player: string, cell: number): string | null {
  const c = cellAt(cell)
  if (c.type !== 'quartier' || !c.group) return 'not_buildable'
  if (ownerOf(s, cell) !== player) return 'not_owner'
  const lvl = levelOf(s, cell)
  if (lvl <= 0) return 'no_buildings'
  if (lvl < Math.max(...groupCells(c.group).map((i) => levelOf(s, i)))) return 'sell_uneven'
  return null
}

const BUILD_PHASES = ['roll', 'jail', 'manage']
const SELL_PHASES = ['roll', 'jail', 'manage', 'debt']

/** Peut-on construire maintenant (tour, phase, règles, argent) ? */
export function canBuild(s: TdpState, player: string, cell: number): boolean {
  return (
    s.turn === player &&
    BUILD_PHASES.includes(s.phase) &&
    buildBlocker(s, player, cell) === null &&
    (s.cash[player] ?? 0) >= (cellAt(cell).house ?? Infinity)
  )
}

export function canSell(s: TdpState, player: string, cell: number): boolean {
  return s.turn === player && SELL_PHASES.includes(s.phase) && sellBlocker(s, player, cell) === null
}

/** Valeur des lieux (prix d'achat). */
export const propertiesValue = (s: Owned, player: string) =>
  cellsOf(s, player).reduce((t, i) => t + (cellAt(i).price ?? 0), 0)

/** Valeur des bâtiments (prix de construction). */
export const buildingsValue = (s: Owned, player: string) =>
  cellsOf(s, player).reduce((t, i) => t + levelOf(s, i) * (cellAt(i).house ?? 0), 0)

/** Ce que rapporterait la vente de tous les bâtiments (moitié prix, arrondi inférieur par maison). */
export const saleValue = (s: Owned, player: string) =>
  cellsOf(s, player).reduce((t, i) => t + levelOf(s, i) * Math.floor((cellAt(i).house ?? 0) / 2), 0)

/** Fortune = argent + lieux + bâtiments (critère du classement final). */
export const fortuneOf = (s: Owned & Pick<TdpState, 'cash'>, player: string) =>
  (s.cash[player] ?? 0) + propertiesValue(s, player) + buildingsValue(s, player)

export const isDouble = (d: [number, number] | null | undefined) => !!d && d[0] === d[1]

export const tdpActions = {
  roll: (): TdpAction => ({ type: 'roll' }),
  payJail: (): TdpAction => ({ type: 'pay_jail' }),
  useCard: (): TdpAction => ({ type: 'use_card' }),
  buy: (): TdpAction => ({ type: 'buy' }),
  pass: (): TdpAction => ({ type: 'pass' }),
  build: (cell: number): TdpAction => ({ type: 'build', cell }),
  sell: (cell: number): TdpAction => ({ type: 'sell', cell }),
  endTurn: (): TdpAction => ({ type: 'end_turn' }),
  tick: (): TdpAction => ({ type: 'tick' }),
  skip: (): TdpAction => ({ type: 'skip' }),
  back: (): TdpAction => ({ type: 'back' }),
}

export const TDP_DEFAULT_OPTIONS: TdpOptions = { format: 'chrono', minutes: 45, rounds: 15, turn_seconds: 45 }

export function normalizeOptions(options: Record<string, unknown>): TdpOptions {
  const f = options.format
  const m = Number(options.minutes)
  const r = Number(options.rounds)
  const t = Number(options.turn_seconds)
  return {
    format: f === 'tours' || f === 'classique' ? f : 'chrono',
    minutes: m === 30 || m === 60 ? m : 45,
    rounds: r === 10 || r === 20 ? r : 15,
    turn_seconds: t === 0 || t === 30 || t === 60 || t === 90 ? t : 45,
  }
}

export async function prepareTdpStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  return { ...normalizeOptions(options) }
}

export const PHASE_LABELS: Record<TdpState['phase'], string> = {
  roll: 'Lance les dés',
  jail: 'Au violon',
  buy: 'Acheter ?',
  manage: 'Gestion',
  debt: 'Dette à régler',
  finished: 'Partie terminée',
  aborted: 'Partie annulée',
}

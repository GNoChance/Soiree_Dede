import type { DieFace, MtrAction, MtrBid, MtrOptions, MtrState } from './types'

export const FACES: DieFace[] = [1, 2, 3, 4, 5, 6]

/** Miroir de `_mtr_valid` (supabase/games/menteur.sql). */
export function isValidBid(qty: number, face: number, bid: Pick<MtrBid, 'qty' | 'face'> | null, total: number): boolean {
  if (!Number.isInteger(qty) || qty < 1 || qty > total || face < 1 || face > 6) return false
  if (!bid) return face !== 1
  if (bid.face === 1) return face === 1 ? qty > bid.qty : qty >= 2 * bid.qty + 1
  if (face === 1) return qty >= Math.ceil(bid.qty / 2)
  return qty > bid.qty || (qty === bid.qty && face > bid.face)
}

/** Plus petite quantité valide pour cette valeur (null si aucune ≤ total). */
export function minQtyFor(face: number, bid: Pick<MtrBid, 'qty' | 'face'> | null, total: number): number | null {
  for (let q = 1; q <= total; q++) if (isValidBid(q, face, bid, total)) return q
  return null
}

/** Ce dé compte-t-il pour une enchère sur `face` ? (les 1 sont jokers sauf enchère Paco) */
export const matches = (d: number, face: number) => d === face || (face !== 1 && d === 1)

/** Joueur vivant suivant dans l'ordre de la table. */
export function nextAlive(s: Pick<MtrState, 'order' | 'alive'>, from: string): string | null {
  const n = s.order.length
  let i = s.order.indexOf(from)
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n
    if (s.alive.includes(s.order[i])) return s.order[i]
  }
  return null
}

export const mtrActions = {
  bid: (qty: number, face: DieFace): MtrAction => ({ type: 'bid', qty, face }),
  liar: (): MtrAction => ({ type: 'liar' }),
  pile: (): MtrAction => ({ type: 'pile' }),
  next: (): MtrAction => ({ type: 'next' }),
  tick: (): MtrAction => ({ type: 'tick' }),
}

export const MTR_DEFAULT_OPTIONS: MtrOptions = { turn_seconds: 45, pile: false }

export function normalizeOptions(options: Record<string, unknown>): MtrOptions {
  const t = Number(options.turn_seconds)
  return {
    turn_seconds: t === 30 || t === 60 ? t : 45,
    pile: options.pile === true,
  }
}

export async function prepareMenteurStart(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  return { ...normalizeOptions(options) }
}

/** Délai d'allumage d'un dé compté pendant la révélation (doit rester ≈ 0,4 s, cf. SQL). */
export const REVEAL_STEP_MS = 400
/** Temps de levée des gobelets avant le comptage. */
export const REVEAL_LIFT_MS = 1300
